#!/usr/bin/env python3
"""Generate Android launcher icons for CrystalLens.

Two layers are produced:

1. Legacy launcher icons: the pre-rendered PNGs from the shared web asset set
   (``web/assets/icons/icon-<size>.png`` or ``dist/preview/assets/icons/...``) are copied
   into the matching ``res/mipmap-*dpi/ic_launcher.png`` slots.
2. Adaptive-icon foreground (Android 8.0+): a transparent 108 dp canvas containing only the
   crystal gem (no rounded plate, per docs/spec/assets.md section 4.4), scaled so the artwork
   stays inside the 66 dp safe circle. Rendered from the 24x24-unit geometric outline that is
   documented in docs/spec/assets.md appendix A.

Run with any Python 3 that has Pillow installed:

    python android/tools/make_icons.py

The generated PNGs are committed, so the APK build never needs Python.
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - guidance only
    sys.exit("Pillow is required: python -m pip install pillow")

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "android" / "app" / "src" / "main" / "res"

LEGACY_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# 108 dp adaptive-icon canvas rendered per density.
FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

# 24x24-unit gem outline (docs/spec/assets.md appendix A), clockwise from the top vertex.
GEM_HEX = [
    (12.0, 1.2),
    (21.2, 7.3),
    (18.4, 18.8),
    (12.0, 22.8),
    (5.6, 18.8),
    (2.8, 7.3),
]

GEM_WHITE = (238, 248, 255)
GEM_TOP = (243, 251, 255)
GEM_BLUE = (64, 186, 255)
GEM_EDGE = (255, 255, 255)


def find_icons_dir() -> Path:
    candidates = [
        ROOT / "dist" / "preview" / "assets" / "icons",
        ROOT / "web" / "assets" / "icons",
    ]
    for candidate in candidates:
        if (candidate / "icon-48.png").is_file() and (candidate / "icon-192.png").is_file():
            return candidate
    raise SystemExit(
        "could not find web icon assets; looked in: " + ", ".join(str(c) for c in candidates)
    )


def build_foreground(size_px: int) -> Image.Image:
    """Render the adaptive-icon foreground at ``size_px`` (108 dp for this density)."""
    supersample = 4
    big = size_px * supersample
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    dp = big / 108.0
    # Keep the gem comfortably inside the 66 dp safe circle.
    content_extent = 60.0 * dp

    xs = [p[0] for p in GEM_HEX]
    ys = [p[1] for p in GEM_HEX]
    units_w = max(xs) - min(xs)
    units_h = max(ys) - min(ys)
    scale = content_extent / max(units_w, units_h)
    center_x, center_y = big / 2.0, big / 2.0
    unit_cx = (min(xs) + max(xs)) / 2.0
    unit_cy = (min(ys) + max(ys)) / 2.0

    points = [
        (center_x + (x - unit_cx) * scale, center_y + (y - unit_cy) * scale)
        for x, y in GEM_HEX
    ]

    # Vertical white -> blue gradient restricted to the gem polygon.
    top_y = min(p[1] for p in points)
    bottom_y = max(p[1] for p in points)
    gradient = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gradient)
    span = max(1.0, bottom_y - top_y)
    for y in range(int(top_y), int(bottom_y) + 1):
        t = (y - top_y) / span
        color = tuple(
            int(round(GEM_TOP[i] + (GEM_BLUE[i] - GEM_TOP[i]) * t)) for i in range(3)
        ) + (255,)
        gd.line([(0, y), (big, y)], fill=color)

    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    canvas.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)

    # White "roof" triangle at the top, exactly like the brand mark.
    roof = [points[0], points[1], points[5]]
    draw.polygon(roof, fill=GEM_WHITE + (255,))

    edge_width = max(1, int(round(1.15 * dp)))
    facet_width = max(1, int(round(1.0 * dp)))
    facet_alpha = 235

    def line(a: int, b: int, width: int, alpha: int) -> None:
        draw.line([points[a], points[b]], fill=GEM_EDGE + (alpha,), width=width)

    # Facet edges of the two large front faces plus the centre seam.
    roof_base = (
        (points[1][0] + points[5][0]) / 2.0,
        (points[1][1] + points[5][1]) / 2.0,
    )
    draw.line([roof_base, points[3]], fill=GEM_EDGE + (facet_alpha,), width=facet_width)
    line(5, 3, facet_width, facet_alpha)
    line(1, 3, facet_width, facet_alpha)
    line(4, 2, facet_width, facet_alpha)
    line(0, 5, facet_width, facet_alpha)
    line(0, 1, facet_width, facet_alpha)

    # Outline last so it sits on top of the facet lines.
    draw.line(points + [points[0]], fill=GEM_EDGE + (255,), width=edge_width)

    # White vertex nodes (the ball joints of the wireframe).
    node_r = 1.45 * dp
    for px, py in points:
        draw.ellipse(
            [px - node_r, py - node_r, px + node_r, py + node_r],
            fill=(255, 255, 255, 255),
        )

    return canvas.resize((size_px, size_px), Image.LANCZOS)


def main() -> int:
    icons = find_icons_dir()
    written = []

    for folder, size in LEGACY_SIZES.items():
        target_dir = RES / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        source = icons / f"icon-{size}.png"
        image = Image.open(source).convert("RGBA")
        if image.size != (size, size):
            raise SystemExit(f"{source} is {image.size}, expected {(size, size)}")
        target = target_dir / "ic_launcher.png"
        image.save(target, "PNG", optimize=True)
        written.append(target)

    for folder, size in FOREGROUND_SIZES.items():
        target = RES / folder / "ic_launcher_foreground.png"
        build_foreground(size).save(target, "PNG", optimize=True)
        written.append(target)

    master_target = ROOT / "android" / "icon-512.png"
    Image.open(icons / "icon-512.png").convert("RGBA").save(master_target, "PNG", optimize=True)
    written.append(master_target)

    print(f"[ok] source icons: {icons}")
    for path in written:
        print(f"[ok] {path.relative_to(ROOT)}  {path.stat().st_size} B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
