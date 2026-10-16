#!/usr/bin/env python3
"""Icône de lanceur : l'œuf pixel art du jeu (SPR_EGG de species.h) sur un
écran rond, dans un boîtier sombre. Écrit android/res/mipmap-*/ic_launcher.png."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src = (root / "www/data.js").read_text(encoding="utf-8")
data = json.loads(src[src.index("=") + 1:].strip().rstrip(";"))
egg = data["SPR"]["SPR_EGG"]
pal = data["SPR_PAL"]


def c565(v):
    r, g, b = (v >> 11) & 31, (v >> 5) & 63, v & 31
    return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255)


def icon(size):
    S = 512
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((8, 8, S - 8, S - 8), fill=(28, 31, 41, 255))          # boîtier
    d.ellipse((40, 40, S - 40, S - 40), fill=(143, 200, 234, 255))   # ciel
    d.chord((40, 40, S - 40, S - 40), 10, 170, fill=(126, 192, 127, 255))  # prairie
    rows = [r for r in egg if any(ch != "." for ch in r)]
    cols = [i for i in range(len(egg[0])) if any(r[i] != "." for r in egg)]
    h, w = len(rows), cols[-1] - cols[0] + 1
    px = 11
    ox, oy = (S - w * px) // 2, (S - h * px) // 2 + 10
    for y, row in enumerate(rows):
        for x in range(cols[0], cols[-1] + 1):
            ch = row[x]
            if ch != ".":
                d.rectangle((ox + (x - cols[0]) * px, oy + y * px,
                             ox + (x - cols[0] + 1) * px - 1, oy + (y + 1) * px - 1), fill=c565(pal[ch]))
    return im.resize((size, size), Image.LANCZOS)


for name, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    out = root / f"android/res/mipmap-{name}/ic_launcher.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    icon(size).save(out)
icon(512).save(root / "icon-512.png")
print("icônes écrites")
