"""Prepare sky data: star catalog binary + star-free Milky Way map."""
import csv, math, struct, sys
import numpy as np
import OpenEXR, Imath
from PIL import Image
from scipy import ndimage as ndi

import os; ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# ---- stars -------------------------------------------------------------
rows = []
with open(ROOT + r"\tools\cache\hyg.csv", newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["id"] == "0":
            continue
        try:
            ra = float(r["ra"]) * 15.0 * math.pi / 180
            dec = float(r["dec"]) * math.pi / 180
            mag = float(r["mag"])
        except ValueError:
            continue
        ci = float(r["ci"]) if r["ci"] else 0.6
        rows.append((ra, dec, mag, ci))
rows.sort(key=lambda t: t[2])
arr = np.zeros((len(rows), 5), np.float32)
for i, (ra, dec, mag, ci) in enumerate(rows):
    arr[i] = (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec), mag, ci)
arr.tofile(ROOT + r"\web\data\stars.bin")
print("stars", len(rows), "faintest", rows[-1][2])

# ---- milky way ---------------------------------------------------------
exr = OpenEXR.InputFile(ROOT + r"\tools\cache\starmap.exr")
dw = exr.header()["dataWindow"]
w, h = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
pt = Imath.PixelType(Imath.PixelType.FLOAT)
ch = [np.frombuffer(exr.channel(c, pt), np.float32).reshape(h, w) for c in "RGB"]
img = np.stack(ch, -1)
print("exr", w, h, img.min(), img.max(), img.mean())

# remove point stars: grey opening, then smooth
lum = img.mean(-1)
out = np.empty_like(img)
for c in range(3):
    ch_ = ndi.grey_opening(img[..., c], size=(7, 7))
    ch_ = ndi.gaussian_filter(ch_, 1.5)
    out[..., c] = ch_
out = np.clip(out, 0, None)
# downsample to 2048x1024
small = np.stack([np.asarray(Image.fromarray(out[..., c]).resize((2048, 1024), Image.BILINEAR)) for c in range(3)], -1)
# perceptual encode (the shader decodes with pow(x, 2.2) * scale)
ref = np.percentile(small, 99.5)
enc = np.clip(small / ref, 0, 1) ** (1 / 2.2)
Image.fromarray((enc * 255).astype(np.uint8)).save(ROOT + r"\web\tex\milkyway.jpg", quality=92)
with open(ROOT + r"\web\data\milkyway.json", "w") as f:
    f.write('{"ref": %.6f}' % ref)
Image.fromarray((np.clip(img / np.percentile(img, 99.8), 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).resize((1024, 512)).save(
    ROOT + r"\tools\cache\preview_full.jpg")
print("done")
