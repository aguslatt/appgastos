"""Procesa datos abiertos de CABA y genera src/mapdata.json (mapa vectorial propio).

Fuente: radios censales de la Ciudad Autónoma de Buenos Aires (INDEC / GCBA, datos abiertos),
tomados de https://bitsandbricks.github.io/data/CABA_rc.geojson
Uso: python3 scripts/build_map.py /ruta/a/CABA_rc.geojson
Necesita: pip install shapely
"""
import json, math, os, random, sys
from shapely.geometry import Polygon, MultiPolygon, Point, shape
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MAP_H = 940.0
SITES = ['PALERMO', 'CABALLITO', 'BELGRANO']  # barrios de los zooms
N_DOTS = 150

d = json.load(open(sys.argv[1]))
feats = d['features']
lons = [c[0] for f in feats for poly in f['geometry']['coordinates'] for ring in poly for c in ring]
lats = [c[1] for f in feats for poly in f['geometry']['coordinates'] for ring in poly for c in ring]
lon_w, lon_e, lat_s, lat_n = min(lons), max(lons), min(lats), max(lats)
cos = math.cos(math.radians((lat_s + lat_n) / 2))
K = MAP_H / (lat_n - lat_s)
W = (lon_e - lon_w) * cos * K

def prj(c):
    return ((c[0] - lon_w) * cos * K, (lat_n - c[1]) * K)

def to_poly(g):
    polys = []
    for poly in g['coordinates']:
        rings = [[prj(c) for c in ring] for ring in poly]
        p = Polygon(rings[0], rings[1:])
        if not p.is_valid:
            p = p.buffer(0)
        polys.append(p)
    return unary_union(polys)

radios = []
for f in feats:
    p = to_poly(f['geometry']).simplify(0.25, preserve_topology=True)
    if p.is_empty:
        continue
    radios.append((f['properties'], p))
print('radios', len(radios))

def rings_of(g):
    polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    for p in polys:
        if p.is_empty:
            continue
        yield list(p.exterior.coords)
        for h in p.interiors:
            yield list(h.coords)

def path_d(g):
    out = []
    for r in rings_of(g):
        out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in r[:-1]) + 'Z')
    return ''.join(out)

# barrios (unión de radios) y contorno de CABA
by_barrio = {}
for pr, p in radios:
    by_barrio.setdefault(pr['BARRIO'], []).append(p)
barrios = {}
for name, ps in by_barrio.items():
    barrios[name] = unary_union([p.buffer(0.3) for p in ps]).buffer(-0.3).simplify(0.4)
caba = unary_union(list(barrios.values())).buffer(0.5).buffer(-0.5).simplify(0.5)

def title(n):
    small = {'DE', 'DEL'}
    return ' '.join(w if w in small else w.capitalize() for w in n.replace('VILLA GRAL. MITRE', 'Villa Gral. Mitre').lower().split()) if n != 'VILLA GRAL. MITRE' else 'Villa Gral. Mitre'

labels = []
for name, g in barrios.items():
    rp = g.representative_point()
    labels.append({'name': title(name), 'x': round(rp.x, 1), 'y': round(rp.y, 1), 'area': round(g.area)})

# puntos: 3 sitios fijos + el resto ponderado por población, separados entre sí
rnd = random.Random(21)
dots = []
sites = []
for s in SITES:
    g = barrios[s]
    c = g.centroid
    pt = c if g.contains(c) else g.representative_point()
    dots.append((pt.x, pt.y, s))
    sites.append({'name': title(s), 'x': round(pt.x, 1), 'y': round(pt.y, 1), 'index': len(dots) - 1})
weights = [max(1.0, pr['POBLACION'] or 1.0) for pr, _ in radios]
guard = 0
while len(dots) < N_DOTS and guard < 100000:
    guard += 1
    i = rnd.choices(range(len(radios)), weights)[0]
    p = radios[i][1]
    minx, miny, maxx, maxy = p.bounds
    for _ in range(12):
        x, y = rnd.uniform(minx, maxx), rnd.uniform(miny, maxy)
        if p.contains(Point(x, y)) and caba.exterior.distance(Point(x, y)) > 8 and all(math.hypot(x - a, y - b) > 30 for a, b, _ in dots):
            dots.append((x, y, radios[i][0]['BARRIO']))
            break
print('puntos', len(dots))

out = {
    'w': round(W, 1), 'h': MAP_H,
    'radios': ''.join(path_d(p) for _, p in radios),
    'barrios': ''.join(path_d(g) for g in barrios.values()),
    'caba': path_d(caba),
    'labels': labels,
    'dots': [[round(x, 1), round(y, 1)] for x, y, _ in dots],
    'sites': sites,
}
json.dump(out, open(os.path.join(ROOT, 'src/mapdata.json'), 'w'), separators=(',', ':'))
print('ok', round(os.path.getsize(os.path.join(ROOT, 'src/mapdata.json')) / 1e6, 2), 'MB', 'W=', out['w'])
