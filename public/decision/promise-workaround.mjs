/**
 * Adapted from Copyright 2026 The MediaPipe Authors.
 * Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 * Provided on an AS IS basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
 */
/** The exact five-method Promise adapter in Google's official worker, for
 * pinned @mediapipe/tasks-decision 1.1.0 CPU only. No scoring changes/fallbacks.
 * https://raw.githubusercontent.com/google-ai-edge/mediapipe-samples-web/main/src/workers/decision-maker.worker.ts
 */
export const WRAPPED_METHODS = Object.freeze([
  'evaluateBoolean', 'evaluateChoice', 'evaluateScore', 'evaluateSchema', 'prewarmSchema',
]);
export function applyOfficialPromiseWorkaround(task) {
  const wasmMod = task?.i?.h;
  if (!wasmMod || WRAPPED_METHODS.some(name => typeof wasmMod[name] !== 'function' || wasmMod[name]._promised)) {
    throw new Error('PINNED_1_1_0_PROMISE_WORKAROUND_SHAPE_CHANGED');
  }
  for (const name of WRAPPED_METHODS) {
    const original = wasmMod[name].bind(wasmMod);
    wasmMod[name] = (...args) => Promise.resolve(original(...args));
    wasmMod[name]._promised = true;
  }
  return [...WRAPPED_METHODS];
}
