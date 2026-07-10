// components/tape/playback.js — the take player. AudioBufferSource
// can't pause, so pause/seek kill the source and remember the offset;
// resume starts a fresh source there. The decoded AudioBuffer is built
// once per take and cached (invalidate() drops it) — the old engine
// re-copied the whole recording on every press of Play.
//
// onChange(state) fires on every transition, including the natural end
// of the clip — the controller mirrors it into the store and applies
// any re-render that was deferred while audio ran.

export function createPlayer({ getSamples, getRate, onChange }) {
  let ctx = null;
  let source = null;
  let cached = null; // AudioBuffer for the current take
  let state = 'stopped'; // stopped | playing | paused
  let offset = 0; // seconds into the clip
  let startedAt = 0; // ctx.currentTime when playback began
  let rate = 1; // varispeed: slower playback also lowers pitch
  let gen = 0; // invalidates onended of killed sources

  const dur = () => {
    const n = getSamples().length;
    return n ? n / getRate() : 0;
  };

  const pos = () =>
    state === 'playing'
      ? Math.min(offset + (ctx.currentTime - startedAt) * rate, dur())
      : offset;

  function kill() {
    if (!source) return;
    gen++;
    try {
      source.stop();
    } catch {
      /* already ended */
    }
    source.disconnect();
    source = null;
  }

  function play() {
    const samples = getSamples();
    if (!samples.length) return;
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    kill();
    if (offset >= dur()) offset = 0;
    if (!cached) {
      cached = ctx.createBuffer(1, samples.length, Math.round(getRate()));
      cached.getChannelData(0).set(samples);
    }
    source = ctx.createBufferSource();
    source.buffer = cached;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);
    const g = ++gen;
    source.onended = () => {
      if (g !== gen || state !== 'playing') return;
      state = 'stopped';
      offset = 0;
      onChange?.('stopped');
    };
    startedAt = ctx.currentTime;
    source.start(0, offset);
    state = 'playing';
    onChange?.('playing');
  }

  function pause() {
    if (state !== 'playing') return;
    offset = pos();
    kill();
    state = 'paused';
    onChange?.('paused');
  }

  function stop(keepOffset) {
    kill();
    state = 'stopped';
    if (!keepOffset) offset = 0;
    onChange?.('stopped');
  }

  function seek(sec) {
    const wasPlaying = state === 'playing';
    offset = Math.max(0, Math.min(dur(), sec));
    if (wasPlaying) {
      // restart the source at the new offset
      play();
    } else {
      onChange?.(state); // position moved; let the UI resync
    }
  }

  function setRate(r) {
    if (state === 'playing') {
      // rebase the position math so the rate change takes effect cleanly
      offset = pos();
      startedAt = ctx.currentTime;
      source.playbackRate.value = r;
    }
    rate = r;
  }

  // a new take (or re-rendered tape) invalidates the cached buffer and
  // the playhead mapping
  function invalidate() {
    kill();
    cached = null;
    state = 'stopped';
    offset = 0;
    onChange?.('stopped');
  }

  function dispose() {
    kill();
    if (ctx) {
      ctx.close();
      ctx = null;
    }
    cached = null;
  }

  return {
    play,
    pause,
    stop,
    seek,
    setRate,
    invalidate,
    dispose,
    pos,
    dur,
    get state() {
      return state;
    },
  };
}
