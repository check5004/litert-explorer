const freezeModel = model => Object.freeze({...model, samples:Object.freeze(model.samples), sampleNames:Object.freeze(model.sampleNames)});
export const MODELS = Object.freeze([
  freezeModel({
    id:'qwen3-0.6b-int4', title:'Qwen3 0.6B INT4', languages:'日本語・英語など', downloadLabel:'約345 MB',
    inputHint:'日本語・英語など / 400文字まで', asciiOnly:false, disableThinking:true,
    memory:'Node参考実測：ピーク約2.4〜2.8 GiB。ブラウザの必要量を保証する値ではありません。',
    name:'Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm', bytes:344671744,
    sha256:'03e7da1eb1108b50dffaa9bb52cc7bcbad2eb0c66ca990267f480c1e545d2856',
    revision:'e6687177e00897731e7716267eebd4eba0dde7c2',
    url:'https://huggingface.co/litert-community/Qwen3-0.6B/resolve/e6687177e00897731e7716267eebd4eba0dde7c2/Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm',
    cardUrl:'https://huggingface.co/litert-community/Qwen3-0.6B',
    licenseUrl:'https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE',
    finalOrigin:'https://us.aws.cdn.hf.co',
    finalPath:'/xet-bridge-us/6933120140f459ddcd1e34e1/fefb87b6fd149a4f7ebce4b35e2e4d9d256064fad023161ce08b0573b11d0476',
    samples:[
      '次の文章を丁寧な日本語にしてください。「会議は明日の午後3時です。」',
      '次の架空の連絡を、一文で短くしてください。「明日の会議は午後3時からです。場所は会議室Aです。」',
      '青いロボットが本を整理する様子を、日本語の短い一文で書いてください。'
    ],
    sampleNames:['会議の連絡を整える','架空の連絡を短くする','ロボットを描写する']
  }),
  freezeModel({
    id:'smollm2-360m', title:'SmolLM2 360M', languages:'英語のみ', downloadLabel:'約374 MB',
    inputHint:'英語・ASCIIのみ / 400文字まで', asciiOnly:true, disableThinking:false,
    memory:'Node参考実測：ピーク約2.7 GiB。ブラウザの必要量を保証する値ではありません。',
    name:'SmolLM2_360M_instruct.litertlm', bytes:373719040,
    sha256:'8e2834da211b439751af968ed650febdde5a8cb8d88bc6c1a3059f049caa5c2e',
    revision:'507c99cfe6541ba2bcd84818786f7b025935e5e1',
    url:'https://huggingface.co/litert-community/SmolLM2-360M-Instruct/resolve/507c99cfe6541ba2bcd84818786f7b025935e5e1/SmolLM2_360M_instruct.litertlm',
    cardUrl:'https://huggingface.co/litert-community/SmolLM2-360M-Instruct',
    licenseUrl:'https://www.apache.org/licenses/LICENSE-2.0',
    finalOrigin:'https://us.aws.cdn.hf.co',
    finalPath:'/xet-bridge-us/69fbc09b2ce8ea711bcd8930/7bde5fd2f497197b7955442af8b7d33d1a194b58bc51538ca6e97476e0bb18f8',
    samples:[
      'Rewrite this fictional support note in one polite sentence: The demo export button is broken. Please check it.',
      'Complete this sentence with one word: The sky is',
      'Write one short sentence about a fictional blue robot sorting books.'
    ],
    sampleNames:['架空の問い合わせを整える','短い文を補完する','ロボットを描写する']
  })
]);
export const MODEL = MODELS[0];
export const SAMPLES = MODEL.samples;
export function getModel(id) {
  const model=MODELS.find(item=>item.id===id);
  if(!model)throw new Error('許可されていないモデルです。');
  return model;
}
export function modelForUrl(url) {
  const model=MODELS.find(item=>item.url===url);
  if(!model)throw new Error('許可されていないモデルの取得先です。');
  return model;
}
export const LOADER = 'litertlm_wasm_asyncify_internal.js';
export const WASM = 'litertlm_wasm_asyncify_internal.wasm';
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
export function validateFinalModelUrl(value, model=MODEL) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error('モデルの配布先を確認できません。');
  // Browser follows redirects; final signed query is not retained or logged.
  if (url.href === model.url) return true;
  if (url.origin === model.finalOrigin && url.pathname === model.finalPath) return true;
  throw new Error('モデル配布先が検証済みの経路から変わりました。ローカルファイルをご利用ください。');
}
export function validatePrompt(value, model=MODEL) {
  if (typeof value !== 'string' || !value.trim() || value.length > 400) throw new Error('入力を1〜400文字で指定してください。');
  if (model.asciiOnly && /[^\x09\x0a\x0d\x20-\x7e]/u.test(value)) throw new Error('SmolLM2は英語（ASCII文字）のみです。日本語はQwen3を選んでください。');
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
