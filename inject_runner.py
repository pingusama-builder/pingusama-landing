"""Inject the 8 running-sprite frames into index.html as a frame-cycle
animation stack, replacing the dozing-reader block.

Run:  python inject_runner.py
"""

import json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(ROOT, "index.html")
FRAMES = json.load(open(os.path.join(ROOT, "runner.b64.txt"), encoding="utf-8"))
assert len(FRAMES) == 8, f"expected 8 frames, got {len(FRAMES)}"

# --- 1. CSS swap -------------------------------------------------------------
# (The OLD/NEW CSS strings are well-defined and don't contain base64.)

OLD_CSS = """  /* ====== reader (dozing) beside the wheel ======
     A real pixel-art sprite (28x36 PNG, scaled 3.5x to 98x126).
     The whole figure breathes very subtly. A "z z z" floats up
     periodically to signal dozing — more readable than subtle head
     nodding, and doesn't need a separate head sprite. */

  .scene {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin: 6px auto 18px;
    max-width: 720px;
  }
  .wheel-wrap {
    flex: 0 0 auto;
    width: min(440px, 70vw);
  }
  .reader-wrap {
    flex: 0 0 auto;
    width: 110px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    /* nudge the reader down a bit so their feet line up with the wheel's
       bottom ornament */
    padding-bottom: 22px;
  }
  .reader {
    position: relative;
    width: 98px;
    height: 126px;
  }
  .reader-img {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
  }
  /* subtle breath: the whole figure bobs ±0.6px every 3.6s */
  @keyframes reader-breath {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50%      { transform: translateX(-50%) translateY(-0.6px); }
  }
  .reader-img { animation: reader-breath 3.6s ease-in-out infinite; }

  /* the floating z's — three small z's that drift up, fade out, repeat */
  .zzz {
    position: absolute;
    top: 0; right: 4px;
    width: 18px; height: 50px;
    pointer-events: none;
  }
  .zzz span {
    position: absolute;
    right: 0;
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 700;
    color: var(--dusk);
    opacity: 0;
    animation: z-float 4.8s ease-in-out infinite;
  }
  .zzz span:nth-child(1) { font-size: 11px; animation-delay: 0s;   }
  .zzz span:nth-child(2) { font-size: 14px; animation-delay: 1.6s; }
  .zzz span:nth-child(3) { font-size: 18px; animation-delay: 3.2s; }
  @keyframes z-float {
    0%   { opacity: 0; transform: translate(0,    0)   rotate(8deg); }
    20%  { opacity: .8;                                          }
    70%  { opacity: .3;                                          }
    100% { opacity: 0; transform: translate(8px, -42px) rotate(-4deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .reader-img, .zzz span { animation: none; }
    .zzz span { opacity: .6; }
  }

  /* ====== responsive: stack reader below wheel on narrow screens ====== */
  @media (max-width: 640px) {
    .scene { flex-direction: column; gap: 8px; }
    .wheel-wrap { width: min(380px, 92vw); }
    .reader-wrap { padding-bottom: 0; }
  }"""

NEW_CSS = """  /* ====== runner beside the wheel ======
     8-frame loop-in-place run cycle from the source sprite sheet.
     Each <img> is a separate frame, all stacked at the same position;
     a single @keyframes runner-cycle gates each frame's opacity for
     1/8 of the cycle, giving us an animation using only one keyframes
     rule and no JS. */

  .scene {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    margin: 6px auto 18px;
    max-width: 760px;
  }
  .wheel-wrap {
    flex: 0 0 auto;
    width: min(440px, 70vw);
  }
  .runner-wrap {
    flex: 0 0 auto;
    width: 132px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    /* nudge the runner's feet down so they sit roughly on the same
       baseline as the wheel's bottom ornament */
    padding-bottom: 18px;
  }
  .runner {
    position: relative;
    width: 132px;
    height: 140px;
  }
  .runner img {
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 132px;
    height: auto;
    transform: translateX(-50%);
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    opacity: 0;
  }
  /* one frame visible at a time, in 8 equal slices of a 960ms cycle
     (= 120ms per frame, a relaxed Stardew-ambient jog) */
  @keyframes runner-cycle {
    0%,       12.5% { opacity: 1; }
    12.5001%, 100%  { opacity: 0; }
  }
  /* per-frame delay so each one takes its turn in sequence.
     Negative delays shift each frame's "on" window into a different slot
     of the 960ms cycle: f0 is on for 0–120ms, f1 for 120–240ms, etc. */
  .runner img.f0 { animation: runner-cycle 960ms steps(1, end) infinite       0ms; }
  .runner img.f1 { animation: runner-cycle 960ms steps(1, end) infinite    -120ms; }
  .runner img.f2 { animation: runner-cycle 960ms steps(1, end) infinite    -240ms; }
  .runner img.f3 { animation: runner-cycle 960ms steps(1, end) infinite    -360ms; }
  .runner img.f4 { animation: runner-cycle 960ms steps(1, end) infinite    -480ms; }
  .runner img.f5 { animation: runner-cycle 960ms steps(1, end) infinite    -600ms; }
  .runner img.f6 { animation: runner-cycle 960ms steps(1, end) infinite    -720ms; }
  .runner img.f7 { animation: runner-cycle 960ms steps(1, end) infinite    -840ms; }
  /* a tiny dust-shadow that pulses with the cadence, just to ground the
     sprite — kept very subtle */
  .runner::before {
    content: "";
    position: absolute;
    bottom: 4px;
    left: 50%;
    width: 64px; height: 6px;
    transform: translateX(-50%);
    background: radial-gradient(closest-side, rgba(62,44,32,.22), rgba(62,44,32,0));
    animation: runner-shadow 960ms ease-in-out infinite;
  }
  @keyframes runner-shadow {
    0%, 100% { transform: translateX(-50%) scaleX(0.85); opacity: .55; }
    50%      { transform: translateX(-50%) scaleX(1.00); opacity: .85; }
  }

  @media (prefers-reduced-motion: reduce) {
    .runner img, .runner::before { animation: none; }
    .runner img.f0 { opacity: 1; }
  }

  /* ====== responsive: stack runner below wheel on narrow screens ====== */
  @media (max-width: 640px) {
    .scene { flex-direction: column; gap: 4px; }
    .wheel-wrap { width: min(380px, 92vw); }
    .runner-wrap { padding-bottom: 0; }
    .runner { width: 110px; height: 116px; }
    .runner img { width: 110px; }
  }"""

# --- 2. HTML swap via regex (the embedded base64 makes an exact match
#       fragile) --------------------------------------------------------------

HTML_PATTERN = re.compile(
    r'      <!-- the dozing reader, sitting to the right of the wheel -->\n'
    r'      <div class="reader-wrap"[^>]*>.*?</div>\n      </div>',
    re.DOTALL,
)

img_lines = []
for i, b64 in enumerate(FRAMES):
    img_lines.append(
        f'          <img class="f{i}" '
        f'src="data:image/png;base64,{b64}" alt="" />'
    )
imgs_block = "\n".join(img_lines)

NEW_HTML = (
    '      <!-- the runner, jogging in place to the right of the wheel -->\n'
    '      <div class="runner-wrap" aria-hidden="true">\n'
    '        <div class="runner">\n'
    f'{imgs_block}\n'
    '        </div>\n'
    '      </div>'
)

# --- do the swap -------------------------------------------------------------

with open(HTML, "r", encoding="utf-8") as f:
    html = f.read()

if OLD_CSS not in html:
    raise SystemExit("OLD_CSS block not found in HTML — aborting")
m = HTML_PATTERN.search(html)
if not m:
    raise SystemExit("reader HTML block not found in HTML — aborting")

html = html.replace(OLD_CSS, NEW_CSS)
html = HTML_PATTERN.sub(NEW_HTML, html, count=1)

with open(HTML, "w", encoding="utf-8") as f:
    f.write(html)

print(f"wrote {HTML}")
print(f"new size: {len(html):,} chars")