import test from 'node:test';
import assert from 'node:assert/strict';
import { installRequestPolicy } from '../../public/decision/request-policy.mjs';
import { makeBootstrapSource } from '../../public/decision/bootstrap.mjs';
import { assetURLs } from '../../public/decision/config.mjs';
const urls = assetURLs('https://local.test/nested/probe/index.html');
function fixture() {
  const forwarded = []; const reported = []; const listeners = new Map();
  class XHR { open() { throw new Error('MUST_NOT_CALL_NATIVE_XHR'); } send() { throw new Error('MUST_NOT_SEND_NATIVE_XHR'); } }
  const scope = {
    fetch: async (input, init) => { forwarded.push({ input, init }); return { ok: true }; },
    performance: { now: () => 10 }, XMLHttpRequest: XHR,
    WebSocket: class {}, EventSource: class {}, navigator: { sendBeacon() { throw new Error('NATIVE_BEACON_CALLED'); } },
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const policy = installRequestPolicy(scope, { baseURL: urls.baseURL,
    allowedURLs: [urls.model, urls.wasmBinary, urls.wasmLoader, urls.sdk] }, value => reported.push(value));
  return { scope, policy, reported, forwarded, listeners };
}
test('only exact same-origin static asset GET/HEAD reach native fetch with no redirects/credentials/referrer', async () => {
  const f = fixture();
  await f.scope.fetch(urls.model, { redirect: 'follow', credentials: 'include', referrerPolicy: 'unsafe-url' });
  await f.scope.fetch(new URL(urls.wasmBinary), { method: 'HEAD' });
  await f.scope.fetch(new Request(urls.sdk));
  assert.equal(f.forwarded.length, 3);
  assert.deepEqual(f.policy.snapshot(), { allowed: 3, blocked: 0, csp: 0 });
  for (const { init } of f.forwarded) {
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer');
  }
});
test('Google metrics POST is blocked before transport, with no query/header/body/API key in logs', async () => {
  const f = fixture();
  await assert.rejects(f.scope.fetch('https://odml.pa.googleapis.com/v1/log?key=SECRET_KEY', {
    method: 'POST', body: 'PRIVATE_BODY', headers: { Authorization: 'PRIVATE_AUTH' },
  }), /REQUEST_BLOCKED/);
  assert.equal(f.forwarded.length, 0);
  assert.equal(f.reported[0].origin, 'https://odml.pa.googleapis.com');
  assert.equal(f.reported[0].path, '/v1/log'); assert.equal(f.reported[0].method, 'POST');
  assert.equal(f.reported[0].allowed, false);
  assert.doesNotMatch(JSON.stringify(f.reported), /SECRET_KEY|PRIVATE_BODY|PRIVATE_AUTH|\?key|Authorization/);
});
test('reject unlisted same-origin URLs, query/fragment/credentials, external schemes, POST and bodies', async () => {
  const f = fixture();
  const calls = [
    ['https://local.test/nested/probe/api'], [urls.model + '?secret=SECRET_KEY'],
    [urls.model + '#fragment'], [urls.model.replace('https://', 'https://user:SECRET_PASS@')],
    [urls.model.replace('local.test', 'attacker.test')], ['data:text/plain,SECRET_TEXT'],
    ['blob:https://local.test/opaque'], ['file:///SECRET_PATH'], ['https://['],
    [urls.model, { method: 'POST' }], [urls.model, { body: 'SECRET_BODY' }],
  ];
  for (const args of calls) await assert.rejects(f.scope.fetch(...args), /REQUEST_BLOCKED/);
  assert.equal(f.forwarded.length, 0); assert.equal(f.policy.snapshot().blocked, calls.length);
  assert.doesNotMatch(JSON.stringify(f.reported), /SECRET_KEY|SECRET_PASS|SECRET_TEXT|SECRET_PATH|SECRET_BODY/);
});
test('Request method cannot bypass blocking, and query values are redacted', async () => {
  const f = fixture();
  await assert.rejects(f.scope.fetch(new Request(urls.model, { method: 'POST', body: 'SECRET' })), /REQUEST_BLOCKED/);
  await assert.rejects(f.scope.fetch(new Request('https://odml.pa.googleapis.com/v1/log?key=SECRET', { method: 'POST' })), /REQUEST_BLOCKED/);
  assert.equal(f.forwarded.length, 0); assert.doesNotMatch(JSON.stringify(f.reported), /SECRET/);
});
test('XHR, WebSocket, EventSource and beacon fail closed; no native transport calls', () => {
  const f = fixture();
  const xhr = new f.scope.XMLHttpRequest();
  assert.throws(() => xhr.open('GET', urls.model), /XHR_DISABLED/);
  assert.throws(() => xhr.send('SECRET'), /XHR_DISABLED/);
  assert.throws(() => new f.scope.WebSocket('wss://example.com/private'), /TRANSPORT_DISABLED/);
  assert.throws(() => new f.scope.EventSource('https://example.com/private'), /TRANSPORT_DISABLED/);
  assert.equal(f.scope.navigator.sendBeacon('https://odml.pa.googleapis.com/v1/log?key=SECRET', 'SECRET'), false);
  assert.equal(f.policy.snapshot().blocked, 5); assert.doesNotMatch(JSON.stringify(f.reported), /SECRET/);
});
test('policy bindings are immutable and CSP observer sanitizes blockedURI', () => {
  const f = fixture();
  assert.throws(() => { f.scope.fetch = () => {}; }, TypeError);
  assert.throws(() => { f.scope.XMLHttpRequest.prototype.open = () => {}; }, TypeError);
  f.listeners.get('securitypolicyviolation')({ blockedURI: 'https://odml.pa.googleapis.com/v1/log?key=SECRET', effectiveDirective: 'connect-src' });
  assert.equal(f.policy.snapshot().csp, 1); assert.equal(f.reported.at(-1).path, '/v1/log');
  assert.doesNotMatch(JSON.stringify(f.reported), /SECRET/);
});
test('cross-origin/query/credential allowlists are rejected before installation', () => {
  for (const bad of ['https://external.test/a', urls.model + '?q=1', urls.model.replace('https://', 'https://user@')]) {
    assert.throws(() => installRequestPolicy({}, { baseURL: urls.baseURL, allowedURLs: [bad] }), /INVALID_ASSET_ALLOWLIST/);
  }
});
test('bootstrap places the complete request policy before the explicit worker-module import', () => {
  const source = makeBootstrapSource({ baseURL: urls.baseURL, workerModuleURL: urls.workerModuleURL, allowedURLs: [urls.model] });
  assert.ok(source.indexOf('const policy =') < source.indexOf('await import('));
  assert.match(source, /Object\.defineProperty\(self, '__decisionProbePolicy'/);
  assert.ok(source.includes(`await import(${JSON.stringify(urls.workerModuleURL)})`));
  assert.throws(() => makeBootstrapSource({ baseURL: urls.baseURL, workerModuleURL: 'https://external.test/worker.mjs', allowedURLs: [] }), /SAME_ORIGIN/);
});
