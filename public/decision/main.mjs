import { CRITERIA, SAMPLES, TIMING_LABELS, assetURLs } from './config.mjs';
import { makeBootstrapSource } from './bootstrap.mjs';
const $ = id => document.getElementById(id);
const assets = assetURLs(import.meta.url);
const states = { idle: '未初期化', initializing: '初期化中', ready: '初期化完了・実行可能',
  running: '実際のモデルを実行中', closing: 'close() 実行中', closed: 'close() 完了',
  cancelled: '中止済み・Worker 終了（正常な close() 完了の記録なし）', error: '処理失敗・再初期化が必要' };
let worker = null;
let workerBlobURL = null;
let state = 'idle';
let bornAt = null;
let endedAt = null;
let stage = null;
let session = { events: [], results: [], timings: {} };
const probabilityCells = new Map();
const timingCells = new Map();
for (const sample of SAMPLES) {
  const option = document.createElement('option');
  option.value = sample.id; option.textContent = sample.label; $('sample').append(option);
}
for (const [key, description] of Object.entries(CRITERIA)) {
  const tr = document.createElement('tr');
  for (const text of [key, description, 'N/A']) {
    const td = document.createElement('td'); td.textContent = text; tr.append(td);
  }
  probabilityCells.set(key, tr.lastChild); $('distribution').append(tr);
}
for (const [key, label] of Object.entries(TIMING_LABELS)) {
  const tr = document.createElement('tr');
  for (const text of [label, 'N/A', '未実行']) {
    const td = document.createElement('td'); td.textContent = text; tr.append(td);
  }
  timingCells.set(key, [tr.children[1], tr.children[2]]); $('timings').append(tr);
}
function evidence() {
  $('evidence').textContent = JSON.stringify({ ...session, state }, null, 2);
}
function controls() {
  $('init').disabled = !['idle', 'closed', 'cancelled', 'error'].includes(state);
  $('run').disabled = state !== 'ready';
  $('close').disabled = state !== 'ready';
  $('cancel').disabled = worker === null;
  $('sample').disabled = ['initializing', 'running', 'closing'].includes(state);
  $('status').textContent = `${states[state]}${state === 'closed' && !worker ? '・Worker 終了' : ''}${stage ? ` / ${TIMING_LABELS[stage] || stage}` : ''}`;
  evidence();
}
function markState(next) { if (['cancelled', 'error', 'closed'].includes(next)) { $('download-progress').hidden = true; if ($('download-status').textContent.startsWith('モデルを取得中')) $('download-status').textContent = 'モデル取得・照合は完了していません（中止または失敗）'; } state = next; if (!['initializing', 'running', 'closing'].includes(state)) stage = null; controls(); }
function clearResult() {
  $('winner').textContent = 'selectedKey：N/A'; $('confidence').textContent = 'SDK confidence：N/A';
  $('call-index').textContent = 'この Worker での evaluateChoice 呼び出し順：N/A';
  $('raw').textContent = 'N/A';
  for (const cell of probabilityCells.values()) cell.textContent = 'N/A';
}
function clearTiming(key, status = '未実行') {
  session.timings[key] = null;
  const [value, label] = timingCells.get(key); value.textContent = 'N/A'; label.textContent = status;
}
function terminate(reason = 'Worker 終了・未完了') {
  if (stage && session.timings[stage] == null) clearTiming(stage, reason);
  if (worker) worker.terminate();
  worker = null;
  if (workerBlobURL) URL.revokeObjectURL(workerBlobURL);
  workerBlobURL = null;
  if (bornAt !== null && endedAt === null) endedAt = performance.now();
}
function recordNetwork(data) {
  const entries = session.events.filter(item => ['request-policy', 'csp-violation'].includes(item.type));
  $('network').textContent = entries.map(item => JSON.stringify(item)).join('\n') || 'まだ通信イベントはありません。';
  if (data.counts) $('counts').textContent = `fetch 許可：${data.counts.allowed} / 通信遮断：${data.counts.blocked} / Worker CSP 違反：${data.counts.csp}`;
}
function operationError(data) {
  if (stage && session.timings[stage] == null) clearTiming(stage, 'Worker エラー・未完了');
  $('validation').textContent = `失敗：${data.code || 'WORKER_RUNTIME_ERROR'}（${data.errorName || 'Error'}）。代替の結果は生成しません。`;
  markState('error');
}
$('sample').addEventListener('change', () => {
  $('input').textContent = SAMPLES.find(s => s.id === $('sample').value)?.text || '未選択';
  $('validation').textContent = '';
  // A previous answer must not appear to belong to a newly selected example.
  clearResult(); clearTiming('evaluateChoice'); evidence();
});
$('init').addEventListener('click', () => {
  if (!['idle', 'closed', 'cancelled', 'error'].includes(state)) return;
  terminate();
  session = { startedAt: new Date().toISOString(), browserExecution: true,
    sdkVersion: '1.1.0', delegate: 'CPU', events: [], results: [], timings: {} };
  clearResult(); for (const key of timingCells.keys()) clearTiming(key);
  $('validation').textContent = ''; $('network').textContent = 'まだ通信イベントはありません。';
  $('counts').textContent = 'fetch 許可：0 / 通信遮断：0 / CSP 違反：0';
  $('download-progress').hidden = true; $('download-status').textContent = '';
  $('integrity').textContent = 'モデル整合性：未検証'; bornAt = null; endedAt = null;
  if (!window.isSecureContext || !window.Worker || !globalThis.crypto?.subtle || typeof WebAssembly !== 'object') {
    operationError({ code: 'HTTPS_OR_LOCALHOST_AND_MODERN_BROWSER_REQUIRED' }); return;
  }
  // Our opt-in root cache Worker may control this page. Unknown controllers
  // are refused; like all same-origin code, the known app Worker is trusted.
  if (navigator.serviceWorker?.controller && navigator.serviceWorker.controller.scriptURL !== new URL('../sw.js', import.meta.url).href) {
    operationError({ code: 'UNKNOWN_SERVICE_WORKER_CONTROLLER' }); return;
  }
  try {
    const config = { baseURL: assets.baseURL, workerModuleURL: assets.workerModuleURL,
      allowedURLs: [assets.model, assets.wasmBinary, assets.wasmLoader, assets.sdk] };
    workerBlobURL = URL.createObjectURL(new Blob([makeBootstrapSource(config)], { type: 'text/javascript' }));
    const current = new Worker(workerBlobURL, { type: 'module', name: 'decision-maker-cpu-probe' });
    worker = current; bornAt = performance.now(); markState('initializing');
    current.addEventListener('message', event => {
      if (worker !== current) return; // Ignore all stale replies after cancel/reinit.
      const data = event.data;
      session.events.push(data);
      if (data.type === 'worker-ready') current.postMessage({ type: 'init' });
      else if (data.type === 'state') markState(data.state);
      else if (data.type === 'stage') { stage = data.stage; clearTiming(stage, '実行中・未完了'); controls(); }
      else if (data.type === 'timing') {
        session.timings[data.key] = { milliseconds: data.milliseconds, status: data.status };
        const [value, label] = timingCells.get(data.key);
        value.textContent = Number.isFinite(data.milliseconds) ? data.milliseconds.toFixed(2) : 'N/A';
        label.textContent = data.status === 'completed' ? '完了' : '失敗までの実測';
      } else if (data.type === 'model-download') {
        const p = $('download-progress'); p.hidden = false; p.max = data.expectedBytes; p.value = data.loadedBytes;
        $('download-status').textContent = `モデルを取得中 ${(data.loadedBytes / 1e6).toFixed(1)} / ${(data.expectedBytes / 1e6).toFixed(1)} MB（既知の展開後サイズ）`;
      } else if (data.type === 'model-verified') {
        $('download-progress').hidden = true; $('download-status').textContent = 'モデルの取得と SHA-256 検証が完了';
        $('integrity').textContent = `モデル整合性：一致 / ${data.bytes} bytes / SHA-256 ${data.sha256}`;
      } else if (data.type === 'result') {
        session.results.push(data);
        const value = data.result;
        $('winner').textContent = `selectedKey：${value?.selectedKey === '' ? '空文字（SDK 返却）' : (value?.selectedKey ?? 'N/A（未返却）')}`;
        $('confidence').textContent = `SDK confidence：${value?.confidence ?? 'N/A（未返却）'}`;
        $('call-index').textContent = `この Worker での evaluateChoice 呼び出し順：${data.attemptedCallIndex}${data.attemptedCallIndex === 1 ? '（初回。事前の推論なし）' : '（再実行）'}`;
        for (const [key, cell] of probabilityCells) cell.textContent = value?.probabilities?.[key] == null ? 'N/A（未返却）' : String(value.probabilities[key]);
        $('raw').textContent = JSON.stringify(value, null, 2) ?? 'undefined（SDK から値の返却なし）';
      } else if (data.type === 'operation-error' || data.type === 'fatal') operationError(data);
      else if (data.type === 'validation') $('validation').textContent = `入力・状態の検証：${data.code}`;
      if (['request-policy', 'csp-violation'].includes(data.type)) recordNetwork(data);
      evidence();
    });
    current.addEventListener('error', event => {
      if (worker !== current) return;
      event.preventDefault(); // Do not capture SDK error text, URLs, or header values.
      session.events.push({ type: 'worker-error', code: 'WORKER_RUNTIME_ERROR' });
      operationError({ code: 'WORKER_RUNTIME_ERROR' }); terminate(); controls();
    });
  } catch { operationError({ code: 'WORKER_START_FAILED' }); terminate(); controls(); }
});
$('run').addEventListener('click', () => {
  if (state !== 'ready' || !worker) return;
  clearResult(); clearTiming('evaluateChoice');
  const sample = SAMPLES.find(s => s.id === $('sample').value);
  if (!sample) {
    $('validation').textContent = '架空の例を選んでください。入力がないため推論は実行しません。';
    session.events.push({ type: 'validation', code: 'NO_SELECTION_NO_INFERENCE' }); evidence(); return;
  }
  $('validation').textContent = ''; markState('running');
  worker.postMessage({ type: 'run', sampleId: sample.id });
});
$('close').addEventListener('click', () => {
  if (state !== 'ready' || !worker) return;
  markState('closing'); clearTiming('close'); worker.postMessage({ type: 'close' });
});
$('cancel').addEventListener('click', () => {
  if (!worker) return;
  const closePreviouslyCompleted = session.timings.close?.status === 'completed';
  session.events.push({ type: 'worker-terminated', closePreviouslyCompleted, interruptedStage: stage });
  terminate('中止・未完了'); markState(closePreviouslyCompleted ? 'closed' : 'cancelled');
});
// Observe the document CSP too. Never keep blockedURI's query, headers, or body.
document.addEventListener('securitypolicyviolation', event => {
  let origin = '[unknown]';
  try { origin = new URL(event.blockedURI, location.href).origin; } catch { /* redact */ }
  session.events.push({ type: 'document-csp-violation', origin, path: '[redacted]', directive: event.effectiveDirective });
  $('validation').textContent = `Document CSP が通信・実行を拒否しました：${event.effectiveDirective}`;
  evidence();
});
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!worker) return;
  session.events.push({ type: 'service-worker-controller-changed' });
  const closePreviouslyCompleted = session.timings.close?.status === 'completed';
  terminate('キャッシュ制御が変更・未完了'); markState(closePreviouslyCompleted ? 'closed' : 'cancelled');
  $('validation').textContent = 'キャッシュの制御が変わったため中止しました。もう一度初期化してください。';
});
window.addEventListener('pagehide', () => {
  session.events.push({ type: 'pagehide-worker-terminated', interruptedStage: stage });
  terminate('ページ離脱・未完了');
});
window.addEventListener('pageshow', event => {
  if (event.persisted && bornAt !== null) { session.events.push({ type: 'bfcache-return-worker-terminated' }); markState(session.timings.close?.status === 'completed' ? 'closed' : 'cancelled'); }
});
setInterval(() => {
  $('elapsed').textContent = bornAt === null ? 'Worker 生存時間：N/A' :
    `Worker 生存時間：${(((endedAt ?? performance.now()) - bornAt) / 1000).toFixed(1)} 秒${endedAt !== null ? '（終了）' : ''}。進捗率ではありません。`;
}, 250);
controls();
