import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOfficialPromiseWorkaround, WRAPPED_METHODS } from '../../public/decision/promise-workaround.mjs';
test('exact five functions preserve bound receiver, arguments and output via Promise.resolve', async () => {
  const module = { identity: 'module' };
  for (const name of WRAPPED_METHODS) module[name] = function(arg) { return { name, arg, receiver: this.identity }; };
  assert.deepEqual(applyOfficialPromiseWorkaround({ i: { h: module } }), [...WRAPPED_METHODS]);
  for (const name of WRAPPED_METHODS) {
    const pending = module[name]('sample'); assert.ok(pending instanceof Promise);
    assert.deepEqual(await pending, { name, arg: 'sample', receiver: 'module' });
  }
});
test('unexpected private shape fails before any function is changed; no guessed introspection', () => {
  for (const task of [null, {}, { i: { h: {} } }]) assert.throws(() => applyOfficialPromiseWorkaround(task), /SHAPE_CHANGED/);
  const module = Object.fromEntries(WRAPPED_METHODS.map(name => [name, () => 'value']));
  delete module.prewarmSchema;
  const before = module.evaluateChoice;
  assert.throws(() => applyOfficialPromiseWorkaround({ i: { h: module } }), /SHAPE_CHANGED/);
  assert.equal(module.evaluateChoice, before);
});
test('already-wrapped modules fail rather than silently repatching an unexpected version', () => {
  const module = Object.fromEntries(WRAPPED_METHODS.map(name => [name, () => 'value']));
  const task = { i: { h: module } }; applyOfficialPromiseWorkaround(task);
  assert.throws(() => applyOfficialPromiseWorkaround(task), /SHAPE_CHANGED/);
});
