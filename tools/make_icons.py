"""Draw RedAnt's toolbar icons: a black top-down ant on a bright orange rounded square
(same idea as DiscordAnt's logo: black ant on the site's colour, no site logo).

    python tools/make_icons.py
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
S = 512                       # draw big, then shrink for clean edges
ORANGE = (255, 69, 0, 255)    # #FF4500
ANT = (32, 32, 32, 255)       # near-black, like DiscordAnt's ant


def draw() -> Image.Image:
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([8, 8, S - 8, S - 8], radius=110, fill=ORANGE)
    w = 26  # leg / antenna thickness

    # body: head (top right), thorax, abdomen (bottom left), on a diagonal
    cx, cy = S / 2, S / 2
    ang = math.radians(-45)
    ux, uy = math.cos(ang), math.sin(ang)  # points up-right

    def at(t):
        return cx + ux * t, cy + uy * t

    hx, hy = at(120)
    tx, ty = at(10)
    ax, ay = at(-120)
    # legs from the thorax: three per side, roughly at right angles to the body
    px, py = -uy, ux
    for off in (-55, 0, 55):
        bx, by = tx + ux * off * 0.6, ty + uy * off * 0.6
        for side in (1, -1):
            kx = bx + px * side * 95 + ux * (off * 0.5)
            ky = by + py * side * 95 + uy * (off * 0.5)
            fx = kx + px * side * 40 + ux * (off * 1.1 - 30)
            fy = ky + py * side * 40 + uy * (off * 1.1 - 30)
            d.line([(bx, by), (kx, ky), (fx, fy)], fill=ANT, width=w, joint="curve")
    # antennae
    for side in (1, -1):
        mx = hx + ux * 70 + px * side * 45
        my = hy + uy * 70 + py * side * 45
        ex = mx + ux * 20 + px * side * 60
        ey = my + uy * 20 + py * side * 60
        d.line([(hx, hy), (mx, my), (ex, ey)], fill=ANT, width=w - 6, joint="curve")
    # segments
    d.ellipse([hx - 52, hy - 52, hx + 52, hy + 52], fill=ANT)
    d.ellipse([tx - 58, ty - 58, tx + 58, ty + 58], fill=ANT)
    d.ellipse([ax - 92, ay - 92, ax + 92, ay + 92], fill=ANT)
    return im


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    big = draw()
    docs = os.path.join(HERE, "..", "docs")
    os.makedirs(docs, exist_ok=True)
    big.save(os.path.join(docs, "logo.png"))  # the logo on the README page
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f"icon{size}.png"))
    print("icons written to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
