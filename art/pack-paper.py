"""Pack Blender frames. Run with python3 art/pack-paper.py RENDER_DIR dist/frames [GROUP ...]."""
import json
import math
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

def denoise(frame, bounds):
    """Remove small speckles without flattening the shadows of the larger folds."""
    cropped = np.array(frame.crop(bounds))
    visible = cropped[:, :, 3] > 0
    _, labels = cv2.distanceTransformWithLabels(
        (~visible).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_5, labelType=cv2.DIST_LABEL_PIXEL
    )
    # Extend the nearest visible color so black transparent pixels do not darken cut edges.
    colors = np.zeros((labels.max() + 1, 3), dtype=np.uint8)
    colors[labels[visible]] = cropped[:, :, :3][visible]
    padded = colors[labels]
    clean = cv2.fastNlMeansDenoisingColored(padded, None, 11, 8, 7, 19)
    cropped[:, :, :3] = clean
    result = Image.new("RGBA", frame.size)
    result.paste(Image.fromarray(cropped), bounds[:2])
    return result


cv2.setNumThreads(2)
source, target = map(Path, sys.argv[1:3])
target.mkdir(parents=True, exist_ok=True)
sizes = json.loads((source / "groups.json").read_text())
groups = sys.argv[3:] or sizes.keys()
manifest = {}
for name, (size, columns, span, count) in sizes.items():
    rows = math.ceil(count / columns)
    has_ink = name == "open"
    manifest[name] = {"columns": columns, "rows": rows, "span": span, "count": count, "ink": has_ink}
    if name not in groups:
        continue
    beauty = Image.new("RGBA", (columns * size, rows * size))
    coordinates = Image.new("RGB", beauty.size) if has_ink else None
    for index in range(count):
        x, y = index % columns * size, index // columns * size
        path = source / name / f"{index:03}.png"
        frame = Image.open(path).convert("RGBA")
        assert frame.size == (size, size)
        left, top, right, bottom = frame.getbbox()
        assert 0 < left < right < size and 0 < top < bottom < size
        clean = denoise(frame, (left, top, right, bottom))
        beauty.paste(clean, (x, y))
        if coordinates is not None:
            uv = Image.open(path.with_name(f"{index:03}-uv.png")).convert("RGB")
            assert uv.size == frame.size
            coordinates.paste(uv, (x, y))
    beauty.save(target / f"{name}.webp", quality=96 if count == 1 else 93, alpha_quality=100, method=5)
    if coordinates is not None:
        coordinates.save(target / f"{name}-uv.png", optimize=True)
(target / "layout.js").write_text("export default " + json.dumps(manifest, indent=2) + ";\n")
