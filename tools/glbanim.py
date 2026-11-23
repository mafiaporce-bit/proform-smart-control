import sys, json, struct, io
import numpy as np
from PIL import Image
p = sys.argv[1]
b = open(p, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20+jl])
bin0 = 20 + jl + 8
acc, bv, nodes = j['accessors'], j['bufferViews'], j['nodes']
CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
NC = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16, 'VEC2': 2}
def read(ai):
    a = acc[ai]; v = bv[a['bufferView']]; fmt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0); stride = v.get('byteStride', sz*n)
    if stride == sz*n:
        return np.frombuffer(b, dtype='<'+fmt, count=a['count']*n, offset=off).reshape(a['count'], n).astype(float)
    return np.array([struct.unpack_from('<'+fmt*n, b, off+i*stride) for i in range(a['count'])], float)
for i, im in enumerate(j['images']):
    v = bv[im['bufferView']]; d = b[bin0+v.get('byteOffset',0): bin0+v.get('byteOffset',0)+v['byteLength']]
    img = Image.open(io.BytesIO(d)); print('image', i, im.get('name'), img.size, img.mode, v['byteLength'])
print('nodes:', [(i, n.get('name')) for i, n in enumerate(nodes) if 'mesh' in n])
names = [n.get('name', '') for n in nodes]
print('joints:', [names[k] for k in j['skins'][0]['joints']])
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []): parent[c] = i
def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def local(T, R, S):
    m = np.eye(4); m[:3, :3] = quat_to_mat(R) * np.array(S); m[:3, 3] = T; return m
base = {i: (np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float), np.array(n.get('scale', [1, 1, 1]), float)) for i, n in enumerate(nodes)}
def sample(times, vals, t):
    if t <= times[0]: return vals[0]
    if t >= times[-1]: return vals[-1]
    k = np.searchsorted(times, t) - 1; f = (t - times[k]) / (times[k+1] - times[k])
    a, c = vals[k], vals[k+1]
    if len(a) == 4:
        if np.dot(a, c) < 0: c = -c
        q = a*(1-f) + c*f; return q/np.linalg.norm(q)
    return a*(1-f) + c*f
def find(*keys):
    for i, n in enumerate(names):
        l = n.lower()
        if all(k in l for k in keys): return i
    return None
foot = {'.l': names.index('ball_l'), '.r': names.index('ball_r')}
toe = {'.l': names.index('foot_l'), '.r': names.index('foot_r')}
hips = names.index('Root')
print('foot', {k: names[v] if v is not None else None for k, v in foot.items()}, 'toe', {k: names[v] if v is not None else None for k, v in toe.items()}, 'root-ish', names[hips] if hips is not None else None, 'pelvis', names[find('pelvis')] if find('pelvis') is not None else None)
for a in j['animations']:
    ch = {}
    for c in a['channels']:
        s = a['samplers'][c['sampler']]; o = read(s['output']); o = o[1::3] if s.get('interpolation') == 'CUBICSPLINE' else o; ch[(c['target']['node'], c['target']['path'])] = (read(s['input']).ravel(), o, s.get('interpolation', 'LINEAR'))
    dur = max(v[0][-1] for v in ch.values()); interp = {v[2] for v in ch.values()}; nkeys = max(len(v[0]) for v in ch.values())
    def world(node, t, cache):
        if node in cache: return cache[node]
        T, R, S = base[node]
        if (node, 'translation') in ch: T = sample(ch[(node, 'translation')][0], ch[(node, 'translation')][1], t)
        if (node, 'rotation') in ch: R = sample(ch[(node, 'rotation')][0], ch[(node, 'rotation')][1], t)
        if (node, 'scale') in ch: S = sample(ch[(node, 'scale')][0], ch[(node, 'scale')][1], t)
        m = local(T, R, S)
        if node in parent: m = world(parent[node], t, cache) @ m
        cache[node] = m; return m
    N = 240; ts = np.linspace(0, dur, N, endpoint=False)
    P = {k: [] for k in ('fl', 'fr', 'root', 'pel')}
    pel = names.index('pelvis')
    for t in ts:
        c = {}
        P['fl'].append(world(foot['.l'], t, c)[:3, 3]); P['fr'].append(world(foot['.r'], t, c)[:3, 3])
        P['root'].append(world(names.index('Root'), t, c)[:3, 3]); P['pel'].append(world(pel, t, c)[:3, 3])
    P = {k: np.array(v) for k, v in P.items()}
    dt = dur / N
    out = []
    for k in ('fl', 'fr'):
        y = P[k][:, 1]; z = P[k][:, 2]
        vz = (np.roll(z, -1) - np.roll(z, 1)) / (2*dt)
        ground = y < (y.min() + 0.02)
        out.append((round(float(-np.median(vz[ground])), 3), round(float(z.max()-z.min()), 3), round(float(y.max()-y.min()), 3), int(ground.sum())))
    print(f"{a['name']:14s} dur {dur:.3f} keys {nkeys} {interp}  rootjoint drift xyz {np.round(P['root'][-1]-P['root'][0], 3)}  pelvis z-range {P['pel'][:,2].max()-P['pel'][:,2].min():.3f} y-bob {P['pel'][:,1].max()-P['pel'][:,1].min():.3f} x-sway {P['pel'][:,0].max()-P['pel'][:,0].min():.3f}")
    zl = P['fl'][:,2]; zr = P['fr'][:,2]
    both = int(((P['fl'][:,1] < P['fl'][:,1].min()+0.02) & (P['fr'][:,1] < P['fr'][:,1].min()+0.02)).sum())
    none = int(((P['fl'][:,1] > P['fl'][:,1].min()+0.02) & (P['fr'][:,1] > P['fr'][:,1].min()+0.02)).sum())
    print(f"    root scale 1.143 applied? foot y min {P['fl'][:,1].min():.3f}; both feet down {both}/240, both feet up (flight) {none}/240")
    if a['name'] in ('Walk_Relaxed','Walk_Brisk','Jog','Run'):
        for nm, key in (('ball', 'fl'),):
            z = P[key][:,2]; y = P[key][:,1]; vz = (np.roll(z,-1)-np.roll(z,1))/(2*dt)
            print('     t    ' + ' '.join(f'{ts[i]:5.2f}' for i in range(0, N, 10)))
            print('     z    ' + ' '.join(f'{z[i]:5.2f}' for i in range(0, N, 10)))
            print('     y    ' + ' '.join(f'{y[i]:5.2f}' for i in range(0, N, 10)))
            print('     vz   ' + ' '.join(f'{vz[i]:5.2f}' for i in range(0, N, 10)))
            neg = vz < 0
            # longest run of backward motion = stance; its travel/time = ground speed with no sliding
            idx = np.where(neg)[0]
            travel = z[idx].max() - z[idx].min(); T = len(idx) * dt
            # plateau speed: median of backward speeds in the middle half of the backward phase
            mid = np.sort(-vz[idx])[len(idx)//4: 3*len(idx)//4]
            print(f'     backward phase {T:.2f}s ({len(idx)}/240), travel {travel:.3f} m, mean {travel/T:.2f} m/s = {travel/T*3.6:.2f} km/h, plateau median {np.median(mid):.2f} m/s = {np.median(mid)*3.6:.2f} km/h, pelvis height {P["pel"][:,1].mean():.2f}')
    for k, o in zip(('L', 'R'), out):
        print(f"    foot {k}: stance backward speed {o[0]} m/s = {o[0]*3.6:.2f} km/h | z-range {o[1]} m | lift {o[2]} m | stance samples {o[3]}/240")
