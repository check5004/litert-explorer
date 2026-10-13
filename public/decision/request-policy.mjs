/**
 * Self-contained so its source can be placed in a Blob MODULE worker bootstrap.
 * Install BEFORE importing SDK-bearing modules. This is transport containment,
 * not an SDK telemetry opt-out, and not a defense against malicious same-origin JS.
 */
export function installRequestPolicy(scope, config, report = () => {}) {
  const base = new URL(config.baseURL);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('HTTP_OR_HTTPS_REQUIRED');
  const allowed = new Set(config.allowedURLs.map(raw => {
    const u = new URL(raw, base);
    if (u.origin !== base.origin || u.username || u.password || u.search || u.hash) {
      throw new Error('INVALID_ASSET_ALLOWLIST');
    }
    return u.href;
  }));
  const knownPaths = new Set([...allowed].map(raw => new URL(raw).pathname));
  const counters = { allowed: 0, blocked: 0, csp: 0 };
  const started = scope.performance.now();
  const nativeFetch = scope.fetch.bind(scope);
  const define = (target, key, value) => Object.defineProperty(target, key, {
    value, writable: false, configurable: false,
  });
  function safeURL(raw) {
    try {
      const u = new URL(raw, base);
      const isMetrics = u.origin === 'https://odml.pa.googleapis.com' && u.pathname === '/v1/log';
      return {
        origin: ['https:', 'http:'].includes(u.protocol) ? u.origin : u.protocol,
        path: knownPaths.has(u.pathname) || isMetrics ? u.pathname : '[unlisted-path]',
      };
    } catch { return { origin: '[invalid-url]', path: '[redacted]' }; }
  }
  function emit(transport, permitted, raw, method) {
    counters[permitted ? 'allowed' : 'blocked'] += 1;
    const normalizedMethod = String(method || 'GET').toUpperCase();
    report({
      type: 'request-policy', transport, allowed: permitted,
      ...safeURL(raw),
      method: /^[A-Z]{1,16}$/.test(normalizedMethod) ? normalizedMethod : '[redacted]',
      elapsedMs: scope.performance.now() - started,
      counts: { ...counters },
    });
  }
  define(scope, 'fetch', async function(input, init = {}) {
    let raw = '[invalid-url]';
    let method = 'GET';
    let permitted = false;
    try {
      raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
      const url = new URL(raw, base);
      permitted = url.origin === base.origin && !url.username && !url.password &&
        !url.search && !url.hash && allowed.has(url.href) && ['GET', 'HEAD'].includes(method) &&
        init?.body == null;
    } catch { permitted = false; }
    emit('fetch', permitted, raw, method);
    if (!permitted) throw new TypeError('REQUEST_BLOCKED_BY_LOCAL_ASSET_POLICY');
    // No redirects, credentials, or referrer. Requests are local static asset reads only.
    return nativeFetch(input, { ...init, method, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  if (typeof scope.XMLHttpRequest === 'function') {
    // The pinned SDK uses fetch for required assets. XHR has no redirect:error
    // control; fail closed even for a same-origin XHR instead of accepting a gap.
    const proto = scope.XMLHttpRequest.prototype;
    define(proto, 'open', function(method, url) {
      emit('xhr', false, url, method);
      throw new TypeError('XHR_DISABLED_BY_LOCAL_ASSET_POLICY');
    });
    define(proto, 'send', function() {
      emit('xhr', false, '[not-opened]', 'UNKNOWN');
      throw new TypeError('XHR_DISABLED_BY_LOCAL_ASSET_POLICY');
    });
  }
  // No other transport is needed by this CPU-only, single-worker probe.
  for (const name of ['WebSocket', 'EventSource']) {
    if (typeof scope[name] === 'function') define(scope, name, function(url) {
      emit(name, false, url, 'CONNECT');
      throw new TypeError('TRANSPORT_DISABLED_BY_LOCAL_ASSET_POLICY');
    });
  }
  if (typeof scope.navigator?.sendBeacon === 'function') {
    define(scope.navigator, 'sendBeacon', function(url) {
      emit('beacon', false, url, 'POST');
      return false;
    });
  }
  scope.addEventListener('securitypolicyviolation', event => {
    counters.csp += 1;
    report({ type: 'csp-violation', ...safeURL(event.blockedURI),
      directive: String(event.effectiveDirective || ''),
      elapsedMs: scope.performance.now() - started, counts: { ...counters } });
  });
  return Object.freeze({ snapshot: () => ({ ...counters }) });
}
