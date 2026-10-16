import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { MODEL, assetURLs, SAMPLES } from '../../public/decision/config.mjs';
const root = new URL('../../public/decision/', import.meta.url);
test('component content has fixed samples, no scripts or duplicate page chrome, and accurate download/CSP notice', async () => {
  const html = await readFile(new URL('panel.html', root), 'utf8');
  assert.doesNotMatch(html, /<script|<style|<textarea|<input|on(?:click|load)=|<header|<footer|<h1|<iframe|<nav/i);
  assert.match(html, /<select id="sample"/);
  assert.match(html, /183 MB/);
  assert.match(html, /164,626,432 bytes/);
  assert.match(html, /自己オリジン限定の CSP ではありません/);
  assert.match(html, /完全一致の許可リスト/);
  assert.match(html, /probabilities は.*相対的/);
  assert.match(html, /SDK confidence は最大 probability とは別/);
});
test('component exports its scoped lifecycle and stylesheet, never an automatic initialization', async () => {
  const main = await readFile(new URL('main.mjs', root), 'utf8');
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.match(main, /export function mountDecision/);
  assert.match(main, /root\.querySelector/);
  assert.doesNotMatch(main, /document\.getElementById|document\.querySelector/);
  assert.match(main, /return \{ activate, deactivate, dispose \}/);
  assert.match(css, /:host/); assert.doesNotMatch(css, /:root|(?:^|\})body\{/);
});
test('all asset URLs survive a nested route and remain on its exact origin', () => {
  const assets = assetURLs('https://local.test/nested/probe/main.mjs');
  for (const value of Object.values(assets)) assert.ok(value.startsWith('https://local.test/nested/probe/'));
  assert.equal(SAMPLES.length, 5); assert.ok(SAMPLES.every(sample => sample.id && sample.text.trim()));
});
test('browser implementation uses CPU/public APIs and exact wrapper, with no host shim or sample-answer fallbacks', async () => {
  const worker = await readFile(new URL('decision-worker.mjs', root), 'utf8');
  const main = await readFile(new URL('main.mjs', root), 'utf8');
  assert.match(worker, /FilesetResolver\.forDecisionTasks\(assets\.wasmDirectory, true\)/);
  assert.match(worker, /delegate: 'CPU'/); assert.match(worker, /modelAssetSize: MODEL\.bytes/);
  assert.match(worker, /crypto\.subtle\.digest\('SHA-256', modelBuffer\)/);
  assert.doesNotMatch(worker, /node:|globalThis\.self|importScripts\s*=|Math\.random|setTimeout/);
  assert.match(main, /new Worker\(workerBlobURL, \{ type: 'module'/);
  assert.match(main, /sampleId: sample\.id/);
  assert.doesNotMatch(main, /postMessage\([^\n]*text:/);
});
test('copied assets exactly match verified provenance, including full model hash', async () => {
  const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', root), 'utf8'));
  assert.equal(manifest.files.length, 4); assert.equal(manifest.package.version, '1.1.0');
  assert.equal(manifest.model.sha256, MODEL.sha256); assert.equal(manifest.model.bytes, 164626432);
  for (const file of manifest.files) {
    const location = new URL(file.path, root); assert.equal((await stat(location)).size, file.bytes);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(location)) hash.update(chunk);
    assert.equal(hash.digest('hex'), file.sha256, file.path);
  }
});

test('practical demo puts static flow, example, category and measured speed ahead of collapsed diagnostics', async () => {
  const html = await readFile(new URL('panel.html', root), 'utf8');
  const main = await readFile(new URL('main.mjs', root), 'utf8');
  const css = await readFile(new URL('style.css', root), 'utf8');
  assert.match(html, /処理のしくみ（説明図）/);
  assert.match(html, /内部の進捗を表すものではありません/);
  assert.match(html, /モデル約 165 MB/);
  assert.match(html, /合計 約 183 MB/);
  const primary = html.slice(0, html.indexOf('<details>'));
  assert.match(primary, /MediaPipe → LiteRT-LM → LiteRT · CPU/);
  assert.match(primary, /演算量：未推定 \/ 内部の層ごとの時間：取得不可（公開 SDK）/);
  for (const id of ['sample', 'input', 'init', 'run', 'cancel', 'status', 'result-label', 'result-meaning', 'inference-time', 'download-time', 'setup-time']) {
    assert.ok(primary.includes(`id="${id}"`), `primary element ${id}`);
  }
  for (const id of ['winner', 'confidence', 'distribution', 'timings', 'network', 'evidence', 'error-detail']) {
    assert.equal(primary.includes(`id="${id}"`), false, `diagnostic element ${id} must be collapsed`);
  }
  assert.doesNotMatch(html, /<details\s+open/);
  assert.equal((html.match(/<details>/g) || []).length, 3);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of main.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.includes(id), `runtime id ${id} exists in panel`);
  }
  assert.match(css, /@media\(max-width:450px\)/);
  assert.match(css, /minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /animation:|min-width: ?[4-9]\d\dpx/);
});
