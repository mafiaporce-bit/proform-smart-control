# Builds the web-sized park textures from the Poly Haven (CC0) files Jim downloaded.
# usage: python3 -I mktex.py <tex2 folder> <output folder>
import sys, math, numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(20261122)
def load(p, mode='RGB'): return np.array(Image.open(src + '/' + p).convert(mode))
def save_jpg(a, name, q=86): Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f'{out}/{name}', quality=q, optimize=True, progressive=True)
def save_webp(a, name, q=88): Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f'{out}/{name}', quality=q, method=6)
def resize(a, s): return cv2.resize(a, (s, s), interpolation=cv2.INTER_AREA)
def grade(a, sat=1.0, val=1.0, hue=0, tint=(1, 1, 1)):
    hsv = cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[..., 0] = (hsv[..., 0] + hue) % 180; hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255); hsv[..., 2] = np.clip(hsv[..., 2] * val, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB).astype(np.float32) * np.array(tint, np.float32)
def seamless(a):
    # blend the picture with a half-shifted copy so opposite edges match
    h, w = a.shape[:2]; a = a.astype(np.float32)
    b = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    y, x = np.mgrid[0:h, 0:w]
    m = np.minimum(np.minimum(x, w - 1 - x) / (w * 0.22), np.minimum(y, h - 1 - y) / (h * 0.22)); m = np.clip(m, 0, 1); m = m * m * (3 - 2 * m)
    return a * m[..., None] + b * (1 - m[..., None])
def flatten(a, sigma=70):
    a = a.astype(np.float32); low = cv2.GaussianBlur(a, (0, 0), sigma); return a / np.maximum(low, 1) * low.reshape(-1, 3).mean(0)

# ---------------- sky ----------------
pano = load('sky/park_bench_sky.jpg'); H, W = pano.shape[:2]
small = cv2.resize(pano, (2048, 1024), interpolation=cv2.INTER_AREA).astype(np.float32)
h, w = small.shape[:2]; hz = h // 2
lum = small.sum(2) / 3
# The photo was taken in winter, with bare trees up to about 32 degrees above the horizon. Keep the real
# sky above them and continue each column down to a hazy horizon, then put the sun's glow back.
y0 = int(h * 0.305)
base = cv2.blur(np.concatenate([small[y0 - 12:y0, -300:], small[y0 - 12:y0], small[y0 - 12:y0, :300]], 1), (201, 1))[:, 300:-300].mean(0)
sky = small.copy()
sun_u, sun_v = 0.897, 0.3945
du = np.abs(np.arange(w) / w - sun_u); du = np.minimum(du, 1 - du)
warm = np.exp(-(du / 0.11) ** 2)[:, None]
t = (np.linspace(0, 1, hz - y0) ** 1.25)[:, None, None]
haze = np.array([200, 218, 236], np.float32)[None, :] * (1 - warm) + np.array([246, 240, 226], np.float32)[None, :] * warm
sky[y0:hz] = base[None] * (1 - t * 0.8) + haze[None] * (t * 0.8)
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
dxs = np.abs(xx / w - sun_u); dxs = np.minimum(dxs, 1 - dxs) * 2 * np.pi * np.cos((0.5 - sun_v) * np.pi); dys = (yy / h - sun_v) * np.pi
ang = np.hypot(dxs, dys)
glow = (0.95 * np.exp(-(ang / 0.035) ** 2) + 0.55 * np.exp(-(ang / 0.12) ** 2) + 0.22 * np.exp(-(ang / 0.33) ** 2))[..., None]
sky = sky + (np.array([255, 250, 232], np.float32) - sky) * np.clip(glow, 0, 1)
sky[y0 - 30:y0 + 30] = cv2.GaussianBlur(sky, (0, 0), 7)[y0 - 30:y0 + 30] * 0.6 + sky[y0 - 30:y0 + 30] * 0.4
horizon = sky[hz - 14:hz - 2].reshape(-1, 3).mean(0)
sky[hz:] = horizon
print('horizon colour', horizon.round().tolist())
save_jpg(sky, 'sky.jpg', 88)
env = cv2.resize(sky, (512, 256), interpolation=cv2.INTER_AREA)
env[128:] = np.array([34, 60, 70], np.float32)        # below the horizon: dark green, like a far bank and lawn
env[124:132] = cv2.blur(env, (1, 15))[124:132]
save_jpg(env, 'env.jpg', 85)

# ---------------- lawn from the same panorama ----------------
def ground_patch(az_deg, near, far, width, px):
    hh = 1.6; zs = np.linspace(far, near, px); xs = np.linspace(-width / 2, width / 2, px); X, Z = np.meshgrid(xs, zs)
    az = np.radians(az_deg) + np.arctan2(X, Z); dep = np.arctan2(hh, np.hypot(X, Z)); u = (az / (2 * np.pi)) % 1.0; v = 0.5 + dep / np.pi
    return cv2.remap(pano, (u * W).astype(np.float32), (v * H).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
lawn = ground_patch(291, 2.3, 4.5, 2.2, 1024)
lawn = flatten(lawn, 60)
lawn = grade(lawn, sat=1.12, val=0.9, hue=11, tint=(0.9, 1.0, 0.96))
lawn = seamless(lawn)
save_jpg(lawn, 'grass.jpg', 86)

# ---------------- ground and path ----------------
gravel = load('ground/path_trail_diff.jpg')
asphalt = grade(flatten(gravel, 90), sat=0.16, val=0.5, tint=(0.98, 1.0, 1.04))
save_jpg(asphalt, 'asphalt.jpg', 84)
save_jpg(resize(load('ground/path_trail_nor.jpg'), 512), 'asphalt_n.jpg', 84)
save_jpg(resize(grade(load('ground/path_stone_diff.jpg'), sat=0.7, val=0.95), 512), 'kerb.jpg', 84)
save_jpg(resize(grade(load('ground/forest_diff.jpg'), sat=0.9, val=0.62), 512), 'mulch.jpg', 82)
save_jpg(resize(grade(load('ground/rock_diff.jpg'), sat=0.55, val=0.95, tint=(0.97, 1, 1.02)), 512), 'rock.jpg', 84)
save_jpg(resize(load('ground/rock_nor.jpg'), 512), 'rock_n.jpg', 84)
save_jpg(resize(grade(load('trees/branch_diff.jpg'), sat=0.9, val=0.8, tint=(1.03, 1, 0.94)), 512), 'bark.jpg', 84)
save_jpg(resize(load('trees/branch_nor.jpg'), 512), 'bark_n.jpg', 84)
save_jpg(resize(grade(load('trees/fir_bark_diff.jpg'), val=0.85), 256), 'firbark.jpg', 82)

# ---------------- leaves: clusters built from the single-leaf photos ----------------
def cutouts(rgb, alpha, min_area, reject=lambda x, y, w, h: False):
    n, lab, stats, _ = cv2.connectedComponentsWithStats((alpha > 110).astype(np.uint8), 8)
    res = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < min_area or reject(x, y, ww, hh): continue
        m = (lab[y:y + hh, x:x + ww] == i).astype(np.float32)
        m = cv2.GaussianBlur(m, (0, 0), 0.8)
        res.append(np.dstack([rgb[y:y + hh, x:x + ww].astype(np.float32), m * 255]))
    return res
def paste(canvas, sprite, cx, cy, length, angle, bright=1.0, hue=0, sat=1.0):
    # sprite points up (tip at the top). length = pixel height after scaling.
    sh, sw = sprite.shape[:2]; s = length / sh
    rgb = grade(sprite[..., :3], sat=sat, val=bright, hue=hue)
    spr = np.dstack([rgb, sprite[..., 3]])
    M = cv2.getRotationMatrix2D((sw / 2, sh / 2), math.degrees(angle), s)
    d = int(math.hypot(sw, sh) * s) + 4
    M[0, 2] += d / 2 - sw / 2; M[1, 2] += d / 2 - sh / 2
    rot = cv2.warpAffine(spr, M, (d, d), flags=cv2.INTER_AREA if s < 0.6 else cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    x0, y0 = int(cx - d / 2), int(cy - d / 2); Hc, Wc = canvas.shape[:2]
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(Wc, x0 + d), min(Hc, y0 + d)
    if xa >= xb or ya >= yb: return
    part = rot[ya - y0:yb - y0, xa - x0:xb - x0]; a = part[..., 3:4] / 255
    reg = canvas[ya:yb, xa:xb]
    reg[..., :3] = reg[..., :3] * (1 - a) + part[..., :3] * a
    reg[..., 3:4] = np.maximum(reg[..., 3:4], part[..., 3:4])
leaf_rgb = load('trees/leaf_diff.jpg')
la = np.array(Image.open(src + '/trees/leaf_alpha.png')).astype(np.float32); la = la / la.max() * 255
leaves = cutouts(leaf_rgb, la, 6000)
print('leaf cut-outs', len(leaves), [l.shape[:2] for l in leaves])
def cluster(S, n_leaves, seed):
    rg = np.random.default_rng(seed); c = np.zeros((S, S, 4), np.float32)
    clumps = [(S / 2 + rg.uniform(-.34, .34) * S, S / 2 + rg.uniform(-.34, .34) * S, rg.uniform(.1, .17) * S) for _ in range(13)]
    for (cx, cy, rr) in clumps:      # a few twigs
        cv2.line(c, (S // 2, S // 2), (int(cx), int(cy)), (52, 40, 30, 255), max(2, S // 260), cv2.LINE_AA)
    items = []
    for _ in range(n_leaves):
        cx, cy, rr = clumps[rg.integers(len(clumps))]
        a = rg.uniform(0, 2 * math.pi); d = rr * math.sqrt(rg.uniform(0, 1)) * 1.15
        items.append((cx + math.cos(a) * d, cy + math.sin(a) * d * 0.9, rg.uniform(0, 1)))
    items.sort(key=lambda t: t[2])
    for (x, y, l) in items:
        paste(c, leaves[rg.integers(len(leaves))], x, y, S * rg.uniform(0.045, 0.066), rg.uniform(0, 2 * math.pi),
              bright=0.42 + 0.72 * l ** 1.3, hue=rg.uniform(4, 13), sat=rg.uniform(1.05, 1.35))
    edge = int(S * 0.03); c[:edge] = 0; c[-edge:] = 0; c[:, :edge] = 0; c[:, -edge:] = 0
    return c
atlas = np.zeros((2048, 2048, 4), np.float32)
for k in range(4):
    atlas[(k // 2) * 1024:(k // 2 + 1) * 1024, (k % 2) * 1024:(k % 2 + 1) * 1024] = cluster(1024, [900, 820, 960, 760][k], 100 + k)
# colour bleed under the transparent parts so edges do not go dark when the picture is shrunk
def bleed(img):
    a = img[..., 3] / 255; rgb = img[..., :3] * a[..., None]
    for sgm in (4, 16, 64):
        num = cv2.GaussianBlur(rgb, (0, 0), sgm); den = cv2.GaussianBlur(a, (0, 0), sgm)[..., None]
        fill = num / np.maximum(den, 1e-4)
        hole = (img[..., 3:4] < 8) & (den > 0.002)
        img[..., :3] = np.where(hole, fill, img[..., :3])
    low = img[..., 3] < 8; far = low & (img[..., :3].sum(-1) == 0)
    img[far, :3] = np.array([60, 92, 40], np.float32)
    return img
save_webp(bleed(atlas), 'leaves.webp', 86)

# ---------------- fir bough built from the twig photos ----------------
fir_rgb = load('trees/fir_twig_diff.jpg'); fa = load('trees/fir_twig_alpha.png', 'L').astype(np.float32)
twigs = cutouts(fir_rgb, fa, 9000, reject=lambda x, y, ww, hh: x < 120 or y + hh > 880 or ww > 700)
print('fir twigs', len(twigs), [t.shape[:2] for t in twigs])
S = 512; fir = np.zeros((S, S, 4), np.float32); rg = np.random.default_rng(7)
fan = []
for k in range(26):
    t = rg.uniform(0.05, 1) ; ang = rg.uniform(-1, 1) * 0.75
    by = S - 6 - t * (S * 0.62); bx = S / 2 + math.sin(ang) * t * S * 0.36
    fan.append((bx, by, ang, rg.uniform(0, 1)))
fan.sort(key=lambda t: t[3])
cv2.line(fir, (S // 2, S - 2), (S // 2, int(S * 0.3)), (48, 36, 26, 255), 5, cv2.LINE_AA)
for (bx, by, ang, l) in fan:
    L = S * rg.uniform(0.3, 0.42)
    paste(fir, twigs[rg.integers(len(twigs))], bx + math.sin(ang) * L * 0.42, by - math.cos(ang) * L * 0.42, L, -ang, bright=0.5 + 0.55 * l, hue=rg.uniform(0, 5), sat=1.1)
save_webp(bleed(fir), 'fir.webp', 86)

# ---------------- generated (not photos): flower heads and water ripples ----------------
S = 256; bloom = np.zeros((S, S, 4), np.float32); rg = np.random.default_rng(11)
fl = []
for _ in range(210):
    a = rg.uniform(0, 2 * math.pi); d = math.sqrt(rg.uniform(0, 1)) * S * 0.43
    fl.append((S / 2 + math.cos(a) * d, S / 2 + math.sin(a) * d * 0.92, rg.uniform(0, 1)))
fl.sort(key=lambda t: t[2])
for (x, y, l) in fl:
    shade = 0.62 + 0.38 * l - 0.16 * (y / S)            # darker low down, as if lit from above
    col = (255 * shade, 252 * shade, 255 * shade, 255)
    rr = rg.uniform(4.5, 7.5); rot = rg.uniform(0, math.pi)
    for p in range(4):
        aa = rot + p * math.pi / 2
        cv2.ellipse(bloom, (int(x + math.cos(aa) * rr * 0.75), int(y + math.sin(aa) * rr * 0.75)), (int(rr * 0.8), int(rr * 0.62)), math.degrees(aa), 0, 360, col, -1, cv2.LINE_AA)
    cv2.circle(bloom, (int(x), int(y)), 1, (150 * shade, 140 * shade, 120 * shade, 255), -1, cv2.LINE_AA)
save_webp(bleed(bloom), 'bloom.webp', 88)
# water ripple normal map from tiling noise
S = 512; yy, xx = np.mgrid[0:S, 0:S].astype(np.float32); hgt = np.zeros((S, S), np.float32)
for _ in range(90):          # many small waves in random directions: tiles, but with no visible grid
    fx, fy = int(rg.integers(-22, 23)), int(rg.integers(-22, 23)); f = math.hypot(fx, fy)
    if f < 7: continue
    hgt += (1.0 / f ** 0.6) * np.sin(2 * math.pi * (fx * xx + fy * yy) / S + rg.uniform(0, 6.28))
hgt *= 5
dx = np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1); dy = np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)
nrm = np.dstack([-dx * 1.6, -dy * 1.6, np.ones_like(hgt)]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
save_jpg((nrm * 0.5 + 0.5) * 255, 'water_n.jpg', 88)
print('done')
