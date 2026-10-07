import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { WebSocketServer, type WebSocket } from 'ws';
import { action, decode, encode, envelope, request, unpack, xorAction, type Data } from '../src/protocol.ts';
import { GameState, commandFor } from '../src/state.ts';
import { GameBrowser, ActionUncertainError } from '../src/browser.ts';
import { MajsoulWorld } from '../src/world.ts';
import { MAJSOUL_CONFIG_GROUP, MAJSOUL_DEFAULTS } from '../src/config.ts';
import { analyzeHand } from '../src/hand.ts';

test('extension loads without a downloaded protocol and connection explains how to prepare it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'majsoul-package-test-'));
  try {
    await cp(fileURLToPath(new URL('../src', import.meta.url)), join(directory, 'src'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'junction');
    const entry = pathToFileURL(join(directory, 'src/index.ts')).href;
    const browser = new URL('./browser.ts', entry).href;
    const script = `import assert from 'node:assert/strict';
      const { default: definition } = await import(${JSON.stringify(entry)});
      assert.equal(definition.id, 'majsoul');
      const { GameBrowser } = await import(${JSON.stringify(browser)});
      await assert.rejects(new GameBrowser(() => false).connect('http://127.0.0.1:1', 'https://game.maj-soul.com/1/'), /start-majsoul\\.cmd/);`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('console dispatches game state and connect through the World contract', async () => {
  const cfg = { ...MAJSOUL_DEFAULTS };
  const world = new MajsoulWorld({ cfg, dataDir: join(tmpdir(), 'majsoul-interface-test') } as ConstructorParameters<typeof MajsoulWorld>[0]);
  const panel = world.console();
  assert.equal(typeof panel.invoke, 'function');
  assert.deepEqual(await panel.invoke!('game', 'state', []), world.status());
  cfg.allowActions = true;
  assert.equal((await panel.invoke!('game', 'state', []) as any).allowActions, true);
  await assert.rejects(panel.invoke!('missing', 'state', []), /未知面板/);
  await assert.rejects(panel.invoke!('game', 'missing', []), /未知游戏管理操作/);
  cfg.gameUrl = 'https://example.invalid/';
  await assert.rejects(panel.invoke!('game', 'connect', []), /网页地址不在/);
});

const hand = ['0m', '5m', '5m', '5m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z'];
const operation = (types: number[], combinations: Record<number, string[]> = {}) => ({ seat: 0, operation_list: types.map(type => ({ type, combination: combinations[type] || [] })), time_fixed: 60000, time_add: 20000 });
const round = (op = operation([1])) => decode('lq.ActionNewRound', encode('lq.ActionNewRound', { tiles: hand, scores: [25000, 25000, 25000, 25000], doras: ['3p'], operation: op, left_tile_count: 69 }));
const message = (name: string, data: Data) => decode(`lq.${name}`, encode(`lq.${name}`, data));
const start = () => { const state = new GameState(); state.setSeat(0, [0, 0, 0, 0]); state.apply('ActionNewRound', round(), 0); return state; };
const args = (state: GameState, action: string, extra: Data = {}) => ({ version: state.view.version, action, ...extra });
const sanmaHand = ['1m', '9m', '2p', '3p', '4p', '5p', '0p', '6p', '7p', '2s', '3s', '4s', '4z', '1z'];

test('sanma authentication and restore retain three seats with four score slots; riichi context includes discard furiten', () => {
  const game = new GameBrowser(() => true);
  const receive = (direction: string, bytes: Buffer) => game.receive({ kind: 'frame', socket: 1, serial: 0, direction, bytes: bytes.toString('base64') });
  receive('out', request('.lq.FastTest.authGame', 1, { account_id: 103 }));
  receive('in', envelope(3, 1, '', encode('lq.ResAuthGame', { seat_list: [101, 102, 103] })));
  receive('out', request('.lq.FastTest.syncGame', 2, {}));
  receive('in', envelope(3, 2, '', encode('lq.ResSyncGame', { game_restore: { actions: [{ name: 'ActionNewRound', step: 0,
    data: encode('lq.ActionNewRound', { ...round(), tiles: sanmaHand, scores: [35000, 35000, 35000, 0], ju: 1, operation: { ...operation([1, 11]), seat: 2 } }) }] } })));
  const v = game.state.view;
  assert.equal(game.error, ''); assert.equal(v.complete, true);
  assert.equal(v.playerCount, 3); assert.equal(v.players.length, 3); assert.equal(v.seat, 2);
  const analysis = analyzeHand(v)!;
  assert.equal(analysis.closed, true); assert.equal(analysis.seatWind, '2z'); assert.equal(analysis.roundWind, '1z');
  assert.ok(!analysis.valueHonorTiles.includes('4z'));
  assert.ok(analysis.discardCandidates.every(c => c.improvingTiles.every(t => t.tile[1] !== 'm' || ['1m', '9m'].includes(t.tile))));
  assert.equal(commandFor(v, { version: v.version, action: 'babei' }).data.type, 11);
  game.state.apply('ActionBaBei', message('ActionBaBei', { seat: 2, scores: [35000, 35000, 35000, 0] }), 1);
  assert.equal(v.players[2].norths, 1); assert.ok(!v.hand.includes('4z')); assert.equal(v.players.length, 3);
  assert.throws(() => game.state.apply('ActionDealTile', message('ActionDealTile', { seat: 3 }), 2), /座位无效/);

  const state = start(), own = state.view.players[0];
  state.view.hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '2s', '3s', '0m'];
  // Includes already called discards; zero unseen copies still cause furiten.
  own.discards = [{ tile: '4s', called: true, tsumogiri: false, riichi: false }];
  state.view.players[1].melds = [{ kind: 'ankan', tiles: ['4s'], froms: [] }];
  const candidate = analyzeHand(state.view)!.discardCandidates.find(c => c.tile === '0m')!;
  assert.equal(candidate.discardFuriten, true);
  assert.ok(!candidate.improvingTiles.some(t => t.tile === '4s'));
  own.discards = [];
  state.view.hand = state.view.hand.slice(0, -1).concat('1s');
  assert.equal(analyzeHand(state.view)!.discardCandidates.find(c => c.tile === '1s')!.discardFuriten, true, 'candidate discard is part of the new river');
  state.view.hand.pop(); state.view.ready = false;
  assert.equal(analyzeHand(state.view)!.discardFuriten, false);
  own.melds = [{ kind: 'ankan', tiles: ['1m', '1m', '1m', '1m'], froms: [] }];
  assert.equal(analyzeHand(state.view)!.closed, true);
  own.melds[0].kind = 'pon';
  assert.equal(analyzeHand(state.view)!.closed, false);
});

test('hand analysis compares legal discards using the whole hand and public tile counts', () => {
  const state = start(), v = state.view;
  v.hand = ['1m', '2m', '3m', '4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '2s', '3s', '0m'];
  v.drawn = '0m'; v.doras = [];
  const before = JSON.stringify(v);
  const analysis = analyzeHand(v)!;
  assert.equal(JSON.stringify(v), before);
  assert.equal(analysis.version, v.version);
  assert.match(analysis.handText, /红5万/);
  assert.equal(analysis.discardCandidates[0].tile, '0m');
  assert.equal(analysis.discardCandidates[0].shanten, 0);
  assert.equal(analysis.discardCandidates[0].ukeire, 8);
  assert.deepEqual(analysis.discardCandidates[0].improvingTiles, [{ tile: '1s', unseen: 4 }, { tile: '4s', unseen: 4 }]);
  assert.ok(analysis.discardCandidates.find(c => c.tile === '2s')!.shanten > 0);
  // The called river tile is counted once, through the exposed meld.
  v.players[1].discards.push({ tile: '1s', called: true, tsumogiri: false, riichi: true });
  v.players[1].riichi = true;
  v.players[2].melds.push({ kind: 'chi', tiles: ['1s', '2s', '3s'], froms: [1, 2, 2] });
  v.doras = ['4s'];
  assert.equal(analyzeHand(v)!.discardCandidates.find(c => c.tile === '0m')!.ukeire, 6);
  v.players[1].discards.push({ tile: '5m', called: false, tsumogiri: false, riichi: false });
  assert.deepEqual(analyzeHand(v)!.discardCandidates.find(c => c.tile === '0m')!.genbutsuAgainst, [1]);
  v.operations[0].combinations = ['0m'];
  assert.equal(analyzeHand(v)!.discardCandidates.some(c => c.tile === '0m'), false);
  v.operations[0].combinations = []; v.players[0].riichi = true;
  assert.deepEqual(analyzeHand(v)!.discardCandidates.map(c => c.tile), ['0m']);
  v.players[0].riichi = false;
  v.hand = ['1m', '1m', '2m', '2m', '3p', '3p', '4p', '4p', '5s', '5s', '6s', '6s', '7z'];
  v.ready = false;
  assert.equal(analyzeHand(v)!.shanten, 0); // Seven pairs.
  v.hand = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z'];
  assert.equal(analyzeHand(v)!.shanten, 0); // Thirteen orphans.
  v.hand = ['4p', '5p', '6p', '7s', '8s', '9s', '1z', '1z', '2s', '3s', '0m'];
  v.drawn = '0m'; v.ready = true;
  v.players[0].melds = [{ kind: 'chi', tiles: ['2m', '1m', '3m'], froms: [0, 3, 0] }];
  assert.equal(analyzeHand(v)!.discardCandidates.find(c => c.tile === '0m')!.shanten, 0);
  v.complete = false;
  assert.equal(analyzeHand(v), null);
});

test('special-hand routes expose kokushi potential without treating honors or quads as complete', () => {
  const v = start().view;
  v.hand = ['1m', '9m', '1p', '9p', '1s', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '2p'];
  v.drawn = '2p'; v.doras = [];
  let a = analyzeHand(v)!;
  assert.equal(a.kokushiShanten, 0);
  assert.equal(a.kokushi!.uniqueKinds, 13);
  assert.deepEqual(a.kokushi!.pairTiles, []);
  assert.equal(a.discardCandidates.find(c => c.tile === '2p')!.kokushiShanten, 0);
  assert.equal(a.discardCandidates.find(c => c.tile === '1m')!.kokushiShanten, 1);
  v.hand[0] = '1z';
  v.players[1].melds = [{ kind: 'ankan', tiles: ['1m'], froms: [] }];
  a = analyzeHand(v)!;
  assert.equal(a.kokushiShanten, 0);
  assert.deepEqual(a.kokushi!.pairTiles, ['1z']);
  assert.deepEqual(a.kokushi!.missingTiles, [{ tile: '1m', unseen: 0 }]);
  v.hand = ['1z', '2z', '3z', '4z', '5z', '6z', '7z', '2m', '3m', '4p', '5p', '6s', '7s', '8s'];
  assert.equal(analyzeHand(v)!.kokushiShanten, 6, 'all seven honors are not enough for kokushi');
  v.players[0].melds = [{ kind: 'ankan', tiles: ['1m', '1m', '1m', '1m'], froms: [] }];
  a = analyzeHand(v)!;
  assert.equal(a.kokushi, null);
  assert.equal(a.kokushiShanten, null);
  assert.equal(a.sevenPairsShanten, null);
  assert.ok(a.discardCandidates.every(c => c.kokushiShanten === null && c.sevenPairsShanten === null));
});

test('new round accepts empty opened-tile seat records and blocks actual opened tiles', () => {
  for (const count of [[], [0, 0, 0]]) {
    const state = new GameState();
    state.setSeat(0, [0, 0, 0, 0]);
    const data = message('ActionNewRound', { ...round(), opens: [0, 1, 2, 3].map(seat => ({ seat, tiles: [], count })) });
    state.apply('ActionNewRound', data, 0);
    assert.equal(state.view.complete, true);
    assert.equal(state.view.ready, true);
    assert.deepEqual(state.view.hand, hand);
    assert.equal(commandFor(state.view, args(state, 'discard', { tile: '0m' })).data.tile, '0m');
  }
  for (const opens of [[{ seat: 1, tiles: ['1z'], count: [] }], [{ seat: 1, tiles: [], count: [1] }]]) {
    const state = new GameState(); state.setSeat(0, [0, 0, 0, 0]);
    assert.throws(() => state.apply('ActionNewRound', message('ActionNewRound', { ...round(), opens }), 0), /特殊规则/);
    assert.equal(state.view.ready, false);
  }
});

test('current schema decodes XOR actions and matches discard/skip wire bytes', () => {
  const payload = encode('lq.ReqSelfOperation', { type: 1, tile: '5m' });
  assert.equal(Buffer.from(payload).toString('hex'), '08011a02356d');
  assert.equal(Buffer.from(encode('lq.ReqChiPengGang', { cancel_operation: true })).toString('hex'), '1801');
  assert.equal(Buffer.from(encode('lq.ReqSelfOperation', { cancel_operation: true })).toString('hex'), '2001');
  const bytes = encode('lq.ActionNewRound', round());
  const notify = envelope(1, 0, '.lq.ActionPrototype', encode('lq.ActionPrototype', { step: 0, name: 'ActionNewRound', data: xorAction(bytes) }));
  const frame = unpack(notify), current = action(decode('lq.ActionPrototype', frame.data), true);
  assert.deepEqual(current.data.tiles, hand);
  assert.deepEqual(action({ name: 'ActionNewRound', step: 0, data: bytes }, false).data.tiles, hand);
});
test('stale versions, unavailable actions, red fives and forbidden discards', () => {
  const state = start();
  assert.equal(commandFor(state.view, args(state, 'discard', { tile: '0m' })).data.tile, '0m');
  assert.throws(() => commandFor(state.view, { version: 'old', action: 'discard', tile: '0m' }), /过期/);
  assert.throws(() => commandFor(state.view, args(state, 'ron')), /没有提供/);
  assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: '0z' })), /格式/);
  assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: '1p' })), /不在/);
  state.view.operations[0].combinations = ['1z'];
  assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: '1z' })), /禁止/);
});
test('riichi uses the current allowed tile list; after riichi only drawn tile can be discarded', () => {
  const state = start(); state.apply('ActionNewRound', round(operation([1, 7], { 7: ['1z'] })), 0);
  assert.equal(commandFor(state.view, args(state, 'riichi', { tile: '1z' })).data.type, 7);
  assert.throws(() => commandFor(state.view, args(state, 'riichi', { tile: '0m' })), /合法立直/);
  state.view.players[0].riichi = true; state.view.drawn = '0m';
  assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: '1z' })), /摸切/);
  assert.equal(commandFor(state.view, args(state, 'discard', { tile: '0m' })).data.moqie, true);
});

test('babei distinguishes drawn north from a north already in hand on the wire', () => {
  const state = start(); state.apply('ActionNewRound', round(operation([1, 11])), 0);
  state.view.hand[0] = '4z';
  for (const drawn of ['4z', '1z']) {
    state.view.drawn = drawn;
    const spec = commandFor(state.view, args(state, 'babei'));
    const wire = decode('lq.ReqSelfOperation', unpack(request(spec.method, 123, spec.data)).data);
    assert.equal(wire.type, 11); assert.equal(wire.moqie, drawn === '4z');
  }
  state.view.hand[0] = '0m';
  assert.throws(() => commandFor(state.view, args(state, 'babei')), /没有北/);
});

test('forbidden fives block both red and ordinary tiles without blocking another suit', () => {
  for (const suit of ['m', 'p', 's']) {
    const state = start();
    const suits = ['m', 'p', 's'];
    state.view.hand = hand.map(t => t[1] === 'z' ? t : t[0] + suits[(suits.indexOf(t[1]) + suits.indexOf(suit)) % 3]);
    state.view.operations[0].combinations = [`5${suit}|1z`];
    for (const value of [`0${suit}`, `5${suit}`, '1z']) {
      assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: value })), /禁止/);
      assert.ok(analyzeHand(state.view)!.blockedDiscards.some(d => d.tile === value));
      assert.ok(!analyzeHand(state.view)!.discardCandidates.some(d => d.tile === value));
    }
    assert.equal(commandFor(state.view, args(state, 'discard', { tile: `2${suit}` })).data.tile, `2${suit}`);
    state.view.operations[0].combinations = [`0${suit}`];
    assert.throws(() => commandFor(state.view, args(state, 'discard', { tile: `5${suit}` })), /禁止/);
  }
});
test('normal opponent draws never expose concealed tiles; claimed river tile is marked called', () => {
  const state = start();
  state.apply('ActionDealTile', message('ActionDealTile', { seat: 1, tile: '7m', left_tile_count: 68 }), 1);
  assert.equal(JSON.stringify(state.view).includes('7m'), false);
  state.apply('ActionDiscardTile', message('ActionDiscardTile', { seat: 1, tile: '5m', operation: operation([3], { 3: ['0m|5m'] }) }), 2);
  state.apply('ActionChiPengGang', message('ActionChiPengGang', { seat: 0, type: 1, tiles: ['0m', '5m', '5m'], froms: [0, 0, 1], operation: operation([1], { 1: ['5m'] }) }), 3);
  assert.equal(state.view.players[1].discards[0].called, true);
  assert.deepEqual(state.view.players[0].melds[0].tiles, ['0m', '5m', '5m']);
  assert.equal(state.view.hand.includes('0m'), false);
  assert.equal(state.view.hand.filter(t => t === '5m').length, 2);
});
test('ankan keeps actual own red five composition; kakan upgrades the existing pon', () => {
  const state = start();
  state.apply('ActionAnGangAddGang', message('ActionAnGangAddGang', { seat: 0, type: 3, tiles: '5m' }), 1);
  assert.deepEqual(state.view.players[0].melds[0].tiles, ['0m', '5m', '5m', '5m']);
  assert.equal(state.view.hand.some(t => t === '5m' || t === '0m'), false);
  const second = start(); second.view.players[0].melds = [{ kind: 'pon', tiles: ['5m', '5m', '5m'], froms: [0, 0, 1] }];
  second.apply('ActionAnGangAddGang', message('ActionAnGangAddGang', { seat: 0, type: 2, tiles: '0m' }), 1);
  assert.equal(second.view.players[0].melds[0].kind, 'kakan');
  assert.equal(second.view.players[0].melds[0].tiles.at(-1), '0m');
});
test('route calls, ron and pass to their matching schema, reject bad combinations', () => {
  const state = start(); state.view.operations = [{ type: 2, name: 'chi', combinations: ['2m|3m', '3m|4m'] }, { type: 9, name: 'ron', combinations: [] }];
  assert.equal(commandFor(state.view, args(state, 'chi', { index: 1 })).method, '.lq.FastTest.inputChiPengGang');
  assert.equal(commandFor(state.view, args(state, 'ron')).method, '.lq.FastTest.inputOperation');
  assert.equal(commandFor(state.view, args(state, 'pass')).method, '.lq.FastTest.inputChiPengGang');
  assert.throws(() => commandFor(state.view, args(state, 'chi', { index: 2 })), /索引/);
  state.view.operations = [{ type: 9, name: 'ron', combinations: [] }];
  assert.equal(commandFor(state.view, args(state, 'pass')).method, '.lq.FastTest.inputOperation');
});
test('duplicate actions are ignored and missing steps fail before state mutation', () => {
  const state = start(), data = message('ActionDiscardTile', { seat: 0, tile: '1z' });
  state.apply('ActionDiscardTile', data, 1); const after = state.snapshot();
  assert.equal(state.apply('ActionDiscardTile', data, 1), false);
  assert.deepEqual(state.snapshot(), after);
  assert.throws(() => state.apply('ActionDiscardTile', message('ActionDiscardTile', { seat: 1, tile: '3p' }), 3), /不连续/);
  assert.deepEqual(state.snapshot(), after);
});

test('Windows launcher verifies deployment and reuses an existing connected game without starting processes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'majsoul-launcher-test-'));
  const deployment = join(directory, 'deployment');
  const schema = fileURLToPath(new URL('../assets/liqi.json', import.meta.url));
  assert.ok((await readFile(schema)).length > 0);
  const digest = createHash('sha256').update(join(deployment, 'data')).digest('hex');
  const extensionDir = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
  const packageVersion = JSON.parse(await readFile(join(extensionDir, 'package.json'), 'utf8')).version;
  const launcher = fileURLToPath(new URL('../setup/start-game.ps1', import.meta.url));
  const fixture = join(directory, 'fixture.ps1');
  await writeFile(fixture, `
param([switch]$ObserveOnly, [switch]$WrongDeployment)
$ErrorActionPreference = 'Stop'
$global:taskCalls = @()
function Start-Process { throw 'launcher must reuse the existing game' }
function Invoke-RestMethod {
  param($Uri, $Method, $ContentType, $Body, $TimeoutSec)
  $path = ([Uri]$Uri).AbsolutePath
  if ($path -eq '/api/run/lifecycle') { return @{ deployment = $(if ($WrongDeployment) { 'other' } else { '${digest}' }); ready = $true; bootId = 'fixture' } }
  if ($path -eq '/api/console/manifest') { return @{ providers = @(@{ id = 'world:majsoul'; availability = 'active' }) } }
  if ($path -eq '/api/extensions') { return @{ dir = '${directory}'; extensions = @(@{ name = 'cortico-world-majsoul'; spec = 'link:${extensionDir}'; installedVersion = '${packageVersion}'; state = 'loaded' }) } }
  if ($path -eq '/api/worlds') { return @{ worlds = @(@{ id = 'majsoul'; prefixDrifted = $true }) } }
  if ($path -eq '/api/console/providers/world%3Amajsoul/panels/game/state' -or $path -eq '/api/console/providers/world:majsoul/panels/game/state') { return @{ connected = $true } }
  if ($Method -eq 'Post' -and $path -in @('/api/config', '/api/worlds/visibility', '/api/session/reload-prefix', '/api/run/resume')) {
    $global:taskCalls += @{ path = $path; body = $Body | ConvertFrom-Json }; return @{ ok = $true }
  }
  throw ('unexpected request: ' + $path)
}
& '${launcher}' -FrameworkDir '${directory}' -DeploymentDir '${deployment}' -ConsoleUrl 'http://fixture.invalid' -ObserveOnly:$ObserveOnly
$global:taskCalls | ConvertTo-Json -Depth 8 -Compress
`, 'utf8');
  for (const observeOnly of [false, true]) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture, ...(observeOnly ? ['-ObserveOnly'] : [])], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const calls = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
    assert.equal(calls.find((entry: Data) => entry.path === '/api/config').body.values['worlds.majsoul.allowActions'], !observeOnly);
    assert.equal(calls.some((entry: Data) => entry.path === '/api/run/resume'), !observeOnly);
  }
  const mismatch = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture, '-WrongDeployment'], { encoding: 'utf8', timeout: 10000 });
  assert.notEqual(mismatch.status, 0);
});

test('real Edge plus local game server: guarded send, ack, authoritative action, rejection, timeout, cancellation, hot permission, reconnect', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'majsoul-browser-test-'));
  let peer: WebSocket | undefined, step = 0, mode = 'normal', submitted = 0, playerCount = 4, gateway = '/game-gateway', authenticate = true, pageLoads = 0, roundStartedAt = 0;
  const auth = request('.lq.FastTest.authGame', 1, { account_id: 101, token: 'private-auth-token' });
  const server = createServer((_req, res) => {
    pageLoads++;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><script>const ws = new WebSocket('ws://' + location.host + '${gateway}'); ws.binaryType='arraybuffer'; window.gameMessages=[]; ws.onmessage=e=>gameMessages.push(Array.from(new Uint8Array(e.data))); ws.onopen=()=>${authenticate ? `ws.send(Uint8Array.from(atob('${auth.toString('base64')}'), c=>c.charCodeAt(0)))` : 'undefined'}; window.testSocket=ws;</script>`);
  });
  const sockets = new WebSocketServer({ server });
  const notify = (name: string, data: Data) => {
    if (name === 'ActionNewRound') roundStartedAt = Date.now();
    peer!.send(envelope(1, 0, '.lq.ActionPrototype', encode('lq.ActionPrototype', { name, step: step++, data: xorAction(encode(`lq.${name}`, data)) })));
  };
  sockets.on('connection', socket => {
    peer = socket; step = 0;
    socket.on('message', bytes => {
      const frame = unpack(Buffer.from(bytes as Buffer));
      if (frame.name.endsWith('.authGame')) {
        socket.send(envelope(3, frame.id, '', encode('lq.ResAuthGame', { seat_list: [101, 102, 103, 104].slice(0, playerCount) })));
        notify('ActionNewRound', { ...round(), ...(playerCount === 3 ? { tiles: sanmaHand, scores: [35000, 35000, 35000, 0] } : {}), opens: [0, 1, 2, 3].slice(0, playerCount).map(seat => ({ seat, tiles: [], count: [] })) });
      } else {
        submitted++;
        if (mode === 'early-round' && Date.now() - roundStartedAt < 100) { socket.send(envelope(3, frame.id, '', encode('lq.ResCommon', {}))); return; }
        if (mode === 'timeout') return;
        if (mode === 'reject') { socket.send(envelope(3, frame.id, '', encode('lq.ResCommon', { error: { code: 2001 } }))); return; }
        const data = decode('lq.ReqSelfOperation', frame.data);
        if (mode === 'reject-after-advance' || mode === 'timeout-after-advance') {
          notify('ActionDiscardTile', { seat: 0, tile: data.tile });
          notify('ActionDealTile', { seat: 0, tile: '2z', operation: operation([1]), left_tile_count: 68 });
          if (mode === 'reject-after-advance') socket.send(envelope(3, frame.id, '', encode('lq.ResCommon', { error: { code: 2001 } })));
          return;
        }
        // 权威动作先于 response，验证不能提前清除待确认的提交。
        if (data.type === 11) { assert.equal(data.moqie, true, 'drawn north requires moqie on the actual request'); notify('ActionBaBei', { seat: 0 }); }
        else notify('ActionDiscardTile', { seat: 0, tile: data.tile, moqie: data.moqie });
        socket.send(envelope(3, frame.id, '', encode('lq.ResCommon', {})));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }, url = `http://127.0.0.1:${address.port}/`;
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), { channel: 'msedge', headless: true, args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'] });
  const port = (await readFile(join(directory, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  const cfg = { ...MAJSOUL_DEFAULTS, allowActions: true, browserPort: Number(port), gameUrl: url, newRoundDelayMs: 0 };
  const permittedUrls = (MAJSOUL_CONFIG_GROUP.schema.properties!['worlds.majsoul.gameUrl'] as { enum: string[] }).enum;
  permittedUrls.push(url); // 本机服务器替代真实服务，仍走 URL 校验与控制台连接入口。
  const world = new MajsoulWorld({ cfg, dataDir: directory } as ConstructorParameters<typeof MajsoulWorld>[0]);
  let renderState: (() => unknown) | undefined;
  await world.start({ pushDeferred(event: { render: () => unknown }) { renderState = event.render; } } as unknown as Parameters<typeof world.start>[0]);
  const game = world.game;
  assert.equal(world.suppressThinking(), false);
  const waitFor = async (condition: () => boolean) => { const until = Date.now() + 8000; while (!condition()) { assert(Date.now() < until, `bridge did not become ready: ${game.error}`); await new Promise(resolve => setTimeout(resolve, 20)); } };
  try {
    await game.connect(`http://127.0.0.1:${port}`, url);
    await waitFor(() => game.snapshot().ready);
    assert.equal(world.suppressThinking(), true);
    const delivered = JSON.parse(String(renderState!()));
    assert.equal(delivered.handAnalysis.version, delivered.observation.version);
    assert.deepEqual(delivered.handAnalysis.sortedHand.slice().sort(), delivered.observation.hand.slice().sort());
    assert.ok(delivered.handAnalysis.discardCandidates.length > 1);
    const page = context.pages()[0];
    const clientReconnect = () => page.evaluate(({ url, auth }) => {
      const ws = new window.WebSocket(url.replace('http:', 'ws:') + 'game-gateway-zone');
      ws.binaryType = 'arraybuffer';
      (window as any).testSocket = ws;
      ws.onopen = () => ws.send(Uint8Array.from(atob(auth), c => c.charCodeAt(0)));
    }, { url, auth: auth.toString('base64') });
    assert.equal(JSON.stringify(game.snapshot()).includes('private-auth-token'), false);
    assert.equal(await page.evaluate(() => (window as any).WebSocket.OPEN), 1);
    assert.equal(await page.evaluate(() => (window as any).testSocket.constructor === (window as any).WebSocket), true);
    const before = game.snapshot();
    const rejected = await page.evaluate(encoded => (window as any).__corticoMajsoul.send(1, 0, encoded), request('.lq.FastTest.inputOperation', 60001, { type: 1, tile: '0m' }).toString('base64'));
    assert.equal(rejected.sent, false); assert.equal(submitted, 0, 'stale browser serial must be rejected before sending');
    await page.evaluate(() => { const hook = (window as any).__corticoMajsoul; hook.originalSend = hook.send; hook.send = () => ({ sent: false, reason: 'fixture guard rejected before sending' }); });
    await assert.rejects(game.execute({ version: before.version, action: 'discard', tile: '0m' }, 500), /guard rejected/);
    assert.equal(game.snapshot().ready, true); assert.equal(game.busy, false); assert.equal(submitted, 0);
    await page.evaluate(() => { const hook = (window as any).__corticoMajsoul; hook.send = hook.originalSend; delete hook.originalSend; });
    const result = await game.execute({ version: before.version, action: 'discard', tile: '0m' }, 1500);
    assert.equal(result.outcome, 'state_changed'); assert.equal(result.observation.hand.includes('0m'), false);
    const after = JSON.parse(String(await world.tools()[0].handler({}, { signal: new AbortController().signal } as any)));
    assert.equal(after.handAnalysis.version, after.observation.version);
    assert.equal(after.handAnalysis.sortedHand.includes('0m'), false);
    assert.equal(submitted, 1);
    assert.equal(await page.evaluate(() => (window as any).gameMessages.filter((bytes: number[]) => bytes[0] === 3 && (bytes[1] | bytes[2] << 8) >= 60000).length), 0, 'injected RPC reply must not reach native client');
    await assert.rejects(game.execute({ version: before.version, action: 'discard', tile: '5m' }, 500), /过期/);
    cfg.newRoundDelayMs = 180; mode = 'early-round';
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    const firstOperation = await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0m' }, 500);
    assert.equal(firstOperation.outcome, 'state_changed', 'dealer first operation must wait past the opening phase, even if early sends receive an acknowledgement');
    assert(firstOperation.decisionMs >= 150);
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    const cancelledCount = submitted, waiting = new AbortController();
    const cancelled = game.execute({ version: game.snapshot().version, action: 'discard', tile: '0m' }, 500, waiting.signal);
    waiting.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(submitted, cancelledCount, 'cancelling the opening wait must not send or consume an action');
    assert.equal(game.snapshot().ready, true);
    const staleWait = game.execute({ version: game.snapshot().version, action: 'discard', tile: '0m' }, 500);
    notify('ActionNoTile', {});
    await assert.rejects(staleWait, /已变化/);
    assert.equal(submitted, cancelledCount, 'a changed game must not receive the delayed older action');
    cfg.newRoundDelayMs = 0; mode = 'normal';
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    assert(context.browser()?.isConnected() !== false, 'disconnecting CDP must preserve launched Edge');
    mode = 'reject';
    await assert.rejects(game.execute({ version: game.snapshot().version, action: 'discard', tile: '1z' }, 500), error => error instanceof Error && !(error instanceof ActionUncertainError) && /2001/.test(error.message));
    assert.equal(game.snapshot().ready, true, 'explicit rejection preserves the unchanged decision window');
    assert.equal(game.busy, false);
    const retry = game.snapshot();
    const failed = await world.tools().find(t => t.name === 'majsoul_act')!.handler({ version: retry.version, action: 'discard', tile: '9z' }, { signal: new AbortController().signal } as any) as { failed: boolean; text: string };
    const receipt = JSON.parse(failed.text);
    assert.equal(receipt.outcome, 'rejected'); assert.equal(receipt.retry, true);
    assert.equal(receipt.observation.version, retry.version);
    assert.ok(receipt.handAnalysis.discardCandidates.length > 0);
    mode = 'normal';
    assert.equal((await game.execute({ version: retry.version, action: 'discard', tile: '0m' }, 500)).outcome, 'state_changed');
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    mode = 'reject-after-advance';
    await assert.rejects(game.execute({ version: game.snapshot().version, action: 'discard', tile: '0m' }, 500), /2001/);
    assert.equal(game.snapshot().lastAction?.name, 'ActionDealTile');
    assert.equal(game.snapshot().drawn, '2z'); assert.equal(game.snapshot().ready, true);
    assert.equal(game.snapshot().hand.includes('0m'), false, 'rejection must not restore the older hand');
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    mode = 'timeout-after-advance';
    await assert.rejects(game.execute({ version: game.snapshot().version, action: 'discard', tile: '0m' }, 150), ActionUncertainError);
    assert.equal(game.snapshot().drawn, '2z'); assert.equal(game.snapshot().ready, true, 'unknown older action must not clear a fresh authoritative window');
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    cfg.allowActions = false;
    assert.equal(world.suppressThinking(), false);
    await assert.rejects(game.execute({ version: game.snapshot().version, action: 'discard', tile: '1z' }, 500), /暂停/);
    cfg.allowActions = true; mode = 'timeout'; const count = submitted;
    await assert.rejects(game.execute({ version: game.snapshot().version, action: 'discard', tile: '1z' }, 150), ActionUncertainError);
    assert.equal(submitted, count + 1); assert.equal(game.snapshot().ready, false); assert.equal(game.busy, false);
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    const controller = new AbortController(), aborted = game.execute({ version: game.snapshot().version, action: 'discard', tile: '1z' }, 1000, controller.signal);
    await waitFor(() => submitted === count + 2); controller.abort();
    await assert.rejects(aborted, ActionUncertainError); assert.equal(game.busy, false);
    mode = 'normal';
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    assert.equal(world.suppressThinking(), true);
    notify('ActionNoTile', {}); await waitFor(() => !game.snapshot().active);
    assert.equal(world.suppressThinking(), false);
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    assert.equal(world.suppressThinking(), true);
    const hook = await page.evaluate(() => (window as any).__corticoMajsoul);
    assert(hook, 'page hook must be installed');
    const reconnect = world.tools().find(t => t.name === 'majsoul_reconnect')!;
    const version = game.snapshot().version;
    const connectedReceipt = JSON.parse(String(await reconnect.handler({}, { signal: new AbortController().signal } as any)));
    assert.equal(connectedReceipt.connected, true); assert.equal(game.snapshot().version, version, 'connected tool call must not refresh an active hand');
    playerCount = 3;
    await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
    assert.equal(game.snapshot().players.length, 3); assert.equal(game.snapshot().playerCount, 3);
    assert.equal((await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0p' }, 1000)).outcome, 'state_changed');
    notify('ActionDealTile', { seat: 0, tile: '4z', operation: operation([1, 11]), left_tile_count: 54 });
    await waitFor(() => game.snapshot().ready);
    assert.equal((await game.execute({ version: game.snapshot().version, action: 'babei' }, 1000)).outcome, 'state_changed');
    assert.equal(game.snapshot().players[0].norths, 1); assert.equal(game.snapshot().hand.filter(t => t === '4z').length, 1);
    peer!.close(); await waitFor(() => !game.connected);
    assert.equal(world.suppressThinking(), false);
    assert.equal(game.snapshot().ready, false);
    cfg.allowActions = false;
    const pausedReceipt = await reconnect.handler({}, { signal: new AbortController().signal } as any) as { failed: boolean; text: string };
    assert.equal(pausedReceipt.failed, true); assert.match(JSON.parse(pausedReceipt.text).error, /暂停/);
    cfg.allowActions = true; cfg.gameUrl = 'https://example.invalid/';
    const invalidReceipt = await reconnect.handler({}, { signal: new AbortController().signal } as any) as { failed: boolean; text: string };
    assert.equal(invalidReceipt.failed, true); assert.match(JSON.parse(invalidReceipt.text).error, /网页地址不在/);
    cfg.gameUrl = url;
    const beforeReconnectLoads = pageLoads;
    const attached = JSON.parse(String(await reconnect.handler({}, { signal: new AbortController().signal } as any)));
    assert.equal(attached.reconnect, 'bridge_attached');
    assert.equal(pageLoads, beforeReconnectLoads, 'mid-hand bridge reconnect must preserve the game page');
    await clientReconnect(); await waitFor(() => game.snapshot().ready);
    assert.equal((await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0p' }, 1000)).outcome, 'state_changed');
    notify('ActionHule', {}); await waitFor(() => !game.snapshot().active);
    peer!.close(); await waitFor(() => !game.connected);
    assert.match(game.error, /已结算/);
    const settledVersion = game.snapshot().version;
    await reconnect.handler({}, { signal: new AbortController().signal } as any);
    await game.connect(`http://127.0.0.1:${port}`, url);
    assert.equal(game.snapshot().version, settledVersion, 'settlement reconnect must preserve the last result');
    assert.equal(pageLoads, beforeReconnectLoads, 'settlement socket close must not refresh the game');
    await clientReconnect(); await waitFor(() => game.snapshot().ready);
    assert.equal(pageLoads, beforeReconnectLoads, 'next game authentication must work without a page refresh');
    assert.equal((await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0p' }, 1000)).outcome, 'state_changed');
    for (const path of ['/gateway', '/gateway/', '/game-gateway-zone', '/game-gateway-zone/']) {
      gateway = path;
      await game.connect(`http://127.0.0.1:${port}`, url); await waitFor(() => game.snapshot().ready);
      assert.equal(game.connected, true, 'FastTest authentication must capture generic and zone gateways');
      assert.equal((await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0p' }, 1000)).outcome, 'state_changed');
    }
    authenticate = false;
    await game.connect(`http://127.0.0.1:${port}`, url);
    assert.equal(game.connected, false);
    const loaded = pageLoads;
    await game.connect(`http://127.0.0.1:${port}`, url);
    assert.equal(pageLoads, loaded, 'waiting for authentication must not reload the game again');
    await page.evaluate(() => { (window as any).__corticoMajsoul.enabled = false; });
    await game.connect(`http://127.0.0.1:${port}`, url, false);
    await page.evaluate(encoded => (window as any).testSocket.send(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))), auth.toString('base64'));
    await waitFor(() => game.snapshot().ready);
    assert.equal((await game.execute({ version: game.snapshot().version, action: 'discard', tile: '0p' }, 1000)).outcome, 'state_changed', 'rebinding must reactivate the existing hook');
    await world.stop(); assert.equal(world.suppressThinking(), false); assert(context.pages().length > 0, 'stopping World must not close the game tab');
  } finally {
    permittedUrls.splice(permittedUrls.indexOf(url), 1);
    await game.stop(); await context.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
