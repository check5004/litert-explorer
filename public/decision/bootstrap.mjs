import { installRequestPolicy } from './request-policy.mjs';
/** Blob URL inherits the document CSP. Do not replace this with a normal
 * Worker('decision-worker.mjs') unless equivalent worker response CSP is proven. */
export function makeBootstrapSource(config) {
  const base = new URL(config.baseURL);
  const workerURL = new URL(config.workerModuleURL);
  if (workerURL.origin !== base.origin || workerURL.search || workerURL.hash || workerURL.username || workerURL.password) {
    throw new Error('WORKER_MUST_BE_EXPLICIT_SAME_ORIGIN_URL');
  }
  return `
const config = ${JSON.stringify(config)};
try {
  const policy = (${installRequestPolicy.toString()})(self, config, data => self.postMessage(data));
  Object.defineProperty(self, '__decisionProbePolicy', { value: policy });
  self.postMessage({ type: 'policy-installed', counts: policy.snapshot() });
  await import(${JSON.stringify(workerURL.href)});
} catch (error) {
  self.postMessage({ type: 'fatal', code: 'BOOTSTRAP_FAILED', errorName: error?.name || 'Error' });
}
`;
}
