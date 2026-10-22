import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MajsoulWorld } from '../src/world.ts';
import { MAJSOUL_DEFAULTS } from '../src/config.ts';
import { renderMajsoulState } from '../src/render.ts';

test('compact decision text retains every legal candidate, river flag and server combination index', () => {
  const world = new MajsoulWorld({ cfg: { ...MAJSOUL_DEFAULTS, allowActions: true }, dataDir: 'scratch' } as any);
  const state = world.game.state;
  state.setSeat(2, [35000, 35000, 35000]);
  Object.assign(state.view, { active: true, complete: true, ready: true,
    hand: ['1m','9m','2p','3p','4p','5p','0p','6p','7p','2s','3s','4s','4z','1z'], drawn: '1z',
    round: { wind: 0, dealer: 1, honba: 2, riichiSticks: 1, leftTiles: 55 }, doras: ['3p'],
    operations: [{type:1,name:'discard',combinations:['4z']},{type:7,name:'riichi',combinations:['1z|1m']}],
    timer: {fixedMs:5000,extraRaw:20000},operationReceivedAt:Date.now(),
  });
  state.view.players[0].riichi = true;
  state.view.players[0].discards.push({tile:'1z',tsumogiri:true,riichi:true,called:true});
  const status = world.status(), before = structuredClone(status);
  const text = renderMajsoulState(status), a = status.handAnalysis!;
  assert.ok(text.includes(`version=${state.view.version}`));
  assert.ok(text.includes('本人座位=2 人数=3'));
  assert.ok(text.includes('自风=2z'));assert.ok(text.includes('0p'));assert.ok(text.includes('1z*!x'));
  assert.ok(text.includes('discard[0=4z] riichi[0=1z|1m]'));
  assert.ok(text.includes('禁打=4z:'));
  const rows = text.split('\n').filter(line=>/^[0-9][mpsz]\|/.test(line));
  assert.deepEqual(rows.map(line=>line.split('|')[0]),a.discardCandidates.map(c=>c.tile));
  for (const c of a.discardCandidates) {
    const cells = rows.find(line=>line.startsWith(c.tile+'|'))!.split('|');
    assert.equal(Number(cells[2]),c.ukeire);
    for (const t of c.improvingTiles) assert.ok(cells[3].includes(`${t.tile}×${t.unseen}`));
    assert.equal(cells[4],String(c.riichiAllowed));
    assert.equal(cells[5],c.discardFuriten===null?'?':String(c.discardFuriten));
    assert.equal(cells[6],c.genbutsuAgainst.join(',')||'无');
  }
  assert.deepEqual(status,before);
  assert.ok(text.length < JSON.stringify(status).length * 0.65);
});

test('waiting, disconnected and ended states remain explicit without inventing candidate data', () => {
  const world = new MajsoulWorld({cfg:{...MAJSOUL_DEFAULTS},dataDir:'scratch'} as any);
  const text = renderMajsoulState(world.status());
  assert.ok(text.includes('connected=false active=false complete=false ready=false allowActions=false'));
  assert.ok(text.includes('operations=无'));assert.ok(!text.includes('discardCandidates'));
  assert.ok(text.includes('等待进入牌局'));
});
