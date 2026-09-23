/* ============================================================
   shared/chalk.js — the material engine for Chalk Days
   ------------------------------------------------------------
   Two jobs, both about making a hand-drawn "X" feel like chalk
   on a slate board:

   1. ChalkSound — procedural Web Audio. No sample files, so the
      app stays fully offline and the sound never loops audibly.
      Chalk is broadband noise with a stick-slip squeak riding on
      top when the hand moves fast.

   2. Chalk — bristle renderer. A stroke is stamped as thousands
      of tiny specks rather than drawn as a smooth line, because
      chalk deposits unevenly and goes dry. Every stroke carries a
      seed, so a saved stroke replays pixel-identical at ANY size
      (12px year cell, 320px mark pad, or the pingu web module).

   Stroke record (this is also the sync payload):
     { pts: [[x, y], ...],  // normalised 0..1 of the pad box
       w:   number,         // stroke width, normalised to pad box
       seed: number }       // deterministic grain
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- deterministic PRNG (mulberry32) ---------- */
  function prng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const reduceMotion =
    typeof global.matchMedia === 'function' &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     ChalkSound
     ============================================================ */
  const ChalkSound = {
    ctx: null,
    on: true,
    _last: 0,
    _noise: null,

    /** Must be called from a user gesture (browser autoplay rule). */
    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;

      // 2s of white noise, reused by every grain
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;

      // tame the top end so it reads as slate, not as a hiss
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7800;
      this.master.connect(lp).connect(ctx.destination);
      return ctx;
    },

    setEnabled(v) {
      this.on = !!v;
    },

    /**
     * One grain of chalk friction.
     * @param {number} speed 0..1, how fast the finger is moving
     */
    grain(speed) {
      const ctx = this.ensure();
      if (!ctx || !this.on) return;
      const now = ctx.currentTime;
      if (now - this._last < 0.014) return; // ~70 grains/s ceiling
      this._last = now;

      const s = Math.max(0.04, Math.min(1, speed));
      const dur = 0.03 + 0.05 * (1 - s);

      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      src.playbackRate.value = 0.85 + s * 0.6;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + s * 2400 + Math.random() * 500;
      bp.Q.value = 4 + s * 10;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.06 + 0.2 * s, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      src.connect(bp).connect(g).connect(this.master);
      src.start(now, Math.random() * 1.4);
      src.stop(now + dur + 0.02);

      // stick-slip squeak — only on quick strokes, only sometimes
      if (s > 0.42 && Math.random() < 0.3) {
        const f = 1900 + Math.random() * 1700;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, now);
        o.frequency.exponentialRampToValueAtTime(f * (0.82 + Math.random() * 0.3), now + 0.06);
        const pk = ctx.createBiquadFilter();
        pk.type = 'peaking';
        pk.frequency.value = f;
        pk.Q.value = 9;
        pk.gain.value = 14;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, now);
        g2.gain.exponentialRampToValueAtTime(0.03 * s, now + 0.008);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        o.connect(pk).connect(g2).connect(this.master);
        o.start(now);
        o.stop(now + 0.08);
      }
    },

    /** Chalk touching down. */
    tap() {
      const ctx = this.ensure();
      if (!ctx || !this.on) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      src.connect(lp).connect(g).connect(this.master);
      src.start(now, Math.random());
      src.stop(now + 0.07);
    },

    /** Felt eraser sweep. */
    erase() {
      const ctx = this.ensure();
      if (!ctx || !this.on) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1500, now);
      lp.frequency.exponentialRampToValueAtTime(380, now + 0.32);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      src.connect(lp).connect(g).connect(this.master);
      src.start(now, Math.random());
      src.stop(now + 0.4);
    },

    /**
     * The mark landed. Warm, short, never triumphant — this fires
     * up to twice a day for months, so it must not get annoying.
     * @param {number} [steps] streak length; lifts the pitch slightly
     */
    settle(steps) {
      const ctx = this.ensure();
      if (!ctx || !this.on) return;
      const now = ctx.currentTime;
      const lift = Math.min(6, steps || 0) * 12;
      [1, 2.01, 3.02].forEach((mult, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = (392 + lift) * mult;
        const g = ctx.createGain();
        const peak = i === 0 ? 0.1 : 0.028 / i;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(peak, now + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + (i === 0 ? 0.9 : 0.45));
        o.connect(g).connect(this.master);
        o.start(now);
        o.stop(now + 1.1);
      });
    },
  };

  /* ============================================================
     Chalk — bristle renderer
     ============================================================ */
  const Chalk = {
    prng,

    /**
     * Stamp a polyline as chalk.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Array<[number,number]>} pts  in ctx coordinate space
     * @param {object} opt
     *   width   stroke width in px            (default 7)
     *   color   chalk colour                  (default '#EDEDE4')
     *   alpha   overall opacity 0..1          (default 1)
     *   seed    grain seed                    (default 1)
     *   bristles count across the stroke      (default 5)
     *   dry     0..1 how uneven the deposit is(default 0.55)
     *   step    px between deposits           (default 1.1)
     *   rnd     an existing prng() to continue from (incremental drawing)
     *   travelled  distance already laid down by this prng
     * @returns {number} travelled, so the next call can continue the
     *   same dry-out cycle. Continuing the same prng + travelled is
     *   what makes an incrementally drawn stroke identical to its
     *   replay from storage.
     */
    polyline(ctx, pts, opt = {}) {
      if (!pts || pts.length < 2) {
        if (pts && pts.length === 1) this.dot(ctx, pts[0], opt);
        return opt.travelled ?? 0;
      }
      const width = opt.width ?? 7;
      const color = opt.color ?? '#EDEDE4';
      const alpha = opt.alpha ?? 1;
      const bristles = Math.max(2, Math.round(opt.bristles ?? 5));
      const dry = opt.dry ?? 0.55;
      const step = opt.step ?? 0.7;
      const seed = opt.seed ?? 1;
      const rnd = opt.rnd || prng(seed);

      // alpha buckets -> one fill per bucket instead of per speck
      const BUCKETS = 5;
      const buckets = Array.from({ length: BUCKETS }, () => []);
      /* Grain size has to stay well under the bristle band that carries it.
         Scale with the band and cap it: otherwise a wide stroke lays down
         specks BIGGER than the gap between bristles, they merge into blobs,
         and the stroke reads as popcorn instead of chalk. Capping means a
         wide stroke gets MORE grains, not bigger ones. */
      const band = width / bristles;
      const speck = Math.max(0.7, Math.min(1.5, band * 0.6));

      let travelled = opt.travelled ?? 0;
      let deposit = 1; // chalk goes dry, then bites again

      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy; // perpendicular
        const py = ux;

        const n = Math.max(1, Math.ceil(len / step));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          const cx = x0 + dx * t;
          const cy = y0 + dy * t;
          travelled += step;

          // slow dry-out cycle along the whole stroke
          const wave = 0.5 + 0.5 * Math.sin(travelled * 0.09 + seed);
          deposit = 1 - dry * 0.75 * (rnd() * 0.6 + wave * 0.4);

          for (let b = 0; b < bristles; b++) {
            const off = (b - (bristles - 1) / 2) * band * 0.86;
            // jitter stays inside this bristle's own band, or the bristle
            // structure dissolves and the stroke goes uniformly fuzzy
            const jitter = (rnd() - 0.5) * band * 0.9;
            const along = (rnd() - 0.5) * speck;
            const x = cx + px * (off + jitter) + ux * along;
            const y = cy + py * (off + jitter) + uy * along;
            if (rnd() < dry * 0.16) continue; // gaps in the deposit

            // edges of a chalk stroke lay down denser than the middle
            const edge = 1 - Math.abs(off) / (width * 0.6);
            let a = deposit * (0.34 + 0.66 * rnd()) * (0.62 + 0.38 * (1 - edge * 0.7));
            a = Math.max(0.04, Math.min(1, a)) * alpha;
            const idx = Math.min(BUCKETS - 1, Math.floor(a * BUCKETS));
            buckets[idx].push(x, y, speck * (0.7 + rnd() * 0.6));
          }
        }
      }

      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < BUCKETS; i++) {
        const arr = buckets[i];
        if (!arr.length) continue;
        ctx.globalAlpha = ((i + 0.6) / BUCKETS) * alpha;
        ctx.beginPath();
        for (let j = 0; j < arr.length; j += 3) ctx.rect(arr[j], arr[j + 1], arr[j + 2], arr[j + 2]);
        ctx.fill();
      }
      ctx.restore();
      return travelled;
    },

    /** A single dab, for a tap without movement. */
    dot(ctx, pt, opt = {}) {
      const width = opt.width ?? 7;
      const rnd = prng(opt.seed ?? 1);
      ctx.save();
      ctx.globalAlpha = (opt.alpha ?? 1) * 0.5;
      ctx.fillStyle = opt.color ?? '#EDEDE4';
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2;
        const r = rnd() * width * 0.5;
        ctx.rect(pt[0] + Math.cos(a) * r, pt[1] + Math.sin(a) * r, 1.1, 1.1);
      }
      ctx.fill();
      ctx.restore();
    },

    /**
     * Replay saved strokes into any box. The single most important
     * function in the app: the hand-drawn trace has to survive being
     * shrunk into a 12px year cell and being sent to the server.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Array} strokes [{pts, w, seed}]
     * @param {number} x  box left
     * @param {number} y  box top
     * @param {number} size box edge (square)
     * @param {object} opt {color, alpha, pad}
     */
    replay(ctx, strokes, x, y, size, opt = {}) {
      if (!strokes || !strokes.length) return;
      const pad = opt.pad ?? size * 0.1;
      const inner = size - pad * 2;
      const tiny = size < 26;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, size, size);
      ctx.clip();
      for (const s of strokes) {
        if (!s || !s.pts || !s.pts.length) continue;
        const pts = s.pts.map(([nx, ny]) => [x + pad + nx * inner, y + pad + ny * inner]);
        Chalk.polyline(ctx, pts, {
          width: Math.max(tiny ? 0.9 : 1.2, (s.w ?? 0.09) * size),
          color: opt.color ?? '#EDEDE4',
          alpha: opt.alpha ?? 1,
          seed: s.seed ?? 1,
          bristles: tiny ? 3 : 5,
          dry: tiny ? 0.2 : 0.55,
          step: tiny ? 0.5 : 1.1,
        });
      }
      ctx.restore();
    },

    /**
     * Is the drawing an X? Deliberately lenient — two strokes that
     * cross each other at a plausible angle. Used only to decide
     * whether to play the settle chime; any mark is still saved.
     */
    looksLikeX(strokes) {
      if (!strokes || strokes.length < 2) return false;
      const longest = strokes
        .filter((s) => s.pts && s.pts.length > 3)
        .map((s) => {
          const a = s.pts[0];
          const b = s.pts[s.pts.length - 1];
          let len = 0;
          for (let i = 1; i < s.pts.length; i++) {
            len += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
          }
          return { a, b, len, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
        })
        .sort((p, q) => q.len - p.len)
        .slice(0, 2);
      if (longest.length < 2) return false;
      let d = Math.abs(longest[0].ang - longest[1].ang);
      if (d > Math.PI / 2) d = Math.PI - d;
      const deg = (d * 180) / Math.PI;
      return deg > 22 && deg < 158;
    },
  };

  /* ============================================================
     Dust — falling chalk specks
     ============================================================ */
  class Dust {
    constructor(canvas, opt = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.color = opt.color ?? 'rgba(237,237,228,';
      this.particles = [];
      this.max = opt.max ?? 46;
      this.running = false;
      this.enabled = !reduceMotion && opt.enabled !== false;
    }
    spawn(x, y, n = 2) {
      if (!this.enabled) return;
      for (let i = 0; i < n && this.particles.length < this.max; i++) {
        this.particles.push({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 0.35,
          vy: 0.15 + Math.random() * 0.5,
          r: 0.5 + Math.random() * 1.3,
          life: 1,
          decay: 0.008 + Math.random() * 0.018,
        });
      }
      this.start();
    }
    start() {
      if (this.running) return;
      this.running = true;
      const tick = () => {
        if (!this.particles.length) {
          this.running = false;
          return;
        }
        this.ctx.save();
        for (const p of this.particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.02;
          p.life -= p.decay;
          if (p.life <= 0) continue;
          this.ctx.fillStyle = this.color + (p.life * 0.5).toFixed(3) + ')';
          this.ctx.fillRect(p.x, p.y, p.r, p.r);
        }
        this.ctx.restore();
        this.particles = this.particles.filter((p) => p.life > 0);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    clear() {
      this.particles.length = 0;
    }
  }

  /* ============================================================
     ChalkPad — the drawing surface
     ============================================================ */
  class ChalkPad {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} opt
     *   color, width (normalised 0..1 of box), sound, dust,
     *   onStroke(stroke), onChange(strokes), pad (inset ratio)
     */
    constructor(canvas, opt = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.color = opt.color ?? '#EDEDE4';
      this.strokeWidth = opt.width ?? 0.085; // normalised
      this.padRatio = opt.pad ?? 0.1;
      this.sound = opt.sound === false ? null : ChalkSound;
      this.onStroke = opt.onStroke || (() => {});
      this.onChange = opt.onChange || (() => {});
      this.strokes = [];
      this._live = null;
      this._lastPt = null;
      this._lastT = 0;
      this._speed = 0;
      this.dust = opt.dust === false ? null : new Dust(canvas, { color: opt.dustColor });
      /* What the board is made of. Defaults to the flat dataset.boardColor
         attribute, but a board can also be PAINTED — a horizon needs a
         gradient, and a gradient has to be repainted on every redraw or
         the first erase would smear flat colour over the sky. */
      this.basePaint = opt.basePaint || null;
      this._bind();
      this.resize();
    }

    /** Repaint the board's own material. Returns false if there is none. */
    _paintBase(ctx, w, h) {
      if (typeof this.basePaint === 'function') {
        ctx.save();
        this.basePaint(ctx, w, h, this);
        ctx.restore();
        return true;
      }
      const board = this.canvas.dataset.boardColor;
      if (board) {
        ctx.save();
        ctx.fillStyle = board;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        return true;
      }
      return false;
    }

    _bind() {
      const c = this.canvas;
      c.style.touchAction = 'none';
      /* Canvas PX, NOT [0,1] of the canvas rect. The distinction is the whole
         ball game. A stored point is 0..1 of the INSET SQUARE BOX — that is
         what _abs() draws, what redraw() re-draws and what Chalk.replay()
         replays into a year cell — and on a 1.5:1 board the canvas rect and
         that box are different spaces sharing only their centre. Feeding a
         canvas-normalised value to _abs() squeezed the mark toward the middle
         and pushed it down the board: a finger at 88% across, 50% down laid
         ink at 72.5%, 75%. So convert once, here, and let every consumer
         downstream see the one space they all already agree on. */
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        c.setPointerCapture?.(e.pointerId);
        this._live = {
          pts: [this._norm(pos(e))],
          w: this.strokeWidth,
          seed: (Math.random() * 1e9) | 0,
        };
        // one prng + one travelled counter for the whole stroke, so the
        // incremental live render is byte-identical to a later replay
        this._rnd = prng(this._live.seed);
        this._travelled = 0;
        this._lastPt = this._abs(this._live.pts[0]);
        this._lastT = performance.now();
        this._speed = 0;
        this.sound?.tap();
      });
      c.addEventListener('pointermove', (e) => {
        if (!this._live) return;
        e.preventDefault();
        const abs = pos(e);
        const dist = Math.hypot(abs[0] - this._lastPt[0], abs[1] - this._lastPt[1]);
        if (dist < 1.2) return; // ignore sub-pixel jitter
        const now = performance.now();
        const dt = Math.max(1, now - this._lastT);
        this._speed = this._speed * 0.65 + Math.min(1, dist / dt / 2.2) * 0.35;
        this._lastT = now;

        this._live.pts.push(this._norm(abs));
        this._segment(this._lastPt, abs, this._live);
        this._lastPt = abs;
        this.sound?.grain(this._speed);
        this.dust?.spawn(abs[0], abs[1], this._speed > 0.5 ? 2 : 1);
      });
      const end = (e) => {
        if (!this._live) return;
        if (e) e.preventDefault?.();
        const s = this._live;
        this._live = null;
        if (s.pts.length < 2) {
          // a tap still leaves a dab
          Chalk.dot(this.ctx, this._abs(s.pts[0]), {
            color: this.color,
            width: s.w * this._size(),
            seed: s.seed,
          });
        }
        this.strokes.push(s);
        this.onStroke(s);
        this.onChange(this.strokes);
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('pointerleave', (e) => {
        // keep drawing if the pointer is captured (finger slides off the pad)
        if (this._live && !c.hasPointerCapture?.(e.pointerId)) end(e);
      });
    }

    /** the square inner box that normalised coordinates live in */
    _box() {
      const S = Math.min(this.cssW, this.cssH);
      const pad = S * this.padRatio;
      return { S, inner: S - pad * 2, ox: (this.cssW - S) / 2 + pad, oy: (this.cssH - S) / 2 + pad };
    }
    _size() {
      return this._box().S;
    }
    /** normalised [0,1] -> canvas px */
    _abs([nx, ny]) {
      const b = this._box();
      return [b.ox + nx * b.inner, b.oy + ny * b.inner];
    }
    /** canvas px -> normalised [0,1] */
    _norm([ax, ay]) {
      const b = this._box();
      return [(ax - b.ox) / b.inner, (ay - b.oy) / b.inner];
    }

    _segment(p0, p1, stroke) {
      const w = stroke.w * this._box().S;
      this._travelled = Chalk.polyline(this.ctx, [p0, p1], {
        width: w,
        color: this.color,
        rnd: this._rnd,
        travelled: this._travelled,
        seed: stroke.seed,
        // bristle count follows the stroke, so a fat chalk stick keeps the
        // same grain size as a thin one instead of going coarse
        bristles: Math.max(3, Math.min(9, Math.round(w / 2.1))),
      });
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(3, global.devicePixelRatio || 1);
      this.cssW = r.width || this.canvas.clientWidth || 300;
      this.cssH = r.height || this.canvas.clientHeight || 300;
      this.canvas.width = Math.round(this.cssW * dpr);
      this.canvas.height = Math.round(this.cssH * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redraw();
    }

    clearCanvas() {
      this.ctx.clearRect(0, 0, this.cssW, this.cssH);
    }

    clear() {
      this.strokes = [];
      this._live = null;
      this.clearCanvas();
      this.dust?.clear();
      this.onChange(this.strokes);
    }

    /** wipe with an eraser: smudge rather than vanish */
    erase() {
      this.sound?.erase();
      this.ctx.save();
      this.ctx.globalAlpha = 0.72;
      let painted = false;
      for (let i = 0; i < 5; i++) {
        const o = i * 2;
        // grow the rect outwards so the outermost pass covers the corners
        this.ctx.save();
        this.ctx.translate(-o, -o);
        painted = this._paintBase(this.ctx, this.cssW + o * 2, this.cssH + o * 2) || painted;
        this.ctx.restore();
      }
      this.ctx.restore();
      // no material of its own -> the board is transparent, so clearing IS erasing
      if (!painted) this.clearCanvas();
      this.strokes = [];
      this.dust?.clear();
      this.onChange(this.strokes);
    }

    undo() {
      this.strokes.pop();
      this.redraw();
      this.onChange(this.strokes);
    }

    /** re-render from stroke records (used after resize / load) */
    redraw() {
      this.clearCanvas();
      this._paintBase(this.ctx, this.cssW, this.cssH);
      for (const s of this.strokes) {
        const pts = s.pts.map((p) => this._abs(p));
        Chalk.polyline(this.ctx, pts, {
          width: s.w * this._size(),
          color: this.color,
          seed: s.seed,
        });
      }
    }

    loadStrokes(strokes) {
      this.strokes = (strokes || []).map((s) => ({
        pts: s.pts.map((p) => [p[0], p[1]]),
        w: s.w,
        seed: s.seed,
      }));
      this.redraw();
    }

    isEmpty() {
      return this.strokes.length === 0;
    }

    /** the payload that gets saved locally and sent to the server */
    export() {
      return this.strokes.map((s) => ({
        pts: s.pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]),
        w: Math.round(s.w * 1000) / 1000,
        seed: s.seed,
      }));
    }
  }

  global.ChalkSound = ChalkSound;
  global.Chalk = Chalk;
  global.ChalkPad = ChalkPad;
  global.Dust = Dust;
  global.chalkPrng = prng;
  if (typeof module !== 'undefined') module.exports = { Chalk, ChalkSound, ChalkPad, Dust, prng };
})(typeof window !== 'undefined' ? window : globalThis);
