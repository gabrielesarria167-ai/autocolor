#!/usr/bin/env python3
"""Genera la máscara de chapa del vehículo del hero (index.html).

    python3 tools/build-paint-mask.py

Lee imgs/assets/suv.png y escribe imgs/assets/suv-paint-mask.png: un PNG del
mismo tamaño, blanco, cuyo canal alfa vale 1 sobre la carrocería pintable y 0
sobre cristales, neumáticos, llantas, cromados, faros, placa y logo. Es lo que
recorta las dos capas de color del hero (ver .hero__vehicle-paint en
styles.css).

Por qué hace falta un archivo y no basta con la foto: antes la máscara era la
foto misma en modo luminancia, que solo distingue claro de oscuro. La parrilla
cromada y los faros son claros, así que se pintaban igual que la chapa, y los
neumáticos salían de un rojo apagado en vez de negros.

Cómo distingue la chapa: en esta foto la carrocería beige es lo único de tono
cálido que hay: todo lo demás es gris neutro o negro. Así que basta con pedir
tono cálido, algo de saturación y no ser muy oscuro. Los umbrales son rampas y
no escalones para que el borde salga suave y no dentado.

Si se cambia la foto del hero hay que volver a ejecutar esto y mirar el
resultado: los umbrales están puestos para este beige y este fondo.
"""

import os
import sys

try:
    import numpy as np
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Faltan numpy y Pillow: pip3 install numpy Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "imgs", "assets", "suv.png")
TARGET = os.path.join(ROOT, "imgs", "assets", "suv-paint-mask.png")

np.seterr(all="ignore")


def hsl(rgb):
    """Tono en grados, saturación y luminosidad, cada uno como su propio plano."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    chroma = mx - mn
    light = (mx + mn) / 2
    den = np.where(light < 0.5, mx + mn, 2.0 - mx - mn)
    sat = np.divide(chroma, den, out=np.zeros_like(chroma), where=den > 1e-6)

    lit = chroma > 1e-6
    div = lambda x: np.divide(x, chroma, out=np.zeros_like(chroma), where=lit)
    hue = np.zeros_like(mx)
    hue = np.where(lit & (mx == r), div(g - b) % 6, hue)
    hue = np.where(lit & (mx == g), div(b - r) + 2, hue)
    hue = np.where(lit & (mx == b), div(r - g) + 4, hue)
    return hue * 60.0, sat, light


def ramp(x, lo, hi):
    return np.clip((x - lo) / (hi - lo), 0, 1)


def blur(plane, radius):
    img = Image.fromarray((np.clip(plane, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255.0


def main():
    if not os.path.exists(SOURCE):
        sys.exit("No está " + SOURCE)

    image = Image.open(SOURCE).convert("RGBA")
    data = np.asarray(image).astype(np.float32) / 255.0
    rgb, alpha = data[..., :3], data[..., 3]
    hue, sat, light = hsl(rgb)

    warm = np.minimum(ramp(hue, 4, 20), 1 - ramp(hue, 68, 92))
    raw = warm * ramp(sat, 0.035, 0.105) * ramp(light, 0.14, 0.30) * alpha

    # El beige es de saturación baja y el PNG trae ruido de compresión, así que
    # la medida cruda sale moteada. Un desenfoque promedia el ruido, un escalón
    # lo vuelve a endurecer y un segundo desenfoque deja el borde limpio.
    mask = blur(raw, 3.0)
    mask = ramp(mask, 0.22, 0.52)
    mask = mask * mask * (3 - 2 * mask)          # smoothstep
    mask = blur(mask, 1.5) * (alpha > 0.5)

    out = np.zeros((*mask.shape, 4), np.uint8)
    out[..., :3] = 255                            # el color da igual: solo se lee el alfa
    out[..., 3] = (mask * 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(TARGET, optimize=True)

    share = 100 * mask.sum() / max(alpha.sum(), 1)
    print("%s escrito — la chapa es el %.1f%% del vehículo" % (os.path.relpath(TARGET, ROOT), share))
    if not 30 <= share <= 55:
        sys.exit("La cobertura se salió de lo esperado (30-55%%): mira la máscara antes de usarla.")


if __name__ == "__main__":
    main()
