import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldContext } from 'cortico/world.ts';
import type { World, WorldHost, WorldWebUiDecl, ToolDef, ToolSpec } from 'cortico/core/types.ts';
import { GameBrowser, ActionUncertainError } from './browser.ts';
import { MAJSOUL_CONFIG_GROUP, type MajsoulConfigSection } from './config.ts';
import { analyzeHand } from './hand.ts';
import { renderMajsoulState } from './render.ts';
const read: ToolSpec = { name: 'majsoul_status', description: '读取实时游戏权限、连接、手牌、公开牌河、副露和服务器可用操作。timer.fixedMs 是服务器固定计时毫秒；extraRaw 为加时原始值。', tags: ['read', 'snapshot'], parameters: { type: 'object', properties: {}, additionalProperties: false } };
export const MAJSOUL_TOOL_DECLS: Omit<ToolDef, 'handler'>[] = [
  read, { ...read, name: 'majsoul_observe', description: '读取最新公开牌局与 version；不重新开局、不刷新网页。看不到对手暗手和牌山。' }, {
      name: 'majsoul_reconnect', description: '断线时重新附着专用 Edge 的桥接，保留当前游戏页面，等待客户端认证。已经连通或本局已结算则只读取状态。不刷新、登录、建房或匹配。', tags: ['act'], barrierAfter: true,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
  }, {
      name: 'majsoul_act', description: '提交一个当前合法动作，等待服务器回执；出牌、立直同时指定 tile。吃碰杠指定当前 combinations 的 index。先动作，收到成功回执后再考虑一句短解说。结果 unknown 不可自动重发。', tags: ['act'], barrierAfter: true,
      parameters: { type: 'object', additionalProperties: false, properties: {
        version: { type: 'string' }, action: { type: 'string', enum: ['discard', 'chi', 'pon', 'ankan', 'minkan', 'kakan', 'riichi', 'tsumo', 'ron', 'kyushu', 'babei', 'pass'] },
        tile: { type: 'string', pattern: '^(?:[0-9][mps]|[1-7]z)$' }, index: { type: 'integer', minimum: 0 }, tsumogiri: { type: 'boolean', description: '需要明确摸切时填写 true。' },
      }, required: ['version', 'action'] }
  },
];
export class MajsoulWorld implements World {
  readonly id = 'majsoul';
  readonly game: GameBrowser;
  private host?: WorldHost;
  private fingerprint = '';
  private eventRevision = 0;
  private handAnalysis?: { version: string; value: ReturnType<typeof analyzeHand> };
  constructor(readonly ctx: WorldContext<MajsoulConfigSection>) {
    this.game = new GameBrowser(() => ctx.cfg.allowActions, join(ctx.dataDir, 'majsoul', 'actions.jsonl'), () => ctx.cfg.newRoundDelayMs, () => ctx.cfg.maxRenderFps);
  }
  envPromptVars(): Record<string, string> { return { 'majsoul.permissions': JSON.stringify({ actions: this.ctx.cfg.allowActions, decisionTargetMs: this.ctx.cfg.decisionTargetMs }) }; }
  suppressThinking(): boolean {
    const view = this.game.state.view;
    return !!this.host && this.ctx.cfg.allowActions && this.game.connected && view.active && view.complete;
  }
  webUi(): WorldWebUiDecl {
    const state = this.game.snapshot();
    return {
      label: '雀魂麻将', config: [MAJSOUL_CONFIG_GROUP],
      lamps: [{ label: '牌局桥接', state: this.game.error ? 'error' : this.game.connected ? 'online' : 'offline', hint: this.game.error || state.reason || '已接收公开牌局。' }],
      badges: [{ label: '游戏操作', value: this.ctx.cfg.allowActions ? '允许' : '暂停', tone: this.ctx.cfg.allowActions ? 'on' : 'off' }],
      panels: [{ id: 'game', title: '游戏状态', description: 'state 查询公开状态；connect 打开游戏；attach 附着桥接并保留页面。登录和开局由操作者完成。', getMethods: ['state'] }],
      invoke: (panel, method) => this.panel(panel, method),
      promptDocs: [{ key: 'worlds.majsoul.envPrompt', title: '雀魂 · 环境提示词', description: '先操作后短句解说、公开状态和回执。', path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)), role: 'envPrompt', vars: [{ name: 'majsoul.permissions', description: '权限与决策目标；实时状态以工具回执为准。' }] }],
    };
  }
  status() {
    const observation = this.game.snapshot();
    if (this.handAnalysis?.version !== observation.version) this.handAnalysis = { version: observation.version, value: analyzeHand(observation) };
    return { connected: this.game.connected, busy: this.game.busy, error: this.game.error, allowActions: this.ctx.cfg.allowActions, decisionTargetMs: this.ctx.cfg.decisionTargetMs,
      observation, handAnalysis: this.handAnalysis.value, fastMode: this.suppressThinking(), elapsedDecisionMs: observation.operationReceivedAt === null ? null : Date.now() - observation.operationReceivedAt,
      metricsFile: join(this.ctx.dataDir, 'majsoul', 'actions.jsonl') };
  }
  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.game.onState = view => {
      const fingerprint = JSON.stringify({ ...view, version: undefined, busy: this.game.busy });
      if (fingerprint === this.fingerprint) return;
      this.fingerprint = fingerprint;
      const revision = ++this.eventRevision;
      const meta = { connected: this.game.connected, active: view.active };
      host.pushDeferred({ type: 'majsoul.state', senderKey: this.id, tags: ['snapshot'], meta, render: () => {
        if (!this.host || revision !== this.eventRevision) return null;
        meta.connected = this.game.connected; meta.active = this.game.state.view.active;
        return this.renderState();
      } },
        { trigger: this.ctx.cfg.allowActions && view.ready && !this.game.busy ? 'preempt' : view.lastAction?.name === 'ActionHule' || view.lastAction?.name === 'ActionNoTile' || view.lastAction?.name === 'ActionLiuJu' ? 'debounce' : 'piggyback' });
    };
  }

  private renderState(): string {
    return renderMajsoulState(this.status());
  }
  private modelStatus(extra: Record<string, unknown> = {}): string {
    const status = this.status();
    return compactJson({ connected: status.connected, version: status.observation.version, ...extra, state: renderMajsoulState(status) });
  }
  async stop(): Promise<void> { this.game.onState = undefined; this.host = undefined; await this.game.stop(); this.fingerprint = ''; }
  async panel(panel: string, method: string): Promise<unknown> {
    if (panel !== 'game') throw new Error('未知面板。');
    if (method === 'state') return this.status();
    if (method !== 'connect' && method !== 'attach') throw new Error('未知游戏管理操作。');
    const permitted = MAJSOUL_CONFIG_GROUP.schema.properties!['worlds.majsoul.gameUrl'] as { enum: string[] };
    if (!permitted.enum.includes(this.ctx.cfg.gameUrl)) throw new Error('网页地址不在支持的雀魂地址中。');
    await this.game.connect(`http://127.0.0.1:${this.ctx.cfg.browserPort}`, this.ctx.cfg.gameUrl, method === 'connect');
    return this.status();
  }
  tools(): ToolDef[] {
    const read: ToolDef = { ...MAJSOUL_TOOL_DECLS[0], handler: async () => this.modelStatus() };
    return [read, { ...read, ...MAJSOUL_TOOL_DECLS[1] }, {
      ...MAJSOUL_TOOL_DECLS[2],
      handler: async (_args, call) => {
        try {
          call.signal?.throwIfAborted();
          if (this.game.connected) return this.modelStatus();
          if (!this.ctx.cfg.allowActions) throw new Error('游戏操作已暂停，不能自动重连。');
          if (!this.game.state.view.active && this.game.state.view.seat !== null) return this.modelStatus();
          await this.panel('game', 'attach');
          return this.modelStatus({ reconnect: 'bridge_attached', message: '桥接已附着，游戏页面保持原样，等待客户端认证；结算后等待下一局或由操作者开局。' });
        } catch (error) {
          return { failed: true, text: this.modelStatus({ error: error instanceof Error ? error.message : String(error) }) };
        }
      },
    }, {
      ...MAJSOUL_TOOL_DECLS[3],
      handler: async (args, call) => {
        try {
          // 成功回执只带动作结果与版本;完整状态由随后的 majsoul.state 事件送达,不重复塞进上下文。
          const { observation, ...rest } = await this.game.execute(args, this.ctx.cfg.commandTimeoutSec * 1000, call.signal) as Record<string, unknown> & { observation?: { version?: string } };
          return compactJson({ ...rest, version: observation?.version });
        } catch (error) {
          const unknown = error instanceof ActionUncertainError;
          return { failed: true, text: this.modelStatus({ outcome: unknown ? 'unknown' : 'rejected', retry: !unknown && this.ctx.cfg.allowActions && this.game.connected && !this.game.busy && this.game.state.view.ready,
            error: error instanceof Error ? error.message : String(error), rejectedAction: args.action, rejectedTile: args.tile }) };
        }
      },
    }];
  }
}

/** 小回执省略 false、null 与空字段；完整状态的真假值在 state 正文中显式列出。 */
function compactJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v === false || v === null || v === '' || (Array.isArray(v) && v.length === 0) ? undefined : v)) ?? 'null';
}
