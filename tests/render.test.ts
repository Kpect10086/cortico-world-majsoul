import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { installHook } from '../src/browser-hook.ts';

test('render cap preserves callbacks, cancellation, timestamps and reconnection without extra loops', () => {
  const native = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const scope: any = {
    WebSocket: class {},
    requestAnimationFrame: (callback: FrameRequestCallback) => { native.set(++serial, callback); return serial; },
    cancelAnimationFrame: (id: number) => native.delete(id),
  };
  const tick = (timestamp: number) => { const batch = [...native.values()]; native.clear(); for (const callback of batch) callback(timestamp); };
  const script = `const __name = value => value; (${installHook.toString()})('binding',30);`;
  runInNewContext(script, { window: scope, setTimeout });
  const times: number[] = [];
  let loopId: number;
  const loop = (at: number) => { times.push(at); loopId = scope.requestAnimationFrame(loop); };
  loopId = scope.requestAnimationFrame(loop);
  for (let i = 0; i < 240; i++) tick(i * 1000 / 240);
  assert.equal(times.length, 30);
  assert.ok(times.every((at, i) => !i || at - times[i - 1] >= 1000 / 30 - 0.1));
  let second = 0;
  scope.requestAnimationFrame(() => second++);
  const cancelled = scope.requestAnimationFrame(() => { throw Error('cancelled callback ran'); });
  scope.cancelAnimationFrame(cancelled);
  for (let i = 240; i < 248; i++) tick(i * 1000 / 240);
  assert.equal(second, 1);
  runInNewContext(script.replace("'binding',30", "'nextBinding',60"), { window: scope, setTimeout });
  assert.equal(scope.__corticoMajsoul.bindingName, 'nextBinding');
  assert.equal(scope.__corticoMajsoul.maxRenderFps, 60);
  assert.equal(native.size, 1);
  const before = times.length;
  for (let i = 248; i < 272; i++) tick(i * 1000 / 240);
  assert.equal(times.length - before, 6);
  scope.cancelAnimationFrame(loopId);
  assert.equal(native.size, 0);
  let pending: number;
  let another = 0;
  scope.requestAnimationFrame(() => scope.cancelAnimationFrame(pending));
  pending = scope.requestAnimationFrame(() => another++);
  tick(1200);
  assert.equal(another, 0);
  assert.equal(native.size, 0);
  scope.requestAnimationFrame(() => scope.requestAnimationFrame(() => another++));
  tick(1300);
  assert.equal(another, 0);
  tick(1320);
  assert.equal(another, 1);
  assert.equal(native.size, 0);
});
