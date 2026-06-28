"""Slice the 8-frame running sprite sheet into individual frames with the
tan background made transparent (anti-aliased edges feathered), and emit
a single base64 file containing all frames stacked as JSON for inline use.

Source: a 1402 x 1122 RGB sprite sheet (4 cols x 2 rows of frames) named
        "snoopy pixel running.png", expected one directory above this script.
        (Set the SOURCE env var to override the path.)
Output: runner.b64.txt  ->  JSON list of 8 base64 PNG strings, frame 0 first.
        runner_*.png     ->  individual frame previews.
"""

from PIL import Image
import numpy as np
import base64, io, json, os

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("SOURCE") or os.path.join(os.path.dirname(_HERE), "snoopy pixel running.png")
OUT_DIR = _HERE

# Frame bounds detected from the source: 4 cols x 2 rows
FRAMES = [
    # (x0, y0, x1, y1)
    (  60, 212,  358, 527),  # 0  top-left
    ( 387, 212,  679, 527),  # 1
    ( 755, 212, 1010, 527),  # 2
    (1066, 212, 1356, 527),  # 3  top-right
    (  60, 629,  358, 930),  # 4  bot-left
    ( 387, 629,  679, 930),  # 5
    ( 755, 629, 1010, 930),  # 6
    (1066, 629, 1356, 930),  # 7  bot-right
]

# Background color sampled from the corners of the source
BG = np.array([235, 197, 141], dtype=np.float32)

def make_transparent(rgb_img: Image.Image, feather: int = 18) -> Image.Image:
    """Return RGBA image where pixels close to BG become transparent.
    `feather` is the distance (sum-of-abs-diff) at which alpha = 0.
    Pixels exactly equal to BG get alpha 0; pixels beyond BG + feather
    get alpha 255; in between, alpha ramps linearly. This handles the
    anti-aliased edges of the original art.
    """
    arr = np.array(rgb_img.convert("RGB"), dtype=np.float32)
    diff = np.abs(arr - BG).sum(axis=2)         # 0 == background
    # alpha: 0 when diff <= 0, 255 when diff >= feather, linear in between
    alpha = np.clip(diff / feather * 255.0, 0, 255).astype(np.uint8)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    return Image.fromarray(rgba, mode="RGBA")

def main():
    src = Image.open(SRC)
    b64_list = []
    for i, box in enumerate(FRAMES):
        crop = src.crop(box)
        rgba = make_transparent(crop)
        # save preview PNG
        preview = os.path.join(OUT_DIR, f"runner_{i}.png")
        rgba.save(preview)
        # base64 encode
        buf = io.BytesIO()
        rgba.save(buf, format="PNG", optimize=True)
        b64_list.append(base64.b64encode(buf.getvalue()).decode())
        print(f"frame {i}: {box[2]-box[0]}x{box[3]-box[1]} -> {preview}")

    out_json = os.path.join(OUT_DIR, "runner.b64.txt")
    with open(out_json, "w") as f:
        json.dump(b64_list, f)
    print(f"wrote {out_json} with {len(b64_list)} frames")

if __name__ == "__main__":
    main()
