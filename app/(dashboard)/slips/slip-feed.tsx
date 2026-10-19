'use client';

// The feed module's travelling printer, the slip under the pointer or
// the keyboard focus hanging out of it at real size, clear of everything,
// to tear off.
//
// The parts are Blender renders through the page's shift-lens camera
// (slip-lens.ts says how it works): the deck's sprites (rod, supports,
// way; the cable slot and its brushes) scroll with the page, and the head
// unit (carriage, printer, cable, roller, and the shadow they cast) is
// drawn by one WebGL canvas from a column of renders, warped to its place
// in the window. Frames: x in px from .sl-mech's left edge; the head unit
// in px from .sl-head-unit's box origin, which sits 147.92px above where
// the printer's front meets the desk; the deck in px from .sl-mech's top
// or its bottom.
//
// The deck: the rod (x 0-16) between its two supports, the cable slot
// with its brushes (x 67-93), the flush way (x 334-354). The carriage: the
// left end cap round the rod with the drive roller in a window, the
// extension carrying the motor and the strap that clamps the flat cable,
// the beam along the printer's back and the right end riding the way on a
// white shoe. The printer (x 32-372) hangs from the beam; the slip leaves
// it at row 145.4 under the tear bar.
//
// Each part moves like its mechanism: the carriage on its motor (it
// catches up with the page at a limited speed), the roller turning
// smoothly with the travel, the paper in the stepper's steps. The printer
// can be grabbed and pushed along the rod. .sl-mech is
// snapped to the device pixel grid so the deck's sprites never resample.
//
// Rows carry data-slip; the slip follows real pointer movement (not rows
// scrolling under a still pointer) and keyboard focus. Every slip stays
// mounted, so a swap never waits on an image.

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { PrinterBlock } from '@/components/hardware/kit/screen';
import { Slip } from '@/components/hardware/kit/slip';
import { startLens } from './slip-lens';

type FeedSlip = { slug: string; title: string; thumb: string | null };

// Where the head unit's box origin rests in the module: home, the
// carriage's back face (92px behind the box origin, at desk level) against
// the top support's front face (module y 40); where it holds below the
// viewport's top while the page scrolls, low enough that it starts
// travelling early and the deck behind it stays in view; and the room kept
// clear below its slip.
const REST = 92;
const HOLD = 260;
const FOOT = 40;

// A notched wheel jumps the page 100px a step. The page eases toward
// where the wheel sends it instead (time constant in ms), so the deck
// and the printer glide and settle with a little inertia.
const GLIDE = 140;

// Changing slips is stop-motion, like the printer's stepper: the slip in
// the printer steps back in through the slot, then the next steps out,
// about 12 steps a second (STEP ms), in quarters going in and eighths
// coming out. The pointer has to rest on a row DWELL ms before it counts,
// and the last row it rests on wins, so a sweep across the list never
// queues up feeds.
const STEP = 83;

// The carriage's motor: it drives the carriage along the module toward the
// hold line at up to SPEED px/s, speeding up and slowing down at ACCEL
// px/s^2, so a fast scroll leaves it behind (it rides up the window with
// the page) and it then drives itself back, without overshooting. The page
// moves the carriage with everything else; only the motor moves it along
// the module, so nothing on screen depends on reading the scroll in time.
const SPEED = 420;
const ACCEL = 2600;
const IN = 1 / 4;
const OUT = 1 / 8;
const DWELL = 120;

// A position's offset past the device pixel grid, in CSS px.
function offGrid(y: number, dpr: number) {
  const f = (((y * dpr) % 1) + 1) % 1;
  return f > 0.999 ? 0 : f / dpr;
}

export function SlipFeed({
  slips,
  initial,
}: {
  slips: FeedSlip[];
  initial: string;
}) {
  // target: the row asked for; shown: the slip in the printer, out by p
  // (0 inside, 1 all the way out)
  const [target, setTarget] = useState(initial);
  const [feed, setFeed] = useState({ shown: initial, p: 1 });
  const mech = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const m = mech.current;
    const h = head.current;
    if (!m || !h) return;
    let top = 0;
    let snap = 0;
    let travel = 0;
    const measure = () => {
      const box = m.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // snap the module's top and bottom to the device pixel grid, so the
      // sprites never resample at rest or pinned
      const laid = box.top + window.scrollY + snap;
      snap = offGrid(laid, dpr);
      top = laid - snap;
      m.style.setProperty('--sl-snap', `${snap}px`);
      m.style.setProperty('--sl-mx', `${box.left}px`);
      m.style.setProperty('--sl-bf', `${offGrid(top + box.height, dpr)}px`);
      travel = Math.max(0, m.clientHeight - FOOT - h.offsetHeight - REST);
      const start = top + REST - HOLD;
      // without the motor (reduced motion) the carriage runs on a scroll
      // timeline (CSS), exact, so it never lags the page
      m.style.setProperty('--sl-s0', `${start}px`);
      m.style.setProperty('--sl-s1', `${start + Math.max(travel, 1)}px`);
      m.style.setProperty('--sl-d', `${travel}px`);
    };
    // where the carriage is asked to be: held at HOLD below the viewport's
    // top, within its travel
    const goal = () =>
      Math.min(travel, Math.max(0, window.scrollY + HOLD - top - REST));
    // the carriage's place along the module; the roller turns with it
    // (slip-lens.ts), never ahead or behind
    const set = (y: number) => {
      m.style.setProperty('--sl-y', `${y}px`);
      window.dispatchEvent(new CustomEvent('sl-move', { detail: y }));
    };
    // reduced motion, or no motor: the carriage is exactly at its goal
    // (the scroll timeline holds it where supported)
    const motor = !window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches;
    if (motor) m.classList.add('sl-motor');
    let at = 0;
    let speed = 0;
    let run = 0;
    let prev = 0;
    const drive = (t: number) => {
      const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 1 / 60;
      prev = t;
      const gap = goal() - at;
      const want =
        Math.sign(gap) * Math.min(SPEED, Math.sqrt(2 * ACCEL * Math.abs(gap)));
      speed += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, want - speed));
      at += speed * dt;
      // never past the goal: a step that crosses it lands on it
      const crossed = gap !== 0 && Math.sign(goal() - at) !== Math.sign(gap);
      if (crossed || (Math.abs(goal() - at) < 0.25 && Math.abs(speed) < 5)) {
        at = goal();
        speed = 0;
      }
      set(at);
      if (speed === 0) {
        run = 0;
        prev = 0;
      } else run = requestAnimationFrame(drive);
    };
    // a hand on the carriage: grab the printer and push it along the rod;
    // it stays where it is left until the page scrolls, and then the motor
    // takes it back
    let grab: { y: number; at: number; id: number } | null = null;
    const place = () => {
      if (grab) return;
      if (!motor) set(goal());
      else if (!run) run = requestAnimationFrame(drive);
    };
    const down = (e: PointerEvent) => {
      if (!motor || e.button !== 0) return;
      e.preventDefault();
      cancelAnimationFrame(run);
      run = 0;
      prev = 0;
      speed = 0;
      grab = { y: e.clientY, at, id: e.pointerId };
      h.setPointerCapture(e.pointerId);
      m.classList.add('sl-held');
    };
    const push = (e: PointerEvent) => {
      if (grab?.id !== e.pointerId) return;
      at = Math.min(travel, Math.max(0, grab.at + e.clientY - grab.y));
      set(at);
    };
    const release = (e: PointerEvent) => {
      if (grab?.id !== e.pointerId) return;
      grab = null;
      m.classList.remove('sl-held');
    };
    const still = (e: Event) => e.preventDefault();
    measure();
    at = goal();
    set(at);
    const seen = new ResizeObserver(() => {
      measure();
      at = Math.min(travel, at);
      place();
    });
    seen.observe(m);
    seen.observe(h);
    // the module moves sideways with the window's width, not its own size
    const resize = () => {
      measure();
      place();
    };
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', resize);
    h.addEventListener('pointerdown', down);
    h.addEventListener('pointermove', push);
    h.addEventListener('pointerup', release);
    h.addEventListener('pointercancel', release);
    h.addEventListener('dragstart', still);
    return () => {
      cancelAnimationFrame(run);
      seen.disconnect();
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', resize);
      h.removeEventListener('pointerdown', down);
      h.removeEventListener('pointermove', push);
      h.removeEventListener('pointerup', release);
      h.removeEventListener('pointercancel', release);
      h.removeEventListener('dragstart', still);
      m.classList.remove('sl-motor');
    };
  }, []);

  // the head unit drawn from its renders, warped to its place in the
  // window, its roller turning with the travel (slip-lens.ts); reduced
  // motion keeps the static render
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const h = head.current;
    const cv = lens.current;
    if (!h || !cv) return;
    // the module shows only in wide windows (slips.css): load nothing
    // until it does
    const wide = window.matchMedia('(min-width: 1180px)');
    let stop: (() => void) | null = null;
    const sync = () => {
      if (wide.matches && !stop) stop = startLens(h, cv);
      else if (!wide.matches && stop) {
        stop();
        stop = null;
      }
    };
    sync();
    wide.addEventListener('change', sync);
    return () => {
      wide.removeEventListener('change', sync);
      stop?.();
    };
  }, []);

  // the wheel glide: every wheel step moves a target and the page eases
  // toward it (never half native, half eased: two animations on one page
  // fight and everything jumps). When anything else moves the page
  // mid-glide (keys, the scrollbar, the browser keeping content in place
  // after a theme switch) the glide moves with it instead of pulling it
  // back. Scrollers inside the page are left alone, and so is everyone who
  // asks for reduced motion.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let target = 0;
    let at = 0;
    let set = 0;
    let frame = 0;
    let last = 0;
    const room = () =>
      document.documentElement.scrollHeight - window.innerHeight;
    const step = (t: number) => {
      const moved = window.scrollY - set;
      if (Math.abs(moved) > 1) {
        at += moved;
        target += moved;
      }
      target = Math.max(0, Math.min(room(), target));
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      at += (target - at) * (1 - Math.exp(-dt / GLIDE));
      if (Math.abs(target - at) < 0.5) at = target;
      window.scrollTo(0, at);
      set = window.scrollY;
      if (at === target) {
        frame = 0;
        last = 0;
      } else frame = requestAnimationFrame(step);
    };
    const inner = (n: Element | null) => {
      for (; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowY;
        if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight)
          return true;
      }
      return false;
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || e.deltaY === 0) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (inner(e.target as Element)) return;
      e.preventDefault();
      const unit =
        e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1;
      if (!frame) at = target = set = window.scrollY;
      target = Math.max(0, Math.min(room(), target + e.deltaY * unit));
      if (!frame) frame = requestAnimationFrame(step);
    };
    window.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', wheel);
    };
  }, []);

  // one step of the feed every STEP ms until the asked-for slip is out
  useEffect(() => {
    if (feed.shown === target && feed.p >= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFeed({ shown: target, p: 1 });
      return;
    }
    const t = window.setTimeout(() => {
      setFeed((f) => {
        if (f.shown !== target) {
          const p = f.p - IN;
          return p <= 0 ? { shown: target, p: 0 } : { shown: f.shown, p };
        }
        return { shown: f.shown, p: Math.min(1, f.p + OUT) };
      });
    }, STEP);
    return () => window.clearTimeout(t);
  }, [feed, target]);

  useEffect(() => {
    let x = -1;
    let y = -1;
    let dwell = 0;
    const pick = (target: EventTarget | null) => {
      const row = (target as Element | null)?.closest?.('[data-slip]');
      const next = row?.getAttribute('data-slip');
      if (!next) return;
      window.clearTimeout(dwell);
      dwell = window.setTimeout(() => setTarget(next), DWELL);
    };
    const move = (e: PointerEvent) => {
      if (e.clientX === x && e.clientY === y) return;
      x = e.clientX;
      y = e.clientY;
      pick(e.target);
    };
    const focus = (e: FocusEvent) => pick(e.target);
    document.addEventListener('pointermove', move);
    document.addEventListener('focusin', focus);
    return () => {
      window.clearTimeout(dwell);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('focusin', focus);
    };
  }, []);

  return (
    <div ref={mech} className="sl-mech" aria-hidden="true">
      <span className="sl-rod" />
      <span className="sl-support t" />
      <span className="sl-support b" />
      <span className="sl-slot" />
      <span className="sl-way" />
      <div ref={head} className="sl-head-unit">
        <PrinterBlock>
          {slips.map((s) =>
            s.thumb ? (
              <Slip
                key={s.slug}
                tear="new"
                src={s.thumb}
                alt=""
                loading="eager"
                className={s.slug === feed.shown ? 'sl-feed' : 'sl-off'}
                style={
                  s.slug === feed.shown
                    ? ({ '--p': feed.p } as CSSProperties)
                    : undefined
                }
              />
            ) : null,
          )}
        </PrinterBlock>
        <span className="sl-cast" />
        <canvas ref={lens} className="sl-lens" />
      </div>
    </div>
  );
}
