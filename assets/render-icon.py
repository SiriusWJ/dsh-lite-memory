"""Render the dsh-lite-memory plugin icon as PNG (assets/icon-256.png).

Same design as assets/icon.svg: a diagonal indigo→violet rounded tile, three
white memory bars fading down, and one amber priority dot. Drawn at 16x and
downsampled with LANCZOS so the tile keeps the SVG's soft edges.
"""

from PIL import Image, ImageDraw

S = 1024           # supersampled canvas (16x the 64-unit viewBox)
OUT = 256
R = S / 64         # unit -> pixel

def gradient(size, start=(0x4F, 0x6E, 0xF7), end=(0x8B, 0x5C, 0xF6)):
    """Diagonal linear gradient as an RGB image."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (
                round(start[0] + (end[0] - start[0]) * t),
                round(start[1] + (end[1] - start[1]) * t),
                round(start[2] + (end[2] - start[2]) * t),
            )
    return img

def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
tile = gradient(S).convert("RGBA")
canvas.paste(tile, (0, 0), rounded_mask(S, round(15 * R)))

def bar(x, y, w, h, radius, alpha):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [x * R, y * R, (x + w) * R, (y + h) * R], radius=radius * R, fill=(255, 255, 255, round(255 * alpha))
    )
    return Image.alpha_composite(canvas, layer)

canvas = bar(13, 14, 38, 10, 5, 0.95)
canvas = bar(13, 28, 28, 9, 4.5, 0.72)
canvas = bar(13, 41, 20, 9, 4.5, 0.50)

dot = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(dot).ellipse(
    [(47 - 5.5) * R, (45.5 - 5.5) * R, (47 + 5.5) * R, (45.5 + 5.5) * R], fill=(0xFF, 0xD1, 0x66, 255)
)
canvas = Image.alpha_composite(canvas, dot)

canvas.resize((OUT, OUT), Image.LANCZOS).save("assets/icon-256.png", optimize=True)
print("wrote assets/icon-256.png", OUT, "x", OUT)
