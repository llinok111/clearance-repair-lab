#!/usr/bin/env node
// Deterministic corpus: 6 curated contact scenes + 100 random primitive pairs.
// `node tools/gen-sample.mjs` rewrites data/*.json byte-for-byte identically.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

let state = 0xC0FFEE;
function rnd() {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = (a, b) => a + (b - a) * rnd();

const box = (cx, cy, cz, sx, sy, sz) => {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]];
  return { positions: v.flat(), indices: f.flat() };
};

function sphere(cx, cy, cz, r, lat = 8, lon = 12) {
  const pos = [], idx = [];
  pos.push(cx, cy - r, cz); // south pole = vertex 0
  for (let i = 1; i < lat; i++) {
    const phi = -Math.PI / 2 + (i * Math.PI) / lat;
    for (let j = 0; j < lon; j++) {
      const th = (2 * Math.PI * j) / lon;
      pos.push(cx + r * Math.cos(phi) * Math.cos(th), cy + r * Math.sin(phi), cz + r * Math.cos(phi) * Math.sin(th));
    }
  }
  pos.push(cx, cy + r, cz);
  const north = pos.length / 3 - 1;
  const ring = (i, j) => 1 + (i - 1) * lon + (j % lon);
  for (let j = 0; j < lon; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < lat - 1; i++) {
    for (let j = 0; j < lon; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  for (let j = 0; j < lon; j++) idx.push(north, ring(lat - 1, j), ring(lat - 1, j + 1));
  return { positions: pos, indices: idx };
}

function cylinder(cx, cy, cz, r, h, seg = 16) {
  const pos = [], idx = [];
  for (let k = 0; k < 2; k++) for (let j = 0; j < seg; j++) {
    const th = (2 * Math.PI * j) / seg;
    pos.push(cx + r * Math.cos(th), cy + (k ? h / 2 : -h / 2), cz + r * Math.sin(th));
  }
  pos.push(cx, cy - h / 2, cz, cx, cy + h / 2, cz);
  const bot = pos.length / 3 - 2, top = bot + 1;
  for (let j = 0; j < seg; j++) {
    const a = j, b = (j + 1) % seg, c = seg + j, d = seg + ((j + 1) % seg);
    idx.push(a, b, c, b, d, c, bot, b, a, top, c, d);
  }
  return { positions: pos, indices: idx };
}

function tetra(cx, cy, cz, s) {
  const p = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(([a, b, c]) => [cx + a * s / 2, cy + b * s / 2, cz + c * s / 2]);
  const f = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  return { positions: p.flat(), indices: f.flat() };
}

function torus(cx, cy, cz, R, r, nu = 16, nv = 8) {
  const pos = [], idx = [];
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    for (let j = 0; j < nv; j++) {
      const v = (2 * Math.PI * j) / nv;
      pos.push(cx + (R + r * Math.cos(v)) * Math.cos(u), cy + r * Math.sin(v), cz + (R + r * Math.cos(v)) * Math.sin(u));
    }
  }
  const at = (i, j) => (i % nu) * nv + (j % nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    idx.push(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  }
  return { positions: pos, indices: idx };
}

const curated = [
  { id: 'box-on-box', kind: 'face contact', target: 0.05, A: box(0, 0, 0, 2, 2, 2), B: box(0, 2, 0, 2, 2, 2), note: '2x2x2 boxes, B sits exactly on A (y: -1..1 and 1..3)' },
  { id: 'sphere-on-box', kind: 'point contact', target: 0.05, A: box(0, 0, 0, 2, 1, 2), B: sphere(0, 1.0, 0, 0.5, 8, 12), note: 'r=0.5 sphere resting on a 2x1x2 slab (top y=0.5)' },
  { id: 'cylinder-on-plate', kind: 'line contact', target: 0.04, A: box(0, -0.1, 0, 4, 0.2, 4), B: cylinder(0, 0.5, 0, 0.5, 1, 16), note: 'r=0.5 h=1 cylinder standing on a plate' },
  { id: 'tetra-over-box', kind: 'near contact', target: 0.10, A: box(0, 0, 0, 1, 1, 1), B: tetra(0, 0.77, 0, 0.5), note: 'tetra bottom vertex 0.02 above the box top' },
  { id: 'torus-over-sphere', kind: 'near contact', target: 0.08, A: sphere(0, 0, 0, 0.6, 10, 14), B: torus(0, 0.65, 0, 0.5, 0.15, 16, 8), note: 'torus ring passing over a sphere' },
  { id: 'sphere-sphere-eps', kind: 'epsilon gap', target: 0.06, A: sphere(0, 0, 0, 0.5, 8, 12), B: sphere(0, 1.0001, 0, 0.5, 8, 12), note: 'centres 1.0001 apart, gap 1e-4' },
];

const cases = curated.map((c) => ({ ...c, meshA: c.A, meshB: c.B, A: undefined, B: undefined }));
for (const c of cases) { delete c.A; delete c.B; }

const random = [];
for (let n = 0; n < 100; n++) {
  const ra = rand(0.2, 0.8), rb = rand(0.2, 0.8);
  const gap = rand(0, 0.06);
  const kind = ['box', 'sphere', 'cylinder'][n % 3];
  const mk = (kind, cx, r) => (kind === 'box' ? box(cx, 0, 0, 2 * r, 2 * r, 2 * r)
    : kind === 'sphere' ? sphere(cx, 0, 0, r, 6, 8) : cylinder(cx, 0, 0, r, 2 * r, 12));
  const bx = ['box', 'sphere', 'cylinder'][n % 3];
  random.push({
    id: `rnd-${String(n).padStart(3, '0')}`, kind: `${kind}/${bx}`, target: rand(0.05, 0.15),
    meshA: mk(kind, 0, ra),
    meshB: mk(bx, ra + rb + gap, rb),
  });
}
random[0].meshA = box(0, 0, 0, 1, 1, 1);
random[0].meshB = box(0, 1, 0, 1, 1, 1); // exact face contact case inside the random set
random[0].target = 0.05;

const countTris = (m) => m.indices.length / 3;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'corpus.json'), JSON.stringify({
  generator: 'tools/gen-sample.mjs', seed: '0xC0FFEE (mulberry32)', caseCount: cases.length,
  cases: cases.map((c) => ({ ...c, trisA: countTris(c.meshA), trisB: countTris(c.meshB) })),
}) + '\n');
writeFileSync(join(OUT, 'random.json'), JSON.stringify({
  generator: 'tools/gen-sample.mjs', seed: '0xC0FFEE (mulberry32)', caseCount: random.length,
  cases: random.map((c) => ({ ...c, trisA: countTris(c.meshA), trisB: countTris(c.meshB) })),
}) + '\n');
console.log(`wrote ${cases.length} curated + ${random.length} random cases to data/`);
