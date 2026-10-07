import { createRequire } from 'node:module';
import { commandFor, type Observation } from './state.ts';

// Reuse the library's regular, seven-pairs and thirteen-orphans calculations.
const { Shoupai, Util } = createRequire(import.meta.url)('@kobalab/majiang-core') as {
  Shoupai: { fromString(text: string): object };
  Util: { xiangting(hand: object): number; xiangting_yiban(hand: object): number;
    xiangting_guoshi(hand: object): number; xiangting_qidui(hand: object): number;
    tingpai(hand: object): string[] | null };
};
const base = (value: string) => value.replace(/^0/, '5');
const order = (value: string) => 'mpsz'.indexOf(value[1]) * 10 + Number(base(value)[0]);
const compact = (tiles: string[]) => ['m', 'p', 's', 'z'].map(suit => {
  const digits = tiles.filter(t => t[1] === suit).sort((a, b) => order(a) - order(b)).map(t => t[0]).join('');
  return digits ? suit + digits : '';
}).join('');
const label = (value: string) => value[1] === 'z' ? ['东', '南', '西', '北', '白', '发', '中'][Number(value[0]) - 1]
  : `${value[0] === '0' ? '红5' : value[0]}${{ m: '万', p: '筒', s: '索' }[value[1]]}`;

export function analyzeHand(view: Observation) {
  if (!view.complete || !view.active || view.seat === null) return null;
  const own = view.players[view.seat];
  const sortedHand = [...view.hand].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const melds = own.melds.map(meld => {
    const text = compact(meld.tiles);
    // Direction affects scoring, but not shanten; '-' is valid for every open set.
    return text + (meld.kind === 'ankan' ? '' : '-');
  });
  const nativeHand = (tiles: string[]) => Shoupai.fromString([compact(tiles), ...melds].join(','));
  const routeShanten = (hand: object) => ({ regularShanten: Util.xiangting_yiban(hand),
    kokushiShanten: own.melds.length ? null : Util.xiangting_guoshi(hand),
    sevenPairsShanten: own.melds.length ? null : Util.xiangting_qidui(hand) });
  const seatWind = view.round ? `${(view.seat - view.round.dealer + view.players.length) % view.players.length + 1}z` : null;
  const roundWind = view.round ? `${view.round.wind + 1}z` : null;
  const closed = own.melds.every(meld => meld.kind === 'ankan');
  const discardFuriten = (hand: object, shanten: number, river: string[]) => {
    if (shanten !== 0) return false;
    const waits = Util.tingpai(hand);
    return waits === null ? null : waits.some(t => river.includes(base(t[1] + t[0])));
  };
  const visible = new Map<string, number>();
  const count = (value: string, n = 1) => visible.set(base(value), (visible.get(base(value)) ?? 0) + n);
  view.hand.forEach(t => count(t));
  view.doras.forEach(t => count(t));
  view.players.forEach(p => {
    p.discards.filter(d => !d.called).forEach(d => count(d.tile));
    p.melds.forEach(m => m.kind === 'ankan' && m.tiles.length === 1 ? count(m.tiles[0], 4) : m.tiles.forEach(t => count(t)));
    count('4z', p.norths);
  });
  const threats = view.players.flatMap((p, seat) => seat !== view.seat && p.riichi ? [seat] : []);
  const blockedDiscards: Array<{ tile: string; reason: string }> = [];
  const discardCandidates = [...new Set(sortedHand)].flatMap(tile => {
    if (!view.ready || !view.operations.some(op => op.type === 1)) return [];
    try { commandFor(view, { version: view.version, action: 'discard', tile }); }
    catch (error) { blockedDiscards.push({ tile, reason: error instanceof Error ? error.message : String(error) }); return []; }
    const remaining = [...view.hand]; remaining.splice(remaining.indexOf(tile), 1);
    const hand = nativeHand(remaining);
    const shanten = Util.xiangting(hand);
    const improvingTiles = (Util.tingpai(hand) ?? []).flatMap(t => {
      const value = t[1] + t[0];
      if (view.players.length === 3 && value[1] === 'm' && !['1', '9'].includes(value[0])) return [];
      const unseen = Math.max(0, 4 - (visible.get(value) ?? 0));
      return unseen ? [{ tile: value, unseen }] : [];
    });
    const riichi = view.operations.some(op => op.name === 'riichi' && op.combinations.some(c => c.split('|').includes(tile)));
    return [{ tile, shanten, ...routeShanten(hand), ukeire: improvingTiles.reduce((n, t) => n + t.unseen, 0),
      improvingTiles, riichiAllowed: riichi,
      discardFuriten: discardFuriten(hand, shanten, [...own.discards.map(d => base(d.tile)), base(tile)]),
      genbutsuAgainst: threats.filter(seat => view.players[seat].discards.some(d => base(d.tile) === base(tile))) }];
  }).sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire);
  // ponytail: first-order tile efficiency only; add value/call evaluation when needed.
  const hand = nativeHand(view.hand), shanten = Util.xiangting(hand);
  const orphans = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
  const kokushi = own.melds.length ? null : {
    uniqueKinds: orphans.filter(t => view.hand.includes(t)).length,
    pairTiles: orphans.filter(t => view.hand.filter(v => v === t).length >= 2),
    missingTiles: orphans.filter(t => !view.hand.includes(t)).map(tile => ({ tile, unseen: Math.max(0, 4 - (visible.get(tile) ?? 0)) })),
  };
  return { version: view.version, sortedHand, handText: sortedHand.map(label).join(' '), drawn: view.drawn,
    closed, seatWind, roundWind, valueHonorTiles: [...new Set(['5z', '6z', '7z', seatWind, roundWind].filter((t): t is string => t !== null))],
    shanten, ...routeShanten(hand), kokushi,
    discardFuriten: discardFuriten(hand, shanten, own.discards.map(d => base(d.tile))), riichiThreats: threats, blockedDiscards, discardCandidates };
}
