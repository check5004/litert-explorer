import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CRITERIA, SAMPLES, TIMING_LABELS, assetURLs } from '../../public/decision/config.mjs';
import { makeBootstrapSource } from '../../public/decision/bootstrap.mjs';

// This harness tests main.mjs's event/state bookkeeping only. It does not run a
// browser, load the SDK/model, or establish CSP/Worker/browser compatibility.
const mainSource = (await readFile(new URL('../../public/decision/main.mjs', import.meta.url), 'utf8'))
  .replace(/^import [^\n]+;\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify('https://local.test/probe/main.mjs'));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function element(id = '') {
  return {
    ...eventTarget(), id, children: [], textContent: '', value: '', disabled: false,
    append(...children) { this.children.push(...children); },
    get lastChild() { return this.children.at(-1); },
  };
}

function fixture() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const document = {
    ...eventTarget(), getElementById: get, createElement: () => element(),
  };
  const workers = [];
  const revokedURLs = [];
  class Worker {
    constructor(url, options) {
      Object.assign(this, eventTarget());
      this.url = url;
      this.options = options;
      this.messages = [];
      this.terminationCount = 0;
      workers.push(this);
    }
    postMessage(data) { this.messages.push(structuredClone(data)); }
    terminate() { this.terminationCount += 1; }
    // Intentionally permit a terminated worker to deliver already-queued events.
    emit(data) { this.dispatch('message', { data }); }
    fail() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.dispatch('error', event);
      return event;
    }
  }
  let urlIndex = 0;
  class MockURL extends URL {}
  MockURL.createObjectURL = () => `blob:https://local.test/mock-${++urlIndex}`;
  MockURL.revokeObjectURL = url => revokedURLs.push(url);
  const window = { ...eventTarget(), isSecureContext: true, Worker };
  vm.runInNewContext(mainSource, {
    CRITERIA, SAMPLES, TIMING_LABELS, assetURLs, makeBootstrapSource,
    document, window, navigator: {}, crypto: { subtle: {} }, WebAssembly: {},
    Worker, URL: MockURL, Blob, performance: { now: () => 100 },
    location: { href: 'https://local.test/probe/' }, setInterval() {},
  }, { filename: 'main.mjs' });
  const evidence = () => JSON.parse(get('evidence').textContent);
  const timing = key => {
    const row = get('timings').children[Object.keys(TIMING_LABELS).indexOf(key)];
    return { value: row.children[1].textContent, status: row.children[2].textContent };
  };
  // Dispatch even when disabled to exercise the handler's own state guard.
  const click = id => get(id).dispatch('click');
  function initializeReady() {
    click('init');
    const worker = workers.at(-1);
    worker.emit({ type: 'worker-ready' });
    worker.emit({ type: 'state', state: 'ready' });
    return worker;
  }
  function completeClose(worker) {
    click('close');
    worker.emit({ type: 'stage', stage: 'close' });
    worker.emit({ type: 'timing', key: 'close', milliseconds: 2.5, status: 'completed' });
    worker.emit({ type: 'state', state: 'closed' });
    worker.emit({ type: 'closed', counts: { allowed: 2, blocked: 1, csp: 0 } });
  }
  return { get, workers, revokedURLs, window, evidence, timing, click, initializeReady, completeClose };
}

test('close then terminate preserves the recorded successful close', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.completeClose(worker);
  assert.equal(f.evidence().state, 'closed');
  assert.equal(f.get('cancel').disabled, false);
  f.click('cancel');
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.evidence().state, 'closed');
  assert.equal(f.evidence().timings.close.status, 'completed');
  assert.equal(f.evidence().events.at(-1).closePreviouslyCompleted, true);
  assert.match(f.get('status').textContent, /close\(\) 完了.*Worker 終了/);
  assert.doesNotMatch(f.get('status').textContent, /未実行|記録なし/);
  assert.equal(f.get('cancel').disabled, true);
  assert.equal(f.get('init').disabled, false);
  assert.deepEqual(f.timing('close'), { value: '2.50', status: '完了' });
});

test('fatal Worker error marks an unfinished stage stopped without fabricating elapsed time', () => {
  const f = fixture();
  f.click('init');
  const worker = f.workers[0];
  worker.emit({ type: 'stage', stage: 'create' });
  assert.match(f.timing('create').status, /実行中/);
  assert.equal(worker.fail().prevented, true);
  assert.equal(f.evidence().state, 'error');
  assert.equal(f.evidence().timings.create, null);
  assert.equal(f.timing('create').value, 'N/A');
  assert.doesNotMatch(f.timing('create').status, /実行中|^完了$|未実行/);
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.get('cancel').disabled, true);
  assert.equal(f.get('init').disabled, false);
  assert.equal(f.evidence().results.length, 0);
});

test('cancel preserves a completed measurement received before the next state event', () => {
  const f = fixture();
  f.click('init');
  const worker = f.workers[0];
  worker.emit({ type: 'stage', stage: 'create' });
  worker.emit({ type: 'timing', key: 'create', milliseconds: 125, status: 'completed' });
  f.click('cancel');
  assert.equal(f.evidence().state, 'cancelled');
  assert.deepEqual(f.evidence().timings.create, { milliseconds: 125, status: 'completed' });
  assert.deepEqual(f.timing('create'), { value: '125.00', status: '完了' });
  assert.equal(worker.terminationCount, 1);
});

test('close completion received just before cancel is retained without awaiting the closed state event', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.click('close');
  worker.emit({ type: 'stage', stage: 'close' });
  worker.emit({ type: 'timing', key: 'close', milliseconds: 3, status: 'completed' });
  f.click('cancel');
  assert.equal(f.evidence().state, 'closed');
  assert.equal(f.evidence().events.at(-1).closePreviouslyCompleted, true);
  assert.deepEqual(f.timing('close'), { value: '3.00', status: '完了' });
  assert.equal(worker.terminationCount, 1);
});

test('repeated init, run, close and cancel clicks cannot duplicate an operation', () => {
  const f = fixture();
  f.click('init'); f.click('init');
  assert.equal(f.workers.length, 1);
  const worker = f.workers[0];
  worker.emit({ type: 'worker-ready' });
  worker.emit({ type: 'state', state: 'ready' });
  f.get('sample').value = SAMPLES[0].id;
  f.get('sample').dispatch('change');
  f.click('run'); f.click('run'); f.click('close'); f.click('init');
  assert.deepEqual(worker.messages, [{ type: 'init' }, { type: 'run', sampleId: SAMPLES[0].id }]);
  assert.equal(f.workers.length, 1);
  worker.emit({ type: 'state', state: 'ready' });
  f.click('close'); f.click('close'); f.click('run');
  assert.equal(worker.messages.filter(message => message.type === 'close').length, 1);
  f.click('cancel');
  const afterCancel = f.evidence();
  f.click('cancel');
  assert.equal(worker.terminationCount, 1);
  assert.deepEqual(f.evidence(), afterCancel);
  assert.equal(f.revokedURLs.length, 1);
});

test('no selected sample never sends an inference command or creates an output', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.click('run');
  assert.deepEqual(worker.messages, [{ type: 'init' }]);
  assert.equal(f.evidence().state, 'ready');
  assert.equal(f.evidence().results.length, 0);
  assert.equal(f.evidence().timings.evaluateChoice, null);
  assert.match(f.get('winner').textContent, /N\/A/);
});

test('queued replies and errors from a cancelled worker are ignored before and after reinitialization', () => {
  const f = fixture();
  const old = f.initializeReady();
  f.click('cancel');
  const cancelled = f.evidence();
  const staleReplies = [
    { type: 'worker-ready' },
    { type: 'state', state: 'ready' },
    { type: 'stage', stage: 'evaluateChoice' },
    { type: 'timing', key: 'evaluateChoice', milliseconds: 10, status: 'completed' },
    { type: 'result', attemptedCallIndex: 1, result: { selectedKey: 'stale', confidence: 1, probabilities: {} } },
    { type: 'operation-error', code: 'STALE_ERROR' },
  ];
  for (const reply of staleReplies) old.emit(reply);
  old.fail();
  assert.deepEqual(f.evidence(), cancelled);
  const current = f.initializeReady();
  const fresh = f.evidence();
  for (const reply of staleReplies) old.emit(reply);
  old.fail();
  assert.deepEqual(f.evidence(), fresh);
  assert.equal(current.terminationCount, 0);
  assert.equal(f.evidence().results.length, 0);
  assert.match(f.get('winner').textContent, /N\/A/);
  assert.deepEqual(old.messages, [{ type: 'init' }]);
});

test('BFCache return after an unfinished stage reports termination, never a still-running stage', () => {
  const f = fixture();
  f.click('init');
  const worker = f.workers[0];
  worker.emit({ type: 'stage', stage: 'create' });
  f.window.dispatch('pagehide', { persisted: true });
  f.window.dispatch('pageshow', { persisted: true });
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.evidence().state, 'cancelled');
  assert.equal(f.evidence().timings.create, null);
  assert.equal(f.timing('create').value, 'N/A');
  assert.doesNotMatch(f.timing('create').status, /実行中|^完了$|未実行/);
  assert.equal(f.get('cancel').disabled, true);
  assert.equal(f.get('init').disabled, false);
  const returned = f.evidence();
  worker.emit({ type: 'state', state: 'ready' });
  assert.deepEqual(f.evidence(), returned);
});

test('BFCache return after a successful close preserves close timing and outcome', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.completeClose(worker);
  f.window.dispatch('pagehide', { persisted: true });
  f.window.dispatch('pageshow', { persisted: true });
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.evidence().state, 'closed');
  assert.equal(f.evidence().timings.close.status, 'completed');
  assert.deepEqual(f.timing('close'), { value: '2.50', status: '完了' });
  assert.match(f.get('status').textContent, /close\(\) 完了.*Worker 終了/);
  assert.equal(f.get('cancel').disabled, true);
});
