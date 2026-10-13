export const MODEL = Object.freeze({
  file: 'embeddinggemma-2-text-270m.litertlm',
  bytes: 164626432,
  sha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb',
  revision: '9be6e8b90982095dc05c2bd162e4b954ee4dbac7',
});
export const SDK_VERSION = '1.1.0';
export const CRITERIA = Object.freeze({
  billing: '料金、請求書、支払い、二重請求、返金に関する問い合わせ。',
  technical: 'ソフトウェアのエラー、機能の不具合、サービスの障害に関する問い合わせ。',
  account: 'ログイン、パスワードの再設定、アカウントへのアクセスに関する問い合わせ。',
  other: '料金、不具合、ログイン以外の一般的な質問や、使い方・仕様についての問い合わせ。',
});
export const SAMPLES = Object.freeze([
  { id: 'ja-billing', label: '架空 A：二重請求', text: '月額プランの請求が二重になっています。同じ月の料金を二回支払ったので、重複分を返金してください。' },
  { id: 'ja-technical', label: '架空 B：エクスポートのエラー', text: 'テスト用プロジェクトでエクスポートボタンを押すとエラーが表示され、ファイルをダウンロードできません。毎回同じ現象です。' },
  { id: 'ja-account', label: '架空 C：パスワードの再設定', text: 'パスワードを忘れてログインできません。アカウントのパスワードを再設定する方法を教えてください。' },
  { id: 'ja-other', label: '架空 D：マニュアルと仕様', text: '製品のマニュアルはどこで読めますか。対応しているファイル形式も教えてください。' },
  { id: 'ja-ambiguous', label: '架空 E：ログインと支払いの混在', text: '料金プランを変更した後、ログインできなくなりました。支払いも正しく完了しているか確認したいです。' },
].map(Object.freeze));
export const TIMING_LABELS = Object.freeze({
  sdkImport: 'SDK import()',
  fileset: 'FilesetResolver.forDecisionTasks()',
  modelFetch: 'fetch() + ReadableStream.read()',
  modelHash: 'crypto.subtle.digest(SHA-256)',
  create: 'DecisionMaker.createFromOptions()',
  promiseWrapper: '公式の 5 メソッド Promise ラッパー',
  evaluateChoice: 'DecisionMaker.evaluateChoice()',
  close: 'DecisionMaker.close() 同期呼び出し',
});
export function assetURLs(baseURL) {
  const base = new URL('./', baseURL);
  const sdk = new URL('./assets/decision_bundle.mjs', base).href;
  const wasmDirectory = new URL('./assets/wasm', base).href;
  return Object.freeze({
    baseURL: base.href,
    workerModuleURL: new URL('./decision-worker.mjs', base).href,
    sdk,
    wasmDirectory,
    wasmLoader: `${wasmDirectory}/decision_wasm_module_internal.js`,
    wasmBinary: `${wasmDirectory}/decision_wasm_module_internal.wasm`,
    model: new URL(`./assets/${MODEL.file}`, base).href,
  });
}
