import sys, json, struct
p = sys.argv[1]
b = open(p, 'rb').read()
magic, ver, length = struct.unpack('<4sII', b[:12])
print('magic', magic, 'version', ver, 'declared', length, 'actual', len(b))
off = 12; chunks = []
while off < len(b):
    clen, ctype = struct.unpack('<I4s', b[off:off+8]); chunks.append((ctype, off+8, clen)); off += 8 + clen
print('chunks', [(c[0], c[2]) for c in chunks])
j = json.loads(b[chunks[0][1]:chunks[0][1]+chunks[0][2]])
json.dump(j, open(sys.argv[2], 'w'))
print('asset', j.get('asset'))
print('extensionsUsed', j.get('extensionsUsed'), 'required', j.get('extensionsRequired'))
print('scenes', len(j.get('scenes', [])), 'nodes', len(j['nodes']), 'meshes', len(j.get('meshes', [])), 'skins', len(j.get('skins', [])), 'materials', len(j.get('materials', [])), 'textures', len(j.get('textures', [])), 'images', len(j.get('images', [])))
acc = j['accessors']; bv = j['bufferViews']
tri = 0
for m in j.get('meshes', []):
    for pr in m['primitives']:
        n = acc[pr['indices']]['count'] // 3 if 'indices' in pr else acc[pr['attributes']['POSITION']]['count'] // 3
        tri += n
        a = acc[pr['attributes']['POSITION']]
        print(' mesh', m.get('name'), 'tris', n, 'verts', a['count'], 'min', [round(x, 2) for x in a.get('min', [])], 'max', [round(x, 2) for x in a.get('max', [])], 'attrs', sorted(pr['attributes'].keys()), 'targets', len(pr.get('targets', [])))
print('total tris', tri)
for i, im in enumerate(j.get('images', [])):
    v = bv[im['bufferView']] if 'bufferView' in im else None
    print(' image', i, im.get('name'), im.get('mimeType'), v['byteLength'] if v else im.get('uri', '')[:40])
for m in j.get('materials', []):
    print(' material', m.get('name'), list(m.keys()), m.get('alphaMode'), m.get('doubleSided'))
for s in j.get('skins', []):
    print(' skin', s.get('name'), 'joints', len(s['joints']))
for a in j.get('animations', []):
    tmax = max(acc[s['input']]['max'][0] for s in a['samplers'])
    paths = {}
    for c in a['channels']: paths[c['target']['path']] = paths.get(c['target']['path'], 0) + 1
    print(' anim', repr(a.get('name')), 'dur', round(tmax, 3), 'channels', paths)
print('scene root nodes', [(n, j['nodes'][n].get('name'), {k: j['nodes'][n].get(k) for k in ('rotation', 'scale', 'translation') if k in j['nodes'][n]}) for n in j['scenes'][j.get('scene', 0)]['nodes']])
