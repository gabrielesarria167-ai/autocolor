"""Trace the supplied logo raster (imgs/logo.jpeg) into SVG paths.

The brand artwork only arrived as a 1000x1000 JPEG. The mark is fitted as
two cubic curves (see MARK below); the wordmark and the tagline are traced
with marching squares on the anti-aliased edges and simplified with
Ramer-Douglas-Peucker, which keeps them within a fraction of a source pixel.

Run from the repo root:  python3 tools/tracelogo.py
Writes the SVGs under imgs/brand/, plus the raster copies that can't be SVG:
the favicon set and the two email logos (mail clients don't render SVG).
"""
import os
from PIL import Image, ImageChops, ImageDraw

SRC = 'imgs/logo.jpeg'
OUT = 'imgs/brand'
INK = '#262D40'

# Bands measured on the source (inclusive pixel rows / columns).
MARK_BOX = (363, 239)            # top-left of the mark
WORD_BOX = (226, 552, 778, 654)  # x0, y0, x1, y1 with a little margin
TAG_BOX = (222, 664, 808, 704)

# Mark in its own 272x297 frame: two blades 16 units wide at the top, a
# 12-unit split, flaring to the baseline along a concave curve.
MARK_W, MARK_H = 272, 297
MARK = ('M114 0H130V297H0C95 189 113 31 114 2Z'
        'M158 0H142V297H272C177 189 159 31 158 2Z')


def load(box):
    im = Image.open(SRC).convert('L')
    x0, y0, x1, y1 = box
    im = im.crop((x0, y0, x1, y1))
    w, h = im.size
    px = im.load()
    # Ink coverage 0..1. Paper reads ~255, ink ~45.
    return w, h, [[max(0.0, min(1.0, (255 - px[x, y]) / 210.0)) for x in range(w)] for y in range(h)]


def contours(w, h, g, level=0.5):
    # Pad with paper so every contour closes.
    G = [[0.0] * (w + 2)] + [[0.0] + row + [0.0] for row in g] + [[0.0] * (w + 2)]
    W, H = w + 2, h + 2

    # Crossings are named by the grid edge they sit on, so linking segments
    # never depends on comparing floats. Every crossing belongs to exactly
    # two cells, so the segments form an undirected graph of closed loops.
    def point(edge):
        kind, x, y = edge
        if kind == 'h':
            va, vb = G[y][x], G[y][x + 1]
            t = (level - va) / (vb - va)
            return (x + t - 1, y - 1)
        va, vb = G[y][x], G[y + 1][x]
        t = (level - va) / (vb - va)
        return (x - 1, y + t - 1)

    adj = {}

    def link(p, q):
        adj.setdefault(p, []).append(q)
        adj.setdefault(q, []).append(p)

    for y in range(H - 1):
        for x in range(W - 1):
            a, b, c, d = G[y][x], G[y][x + 1], G[y + 1][x + 1], G[y + 1][x]
            idx = (a > level) * 8 + (b > level) * 4 + (c > level) * 2 + (d > level)
            if idx in (0, 15):
                continue
            top, bottom = ('h', x, y), ('h', x, y + 1)
            left, right = ('v', x, y), ('v', x + 1, y)
            if idx == 5 or idx == 10:
                # Saddle: decide by the cell centre.
                centre = (a + b + c + d) / 4 > level
                if (idx == 5) == centre:
                    link(top, left); link(bottom, right)
                else:
                    link(top, right); link(bottom, left)
                continue
            ends = []
            if (a > level) != (b > level): ends.append(top)
            if (b > level) != (c > level): ends.append(right)
            if (d > level) != (c > level): ends.append(bottom)
            if (a > level) != (d > level): ends.append(left)
            link(ends[0], ends[1])

    loops = []
    seen = set()
    for startnode in adj:
        if startnode in seen:
            continue
        loop = [startnode]
        seen.add(startnode)
        prev, cur = startnode, adj[startnode][0]
        while cur != startnode:
            seen.add(cur)
            loop.append(cur)
            n0, n1 = adj[cur]
            prev, cur = cur, (n1 if n0 == prev else n0)
        if len(loop) > 8:
            loops.append([point(e) for e in loop])
    return loops


def rdp(points, eps):
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-9
    best, idx = 0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        dist = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if dist > best:
            best, idx = dist, i
    if best > eps:
        return rdp(points[:idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]


def trace(box, eps, loops_out=None):
    w, h, g = load(box)
    parts = []
    for loop in contours(w, h, g):
        # Split the closed loop in two so RDP has fixed ends.
        m = len(loop) // 2
        pts = rdp(loop[:m + 1], eps)[:-1] + rdp(loop[m:] + [loop[0]], eps)[:-1]
        if len(pts) < 3:
            continue
        if loops_out is not None:
            loops_out.append(pts)
        parts.append('M' + 'L'.join(f'{x:.2f} {y:.2f}' for x, y in pts) + 'Z')
    return w, h, ''.join(parts)


def mark_loops(steps=48):
    """The mark's two blades as polygons, sampling the fitted curves."""
    def blade(top_outer, inner, base, c1, c2):
        pts = [(top_outer, 0), (inner, 0), (inner, MARK_H), (base, MARK_H)]
        p0, p3 = (base, MARK_H), (top_outer, 2)
        for i in range(1, steps + 1):
            t = i / steps
            u = 1 - t
            pts.append((u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
                        u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1]))
        return pts
    return [blade(114, 130, 0, (95, 189), (113, 31)), blade(158, 142, 272, (177, 189), (159, 31))]


def raster(shapes, size, box, colour, ground=None, pad=0.0, ss=4):
    """Rasterise [(loops, dx, dy)] fitted into `size` (w, h), evenodd fill.

    `box` is the (w, h) of the artwork in its own units; `pad` is the margin
    as a fraction of the shorter side. Drawn at `ss`x and scaled down, which
    is the anti-aliasing PIL's polygon fill doesn't do by itself."""
    W, H = size[0] * ss, size[1] * ss
    margin = pad * min(W, H)
    k = min((W - 2 * margin) / box[0], (H - 2 * margin) / box[1])
    ox = (W - box[0] * k) / 2
    oy = (H - box[1] * k) / 2
    cover = Image.new('L', (W, H), 0)
    for loops, dx, dy in shapes:
        for loop in loops:
            layer = Image.new('L', (W, H), 0)
            ImageDraw.Draw(layer).polygon([(ox + (x + dx) * k, oy + (y + dy) * k) for x, y in loop], fill=255)
            cover = ImageChops.logical_xor(cover.convert('1'), layer.convert('1')).convert('L')
    cover = cover.resize(size, Image.LANCZOS)
    rgb = tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5))
    if ground:
        img = Image.new('RGBA', size, ground)
        img.paste(Image.new('RGBA', size, rgb + (255,)), (0, 0), cover)
        return img
    img = Image.new('RGBA', size, rgb + (0,))
    img.putalpha(cover)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    word_loops, tag_loops = [], []
    ww, wh, word = trace(WORD_BOX, 0.3, word_loops)
    tw, th, tag = trace(TAG_BOX, 0.18, tag_loops)

    def write(name, content):
        with open(os.path.join(OUT, name), 'w') as f:
            f.write(content)

    mark = f'<path d="{MARK}"/>'
    write('mark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {MARK_W} {MARK_H}" fill="{INK}"><title>Autocolor</title>{mark}</svg>\n')
    write('wordmark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ww} {wh}" fill="{INK}"><title>autocolor</title><path fill-rule="evenodd" d="{word}"/></svg>\n')

    # Stacked lockup, as supplied: mark over wordmark over tagline, all in
    # source coordinates so the proportions are the original ones.
    mx, my = MARK_BOX
    x0 = min(TAG_BOX[0], WORD_BOX[0])
    x1 = max(TAG_BOX[2], WORD_BOX[2])
    y0 = my - 4
    y1 = TAG_BOX[3]
    stacked = (f'<g transform="translate({mx - x0} {my - y0})">{mark}</g>'
               f'<path fill-rule="evenodd" transform="translate({WORD_BOX[0] - x0} {WORD_BOX[1] - y0})" d="{word}"/>'
               f'<path fill-rule="evenodd" transform="translate({TAG_BOX[0] - x0} {TAG_BOX[1] - y0})" d="{tag}"/>')
    for suffix, colour in (('', INK), ('-white', '#FFFFFF')):
        write(f'lockup-stacked{suffix}.svg',
              f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x1 - x0} {y1 - y0}" fill="{colour}">'
              f'<title>Autocolor — Laboratorio de Matizado y Pintado al Horno</title>{stacked}</svg>\n')

    # Horizontal lockup for headers: the mark at the wordmark's full height
    # (ascender to baseline), then the wordmark after a gap of one blade.
    scale = (wh - 12) / MARK_H
    gap = 40
    mw = MARK_W * scale
    horiz = (f'<path transform="translate(0 6) scale({scale:.5f})" d="{MARK}"/>'
             f'<path fill-rule="evenodd" transform="translate({mw + gap:.2f} 0)" d="{word}"/>')
    for suffix, colour in (('', INK), ('-white', '#FFFFFF')):
        write(f'lockup-horizontal{suffix}.svg',
              f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {mw + gap + ww:.2f} {wh}" fill="{colour}">'
              f'<title>Autocolor</title>{horiz}</svg>\n')
    # Favicons: the mark alone, no background. The SVG follows the browser's
    # theme with its own media query: ink on a light tab strip, white on a
    # dark one (Chrome, Edge, Firefox). Browsers that don't take SVG icons get
    # the ICO, in ink. The home-screen icon needs a solid ground, so it is the
    # white mark on ink.
    mark = mark_loops()
    write('favicon.svg',
          f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -8 312 313">'
          f'<style>path{{fill:{INK}}}@media (prefers-color-scheme:dark){{path{{fill:#FFFFFF}}}}</style>'
          f'<path d="{MARK}"/></svg>\n')
    icons = [raster([(mark, 0, 0)], (n, n), (MARK_W, MARK_H), INK, pad=0.04) for n in (16, 32, 48)]
    icons[-1].save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)], append_images=icons[:-1])
    raster([(mark, 0, 0)], (180, 180), (MARK_W, MARK_H), '#FFFFFF', ground=(38, 45, 64, 255), pad=0.2) \
        .save(os.path.join(OUT, 'apple-touch-icon.png'))

    # Email logos: the stacked lockup, 480 px wide for a 240 px slot on
    # retina screens, ink for light clients and white for dark ones.
    sx = min(TAG_BOX[0], WORD_BOX[0])
    sy = MARK_BOX[1] - 4
    sw = max(TAG_BOX[2], WORD_BOX[2]) - sx
    sh = TAG_BOX[3] - sy
    stacked_shapes = [(mark, MARK_BOX[0] - sx, MARK_BOX[1] - sy),
                      (word_loops, WORD_BOX[0] - sx, WORD_BOX[1] - sy),
                      (tag_loops, TAG_BOX[0] - sx, TAG_BOX[1] - sy)]
    size = (480, round(480 * sh / sw))
    raster(stacked_shapes, size, (sw, sh), INK).save(os.path.join(OUT, 'logo-email.png'))
    raster(stacked_shapes, size, (sw, sh), '#FFFFFF').save(os.path.join(OUT, 'logo-email-white.png'))

    # Social preview: the stacked lockup centred on paper at 1200x630.
    raster(stacked_shapes, (1200, 630), (sw, sh), INK, ground=(255, 255, 255, 255), pad=0.2) \
        .convert('RGB').save(os.path.join(OUT, 'og-image.png'))
    print('wordmark', ww, wh, len(word), 'tagline', tw, th, len(tag))


if __name__ == '__main__':
    main()
