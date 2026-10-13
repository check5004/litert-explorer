import { MODEL, SDK_VERSION, CRITERIA, SAMPLES, assetURLs } from './config.mjs';
import { applyOfficialPromiseWorkaround } from './promise-workaround.mjs';

if (!self.__decisionProbePolicy) throw new Error('REQUEST_POLICY_REQUIRED_BEFORE_WORKER_IMPORT');
const assets = assetURLs(import.meta.url);
let task = null;
let state = 'idle';
let stage = 'idle';
let attemptedCalls = 0;
const timings = {};
const send = data => self.postMessage(data);
const setState = value => { state = value; send({ type: 'state', state }); };
async function measured(key, operation) {
  stage = key;
  send({ type: 'stage', stage });
  const start = performance.now();
  try {
    const value = await operation();
    timings[key] = { milliseconds: performance.now() - start, status: 'completed' };
    send({ type: 'timing', key, ...timings[key] });
    return value;
  } catch (error) {
    timings[key] = { milliseconds: performance.now() - start, status: 'failed' };
    send({ type: 'timing', key, ...timings[key] });
    throw error;
  }
}
const expectedCodes = new Set([
  'MODEL_HTTP_ERROR', 'MODEL_SIZE_MISMATCH', 'MODEL_SHA256_MISMATCH',
  'MODEL_RESPONSE_BODY_UNAVAILABLE', 'FILESET_UNEXPECTED_PATH',
  'PINNED_1_1_0_PROMISE_WORKAROUND_SHAPE_CHANGED',
  'WEB_CRYPTO_UNAVAILABLE', 'SDK_PUBLIC_API_SHAPE_CHANGED',
]);
function safeError(error) {
  return { code: expectedCodes.has(error?.message) ? error.message : 'SDK_OR_BROWSER_OPERATION_FAILED',
    errorName: error?.name || 'Error', stage };
}
async function initialize() {
  setState('initializing');
  const { DecisionMaker, FilesetResolver } = await measured('sdkImport', () => import(assets.sdk));
  if (typeof DecisionMaker?.createFromOptions !== 'function' || typeof FilesetResolver?.forDecisionTasks !== 'function') {
    throw new Error('SDK_PUBLIC_API_SHAPE_CHANGED');
  }
  const fileset = await measured('fileset', () => FilesetResolver.forDecisionTasks(assets.wasmDirectory, true));
  if (fileset.wasmLoaderPath !== assets.wasmLoader || fileset.wasmBinaryPath !== assets.wasmBinary) {
    throw new Error('FILESET_UNEXPECTED_PATH');
  }
  let modelBuffer = await measured('modelFetch', async () => {
    const response = await fetch(assets.model);
    if (!response.ok) throw new Error('MODEL_HTTP_ERROR');
    if (!response.body) throw new Error('MODEL_RESPONSE_BODY_UNAVAILABLE');
    const data = new Uint8Array(MODEL.bytes);
    const reader = response.body.getReader(); let offset = 0; let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (offset + value.byteLength > MODEL.bytes) { void reader.cancel().catch(() => {}); throw new Error('MODEL_SIZE_MISMATCH'); }
      data.set(value, offset); offset += value.byteLength;
      if (performance.now() - lastReport > 150 || offset === MODEL.bytes) {
        send({ type: 'model-download', loadedBytes: offset, expectedBytes: MODEL.bytes }); lastReport = performance.now();
      }
    }
    if (offset !== MODEL.bytes) throw new Error('MODEL_SIZE_MISMATCH');
    return data.buffer;
  });
  const actualHash = await measured('modelHash', async () => {
    if (!self.crypto?.subtle) throw new Error('WEB_CRYPTO_UNAVAILABLE');
    const digest = await crypto.subtle.digest('SHA-256', modelBuffer);
    const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== MODEL.sha256) throw new Error('MODEL_SHA256_MISMATCH');
    return hex;
  });
  send({ type: 'model-verified', bytes: modelBuffer.byteLength, sha256: actualHash });
  // Deliberately buffer once for SHA-256 verification. This increases peak browser
  // memory versus the streaming-only official sample; do not claim a memory win.
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(modelBuffer));
    controller.close();
  } });
  task = await measured('create', () => DecisionMaker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: stream.getReader(), delegate: 'CPU' },
    modelAssetSize: MODEL.bytes,
    maxNumTokens: 4096,
  }));
  modelBuffer = null;
  const methods = await measured('promiseWrapper', () => applyOfficialPromiseWorkaround(task));
  send({ type: 'initialized', sdkVersion: SDK_VERSION, delegate: 'CPU',
    model: MODEL, methods, contextWindow: task.contextWindow,
    runtimeChain: ['MediaPipe Tasks', 'LiteRT-LM', 'LiteRT'] });
  setState('ready');
}
async function run(id) {
  // Only IDs for immutable fictional samples cross the main/worker boundary.
  const sample = SAMPLES.find(entry => entry.id === id);
  if (!sample || !sample.text.trim()) {
    send({ type: 'validation', code: 'SELECT_BAKED_IN_FICTIONAL_SAMPLE' });
    return;
  }
  setState('running');
  attemptedCalls += 1;
  const value = await measured('evaluateChoice', () => task.evaluateChoice(sample.text, {
    criteria: { ...CRITERIA }, instructions: '',
  }));
  // Preserve the SDK object unchanged. No prior, fallback, threshold, confidence
  // substitution, generated rationale, or hardcoded sample answer.
  send({ type: 'result', sampleId: sample.id, input: sample.text,
    criteria: CRITERIA, instructions: '', attemptedCallIndex: attemptedCalls,
    result: value, timing: timings.evaluateChoice });
  setState('ready');
}
async function closeTask() {
  setState('closing');
  // Measure the synchronous close() function itself, not an invented transport wait.
  stage = 'close';
  send({ type: 'stage', stage });
  const start = performance.now();
  try {
    task.close();
    timings.close = { milliseconds: performance.now() - start, status: 'completed' };
  } catch (error) {
    timings.close = { milliseconds: performance.now() - start, status: 'failed' };
    throw error;
  } finally {
    send({ type: 'timing', key: 'close', ...timings.close });
    task = null;
  }
  setState('closed');
  send({ type: 'closed', counts: self.__decisionProbePolicy.snapshot() });
  // Do not terminate here: allow close-triggered async transport rejections/logs
  // to settle. The user can cancel or reinitialize; unload terminates the worker.
}
self.addEventListener('message', async event => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  try {
    if (message.type === 'init' && state === 'idle') await initialize();
    else if (message.type === 'run' && state === 'ready') await run(message.sampleId);
    else if (message.type === 'close' && state === 'ready') await closeTask();
    else send({ type: 'validation', code: 'INVALID_STATE', state });
  } catch (error) {
    send({ type: 'operation-error', ...safeError(error) });
    // Discard a possibly partly-mutated task on any inference/init failure.
    // Cleanup may attempt telemetry, still behind the preinstalled gate.
    if (task) {
      try { task.close(); } catch { /* Never publish a false cleanup success. */ }
      task = null;
    }
    setState('error');
  }
});
send({ type: 'worker-ready' });
