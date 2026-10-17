"""Generate the sample models shipped with WebSlicer (binary STL, millimetres, Z up).

Run:  python samples/make_samples.py
"""
import math
import struct
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def write_stl(path, tris):
    with open(path, 'wb') as f:
        f.write(b'WebSlicer sample'.ljust(80, b'\0'))
        f.write(struct.pack('<I', len(tris)))
        for a, b, c in tris:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            f.write(struct.pack('<3f', nx / l, ny / l, nz / l))
            for p in (a, b, c):
                f.write(struct.pack('<3f', *p))
            f.write(struct.pack('<H', 0))


def box(x0, y0, z0, x1, y1, z1):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return [(v[a], v[b], v[c]) for a, b, c in f]


def cylinder(cx, cy, r, z0, z1, n=64):
    tris = []
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = 2 * math.pi * (i + 1) / n
        p0 = (cx + r * math.cos(a0), cy + r * math.sin(a0))
        p1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
        tris.append(((p0[0], p0[1], z0), (p1[0], p1[1], z1), (p1[0], p1[1], z0)))
        tris.append(((p0[0], p0[1], z0), (p0[0], p0[1], z1), (p1[0], p1[1], z1)))
        tris.append(((cx, cy, z0), (p1[0], p1[1], z0), (p0[0], p0[1], z0)))
        tris.append(((cx, cy, z1), (p0[0], p0[1], z1), (p1[0], p1[1], z1)))
    return tris


# 1) calibration cube 20 mm
write_stl(os.path.join(HERE, 'calibration_cube_20mm.stl'), box(0, 0, 0, 20, 20, 20))

# 2) overhang test: a bridge table (top plate 40x20x4 on two legs) – needs supports or bridging
tris = box(0, 0, 0, 5, 20, 15) + box(35, 0, 0, 40, 20, 15) + box(0, 0, 15, 40, 20, 19)
write_stl(os.path.join(HERE, 'bridge_table.stl'), tris)

# 3) tolerance / seam test: cylinder 25 mm diameter, 30 mm high, with a 10 mm cube on top (paint seam, place on face)
tris = cylinder(0, 0, 12.5, 0, 30) + box(-5, -5, 30, 5, 5, 40)
write_stl(os.path.join(HERE, 'cylinder_with_cube.stl'), tris)

# 4) stepped pyramid: ideal for height ranges / variable layer height
tris = []
for i, s in enumerate([30, 24, 18, 12, 6]):
    h = 6
    tris += box(-s / 2, -s / 2, i * h, s / 2, s / 2, (i + 1) * h)
write_stl(os.path.join(HERE, 'stepped_pyramid.stl'), tris)

print('samples written to', HERE)
