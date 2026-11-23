# Makes a phone-friendly copy of a GLB: shrinks the embedded textures and
# rewrites the binary chunk. Geometry, skeleton and animations are copied
# byte for byte.
import sys, json, struct, io, hashlib
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20+jl]); bin0 = 20 + jl + 8
bv = j['bufferViews']
# target max size per image name; anything else is left alone
RULES = {'female_casualsuit01_normal': (1024, 'JPEG'), 'young_lightskinned_female_diffuse3': (1024, 'JPEG'), 'ponytail01_diffuse': (1024, 'PNG'), 'teeth': (256, 'PNG'), 'brown_eye': (256, 'PNG')}
new_data = {}
for i, im in enumerate(j['images']):
    v = bv[im['bufferView']]; raw = b[bin0+v.get('byteOffset', 0): bin0+v.get('byteOffset', 0)+v['byteLength']]
    rule = RULES.get(im.get('name'))
    if not rule: continue
    size, fmt = rule
    img = Image.open(io.BytesIO(raw))
    if max(img.size) > size: img = img.resize((size, size), Image.LANCZOS)
    out = io.BytesIO()
    if fmt == 'JPEG': img.convert('RGB').save(out, 'JPEG', quality=90, subsampling=0, optimize=True); im['mimeType'] = 'image/jpeg'
    else: img.save(out, 'PNG', optimize=True)
    new_data[im['bufferView']] = out.getvalue()
    print(f"  {im.get('name'):38s} {v['byteLength']:>8} -> {len(out.getvalue()):>8}  {img.size} {fmt}")
# rebuild the binary chunk, keeping view order and 4-byte alignment
order = sorted(range(len(bv)), key=lambda k: bv[k].get('byteOffset', 0))
blob = bytearray(); hashes = {}
for k in order:
    v = bv[k]; data = new_data.get(k, b[bin0+v.get('byteOffset', 0): bin0+v.get('byteOffset', 0)+v['byteLength']])
    while len(blob) % 4: blob.append(0)
    if k not in new_data: hashes[k] = hashlib.md5(data).hexdigest()
    v['byteOffset'] = len(blob); v['byteLength'] = len(data); blob += data
while len(blob) % 4: blob.append(0)
j['buffers'][0]['byteLength'] = len(blob)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + 8 + len(blob)
open(dst, 'wb').write(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(blob), b'BIN\x00') + bytes(blob))
print('written', dst, total, 'bytes (was', len(b), ')')
# verify: every non-image view is byte-identical in the new file
nb = open(dst, 'rb').read(); njl = struct.unpack('<I', nb[12:16])[0]; nj = json.loads(nb[20:20+njl]); nbin = 20 + njl + 8
bad = 0
for k, h in hashes.items():
    v = nj['bufferViews'][k]
    if hashlib.md5(nb[nbin+v['byteOffset']: nbin+v['byteOffset']+v['byteLength']]).hexdigest() != h: bad += 1
print('non-image views checked', len(hashes), 'mismatches', bad, '| declared length ok', struct.unpack('<I', nb[8:12])[0] == len(nb))
for im in nj['images']:
    v = nj['bufferViews'][im['bufferView']]; Image.open(io.BytesIO(nb[nbin+v['byteOffset']: nbin+v['byteOffset']+v['byteLength']])).load()
print('all', len(nj['images']), 'images decode')
