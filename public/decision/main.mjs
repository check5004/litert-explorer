import { CRITERIA, SAMPLES, TIMING_LABELS, assetURLs } from './config.mjs';
import { makeBootstrapSource } from './bootstrap.mjs';
/** Mount the retained Decision panel. Mounting and activation never load a model. */
export function mountDecision(root, { assetBase = new URL('./', import.meta.url), appBase = new URL('../', import.meta.url) } = {}) {
  const $ = id => root.querySelector(`#${id}`);
  const assets = assetURLs(new URL('main.mjs', assetBase));
  const expectedServiceWorkerURL = new URL('sw.js', appBase).href;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('style.css', assetBase).href;
  root.append(stylesheet);
  let active = false;
  let disposed = false;
  let elapsedTimer = null;
  let resumeAfterPagehide = false;
  const removeListeners = [];
  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    removeListeners.push(() => target.removeEventListener(type, handler));
  }
  const states = { idle: 'まずモデルを準備してください。', initializing: 'モデルを準備しています。', ready: '準備できました。例を選んで分類できます。',
    running: 'この端末で分類しています。', closing: 'モデルを解放しています。', closed: 'モデルを解放しました。',
    cancelled: '中止しました。続けるにはもう一度モデルを準備してください。', error: '処理を完了できませんでした。下の案内を確認してください。' };
  const stageLabels = { sdkImport: '実行用ファイルを読み込み中', fileset: '実行環境を確認中', modelFetch: 'モデルを取得中',
    modelHash: '取得したモデルを確認中', create: 'モデルを端末に読み込み中', promiseWrapper: '実行の準備を仕上げています',
    evaluateChoice: '問い合わせと候補の意味を比較中', close: 'モデルを解放中' };
  // These labels describe the SDK's selected key, never a sample-specific answer.
  const categoryLabels = { billing: '料金・請求', technical: '不具合・エラー', account: 'ログイン・アカウント', other: '使い方・その他' };
  const setupKeys = ['sdkImport', 'fileset', 'modelHash', 'create', 'promiseWrapper'];
  let displayedCallIndex = null;
  let worker = null;
  let workerBlobURL = null;
  let state = 'idle';
  let bornAt = null;
  let endedAt = null;
  let stage = null;
  let session = { events: [], results: [], timings: {} };
  const probabilityCells = new Map();
  const timingCells = new Map();
  const timingStatuses = new Map();
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
    $('init').disabled = !active || disposed || !['idle', 'closed', 'cancelled', 'error'].includes(state);
    $('run').disabled = !active || disposed || state !== 'ready';
    $('close').disabled = !active || disposed || state !== 'ready';
    $('cancel').disabled = !active || disposed || worker === null;
    $('sample').disabled = !active || disposed || ['initializing', 'running', 'closing'].includes(state);
    $('status').textContent = `${states[state]}${stage ? ` ${stageLabels[stage] || '処理中'}` : ''}`;
    renderTimingSummary();
    evidence();
  }
  function markState(next) { if (['cancelled', 'error', 'closed'].includes(next)) { $('download-progress').hidden = true; if ($('download-status').textContent.startsWith('モデルを取得中')) $('download-status').textContent = 'モデル取得・照合は完了していません（中止または失敗）'; } state = next; if (!['initializing', 'running', 'closing'].includes(state)) stage = null; controls(); }
  function measuredTime(milliseconds) {
    return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} 秒` : `${milliseconds.toFixed(2)} ms`;
  }
  function completedTiming(key) {
    const timing = session.timings[key];
    return timing?.status === 'completed' && Number.isFinite(timing.milliseconds) && timing.milliseconds >= 0 ? timing.milliseconds : null;
  }
  function missingTiming(key) {
    return session.timings[key]?.status === 'failed' || (timingStatuses.has(key) && timingStatuses.get(key) !== '未実行') ? '未完了' : '未計測';
  }
  function renderTimingSummary() {
    const inference = completedTiming('evaluateChoice');
    $('inference-time').textContent = inference !== null ? measuredTime(inference) : state === 'running' ? '計測中' : missingTiming('evaluateChoice');
    $('inference-note').textContent = inference !== null
      ? `${displayedCallIndex === 1 ? '初回の分類。' : displayedCallIndex > 1 ? `このモデルで ${displayedCallIndex} 回目の分類。` : ''}分類の処理だけを実測。モデルの取得・準備時間は含みません。`
      : state === 'running' ? '実際の処理が終わると、かかった時間を表示します。'
      : '分類すると実測値が表示されます。モデルの取得・準備時間は含みません。';
    const download = completedTiming('modelFetch');
    $('download-time').textContent = download !== null ? measuredTime(download) : stage === 'modelFetch' && state === 'initializing' ? '取得中' : missingTiming('modelFetch');
    const setup = setupKeys.map(completedTiming);
    $('setup-time').textContent = setup.every(value => value !== null) ? measuredTime(setup.reduce((sum, value) => sum + value, 0)) : state === 'initializing' ? '準備中' : setupKeys.some(key => missingTiming(key) === '未完了') ? '未完了' : '未計測';
  }
  function renderResult(value) {
    const key = value?.selectedKey;
    if (Object.hasOwn(categoryLabels, key)) {
      $('result-label').textContent = categoryLabels[key];
      $('result-meaning').textContent = `この候補の説明文が選ばれました。${CRITERIA[key]}`;
    } else {
      $('result-label').textContent = key === '' ? '候補を選べませんでした' : key == null ? '分類結果が返りませんでした' : '未定義の候補が返りました';
      $('result-meaning').textContent = '別の担当候補に置き換えず、モデルの返却内容をそのまま記録しています。下の「結果の詳細」で確認できます。';
    }
  }
  function clearResult() {
    displayedCallIndex = null;
    $('result-label').textContent = 'まだ分類していません';
    $('result-meaning').textContent = '例を選び、準備が終わったら「この例を分類する」を押してください。';
    $('winner').textContent = 'selectedKey：N/A'; $('confidence').textContent = 'SDK confidence：N/A';
    $('call-index').textContent = 'この Worker での evaluateChoice 呼び出し順：N/A';
    $('raw').textContent = 'N/A';
    for (const cell of probabilityCells.values()) cell.textContent = 'N/A';
  }
  function clearTiming(key, status = '未実行') {
    session.timings[key] = null;
    timingStatuses.set(key, status);
    const [value, label] = timingCells.get(key); value.textContent = 'N/A'; label.textContent = status;
    renderTimingSummary();
  }
  function terminate(reason = 'Worker 終了・未完了') {
    if (stage && session.timings[stage] == null) clearTiming(stage, reason);
    const previous = worker;
    worker = null; // Invalidate queued messages before asking the old worker to stop.
    if (previous) previous.terminate();
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
    const help = {
      HTTPS_OR_LOCALHOST_AND_MODERN_BROWSER_REQUIRED: 'このブラウザーでは必要な機能が使えません。HTTPS または localhost で開き、最新版の Chrome / Edge で試してください。',
      UNKNOWN_SERVICE_WORKER_CONTROLLER: 'このページを別のキャッシュ処理が管理しているため、安全のため停止しました。ページを再読み込みし、続く場合はサイトの管理者に確認してください。',
      MODEL_HTTP_ERROR: 'モデルを取得できませんでした。通信を確認し、「モデルを準備する」をもう一度押してください。続く場合は配信ファイルの確認が必要です。',
      MODEL_RESPONSE_BODY_UNAVAILABLE: 'モデルのデータを読み取れませんでした。通信を確認し、最新版の Chrome / Edge で準備し直してください。',
      MODEL_SIZE_MISMATCH: '取得したモデルのサイズが一致しないため停止しました。通信を確認して準備し直し、続く場合はサイトの管理者に確認してください。',
      MODEL_SHA256_MISMATCH: '取得したモデルの検証に失敗したため停止しました。もう一度準備し、続く場合はサイトの管理者に確認してください。',
      WEB_CRYPTO_UNAVAILABLE: 'モデルを検証するブラウザー機能が使えません。HTTPS または localhost で開き、最新版の Chrome / Edge で試してください。',
      FILESET_UNEXPECTED_PATH: '実行用ファイルの構成が想定と異なります。サイトの管理者による配信ファイルの確認が必要です。',
      PINNED_1_1_0_PROMISE_WORKAROUND_SHAPE_CHANGED: 'SDK の構成が想定と異なります。サイトの管理者によるバージョンの確認が必要です。',
      SDK_PUBLIC_API_SHAPE_CHANGED: 'SDK の機能が想定と異なります。サイトの管理者によるバージョンの確認が必要です。',
    };
    $('validation').textContent = help[data.code] || 'ブラウザーが処理を完了できませんでした。ほかのタブを閉じ、最新版の Chrome / Edge でモデルを準備し直してください。メモリの少ない端末では実行できない場合があります。';
    $('error-detail').textContent = `エラー：${data.code || 'WORKER_RUNTIME_ERROR'}（${data.errorName || 'Error'}） / ${data.stage || stage || '開始時'}`;
    $('result-label').textContent = '処理を完了できませんでした';
    $('result-meaning').textContent = '入力欄の下に原因と次の操作を表示しています。結果は生成していません。';
    markState('error');
  }
  listen($('sample'), 'change', () => {
    if (!active || disposed || $('sample').disabled) return;
    $('input').textContent = SAMPLES.find(s => s.id === $('sample').value)?.text || '選んだ問い合わせがここに表示されます。';
    $('validation').textContent = '';
    // A previous answer must not appear to belong to a newly selected example.
    clearResult(); clearTiming('evaluateChoice'); evidence();
  });
  listen($('init'), 'click', () => {
    if (!active || disposed || !['idle', 'closed', 'cancelled', 'error'].includes(state)) return;
    terminate();
    session = { startedAt: new Date().toISOString(), browserExecution: true,
      sdkVersion: '1.1.0', delegate: 'CPU', events: [], results: [], timings: {} };
    clearResult(); for (const key of timingCells.keys()) clearTiming(key);
    $('error-detail').textContent = 'エラーの記録はありません。';
    $('validation').textContent = ''; $('network').textContent = 'まだ通信イベントはありません。';
    $('counts').textContent = 'fetch 許可：0 / 通信遮断：0 / CSP 違反：0';
    $('download-progress').hidden = true; $('download-status').textContent = '';
    $('integrity').textContent = 'モデル整合性：未検証'; bornAt = null; endedAt = null; $('elapsed').textContent = 'Worker 生存時間：N/A';
    if (!window.isSecureContext || !window.Worker || !globalThis.crypto?.subtle || typeof WebAssembly !== 'object') {
      operationError({ code: 'HTTPS_OR_LOCALHOST_AND_MODERN_BROWSER_REQUIRED' }); return;
    }
    // Our opt-in root cache Worker may control this page. Unknown controllers
    // are refused; like all same-origin code, the known app Worker is trusted.
    if (navigator.serviceWorker?.controller && navigator.serviceWorker.controller.scriptURL !== expectedServiceWorkerURL) {
      operationError({ code: 'UNKNOWN_SERVICE_WORKER_CONTROLLER' }); return;
    }
    try {
      const config = { baseURL: assets.baseURL, workerModuleURL: assets.workerModuleURL,
        allowedURLs: [assets.model, assets.wasmBinary, assets.wasmLoader, assets.sdk] };
      workerBlobURL = URL.createObjectURL(new Blob([makeBootstrapSource(config)], { type: 'text/javascript' }));
      const current = new Worker(workerBlobURL, { type: 'module', name: 'decision-maker-cpu-probe' });
      worker = current; bornAt = performance.now(); markState('initializing');
      current.addEventListener('message', event => {
        if (!active || disposed || worker !== current) return; // Ignore all stale replies after cancel/reinit.
        const data = event.data;
        session.events.push(data);
        if (data.type === 'worker-ready') current.postMessage({ type: 'init' });
        else if (data.type === 'state') markState(data.state);
        else if (data.type === 'stage') { stage = data.stage; clearTiming(stage, '実行中・未完了'); controls(); }
        else if (data.type === 'timing') {
          session.timings[data.key] = { milliseconds: data.milliseconds, status: data.status };
          timingStatuses.set(data.key, data.status);
          const [value, label] = timingCells.get(data.key);
          value.textContent = Number.isFinite(data.milliseconds) ? data.milliseconds.toFixed(2) : 'N/A';
          label.textContent = data.status === 'completed' ? '完了' : '失敗までの実測';
          renderTimingSummary();
        } else if (data.type === 'model-download') {
          const p = $('download-progress'); p.hidden = false; p.max = data.expectedBytes; p.value = data.loadedBytes;
          $('download-status').textContent = `モデルを取得中 ${(data.loadedBytes / 1e6).toFixed(1)} / ${(data.expectedBytes / 1e6).toFixed(1)} MB（既知の展開後サイズ）`;
        } else if (data.type === 'model-verified') {
          $('download-progress').hidden = true; $('download-status').textContent = 'モデルの取得・検証が完了しました。';
          $('integrity').textContent = `モデル整合性：一致 / ${data.bytes} bytes / SHA-256 ${data.sha256}`;
        } else if (data.type === 'result') {
          session.results.push(data);
          const value = data.result;
          displayedCallIndex = data.attemptedCallIndex;
          renderResult(value); renderTimingSummary();
          $('winner').textContent = `selectedKey：${value?.selectedKey === '' ? '空文字（SDK 返却）' : (value?.selectedKey ?? 'N/A（未返却）')}`;
          $('confidence').textContent = `SDK confidence：${value?.confidence ?? 'N/A（未返却）'}`;
          $('call-index').textContent = `この Worker での evaluateChoice 呼び出し順：${data.attemptedCallIndex}${data.attemptedCallIndex === 1 ? '（初回。事前の推論なし）' : '（再実行）'}`;
          for (const [key, cell] of probabilityCells) cell.textContent = value?.probabilities?.[key] == null ? 'N/A（未返却）' : String(value.probabilities[key]);
          $('raw').textContent = JSON.stringify(value, null, 2) ?? 'undefined（SDK から値の返却なし）';
        } else if (data.type === 'operation-error' || data.type === 'fatal') operationError(data);
        else if (data.type === 'validation') {
          $('validation').textContent = '例を選び、準備の完了を待ってから分類してください。';
          $('error-detail').textContent = `入力・状態の検証：${data.code}`;
        }
        if (['request-policy', 'csp-violation'].includes(data.type)) recordNetwork(data);
        evidence();
      });
      current.addEventListener('error', event => {
        if (!active || disposed || worker !== current) return;
        event.preventDefault(); // Do not capture SDK error text, URLs, or header values.
        session.events.push({ type: 'worker-error', code: 'WORKER_RUNTIME_ERROR' });
        operationError({ code: 'WORKER_RUNTIME_ERROR' }); terminate(); controls();
      });
    } catch { operationError({ code: 'WORKER_START_FAILED' }); terminate(); controls(); }
  });
  listen($('run'), 'click', () => {
    if (!active || disposed || state !== 'ready' || !worker) return;
    clearResult(); clearTiming('evaluateChoice');
    const sample = SAMPLES.find(s => s.id === $('sample').value);
    if (!sample) {
      $('validation').textContent = '架空の例を選んでください。入力がないため推論は実行しません。';
      session.events.push({ type: 'validation', code: 'NO_SELECTION_NO_INFERENCE' }); evidence(); return;
    }
    $('result-label').textContent = '分類しています';
    $('result-meaning').textContent = 'この端末で問い合わせと候補の説明文を比較しています。';
    $('validation').textContent = ''; stage = 'evaluateChoice'; clearTiming('evaluateChoice', '実行中・未完了'); markState('running');
    worker.postMessage({ type: 'run', sampleId: sample.id });
  });
  listen($('close'), 'click', () => {
    if (!active || disposed || state !== 'ready' || !worker) return;
    stage = 'close'; clearTiming('close', '実行中・未完了'); markState('closing'); worker.postMessage({ type: 'close' });
  });
  function stopWorker(reason, eventType = 'worker-terminated') {
    if (!worker) return;
    const closePreviouslyCompleted = session.timings.close?.status === 'completed';
    if (state === 'initializing' && !stage) stage = 'sdkImport';
    const unfinishedInference = state === 'running' && session.timings.evaluateChoice?.status !== 'completed';
    session.events.push({ type: eventType, reason, closePreviouslyCompleted, interruptedStage: stage });
    if (unfinishedInference || state === 'initializing') clearResult();
    terminate(`${reason}・未完了`);
    markState(closePreviouslyCompleted ? 'closed' : 'cancelled');
    if (unfinishedInference) {
      $('result-label').textContent = '分類を中止しました';
      $('result-meaning').textContent = '完了した結果はありません。もう一度モデルを準備すると試せます。';
    }
    renderElapsed();
  }
  listen($('cancel'), 'click', () => {
    if (!active || disposed) return;
    stopWorker('中止');
  });
  // The shared document CSP permits fixed LLM download hosts. Decision's exact
  // request allowlist is installed in its Blob worker before the SDK is imported.
  // Observe document CSP failures too, without retaining blocked query strings.
  listen(document, 'securitypolicyviolation', event => {
    if (!active || disposed) return;
    let origin = '[unknown]';
    try { origin = new URL(event.blockedURI, location.href).origin; } catch { /* redact */ }
    session.events.push({ type: 'document-csp-violation', origin, path: '[redacted]', directive: event.effectiveDirective });
    $('validation').textContent = 'ページの安全設定で通信または実行が止まりました。再読み込みしても続く場合は、サイトの管理者に確認してください。';
    $('error-detail').textContent = `Document CSP が通信・実行を拒否しました：${event.effectiveDirective}`;
    evidence();
  });
  listen(navigator.serviceWorker, 'controllerchange', () => {
    if (!active || disposed || !worker) return;
    stopWorker('キャッシュ制御が変更', 'service-worker-controller-changed');
    $('validation').textContent = 'キャッシュの制御が変わったため中止しました。「モデルを準備する」をもう一度押してください。';
  });
  listen(window, 'pagehide', () => {
    resumeAfterPagehide = active;
    deactivate('ページ離脱');
  });
  listen(window, 'pageshow', event => {
    if (event.persisted && resumeAfterPagehide && !disposed) {
      resumeAfterPagehide = false;
      activate(); // Restore controls only; reinitialization remains explicitly opt-in.
    }
  });
  function renderElapsed() {
    $('elapsed').textContent = bornAt === null ? 'Worker 生存時間：N/A' :
      `Worker 生存時間：${(((endedAt ?? performance.now()) - bornAt) / 1000).toFixed(1)} 秒${endedAt !== null ? '（終了）' : ''}。進捗率ではありません。`;
  }
  function activate() {
    if (disposed || active) return;
    active = true;
    renderElapsed();
    elapsedTimer = setInterval(renderElapsed, 250);
    controls();
  }
  function deactivate(reason = 'タブ切替') {
    active = false;
    if (elapsedTimer !== null) clearInterval(elapsedTimer);
    elapsedTimer = null;
    const interrupted = worker !== null;
    stopWorker(reason, 'panel-deactivated-worker-terminated');
    if (interrupted) $('validation').textContent = 'タブを離れたためモデルを終了しました。続けるには「モデルを準備する」をもう一度押してください。';
    controls();
  }
  function dispose() {
    if (disposed) return;
    deactivate('パネル破棄');
    disposed = true;
    resumeAfterPagehide = false;
    for (const remove of removeListeners.splice(0)) remove();
    stylesheet.remove();
    controls();
  }
  controls();
  return { activate, deactivate, dispose };
}
