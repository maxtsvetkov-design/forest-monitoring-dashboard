#!/usr/bin/env python3
"""Composites public/preview_trees/*.png (17 individually-shipped drone tree
crops) into a single 6x3 sprite sheet, public/preview_trees/sprite.png.

Re-run this whenever a tree-crop photo is added, removed, or replaced. The
tile order here MUST match PREVIEW_TREE_IMAGE_IDS in
src/data/treePhotoSprite.ts (left-to-right, top-to-bottom) -- that file has no
way to detect a mismatch on its own.

Requires Pillow: pip3 install pillow
"""

from PIL import Image
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(SCRIPT_DIR, "..", "public", "preview_trees")
OUT_PATH = os.path.join(SRC_DIR, "sprite.png")

FILES = [
    "1456abbb-f0a5-4a8f-ba44-1a6a4fad24d3.png",
    "170e3d3d-0c05-452d-afa6-e98ef9db918c.png",
    "184e9c8d-d02b-4123-bf1c-b9e90f74195f.png",
    "1c32eced-a77c-4c0b-a195-fac349af8bf5.png",
    "2192f564-b46d-432a-8e71-2d55bb81220a.png",
    "27679ac5-e657-418c-b9f5-f2e184f49004.png",
    "3008cdde-f9f2-43ec-81d8-6a31d6f8408c.png",
    "5a591221-eb0c-44ef-8b00-3827b3ecd73f.png",
    "5ab12952-5d2b-4ed9-9f5e-b8883fae22dc.png",
    "962458fa-295c-4692-94e7-09ee08eabb15.png",
    "9d870897-fad9-47ed-94c4-140d70a414dd.png",
    "9d89c3f7-0805-4ee0-a49b-0d584c4770b6.png",
    "a2c42919-1e2b-4a30-8882-cb3fb0af35f3.png",
    "a5c4e979-203d-440a-a9c1-1d46fde85ae0.png",
    "b19279e3-b9b8-49ad-b444-0b090fb67d28.png",
    "c8a299f4-26bb-4d4a-80db-42abb5130717.png",
    "f4ad4abe-930b-420b-9d13-4c6645abd5f5.png",
]

TILE = 200
COLS = 6
ROWS = 3  # 18 cells for 17 photos; the trailing cell stays transparent.


def main():
    sheet = Image.new("RGBA", (TILE * COLS, TILE * ROWS), (0, 0, 0, 0))
    for i, name in enumerate(FILES):
        img = Image.open(os.path.join(SRC_DIR, name)).convert("RGBA")
        w, h = img.size
        side = min(w, h)
        left, top = (w - side) // 2, (h - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize((TILE, TILE), Image.LANCZOS)
        sheet.paste(img, ((i % COLS) * TILE, (i // COLS) * TILE))
    sheet.save(OUT_PATH)
    print(f"wrote {OUT_PATH} {sheet.size}")


if __name__ == "__main__":
    main()
