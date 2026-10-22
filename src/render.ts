import type { MajsoulWorld } from './world.ts';

type Status = ReturnType<MajsoulWorld['status']>;
const value = (v: unknown) => v === null || v === undefined ? '?' : String(v);
const tiles = (v: string[]) => v.join(' ') || '无';
const counts = (v: { tile: string; unseen: number }[]) => v.map(t => `${t.tile}×${t.unseen}`).join(' ') || '无';
const routes = (v: { shanten: number; regularShanten: number; kokushiShanten: number | null; sevenPairsShanten: number | null }) =>
  [v.shanten, v.regularShanten, v.kokushiShanten, v.sevenPairsShanten].map(value).join('/');

/** 每份状态可独立决策；候选、牌河和操作索引完整保留。 */
export function renderMajsoulState(status: Status): string {
  const { observation: v, handAnalysis: a } = status;
  const lines = [
    `[雀魂] version=${v.version} connected=${status.connected} active=${v.active} complete=${v.complete} ready=${v.ready} allowActions=${status.allowActions} busy=${status.busy}`,
  ];
  if (status.error || v.reason) lines.push(`状态：${[status.error, v.reason].filter(Boolean).join('；')}`);
  if (v.seat !== null) lines.push(`本人座位=${v.seat} 人数=${value(v.playerCount)}`);
  if (v.round) lines.push(`场风=${v.round.wind + 1}z 庄家座位=${v.round.dealer} 本场=${v.round.honba} 立直棒=${v.round.riichiSticks} 余牌=${v.round.leftTiles}`);
  if (v.hand.length) lines.push(`hand=${tiles(a?.sortedHand ?? v.hand)} drawn=${v.drawn ?? '无'} doras=${tiles(v.doras)}`);
  if (v.players.length) lines.push('牌河标记：*=摸切 !=立直宣言 x=已被鸣走。');
  v.players.forEach((p, seat) => lines.push(`座${seat} 分=${p.score} 立直=${p.riichi} 拔北=${p.norths} 牌河=${p.discards.map(d => d.tile + (d.tsumogiri ? '*' : '') + (d.riichi ? '!' : '') + (d.called ? 'x' : '')).join(' ') || '无'} 副露=${p.melds.map(m => `${m.kind}(${tiles(m.tiles)};froms=${m.froms.join(',')})`).join(' ') || '无'}`));
  if (v.lastAction) lines.push(`最近动作=${v.lastAction.name} 座位=${value(v.lastAction.seat)} 牌=${value(v.lastAction.tile)}`);
  lines.push(`operations=${v.operations.map(op => `${op.name}${op.combinations.length ? '[' + op.combinations.map((c, i) => `${i}=${c}`).join(';') + ']' : ''}`).join(' ') || '无'}`);
  if (v.timer) lines.push(`计时 fixedMs=${v.timer.fixedMs} extraRaw=${v.timer.extraRaw} operationReceivedAt=${value(v.operationReceivedAt)}`);
  if (v.ready) lines.push(`决策目标=${status.decisionTargetMs}ms 已耗=${value(status.elapsedDecisionMs)}ms fastMode=${status.fastMode}`);
  if (a) {
    lines.push(`handAnalysis 门清=${a.closed} 自风=${value(a.seatWind)} 场风=${value(a.roundWind)} 役牌=${tiles(a.valueHonorTiles)} 向听(总/普通/国士/七对)=${routes(a)} 振听=${value(a.discardFuriten)} 立直威胁座位=${a.riichiThreats.join(',') || '无'}`);
    if (a.kokushi) lines.push(`国士 种类=${a.kokushi.uniqueKinds} 对子=${tiles(a.kokushi.pairTiles)} 缺牌×未见=${counts(a.kokushi.missingTiles)}`);
    if (a.blockedDiscards.length) lines.push(`禁打=${a.blockedDiscards.map(c => `${c.tile}:${c.reason}`).join('；')}`);
    if (a.discardCandidates.length) {
      lines.push('discardCandidates（保持牌效排序）：牌|向听(总/普通/国士/七对)|进张总数|进张牌×未见|可立直|振听|现物座位；?=未知/不适用');
      for (const c of a.discardCandidates) lines.push(`${c.tile}|${routes(c)}|${c.ukeire}|${counts(c.improvingTiles)}|${c.riichiAllowed}|${value(c.discardFuriten)}|${c.genbutsuAgainst.join(',') || '无'}`);
    }
  }
  return lines.join('\n');
}
