#!/usr/bin/env python3
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
src = root / "assets" / "PanRelay.png"
icons = root / "extension" / "icons"
icons.mkdir(parents=True, exist_ok=True)

img = Image.open(src).convert("RGBA")
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.Resampling.LANCZOS).save(
        icons / f"icon{size}.png",
        optimize=True,
    )
img.resize((256, 256), Image.Resampling.LANCZOS).save(
    root / "assets" / "PanRelay-256.png",
    optimize=True,
)
print("Generated extension/icons/icon{16,32,48,128}.png and assets/PanRelay-256.png")
