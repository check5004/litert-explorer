import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {
  createServiceWorkerGate, SW_POLICY_REQUEST, SW_POLICY_RESPONSE,
  SW_POLICY_PROTOCOL, SW_POLICY_VERSION, SW_POLICY_CAPABILITIES,
} from '../../src/generation/service-worker-policy.mjs';

const scope = 'https://example.test/lab/';
const script = scope + 'sw.js';
const reply = () => ({type: SW_POLICY_RESPONSE, protocolVersion: SW_POLICY_PROTOCOL,
  policyVersion: SW_POLICY_VERSION, capabilities: {...SW_POLICY_CAPABILITIES}});
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function setup({controlled = true, serviceWorkerAvailable = true, answer = reply()} = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), channels = [], registrations = [], listeners = new Map();
  class Port {
    closed = false; onmessage = null; onmessageerror = null;
    postMessage(data) {
      const peer = this.peer;
      queueMicrotask(() => { if (!peer.closed) peer.onmessage?.({data}); });
    }
    close() { this.closed = true; }
    start() { this.started = true; }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new Port(); this.port2 = new Port();
      this.port1.peer = this.port2; this.port2.peer = this.port1;
      channels.push(this);
    }
  }
  const controller = {
    scriptURL: script, state: 'activated', messages: [],
    postMessage(data, transfer) {
      this.messages.push({data, transfer});
      if (answer !== null) transfer[0].postMessage(answer);
    },
  };
  const registration = {scope, active: controller};
  const sw = {
    controller: controlled ? controller : null,
    getRegistration(url) { registrations.push(url); return Promise.resolve(registration); },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    change(next) { this.controller = next; for (const fn of [...listeners.get('controllerchange') ?? []]) fn(); },
  };
  const options = {
    serviceWorker: serviceWorkerAvailable ? sw : undefined,
    expectedScriptURL: script, expectedScope: scope, MessageChannel,
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, {at: now + ms, fn}); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const gate = createServiceWorkerGate(options);
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  return {gate, controller, registration, sw, channels, timers, registrations, listeners, options, advance};
}
function assertClosed(env) {
  assert.equal(env.timers.size, 0);
  for (const channel of env.channels) {
    assert.equal(channel.port1.closed, true); assert.equal(channel.port2.closed, true);
    assert.equal(channel.port1.onmessage, null); assert.equal(channel.port1.onmessageerror, null);
  }
}

test('no Service Worker API is accepted without any registration/handshake', async () => {
  const env = setup({serviceWorkerAvailable: false});
  assert.equal(env.gate.isAccepted(), false);
  assert.equal(await env.gate.validate(), true);
  assert.equal(env.gate.isAccepted(), true);
  assert.equal(env.channels.length, 0); assert.equal(env.registrations.length, 0);
});
test('uncontrolled page is accepted; acquisition immediately invalidates it', async () => {
  const env = setup({controlled: false});
  assert.equal(await env.gate.validate(), true);
  assert.equal(env.gate.isAccepted(), true);
  env.sw.change(env.controller);
  assert.equal(env.gate.isAccepted(), false);
  assertClosed(env);
});
test('correct activated root SW and version/capabilities are accepted', async () => {
  const env = setup();
  const result = env.gate.validate();
  assert.equal(env.gate.isAccepted(), false);
  assert.equal(await result, true);
  assert.equal(env.gate.isAccepted(), true);
  assert.deepEqual(env.registrations, [scope]);
  assert.equal(env.controller.messages.length, 1);
  assert.deepEqual(env.controller.messages[0].data, {type: SW_POLICY_REQUEST, protocolVersion: SW_POLICY_PROTOCOL});
  assert.equal(env.controller.messages[0].transfer[0], env.channels[0].port2);
  assertClosed(env);
});
test('old same-URL SW with no reply fails at the 2-second deadline, with no polling', async () => {
  const env = setup({answer: null});
  let settled = false;
  const result = env.gate.validate().then(value => { settled = true; return value; });
  await flush(); env.advance(1999); await flush();
  assert.equal(settled, false); assert.equal(env.gate.isAccepted(), false);
  env.advance(1);
  assert.equal(await result, false); assert.equal(env.gate.isAccepted(), false);
  assert.equal(env.registrations.length, 1); assert.equal(env.controller.messages.length, 1);
  assertClosed(env);
});
for (const wrong of ['https://other.test/lab/sw.js', scope + 'unknown.js', script + '?old=1']) {
  test('wrong script fails before handshake: ' + wrong, async () => {
    const env = setup(); env.controller.scriptURL = wrong;
    assert.equal(await env.gate.validate(), false); assert.equal(env.gate.isAccepted(), false);
    assert.equal(env.registrations.length, 0); assert.equal(env.channels.length, 0);
  });
}
for (const wrong of ['https://example.test/', scope + 'generation/']) {
  test('wrong registration scope fails: ' + wrong, async () => {
    const env = setup(); env.registration.scope = wrong;
    assert.equal(await env.gate.validate(), false); assert.equal(env.channels.length, 0); assertClosed(env);
  });
}
for (const state of ['installing', 'installed', 'activating', 'redundant']) {
  test('controller must be activated: ' + state, async () => {
    const env = setup(); env.controller.state = state;
    assert.equal(await env.gate.validate(), false); assert.equal(env.channels.length, 0);
  });
}
test('same-URL registration.active must be the identical controller object', async () => {
  const env = setup(); env.registration.active = {...env.controller};
  assert.equal(await env.gate.validate(), false); assert.equal(env.channels.length, 0); assertClosed(env);
});
test('missing registration fails closed', async () => {
  const env = setup(); env.sw.getRegistration = async () => undefined;
  assert.equal(await env.gate.validate(), false); assertClosed(env);
});
test('getRegistration is bounded too; late completion cannot send a handshake', async () => {
  const env = setup(), pending = deferred(); env.sw.getRegistration = () => pending.promise;
  const result = env.gate.validate(); await flush(); env.advance(2000);
  assert.equal(await result, false);
  pending.resolve(env.registration); await flush();
  assert.equal(env.channels.length, 0); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
});
test('controllerchange during getRegistration immediately cancels, even if identity later returns', async () => {
  const env = setup(), pending = deferred(); env.sw.getRegistration = () => pending.promise;
  const result = env.gate.validate(); await flush();
  env.sw.change({...env.controller}); env.sw.change(env.controller);
  assert.equal(await result, false);
  pending.resolve(env.registration); await flush();
  assert.equal(env.channels.length, 0); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
});
test('controllerchange during handshake cancels and a late valid reply cannot enable', async () => {
  const env = setup({answer: null}); const result = env.gate.validate(); await flush();
  const lateHandler = env.channels[0].port1.onmessage;
  env.sw.change({...env.controller});
  assert.equal(await result, false);
  lateHandler({data: reply()});
  assert.equal(env.gate.isAccepted(), false); assertClosed(env);
});
for (const phase of ['registration', 'handshake']) {
  test('controller identity recheck rejects changes before event delivery during ' + phase, async () => {
    const env = setup({answer: null}), pending = deferred();
    if (phase === 'registration') env.sw.getRegistration = () => pending.promise;
    const result = env.gate.validate(); await flush(); env.sw.controller = {...env.controller};
    if (phase === 'registration') pending.resolve(env.registration);
    else env.channels[0].port2.postMessage(reply());
    assert.equal(await result, false); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
  });
  test('stale caller epoch cannot enable during ' + phase, async () => {
    const env = setup({answer: null}), pending = deferred(); let epoch = 1;
    if (phase === 'registration') env.sw.getRegistration = () => pending.promise;
    const captured = epoch, result = env.gate.validate({isCurrent: () => epoch === captured});
    await flush(); epoch++;
    if (phase === 'registration') pending.resolve(env.registration);
    else env.channels[0].port2.postMessage(reply());
    assert.equal(await result, false); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
  });
}
test('already stale epoch is rejected even without a controller', async () => {
  const env = setup({controlled: false});
  assert.equal(await env.gate.validate({isCurrent: () => false}), false);
  assert.equal(env.gate.isAccepted(), false);
});
for (const mutation of [
  data => { data.type = 'other'; },
  data => { data.protocolVersion = 2; },
  data => { data.policyVersion = 'older-policy'; },
  data => { delete data.capabilities.generationNetworkOnly; },
  data => { data.capabilities.credentialsOmit = false; },
  data => { data.capabilities.redirectError = 'true'; },
]) {
  test('malformed/mismatched reply fails closed: ' + String(mutation), async () => {
    const data = reply(); mutation(data); const env = setup({answer: data});
    assert.equal(await env.gate.validate(), false); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
  });
}
test('a message decoding error fails closed', async () => {
  const env = setup({answer: null}), result = env.gate.validate(); await flush();
  env.channels[0].port1.onmessageerror({});
  assert.equal(await result, false); assertClosed(env);
});
for (const stage of ['registration', 'postMessage']) {
  test(stage + ' rejection is contained and fails closed', async () => {
    const env = setup();
    if (stage === 'registration') env.sw.getRegistration = async () => { throw Error('denied'); };
    else env.controller.postMessage = () => { throw Error('cannot post'); };
    assert.equal(await env.gate.validate(), false); assert.equal(env.gate.isAccepted(), false); assertClosed(env);
  });
}
test('superseded validations cannot late-enable or erase the new acceptance', async () => {
  const env = setup({answer: null}); const first = env.gate.validate(); await flush();
  const late = env.channels[0].port1.onmessage;
  const second = env.gate.validate(); await flush();
  assert.equal(await first, false); env.channels[1].port2.postMessage(reply());
  assert.equal(await second, true); late({data: reply()});
  assert.equal(env.gate.isAccepted(), true); assertClosed(env);
});
for (const mutation of [
  env => { env.sw.controller = {...env.controller}; },
  env => { env.sw.controller = null; },
  env => { env.registration.active = {...env.controller}; },
  env => { env.controller.state = 'redundant'; },
  env => { env.controller.scriptURL = scope + 'other.js'; },
  env => { env.registration.scope = 'https://example.test/'; },
]) {
  test('synchronous boundary recheck catches ' + String(mutation), async () => {
    const env = setup(); assert.equal(await env.gate.validate(), true);
    mutation(env); assert.equal(env.gate.isAccepted(), false);
  });
}
test('invalidate cancels a pending reply; dispose removes listener and prevents reuse', async () => {
  const env = setup({answer: null}), result = env.gate.validate(); await flush();
  env.gate.invalidate(); assert.equal(await result, false); assertClosed(env);
  env.gate.dispose(); assert.equal(env.listeners.get('controllerchange').size, 0);
  env.sw.controller = null;
  assert.equal(await env.gate.validate(), false); assert.equal(env.gate.isAccepted(), false);
});
test('the root SW listener responds only through the requested port with the matching contract', async () => {
  const source = (await fs.readFile(new URL('../../public/sw.js', import.meta.url), 'utf8')).split('// Extension fetch-policy capability reply\n')[1];
  let listener, closed = false, response;
  vm.runInNewContext(source, {self: {addEventListener(type, fn) { assert.equal(type, 'message'); listener = fn; }}});
  const port = {postMessage(data) { response = data; }, close() { closed = true; }};
  listener({data: {type: 'cache-all'}, ports: [port]}); assert.equal(response, undefined);
  listener({data: {type: SW_POLICY_REQUEST, protocolVersion: 2}, ports: [port]}); assert.equal(response, undefined);
  listener({data: {type: SW_POLICY_REQUEST, protocolVersion: 1}, ports: []}); assert.equal(response, undefined);
  listener({data: {type: SW_POLICY_REQUEST, protocolVersion: 1}, ports: [port]});
  assert.deepEqual(JSON.parse(JSON.stringify(response)), reply()); assert.equal(closed, true);
});
