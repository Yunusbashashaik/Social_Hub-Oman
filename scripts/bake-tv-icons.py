#!/usr/bin/env python3
"""Bake sharp catalog service icons into the hero wallpaper TV screen.

Replaces the soft/blurry icons that were part of the photo with the same
assets used in the catalog (client/public/*.JPG), perspective-mapped into
the TV glass — not a CSS overlay.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "client" / "public"
SOURCE = PUBLIC / "Social_Store_bg.JPG"
# Prefer an unbaked photo if present; otherwise bake over current wallpaper.
SOURCE_CANDIDATES = [
    PUBLIC / "wallpaper-source.JPG",
    PUBLIC / "Global_bg.JPG",
    PUBLIC / "Social_Store_bg.JPG",
]

ICONS = [
    "Netflix.JPG",
    "Prime.JPG",
    "YTPremium.JPG",
    "DisneyPlus.JPG",
    "HBOMax.JPG",
    "AppleTVPlus.JPG",
    "SpotifyPremium.JPG",
    "CanvaPro.JPG",
]

# Inner TV glass corners (TL, TR, BR, BL) on the 1600x666 wallpaper.
SCREEN_QUAD = [(1002, 116), (1465, 104), (1482, 412), (992, 422)]


def rounded_icon(path: Path, size: int, radius: int) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    im = im.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    rgb = ImageEnhance.Contrast(im.convert("RGB")).enhance(1.05)
    im = rgb.convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0))
    out.putalpha(mask)
    return out


def make_screen_panel(
    cols: int = 4,
    rows: int = 2,
    icon_size: int = 248,
    gap: int = 26,
    pad: int = 28,
    radius: int = 38,
    bg: tuple[int, int, int] = (4, 6, 10),
) -> Image.Image:
    width = pad * 2 + cols * icon_size + (cols - 1) * gap
    height = pad * 2 + rows * icon_size + (rows - 1) * gap
    panel = Image.new("RGBA", (width, height), bg + (255,))
    for i, name in enumerate(ICONS):
        r, c = divmod(i, cols)
        x = pad + c * (icon_size + gap)
        y = pad + r * (icon_size + gap)
        panel.alpha_composite(rounded_icon(PUBLIC / name, icon_size, radius), (x, y))
    return panel


def find_coeffs(pa, pb):
    matrix = []
    for s, t in zip(pa, pb):
        matrix.append([t[0], t[1], 1, 0, 0, 0, -s[0] * t[0], -s[0] * t[1]])
        matrix.append([0, 0, 0, t[0], t[1], 1, -s[1] * t[0], -s[1] * t[1]])
    a = np.asarray(matrix, dtype=float)
    b = np.asarray([c for p in pa for c in p], dtype=float)
    return np.linalg.lstsq(a, b, rcond=None)[0].tolist()


def expand_quad(quad, amount: float):
    cx = sum(p[0] for p in quad) / 4
    cy = sum(p[1] for p in quad) / 4
    out = []
    for x, y in quad:
        dx, dy = x - cx, y - cy
        n = (dx * dx + dy * dy) ** 0.5 or 1
        out.append((x + dx / n * amount, y + dy / n * amount))
    return out


def pick_source() -> Path:
    for path in SOURCE_CANDIDATES:
        if path.exists():
            return path
    raise SystemExit("No wallpaper source image found in client/public")


def main() -> None:
    source = pick_source()
    wall = Image.open(source).convert("RGBA")
    if wall.size != (1600, 666):
        wall = wall.resize((1600, 666), Image.Resampling.LANCZOS)

    panel = make_screen_panel()
    pw, ph = panel.size
    src = [(0, 0), (pw - 1, 0), (pw - 1, ph - 1), (0, ph - 1)]
    coeffs = find_coeffs(src, SCREEN_QUAD)
    warped = panel.transform(
        wall.size,
        Image.Transform.PERSPECTIVE,
        coeffs,
        resample=Image.Resampling.BICUBIC,
    )

    under = Image.new("RGBA", wall.size, (0, 0, 0, 0))
    ImageDraw.Draw(under).polygon(expand_quad(SCREEN_QUAD, 6), fill=(4, 6, 10, 255))
    under.putalpha(under.split()[-1].filter(ImageFilter.GaussianBlur(1.2)))

    result = Image.alpha_composite(Image.alpha_composite(wall, under), warped)
    bloom = warped.filter(ImageFilter.GaussianBlur(3))
    bloom.putalpha(bloom.split()[-1].point(lambda a: int(a * 0.18)))
    result = Image.alpha_composite(result, bloom).convert("RGB")

    targets = [
        PUBLIC / "hero-wallpaper.jpg",
        PUBLIC / "Social_Store_bg.JPG",
        PUBLIC / "Global_bg.JPG",
    ]
    for target in targets:
        result.save(target, quality=94, optimize=True)
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
