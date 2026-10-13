export const MODEL = Object.freeze({
  name: 'SmolLM2_360M_instruct.litertlm',
  bytes: 373719040,
  sha256: '8e2834da211b439751af968ed650febdde5a8cb8d88bc6c1a3059f049caa5c2e',
  revision: '507c99cfe6541ba2bcd84818786f7b025935e5e1',
  url: 'https://huggingface.co/litert-community/SmolLM2-360M-Instruct/resolve/507c99cfe6541ba2bcd84818786f7b025935e5e1/SmolLM2_360M_instruct.litertlm',
  finalOrigin: 'https://us.aws.cdn.hf.co',
  finalPath: '/xet-bridge-us/69fbc09b2ce8ea711bcd8930/7bde5fd2f497197b7955442af8b7d33d1a194b58bc51538ca6e97476e0bb18f8',
});
export const LOADER = 'litertlm_wasm_asyncify_internal.js';
export const WASM = 'litertlm_wasm_asyncify_internal.wasm';
export const SAMPLES = [
  'Rewrite this fictional support note in one polite sentence: The demo export button is broken. Please check it.',
  'Complete this sentence with one word: The sky is',
  'Write one short sentence about a fictional blue robot sorting books.'
];
export function exactGet(input, init, base, allowed) {
  const request = typeof input === 'object' && input !== null && 'url' in input ? input : null;
  const url = new URL(request ? request.url : String(input), base);
  const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || init?.body != null || request?.body != null || url.username || url.password || !allowed.includes(url.href)) {
    throw new Error('許可されていない通信をブロックしました。');
  }
  if (init?.headers && [...new Headers(init.headers)].length) throw new Error('追加ヘッダーは許可されていません。');
  if (request?.headers && [...request.headers].length) throw new Error('追加ヘッダーは許可されていません。');
  return url.href;
}
export function validateFinalModelUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error('モデルの配布先を確認できません。');
  // Browser follows redirects; final signed query is not retained or logged.
  if (url.href === MODEL.url) return true;
  if (url.origin === MODEL.finalOrigin && url.pathname === MODEL.finalPath) return true;
  throw new Error('モデル配布先が検証済みの経路から変わりました。ローカルファイルをご利用ください。');
}
export function validatePrompt(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 400) throw new Error('英語の入力を1〜400文字で指定してください。');
  if (/[^\x09\x0a\x0d\x20-\x7e]/u.test(value)) throw new Error('この実験は英語（ASCII文字）のみです。日本語は利用できません。');
  return value.trim();
}
export function textFromChunk(chunk) {
  return Array.isArray(chunk?.content) ? chunk.content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('') : '';
}
export function finiteMetrics(value) {
  const result = {};
  for (const key of ['lastPrefillTokensPerSecond','lastPrefillTokenCount','lastDecodeTokensPerSecond','lastDecodeTokenCount','timeToFirstTokenInSecond']) {
    result[key] = Number.isFinite(value?.[key]) && value[key] >= 0 ? value[key] : null;
  }
  return result;
}
export function fixedProperty(target, name, value) {
  Object.defineProperty(target, name, {value, writable:false, configurable:false});
}
export function blockOtherChannels(scope, report = () => {}) {
  for (const name of ['XMLHttpRequest','WebSocket','WebTransport','EventSource','RTCPeerConnection','SharedWorker']) {
    fixedProperty(scope, name, class { constructor() { report(name); throw new Error(name + ' is disabled in this lab'); } });
  }
  if (scope.navigator) fixedProperty(scope.navigator, 'sendBeacon', () => {report('sendBeacon');return false;});
}
export function supportsRelaxedSimd() {
  return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]));
}

export {createServiceWorkerGate} from './service-worker-policy.mjs';
