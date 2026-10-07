import { randomUUID } from 'node:crypto';
import type { Data } from './protocol.ts';

export const OPERATIONS: Record<number, string> = { 1: 'discard', 2: 'chi', 3: 'pon', 4: 'ankan', 5: 'minkan', 6: 'kakan', 7: 'riichi', 8: 'tsumo', 9: 'ron', 10: 'kyushu', 11: 'babei' };
export interface Operation { type: number; name: string; combinations: string[]; }
export interface Player { score: number; riichi: boolean; discards: Array<{ tile: string; tsumogiri: boolean; riichi: boolean; called: boolean }>; melds: Array<{ kind: string; tiles: string[]; froms: number[] }>; norths: number; }
export interface Observation {
  version: string; active: boolean; complete: boolean; ready: boolean; reason: string;
  seat: number | null; playerCount: number | null; hand: string[]; drawn: string | null;
  round: { wind: number; dealer: number; honba: number; riichiSticks: number; leftTiles: number } | null;
  doras: string[]; players: Player[]; operations: Operation[];
  operationReceivedAt: number | null; timer: { fixedMs: number; extraRaw: number } | null;
  lastAction: { name: string; seat?: number; tile?: string } | null;
}
const tilePattern = /^(?:[0-9][mps]|[1-7]z)$/;
export function tile(value: unknown): string {
  if (typeof value !== 'string' || !tilePattern.test(value)) throw new Error('牌格式无效。');
  return value;
}
const base = (value: string) => value[0] === '0' ? `5${value[1]}` : value;
const player = (score: number): Player => ({ score, riichi: false, discards: [], melds: [], norths: 0 });
export class GameState {
  view: Observation = { version: randomUUID(), active: false, complete: false, ready: false, reason: '等待进入牌局。', seat: null, playerCount: null, hand: [], drawn: null, round: null, doras: [], players: [], operations: [], operationReceivedAt: null, timer: null, lastAction: null };
  private epoch = randomUUID();
  private revision = 0;
  private step: number | null = null;
  private previous = '';
  snapshot(): Observation { return structuredClone(this.view); }
  touch(): void { this.view.version = `${this.epoch}:${++this.revision}`; }
  block(reason: string): void { this.view.complete = false; this.view.ready = false; this.view.reason = reason; this.view.operations = []; this.touch(); }
  reset(seat: number | null = null, playerCount: number | null = null): void {
    const fresh = new GameState(); this.view = fresh.view; this.epoch = fresh.epoch; this.revision = 0; this.step = null; this.previous = ''; this.view.seat = seat; this.view.playerCount = playerCount; this.touch();
  }
  setSeat(seat: number, scores: number[]): void {
    if (!Number.isInteger(seat) || seat < 0 || seat >= scores.length || ![3, 4].includes(scores.length)) throw new Error('无法确认本人座位。');
    this.view.seat = seat; this.view.playerCount = scores.length; this.view.players = scores.map(player); this.touch();
  }
  private owner(seat: number): Player {
    if (!Number.isInteger(seat) || !this.view.players[seat]) throw new Error('公开消息的座位无效。');
    return this.view.players[seat];
  }
  private remove(value: string): void {
    const index = this.view.hand.indexOf(value);
    if (index < 0) throw new Error('本人手牌与服务器动作不一致，请刷新游戏恢复状态。');
    this.view.hand.splice(index, 1);
  }
  consume(): void { this.view.operations = []; this.view.ready = false; this.view.timer = null; this.touch(); }
  apply(name: string, data: Data, step?: number, receivedAt = Date.now()): boolean {
    const signature = JSON.stringify([name, step, data]);
    if (signature === this.previous) return false;
    if (name !== 'ActionNewRound' && step !== undefined && this.step !== null && step !== this.step + 1) {
      throw new Error('牌局消息顺序不连续，请刷新游戏恢复状态。');
    }
    this.previous = signature; if (step !== undefined) this.step = step;
    const v = this.view;
    v.operations = []; v.ready = false; v.timer = null; v.operationReceivedAt = null;
    if (name === 'ActionNewRound') {
      if (data.opens?.some((open: Data) => open.tiles?.length || open.count?.some((count: number) => count > 0))) throw new Error('当前特殊规则的公开手牌尚未支持。');
      const scores = data.scores as number[];
      if (![3, 4].includes(scores.length) || (v.playerCount !== null && scores.length < v.playerCount) || ![13, 14].includes(data.tiles.length)) throw new Error('新局状态不完整。');
      v.active = true; v.complete = v.seat !== null; v.reason = v.complete ? '' : '尚未确认本人座位。';
      v.hand = data.tiles.map(tile); v.drawn = v.hand.length === 14 ? v.hand.at(-1)! : null;
      // authGame 的实际座位数优先；三麻分数消息可以保留第四格占位。
      v.players = scores.slice(0, v.playerCount ?? scores.length).map(player); v.doras = (data.doras?.length ? data.doras : [data.dora]).map(tile);
      v.round = { wind: data.chang, dealer: data.ju, honba: data.ben, riichiSticks: data.liqibang, leftTiles: data.left_tile_count };
    } else if (!v.active || !v.complete) { this.touch(); return true; }
    else if (name === 'ActionDealTile') {
      this.owner(data.seat);
      if (data.seat === v.seat) { v.drawn = tile(data.tile); v.hand.push(v.drawn); }
      if (v.round) v.round.leftTiles = data.left_tile_count;
    } else if (name === 'ActionDiscardTile') {
      const discarded = tile(data.tile), p = this.owner(data.seat);
      p.discards.push({ tile: discarded, tsumogiri: !!data.moqie, riichi: !!(data.is_liqi || data.is_wliqi), called: false });
      if (data.is_liqi || data.is_wliqi) p.riichi = true;
      if (data.seat === v.seat) { this.remove(discarded); v.drawn = null; }
    } else if (name === 'ActionChiPengGang') {
      const p = this.owner(data.seat), tiles = data.tiles.map(tile) as string[], froms = data.froms as number[];
      if (froms.length !== tiles.length || ![0, 1, 2].includes(data.type)) throw new Error('副露状态不完整。');
      for (let i = 0; i < tiles.length; i++) {
        if (froms[i] === data.seat) { if (data.seat === v.seat) this.remove(tiles[i]); }
        else {
          const river = this.owner(froms[i]).discards;
          const last = river.at(-1); if (!last || last.tile !== tiles[i]) throw new Error('副露与牌河不一致。');
          last.called = true;
        }
      }
      p.melds.push({ kind: ['chi', 'pon', 'minkan'][data.type], tiles, froms: [...froms] });
      if (data.seat === v.seat) v.drawn = null;
    } else if (name === 'ActionAnGangAddGang') {
      const p = this.owner(data.seat), value = tile(data.tiles), normalized = base(value);
      if (data.type === 3) {
        const own = v.hand.filter(t => base(t) === normalized);
        if (data.seat === v.seat) { if (own.length !== 4) throw new Error('暗杠手牌不完整。'); own.forEach(t => this.remove(t)); }
        // 对手暗杠保留服务器给出的牌种，不推测其中是否有红五。
        p.melds.push({ kind: 'ankan', tiles: data.seat === v.seat ? own : [value], froms: [] });
      } else if (data.type === 2) {
        const meld = p.melds.find(m => m.kind === 'pon' && base(m.tiles[0]) === normalized);
        if (!meld) throw new Error('加杠前的碰牌缺失。');
        if (data.seat === v.seat) this.remove(value);
        meld.kind = 'kakan'; meld.tiles.push(value); meld.froms.push(data.seat);
      } else throw new Error('未知杠牌动作。');
      if (data.seat === v.seat) v.drawn = null;
    } else if (name === 'ActionBaBei') {
      this.owner(data.seat).norths++; if (data.seat === v.seat) { this.remove('4z'); v.drawn = null; }
    } else if (['ActionHule', 'ActionLiuJu', 'ActionNoTile'].includes(name)) {
      v.active = false; v.reason = '本局结束，等待下一局。';
    } else throw new Error(`尚未支持的牌局动作：${name}。`);
    if (data.liqi && !data.liqi.failed) {
      this.owner(data.liqi.seat).score = data.liqi.score;
      if (v.round) v.round.riichiSticks = data.liqi.liqibang;
    }
    if (data.scores?.length && typeof data.scores[0] === 'number') data.scores.slice(0, v.players.length).forEach((score: number, i: number) => { this.owner(i).score = score; });
    if (data.doras?.length) v.doras = data.doras.map(tile);
    if (data.operation && v.active && v.complete) {
      if (data.operation.seat !== v.seat) throw new Error('可选操作不属于本人座位。');
      v.operations = data.operation.operation_list.map((op: Data) => ({ type: op.type, name: OPERATIONS[op.type] ?? 'unsupported', combinations: [...op.combination] }));
      if (v.operations.some(op => op.name === 'unsupported')) throw new Error('当前特殊操作尚未支持。');
      v.operationReceivedAt = receivedAt; v.timer = { fixedMs: data.operation.time_fixed, extraRaw: data.operation.time_add };
      v.ready = v.operations.length > 0;
    }
    v.lastAction = { name, ...(Number.isInteger(data.seat) ? { seat: data.seat } : {}), ...((name === 'ActionDiscardTile' || (name === 'ActionDealTile' && data.seat === v.seat)) && typeof data.tile === 'string' && tilePattern.test(data.tile) ? { tile: data.tile } : {}) };
    this.touch(); return true;
  }
}
export interface ActionRequest { method: string; data: Data; expectedAction: string | null; tile?: string; }
export function commandFor(view: Observation, args: Record<string, unknown>): ActionRequest {
  if (args.version !== view.version) throw new Error('观察版本过期，请读取新状态。');
  if (!view.ready || !view.complete) throw new Error(view.reason || '当前没有可操作的决策窗口。');
  const name = args.action;
  const own = '.lq.FastTest.inputOperation', call = '.lq.FastTest.inputChiPengGang';
  if (name === 'pass') {
    if (view.operations.some(op => op.type === 1)) throw new Error('需要出牌时不能跳过。');
    const method = view.operations.some(op => [2, 3, 5].includes(op.type)) ? call : own;
    return { method, data: { cancel_operation: true }, expectedAction: null };
  }
  const op = view.operations.find(op => op.name === name);
  if (!op) throw new Error('服务器当前没有提供这个操作。');
  const data: Data = { type: op.type };
  if (op.type === 1 || op.type === 7) {
    const value = tile(args.tile);
    if (!view.hand.includes(value)) throw new Error('选定牌不在本人手牌中。');
    if (op.type === 1 && op.combinations.some(combo => combo.split('|').some(forbidden => base(forbidden) === base(value)))) throw new Error('这张牌被服务器列为禁止弃牌，红五与普通五受同一限制。');
    if (op.type === 7 && !op.combinations.some(combo => combo.split('|').includes(value))) throw new Error('这张牌不在合法立直弃牌中。');
    if (view.players[view.seat!]?.riichi && value !== view.drawn) throw new Error('立直后只能摸切。');
    if (args.tsumogiri === true && value !== view.drawn) throw new Error('摸切牌与刚摸到的牌不一致。');
    data.tile = value;
    if (args.tsumogiri === true || (value === view.drawn && view.hand.filter(t => t === value).length === 1) || view.players[view.seat!]?.riichi) data.moqie = true;
  } else if (op.type === 11) {
    if (!view.hand.includes('4z')) throw new Error('当前手牌没有北，不能拔北。');
    data.moqie = view.drawn === '4z';
  } else if ([2, 3, 4, 5, 6].includes(op.type)) {
    if (!Number.isInteger(args.index) || (args.index as number) < 0 || (args.index as number) >= op.combinations.length) throw new Error('请指定当前 combinations 的合法索引。');
    if (args.index !== 0) data.index = args.index;
    if ([4, 6].includes(op.type)) data.tile = tile(op.combinations[args.index as number].split('|')[0]);
  }
  const expectedAction = op.type === 1 || op.type === 7 ? 'ActionDiscardTile' : [2, 3, 5].includes(op.type) ? 'ActionChiPengGang' : [4, 6].includes(op.type) ? 'ActionAnGangAddGang' : [8, 9].includes(op.type) ? 'ActionHule' : op.type === 10 ? 'ActionLiuJu' : 'ActionBaBei';
  return { method: [2, 3, 5].includes(op.type) ? call : own, data, expectedAction, ...(data.tile ? { tile: data.tile } : {}) };
}
