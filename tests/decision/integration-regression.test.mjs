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
  .replace('export function mountDecision', 'function mountDecision')
  .replaceAll('import.meta.url', JSON.stringify('https://local.test/probe/main.mjs'));

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener));
    },
    listenerCount() { return [...listeners.values()].reduce((count, list) => count + list.length, 0); },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function element(id = '') {
  return {
    ...eventTarget(), id, children: [], textContent: '', value: '', disabled: false,
    append(...children) { this.children.push(...children); },
    remove() { this.removed = true; },
    get lastChild() { return this.children.at(-1); },
  };
}

function fixture(controller = null, { autoActivate = true, assetBase = 'https://local.test/probe/', appBase = 'https://local.test/' } = {}) {
  const serviceWorker = { ...eventTarget(), controller };
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  const document = {
    ...eventTarget(), getElementById() { throw new Error('Document-global IDs are forbidden'); }, createElement: () => element(),
  };
  const root = { ...element('shadow-root'), querySelector: selector => get(selector.slice(1)) };
  const intervals = new Map(); let nextInterval = 0;
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
  const context = {
    CRITERIA, SAMPLES, TIMING_LABELS, assetURLs, makeBootstrapSource,
    document, root, assetBase, appBase, window, navigator: { serviceWorker }, crypto: { subtle: {} }, WebAssembly: {},
    Worker, URL: MockURL, Blob, performance: { now: () => 100 },
    location: { href: 'https://local.test/probe/' },
    setInterval(callback) { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval(id) { intervals.delete(id); },
  };
  vm.runInNewContext(mainSource + '\nglobalThis.panel = mountDecision(root, {assetBase, appBase});', context, { filename: 'main.mjs' });
  const panel = context.panel;
  if (autoActivate) panel.activate();
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
  return { get, root, document, panel, intervals, workers, revokedURLs, window, serviceWorker, evidence, timing, click, initializeReady, completeClose };
}

test('expected root SW controller is accepted; a different script URL is refused', () => {
  const allowed = fixture({ scriptURL: 'https://local.test/sw.js' });
  allowed.click('init'); assert.equal(allowed.workers.length, 1);
  const refused = fixture({ scriptURL: 'https://local.test/another-sw.js' });
  refused.click('init'); assert.equal(refused.workers.length, 0);
  assert.match(refused.get('validation').textContent, /UNKNOWN_SERVICE_WORKER_CONTROLLER/);
});
test('controllerchange during model download terminates unfinished work and suppresses stale progress', () => {
  const f = fixture({ scriptURL: 'https://local.test/sw.js' });
  f.click('init'); const worker = f.workers[0];
  worker.emit({ type: 'stage', stage: 'modelFetch' });
  worker.emit({ type: 'model-download', loadedBytes: 100, expectedBytes: 1000 });
  assert.equal(f.get('download-progress').hidden, false);
  f.serviceWorker.dispatch('controllerchange');
  assert.equal(worker.terminationCount, 1); assert.equal(f.evidence().state, 'cancelled');
  assert.equal(f.timing('modelFetch').value, 'N/A'); assert.doesNotMatch(f.timing('modelFetch').status, /実行中/);
  assert.equal(f.get('download-progress').hidden, true);
  assert.doesNotMatch(f.get('download-status').textContent, /取得中/);
  const stopped = f.evidence();
  worker.emit({ type: 'model-download', loadedBytes: 1000, expectedBytes: 1000 });
  assert.deepEqual(f.evidence(), stopped); assert.equal(f.get('download-progress').hidden, true);
});
test('controllerchange after successful close must preserve the completed close outcome', () => {
  const f = fixture({ scriptURL: 'https://local.test/sw.js' });
  const worker = f.initializeReady(); f.completeClose(worker);
  f.serviceWorker.dispatch('controllerchange');
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.evidence().state, 'closed');
  assert.equal(f.evidence().timings.close.status, 'completed');
  assert.doesNotMatch(f.get('status').textContent, /記録なし|未実行/);
});
test('reinitialization after an unknown controller change refuses the new controller', () => {
  const f = fixture({ scriptURL: 'https://local.test/sw.js' });
  f.initializeReady();
  f.serviceWorker.controller = { scriptURL: 'https://local.test/unknown-sw.js' };
  f.serviceWorker.dispatch('controllerchange'); f.click('init');
  assert.equal(f.workers.length, 1);
  assert.match(f.get('validation').textContent, /UNKNOWN_SERVICE_WORKER_CONTROLLER/);
});

// Execute only the isolated streamed-response consumer with small synthetic
// decoded chunks. This loads no SDK/model and opens no sockets/browser.
const workerSource = await readFile(new URL('../../public/decision/decision-worker.mjs', import.meta.url), 'utf8');
const streamBody = workerSource.match(/let modelBuffer = await measured\('modelFetch', async \(\) => \{([\s\S]*?)\n  \}\);/)[1];
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const consume = new AsyncFunction('fetch', 'assets', 'MODEL', 'performance', 'send', streamBody);
async function streamFixture(chunks, expected = 6, options = {}) {
  const events = []; let index = 0; let cancelCount = 0; let now = 0;
  const reader = {
    async read() {
      if (options.failReadAt === index) throw new TypeError('TEST_STREAM_ERROR');
      if (index >= chunks.length) return { done: true };
      return { done: false, value: new Uint8Array(chunks[index++]) };
    },
    async cancel() { cancelCount++; if (options.cancelReject) throw new Error('TEST_CANCEL_REJECT'); },
  };
  const response = { ok: true, body: { getReader: () => reader },
    // Must never use encoded Content-Length as the decoded total.
    headers: new Headers({ 'content-encoding': 'gzip', 'content-length': '1' }),
  };
  try {
    const buffer = await consume(async () => response, { model: 'https://local.test/model' },
      { bytes: expected }, { now: () => now += 200 }, event => events.push(event));
    return { bytes: [...new Uint8Array(buffer)], events, cancelCount };
  } catch (error) { return { error, events, cancelCount }; }
}
test('stream consumer uses actual decoded bytes and pinned total, not Content-Length', async () => {
  const result = await streamFixture([[1, 2], [3], [4, 5, 6]]);
  assert.deepEqual(result.bytes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.events.map(event => event.loadedBytes), [2, 3, 6]);
  assert.ok(result.events.every(event => event.expectedBytes === 6));
});
test('short stream fails with exact model-size error', async () => {
  const result = await streamFixture([[1, 2]]);
  assert.equal(result.error?.message, 'MODEL_SIZE_MISMATCH'); assert.equal(result.bytes, undefined);
});
test('extra data after expected byte count must still fail; no early success at 100 percent', async () => {
  const result = await streamFixture([[1, 2, 3, 4, 5, 6], [7]]);
  assert.equal(result.error?.message, 'MODEL_SIZE_MISMATCH'); assert.equal(result.bytes, undefined);
  assert.equal(result.cancelCount, 1); assert.equal(result.events.at(-1).loadedBytes, 6);
});
test('oversized stream reports the size violation even if reader cancellation rejects', async () => {
  const result = await streamFixture([[1, 2, 3, 4, 5, 6, 7]], 6, { cancelReject: true });
  assert.equal(result.error?.message, 'MODEL_SIZE_MISMATCH'); assert.equal(result.bytes, undefined);
});
test('midstream errors cannot return a completed model buffer', async () => {
  const result = await streamFixture([[1], [2]], 6, { failReadAt: 1 });
  assert.equal(result.error?.message, 'TEST_STREAM_ERROR'); assert.equal(result.bytes, undefined);
});

test('configured nested application service worker is trusted instead of a hardcoded root path', () => {
  const nested = fixture({ scriptURL: 'https://local.test/project/sw.js' }, {
    assetBase: 'https://local.test/project/decision/', appBase: 'https://local.test/project/',
  });
  nested.click('init');
  assert.equal(nested.workers.length, 1);
  const wrongRoot = fixture({ scriptURL: 'https://local.test/sw.js' }, {
    assetBase: 'https://local.test/project/decision/', appBase: 'https://local.test/project/',
  });
  wrongRoot.click('init');
  assert.equal(wrongRoot.workers.length, 0);
  assert.match(wrongRoot.get('validation').textContent, /UNKNOWN_SERVICE_WORKER_CONTROLLER/);
});

test('disposed panels remove service-worker listeners and inactive panels ignore unrelated controller/CSP changes', () => {
  const f = fixture({ scriptURL: 'https://local.test/sw.js' });
  f.initializeReady();
  f.panel.deactivate();
  const inactive = f.evidence();
  f.serviceWorker.dispatch('controllerchange');
  f.document.dispatch('securitypolicyviolation', { blockedURI: 'https://other.test/?secret=1', effectiveDirective: 'connect-src' });
  assert.deepEqual(f.evidence(), inactive);
  f.panel.dispose();
  assert.equal(f.serviceWorker.listenerCount(), 0);
});
