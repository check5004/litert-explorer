// This detects a trusted same-origin SW's policy version. It does not authenticate
// script bytes and is not a boundary against compromised same-origin code.
export const SW_POLICY_REQUEST = 'litert-lab:describe-fetch-policy';
export const SW_POLICY_RESPONSE = 'litert-lab:fetch-policy';
export const SW_POLICY_PROTOCOL = 1;
export const SW_POLICY_VERSION = 'litert-lab-core-pass-through-v1';
export const SW_POLICY_CAPABILITIES = Object.freeze({
  decisionNetworkOnly: true,
  generationNetworkOnly: true,
  redirectError: true,
  credentialsOmit: true,
  noReferrer: true,
  crossOriginUnhandled: true,
});

function matchesReply(data) {
  return data?.type === SW_POLICY_RESPONSE &&
    data.protocolVersion === SW_POLICY_PROTOCOL &&
    data.policyVersion === SW_POLICY_VERSION &&
    Object.entries(SW_POLICY_CAPABILITIES).every(([key, value]) => data.capabilities?.[key] === value);
}

/**
 * Importing this module has no effects. All platform objects are injected.
 * Creation subscribes to controllerchange; dispose() releases that subscription.
 * No registration, update, fetch, cache operation, polling, or global message listener.
 */
export function createServiceWorkerGate({
  serviceWorker,
  expectedScriptURL,
  expectedScope,
  MessageChannel,
  setTimeout,
  clearTimeout,
  timeoutMs = 2000,
}) {
  const script = new URL(expectedScriptURL);
  const scope = new URL(expectedScope);
  if (script.href !== expectedScriptURL || scope.href !== expectedScope ||
      script.origin !== scope.origin || script.search || script.hash ||
      scope.search || scope.hash || !scope.pathname.endsWith('/') ||
      !script.href.startsWith(scope.href)) {
    throw new TypeError('Expected absolute canonical same-origin SW script URL and scope.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2000) {
    throw new TypeError('The Service Worker policy deadline must be at most 2000 ms.');
  }
  let revision = 0, accepted = null, pendingCancel = null, disposed = false;
  const currentController = () => serviceWorker?.controller ?? null;
  const matchesRegistration = (controller, registration) =>
    Boolean(registration) && registration.scope === expectedScope &&
    registration.active === controller && controller.state === 'activated' &&
    controller.scriptURL === expectedScriptURL;

  function invalidate() {
    revision++;
    accepted = null;
    pendingCancel?.();
  }
  serviceWorker?.addEventListener('controllerchange', invalidate);

  function isAccepted() {
    if (disposed || !accepted || currentController() !== accepted.controller) return false;
    return accepted.controller === null || matchesRegistration(accepted.controller, accepted.registration);
  }

  // isCurrent checks the caller's captured epoch while validation is pending.
  // The resulting acceptance is tied to SW identity, not to model-load epochs.
  function validate({isCurrent = () => true} = {}) {
    invalidate();
    const attempt = revision;
    const controller = currentController(); // Capture before the first async step.
    const stillCurrent = () => !disposed && attempt === revision &&
      isCurrent() && currentController() === controller;
    if (!stillCurrent()) return Promise.resolve(false);
    if (controller === null) {
      accepted = {controller: null, registration: null};
      return Promise.resolve(true);
    }
    if (controller.scriptURL !== expectedScriptURL || controller.state !== 'activated' ||
        typeof serviceWorker?.getRegistration !== 'function' || typeof MessageChannel !== 'function') {
      return Promise.resolve(false);
    }
    return new Promise(resolve => {
      let done = false, registration = null, channel = null, timer = null;
      const cancel = () => finish(false);
      function finish(valid) {
        if (done) return;
        const allow = Boolean(valid && stillCurrent() && matchesRegistration(controller, registration));
        done = true;
        if (timer !== null) clearTimeout(timer);
        if (channel) {
          channel.port1.onmessage = null;
          channel.port1.onmessageerror = null;
          channel.port1.close();
          channel.port2.close();
        }
        if (pendingCancel === cancel) pendingCancel = null;
        if (allow) accepted = {controller, registration};
        resolve(allow);
      }
      pendingCancel = cancel;
      // One total deadline also bounds getRegistration; no retry or polling.
      timer = setTimeout(() => finish(false), timeoutMs);
      Promise.resolve().then(() => {
        if (done || !stillCurrent()) return null;
        return serviceWorker.getRegistration(expectedScope);
      }).then(value => {
        if (done) return;
        registration = value;
        if (!stillCurrent() || !matchesRegistration(controller, registration)) return finish(false);
        channel = new MessageChannel();
        channel.port1.onmessage = event => finish(matchesReply(event.data));
        channel.port1.onmessageerror = () => finish(false);
        channel.port1.start?.();
        if (!stillCurrent() || !matchesRegistration(controller, registration)) return finish(false);
        controller.postMessage({type: SW_POLICY_REQUEST, protocolVersion: SW_POLICY_PROTOCOL}, [channel.port2]);
      }).catch(() => finish(false));
    });
  }

  function dispose() {
    disposed = true;
    invalidate();
    serviceWorker?.removeEventListener('controllerchange', invalidate);
  }
  return Object.freeze({validate, isAccepted, invalidate, dispose});
}
