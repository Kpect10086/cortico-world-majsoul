import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page, type Frame } from 'playwright-core';
import { installHook } from './browser-hook.ts';
import { action, decode, request, response, unpack, type Data } from './protocol.ts';
import { GameState, commandFor, type Observation, type ActionRequest } from './state.ts';

export class ActionUncertainError extends Error {}
interface Pending { id: number; version: string; observation: Observation; request: ActionRequest; ack: boolean; changed: boolean; publicChanged: boolean; resolve: (data: Data) => void; reject: (error: Error) => void; cleanup: () => void; startedAt: number; decisionMs: number | null; }
export class GameBrowser {
  readonly state = new GameState();
  onState?: (view: Observation) => void;
  error = '';
  private browser?: Browser;
  private page?: Page;
  private socket: number | null = null;
  private serial = 0;
  private nextId = 65535;
  private requests = new Map<string, { method: string; accountId?: number }>();
  private pending?: Pending;
  private connecting?: Promise<void>;
  private readonly onPageClose = () => this.disconnected('专用游戏页面已关闭。');
  private readonly onNavigation = (frame: Frame) => { if (frame === this.page?.mainFrame()) this.disconnected('游戏页面已刷新，等待状态恢复。'); };
  private readonly onBrowserDisconnected = () => this.disconnected('专用浏览器连接已断开。');
  constructor(private readonly allowActions: () => boolean, private readonly metricsFile?: string, private readonly newRoundDelayMs: () => number = () => 4000) {}
  get connected(): boolean { return !!this.browser?.isConnected() && this.socket !== null; }
  get busy(): boolean { return !!this.pending; }
  snapshot(): Observation { return this.state.snapshot(); }
  private publish(): void { this.onState?.(this.snapshot()); }
  async connect(endpoint: string, url: string, navigate = true): Promise<void> {
    if (this.connecting) return this.connecting;
    if (navigate && this.browser?.isConnected() && this.page && !this.page.isClosed() && this.socket === null) return;
    this.connecting = this.attach(endpoint, url, navigate).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async attach(endpoint: string, url: string, navigate: boolean): Promise<void> {
    await this.stop();
    this.error = ''; this.state.reset(); this.requests.clear(); this.nextId = 65535;
    try {
      this.browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
      const context = this.browser.contexts()[0];
      if (!context) throw new Error('专用浏览器没有可连接的页面。');
      const binding = `__majsoul_${randomUUID().replaceAll('-', '')}`;
      await context.exposeBinding(binding, (source, packet) => {
        if (source.page !== this.page || source.frame !== this.page?.mainFrame() || new URL(source.page.url()).origin !== new URL(url).origin) return;
        this.receive(packet);
      });
      // tsx 为命名函数注入 __name；序列化到网页时一并提供这个无副作用助手。
      const script = `(() => { const __name = value => value; (${installHook.toString()})(${JSON.stringify(binding)}); })();`;
      await context.addInitScript({ content: script });
      this.page = context.pages().find(p => p.url().startsWith(new URL(url).origin)) ?? context.pages().find(p => p.url() === 'about:blank') ?? await context.newPage();
      this.page.on('close', this.onPageClose);
      this.page.on('framenavigated', this.onNavigation);
      this.browser.on('disconnected', this.onBrowserDisconnected);
      if (navigate) await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      else await this.page.evaluate(script);
      this.publish();
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); await this.stop(); throw error; }
  }
  private disconnected(message: string): void {
    this.socket = null; this.state.block(message); this.error = message;
    this.failPending(new ActionUncertainError('连接中断，已提交操作结果未知；请重新观察，不要重发。'));
    this.publish();
  }
  receive(packet: Data): void {
    try {
      if (!Number.isInteger(packet.socket)) throw new Error('无效浏览器连接编号。');
      if (packet.kind === 'open') return;
      if (packet.kind === 'close') { if (packet.socket === this.socket) this.disconnected(this.state.view.active ? '游戏服务器连接已关闭，等待客户端重连。' : '本局已结算，等待下一局或开局。'); return; }
      if (packet.kind === 'fault') throw new Error('游戏消息格式尚未支持，自动操作已停止。');
      if (packet.kind !== 'frame' || typeof packet.bytes !== 'string' || packet.bytes.length > 3 * 1024 * 1024) throw new Error('无效游戏桥接消息。');
      const frame = unpack(Buffer.from(packet.bytes, 'base64')), key = `${packet.socket}:${frame.id}`;
      if (frame.type === 2 && packet.direction === 'out') {
        if (!frame.name.startsWith('.lq.FastTest.')) return;
        if (frame.name.endsWith('.authGame')) {
          const data = decode('lq.ReqAuthGame', frame.data);
          this.socket = packet.socket; this.serial = packet.serial; this.state.reset(); this.error = '';
          this.requests.clear(); this.requests.set(key, { method: frame.name, accountId: data.account_id }); this.publish(); return;
        }
        this.requests.set(key, { method: frame.name });
        if (packet.socket === this.socket && /\.input(Operation|ChiPengGang)$/.test(frame.name)) {
          if (this.pending) this.pending.publicChanged = true;
          this.serial = packet.serial; this.state.consume(); this.publish();
        }
        return;
      }
      if (packet.socket !== this.socket || packet.direction !== 'in') return;
      if (frame.type === 3) {
        if (frame.id === this.pending?.id) {
          const data = response(this.pending.request.method, frame.data);
          if (data.error?.code) { this.failPending(new Error(`雀魂拒绝操作，错误码 ${data.error.code}；请按最新合法候选重新选择。`), 'rejected'); return; }
          this.pending.ack = true; this.finishPending(); return;
        }
        const original = this.requests.get(key); if (!original) return;
        this.requests.delete(key);
        if (!/\.(authGame|enterGame|syncGame)$/.test(original.method)) return;
        const data = response(original.method, frame.data);
        if (data.error?.code) throw new Error(`游戏状态请求被拒绝，错误码 ${data.error.code}。`);
        if (original.method.endsWith('.authGame')) {
          const seat = data.seat_list.indexOf(original.accountId);
          this.state.setSeat(seat, data.seat_list.map(() => 0));
        } else if (data.game_restore) this.restore(data.game_restore);
        this.publish(); return;
      }
      if (frame.type !== 1) return;
      this.serial = packet.serial;
      if (frame.name === '.lq.ActionPrototype') {
        const current = action(decode('lq.ActionPrototype', frame.data), true);
        this.apply(current.name, current.data, current.step); this.error = '';
      } else if (frame.name === '.lq.NotifyGameEndResult') {
        this.state.view.active = false; this.state.consume();
      } else return;
      this.finishPending(); this.publish();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.state.block(this.error); this.failPending(new ActionUncertainError('协议或状态核对失败；已提交动作结果未知，不自动重发。')); this.publish();
    }
  }
  private apply(name: string, data: Data, step?: number): void {
    const changed = this.state.apply(name, data, step);
    const pending = this.pending;
    if (changed && pending) pending.publicChanged = true;
    if (changed && pending?.request.expectedAction === name) {
      const own = data.seat === this.state.view.seat;
      const matches = name === 'ActionHule' ? data.hules.some((h: Data) => h.seat === this.state.view.seat) : name === 'ActionLiuJu' || own;
      const type = pending.request.data.type;
      const operationMatches = name === 'ActionDiscardTile' ? data.tile === pending.request.tile && (type !== 7 || data.is_liqi || data.is_wliqi)
        : name === 'ActionChiPengGang' ? data.type === ({ 2: 0, 3: 1, 5: 2 } as Record<number, number>)[type]
        : name === 'ActionAnGangAddGang' ? data.type === (type === 4 ? 3 : 2) : true;
      if (matches && operationMatches) pending.changed = true;
    }
  }
  private restore(data: Data): void {
    const { seat, playerCount } = this.state.view; this.state.reset(seat, playerCount);
    // ponytail: 重连只重放带新局起点的 actions；仅 snapshot 时等待下一局，避免猜测摸牌和操作窗口。
    if (!data.actions?.length || data.actions[0].name !== 'ActionNewRound') { this.state.block('恢复消息缺少新局起点，请等待下一局或重新开友人局。'); return; }
    for (const entry of data.actions) { const current = action(entry, false); this.state.apply(current.name, current.data, current.step); }
    if (this.state.view.operationReceivedAt !== null) this.state.view.operationReceivedAt -= data.passed_waiting_time || 0;
  }
  async execute(args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Data> {
    signal?.throwIfAborted();
    if (!this.allowActions()) throw new Error('游戏操作已暂停；请查看控制台的实时权限。');
    if (!this.connected || !this.page) throw new Error('尚未连接牌局，请使用游戏启动入口并手动开局。');
    if (this.pending) throw new Error('上一个动作尚未完成。');
    const view = this.snapshot(), spec = commandFor(view, args);
    // ponytail: 当前桥接没有发牌就绪信号，首个操作使用可调等待；获得客户端就绪信号后替换它。
    const waitMs = view.lastAction?.name === 'ActionNewRound' && view.round?.dealer === view.seat && view.operationReceivedAt !== null
      ? Math.max(0, this.newRoundDelayMs() - (Date.now() - view.operationReceivedAt)) : 0;
    if (waitMs > 0) {
      await delay(waitMs, undefined, { signal });
      if (this.pending) throw new Error('上一个动作尚未完成。');
      if (!this.connected || !this.page || this.state.view.version !== view.version) throw new Error('开局等待期间牌局已变化，请读取新状态。');
    }
    if (this.nextId < 60000) throw new Error('本次连接的动作序号已用完，请重新连接游戏。');
    const id = this.nextId--, serial = this.serial, socket = this.socket, page = this.page;
    const startedAt = Date.now();
    let submitted = false;
    const completion = new Promise<Data>((resolve, reject) => {
      const timeout = setTimeout(() => this.failPending(new ActionUncertainError('等待服务器结果超时；操作结果未知，不自动重发。')), timeoutMs);
      const abort = () => this.failPending(new ActionUncertainError('提交后等待被取消；操作结果未知，不自动重发。'));
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { id, version: view.version, observation: view, request: spec, ack: false, changed: false, publicChanged: false, resolve, reject, cleanup, startedAt, decisionMs: view.operationReceivedAt === null ? null : startedAt - view.operationReceivedAt };
    });
    void completion.catch(() => {});
    try {
      signal?.throwIfAborted();
      if (!this.allowActions()) throw new Error('游戏操作已暂停。');
      const encoded = request(spec.method, id, spec.data).toString('base64');
      const result = await page.evaluate(({ socket, serial, encoded }) => (window as any).__corticoMajsoul?.send(socket, serial, encoded), { socket, serial, encoded });
      if (!result?.sent) throw new Error(result?.reason || '网页桥接未安装。');
      submitted = true;
      // 如权威状态已经先到，不能用提交时的状态覆盖它。
      this.serial = Math.max(this.serial, result.serial);
      if (this.state.view.version === view.version) this.state.consume();
      this.publish();
    } catch (error) {
      const failure = submitted || !(error instanceof Error) || /evaluate|Target|closed/i.test(error.message) ? new ActionUncertainError('网页动作已尝试提交，结果未知；请重新观察，不自动重发。') : error;
      this.failPending(failure, failure instanceof ActionUncertainError ? 'unknown' : 'not_sent'); throw failure;
    }
    return completion;
  }
  private finishPending(): void {
    const pending = this.pending;
    if (!pending?.ack || (pending.request.expectedAction && !pending.changed)) return;
    this.pending = undefined; pending.cleanup();
    if (!pending.request.expectedAction && this.state.view.version === pending.version) this.state.consume();
    const result = { outcome: pending.changed ? 'state_changed' : 'server_accepted', id: pending.id, decisionMs: pending.decisionMs, acknowledgementMs: Date.now() - pending.startedAt, observation: this.snapshot() };
    this.metric(result); pending.resolve(result); this.publish();
  }
  private failPending(error: Error, outcome: 'unknown' | 'rejected' | 'not_sent' = 'unknown'): void {
    const pending = this.pending; if (!pending) return;
    this.pending = undefined; pending.cleanup();
    if (outcome === 'rejected' && !pending.publicChanged) {
      const view = this.state.view, before = pending.observation;
      view.operations = structuredClone(before.operations); view.ready = before.ready;
      view.timer = before.timer; view.operationReceivedAt = before.operationReceivedAt; this.state.touch();
    } else if (outcome === 'unknown' && !pending.publicChanged) this.state.consume();
    this.metric({ outcome, id: pending.id, type: pending.request.data.type, tile: pending.request.tile, ack: pending.ack, decisionMs: pending.decisionMs, acknowledgementMs: Date.now() - pending.startedAt, error: error.message });
    pending.reject(error); this.publish();
  }
  private metric(data: Data): void {
    if (!this.metricsFile) return;
    const { observation, ...record } = data;
    void mkdir(dirname(this.metricsFile), { recursive: true }).then(() => appendFile(this.metricsFile!, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n')).catch(() => {});
  }
  async stop(): Promise<void> {
    this.failPending(new ActionUncertainError('World 已停止，提交结果未知。'));
    if (this.page && !this.page.isClosed()) await this.page.evaluate(() => { if ((window as any).__corticoMajsoul) (window as any).__corticoMajsoul.enabled = false; }).catch(() => {});
    this.page?.off('close', this.onPageClose); this.page?.off('framenavigated', this.onNavigation);
    this.browser?.off('disconnected', this.onBrowserDisconnected);
    // connectOverCDP 的 close 断开调试连接，不结束用户启动的 Edge 进程。
    await this.browser?.close().catch(() => {});
    this.browser = undefined; this.page = undefined; this.socket = null; this.state.block('浏览器桥接未连接。');
  }
}
