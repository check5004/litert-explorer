import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { MODEL, assetURLs, SAMPLES } from '../../public/decision/config.mjs';
const root = new URL('../../public/decision/', import.meta.url);
test('document has no inline scripts, only local CSS/JS, strict CSP, fixed sample select', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /connect-src 'self'/); assert.match(html, /worker-src blob:/);
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'|<textarea|<input|on(?:click|load)=/i);
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1); assert.match(scripts[0][1], /src="\.\/main\.mjs"/); assert.equal(scripts[0][2], '');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
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
