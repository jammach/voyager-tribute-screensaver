import numpy as np, OpenEXR, Imath
from PIL import Image
from scipy import ndimage as ndi
import os; ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
exr = OpenEXR.InputFile(ROOT + r"\tools\cache\starmap.exr")
dw = exr.header()["dataWindow"]; w, h = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
pt = Imath.PixelType(Imath.PixelType.FLOAT)
img = np.stack([np.frombuffer(exr.channel(c, pt), np.float32).reshape(h, w) for c in "RGB"], -1)
# star removal: opening with a circular footprint, then a soft blur
r = 4
yy, xx = np.mgrid[-r:r+1, -r:r+1]; disk = (xx**2 + yy**2) <= r*r
out = np.empty_like(img)
for c in range(3):
    o = ndi.grey_opening(img[..., c], footprint=disk)
    o = ndi.gaussian_filter(o, 1.6)
    out[..., c] = o
out = np.clip(out, 0, None)
lum = out.mean(-1, keepdims=True)
out = lum + (out - lum) * 0.55          # tone down the orange cast of the dust
ref = float(np.percentile(out, 99.5))
enc = np.clip(out / ref, 0, 1) ** (1/2.2)
Image.fromarray((enc*255).astype(np.uint8)).save(ROOT + r"\web\tex\milkyway.jpg", quality=90)
open(ROOT + r"\web\data\milkyway.json", "w").write('{"ref": %.6f}' % ref)
print("ok", ref)
