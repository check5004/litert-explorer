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
