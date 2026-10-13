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

function fixture({ autoActivate = true, assetBase = 'https://local.test/probe/', appBase = 'https://local.test/' } = {}) {
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
  const createdBlobs = [];
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
  MockURL.createObjectURL = blob => { createdBlobs.push(blob); return `blob:https://local.test/mock-${++urlIndex}`; };
  MockURL.revokeObjectURL = url => revokedURLs.push(url);
  const window = { ...eventTarget(), isSecureContext: true, Worker };
  const context = {
    CRITERIA, SAMPLES, TIMING_LABELS, assetURLs, makeBootstrapSource,
    document, root, assetBase, appBase, window, navigator: {}, crypto: { subtle: {} }, WebAssembly: {},
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
  return { get, root, document, panel, intervals, workers, revokedURLs, createdBlobs, window, evidence, timing, click, initializeReady, completeClose };
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

test('mount and repeated activation never create a worker, initialize an SDK, or start duplicate timers', () => {
  const f = fixture({ autoActivate: false });
  assert.equal(f.workers.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.get('init').disabled, true);
  f.click('init'); f.click('run');
  assert.equal(f.workers.length, 0);
  f.panel.activate(); f.panel.activate();
  assert.equal(f.intervals.size, 1);
  assert.equal(f.get('init').disabled, false);
  assert.equal(f.workers.length, 0);
  assert.equal(f.evidence().state, 'idle');
  f.panel.deactivate('test tab switch');
  assert.equal(f.intervals.size, 0);
  f.panel.activate();
  assert.equal(f.intervals.size, 1);
  assert.equal(f.workers.length, 0);
  assert.equal(f.evidence().state, 'idle');
});

test('deactivation during initialization terminates and revokes immediately, stops timers, and requires manual reinit', () => {
  const f = fixture();
  f.click('init');
  const worker = f.workers[0];
  worker.emit({ type: 'stage', stage: 'modelFetch' });
  worker.emit({ type: 'model-download', loadedBytes: 10, expectedBytes: 100 });
  f.panel.deactivate('別のタブ');
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.revokedURLs.length, 1);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.evidence().state, 'cancelled');
  assert.equal(f.timing('modelFetch').value, 'N/A');
  assert.match(f.timing('modelFetch').status, /未完了/);
  assert.equal(f.get('download-progress').hidden, true);
  assert.doesNotMatch(f.get('download-status').textContent, /取得中/);
  assert.match(f.get('status').textContent, /close\(\) 完了の記録なし/);
  assert.equal(f.get('init').disabled, true);
  const stopped = f.evidence();
  worker.emit({ type: 'state', state: 'ready' });
  worker.emit({ type: 'model-download', loadedBytes: 100, expectedBytes: 100 });
  assert.deepEqual(f.evidence(), stopped);
  f.click('init');
  assert.equal(f.workers.length, 1);
  f.panel.activate();
  assert.equal(f.workers.length, 1);
  assert.equal(f.get('init').disabled, false);
  assert.equal(f.get('run').disabled, true);
  f.click('init');
  assert.equal(f.workers.length, 2);
  const initializing = f.evidence();
  worker.emit({ type: 'result', result: { selectedKey: 'stale' } });
  assert.deepEqual(f.evidence(), initializing);
});

test('deactivation before the first worker reply records an incomplete init without an invented time', () => {
  const f = fixture();
  f.click('init');
  const worker = f.workers[0];
  f.panel.deactivate();
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.timing('sdkImport').value, 'N/A');
  assert.match(f.timing('sdkImport').status, /未完了/);
  assert.equal(f.evidence().timings.sdkImport, null);
  assert.equal(f.evidence().timings.close, null);
});

test('deactivation during a second inference cannot leave an old winner or count a forced stop as close', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.get('sample').value = SAMPLES[0].id;
  f.get('sample').dispatch('change');
  f.click('run');
  worker.emit({ type: 'timing', key: 'evaluateChoice', milliseconds: 42, status: 'completed' });
  worker.emit({ type: 'result', attemptedCallIndex: 1, result: { selectedKey: 'billing', confidence: .6, probabilities: { billing: .7 } } });
  worker.emit({ type: 'state', state: 'ready' });
  assert.match(f.get('winner').textContent, /billing/);
  f.click('run');
  // Stop before even a worker-side stage acknowledgement arrives.
  f.panel.deactivate('タブ切替');
  assert.equal(worker.terminationCount, 1);
  assert.match(f.get('winner').textContent, /N\/A/);
  assert.equal(f.get('raw').textContent, 'N/A');
  assert.deepEqual(f.timing('evaluateChoice'), { value: 'N/A', status: 'タブ切替・未完了' });
  assert.equal(f.evidence().timings.close, null);
  assert.equal(worker.messages.some(message => message.type === 'close'), false);
  assert.equal(f.evidence().events.at(-1).closePreviouslyCompleted, false);
  f.panel.activate();
  assert.equal(f.get('run').disabled, true);
  assert.match(f.get('winner').textContent, /N\/A/);
});

test('deactivation during close labels it incomplete instead of claiming successful SDK cleanup', () => {
  const f = fixture();
  const worker = f.initializeReady();
  f.click('close');
  f.panel.deactivate();
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.evidence().state, 'cancelled');
  assert.deepEqual(f.timing('close'), { value: 'N/A', status: 'タブ切替・未完了' });
  assert.match(f.get('status').textContent, /完了の記録なし/);
});

test('completed output and successful close evidence remain inspectable after tab leave', () => {
  const f = fixture();
  const worker = f.initializeReady();
  worker.emit({ type: 'result', attemptedCallIndex: 1, result: { selectedKey: '', confidence: 0, probabilities: { billing: 0 } } });
  f.completeClose(worker);
  f.panel.deactivate();
  assert.equal(f.evidence().state, 'closed');
  assert.match(f.get('winner').textContent, /空文字（SDK 返却）/);
  assert.equal(f.evidence().results.length, 1);
  assert.deepEqual(f.timing('close'), { value: '2.50', status: '完了' });
  assert.equal(worker.terminationCount, 1);
  f.panel.activate();
  assert.equal(f.get('run').disabled, true);
  assert.equal(f.workers.length, 1);
});

test('dispose removes document/window/control listeners and leaves no worker or interval to restart', () => {
  const f = fixture();
  const worker = f.initializeReady();
  assert.ok(f.document.listenerCount() > 0);
  assert.ok(f.window.listenerCount() > 0);
  f.panel.dispose(); f.panel.dispose();
  assert.equal(worker.terminationCount, 1);
  assert.equal(f.revokedURLs.length, 1);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.document.listenerCount(), 0);
  assert.equal(f.window.listenerCount(), 0);
  assert.equal(f.get('init').listenerCount(), 0);
  assert.equal(f.root.children[0].removed, true);
  const disposed = f.evidence();
  f.window.dispatch('pageshow', { persisted: true });
  f.document.dispatch('securitypolicyviolation', { blockedURI: 'https://example.test/private?token=secret', effectiveDirective: 'connect-src' });
  worker.emit({ type: 'state', state: 'ready' });
  f.panel.activate(); f.click('init');
  assert.equal(f.workers.length, 1);
  assert.equal(f.intervals.size, 0);
  assert.deepEqual(f.evidence(), disposed);
});

test('stylesheet and model bootstrap follow the supplied nested asset base rather than document route', async () => {
  const f = fixture({ assetBase: 'https://local.test/project/decision/', appBase: 'https://local.test/project/' });
  assert.equal(f.root.children[0].href, 'https://local.test/project/decision/style.css');
  f.click('init');
  assert.equal(f.workers.length, 1);
  const bootstrap = await f.createdBlobs[0].text();
  assert.match(bootstrap, /https:\/\/local\.test\/project\/decision\/decision-worker\.mjs/);
  assert.match(bootstrap, /https:\/\/local\.test\/project\/decision\/assets\/embeddinggemma-2-text-270m\.litertlm/);
  assert.doesNotMatch(bootstrap, /https:\/\/local\.test\/probe\//);
});
