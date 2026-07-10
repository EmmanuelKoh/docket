// components/tape/analyzer.js — the one owner of the pitch worker
// (public/pitch-worker.js). Every caller — the live mic pump and the
// post-decode trace backfill — goes through analyze(), which serializes
// requests on an internal promise chain: one window in the worker at a
// time, each reply resolved to its own caller. This replaces the old
// pattern of hijacking and hand-restoring worker.onmessage, which
// duplicated the handler in two places.
//
// dispose() resolves any in-flight call with null so awaiting loops can
// exit — a terminated worker never replies, and a promise that never
// settles would pin its caller's closure (and the recording buffer it
// holds) in memory forever. Callers treat a null frame as "stop".

export function createAnalyzer() {
  let worker = null;
  let chain = Promise.resolve();
  let pendingResolve = null;
  let disposed = false;

  // win: Float32Array (transferred). params: { sr, t, mode, fMin, gen,
  // holdF0 } — the detector knobs that ride along with every window.
  // Resolves with the detector frame, or null after dispose().
  function analyze(win, params) {
    const run = () =>
      new Promise((resolve) => {
        if (disposed) {
          resolve(null);
          return;
        }
        if (!worker) worker = new Worker('/pitch-worker.js');
        pendingResolve = resolve;
        worker.onmessage = (ev) => {
          pendingResolve = null;
          resolve(ev.data);
        };
        worker.postMessage({ buf: win.buffer, ...params }, [win.buffer]);
      });
    const p = chain.then(run);
    chain = p.then(
      () => {},
      () => {},
    );
    return p;
  }

  function dispose() {
    disposed = true;
    if (worker) worker.terminate();
    worker = null;
    if (pendingResolve) {
      pendingResolve(null); // release the awaiting caller
      pendingResolve = null;
    }
  }

  return { analyze, dispose };
}
