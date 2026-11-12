// Deterministic sample generator for clearance-repair.
// Produces data/corpus.json containing:
//   pairs[]      : 6 hand-built real contact pairs (meshes must genuinely touch or
//                  interpenetrate: pre-repair closest distance ~ 0)
//   randomPairs  : 100 random pairs (sphere-like blobs placed at controlled separations)
//   scaleCases   : a single overlapping pair scaled to 1e-6 / 1e-3 / 1 / 1e3 / 1e6
// Re-running this script byte-for-byte reproduces the same data (fixed seed).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh } from '../src/core.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'data', 'corpus.json');

/* ------------------------------- PRNG (deterministic mulberry32) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- geometry helpers -------------------------- */
// Unit cube centered at (cx,cy,cz), half-size h, returned as {P,I}.
function cube(cx, cy, cz, h) {
  const P = [];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++)
    P.push(cx + (x ? h : -h), cy + (y ? h : -h), cz + (z ? h : -h));
  const V = [0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7, 0, 1, 5, 5, 4, 0, 2, 3, 7, 7, 6, 2, 0, 2, 6, 6, 4, 0, 1, 3, 7, 7, 5, 1];
  const I = [];
  for (let i = 0; i < V.length; i += 3) I.push(V[i], V[i + 1], V[i + 2]);
  return { P, I };
}

// Subdivided spheroid / blob (Fibonacci-ish rings), returns {P,I} and also the
// list of valid moved points so the caller knows ground-truth separation.
function blob(cx, cy, cz, rx, ry, rz, phi, theta, rotZ, merid, rings, rand) {
  const P = [], I = [];
  // keep a sphere mesh: unit sphere with merid/rings then scale & rotate & translate
  const u = [], v = [];
  for (let m = 0; m < merid; m++) {
    u.push(m);
    for (let r = 0; r < rings; r++) v.push(r);
  }
  // build base sphere points (lat: -pi/2..pi/2 across rings)
  const base = [];
  for (let r = 0; r < rings; r++) {
    const lat = -Math.PI / 2 + (r + 0.5) * (Math.PI / rings);
    const circ = Math.cos(lat);
    for (let m = 0; m < merid; m++) {
      const lon = (2 * Math.PI * m) / merid;
      base.push([circ * Math.cos(lon), Math.sin(lat), circ * Math.sin(lon)]);
    }
  }
  // indices: two triangles per quad between ring r and r+1
  for (let r = 0; r < rings - 1; r++) {
    for (let m = 0; m < merid; m++) {
      const a0 = r * merid + m, a1 = r * merid + (m + 1) % merid;
      const b0 = (r + 1) * merid + m, b1 = (r + 1) * merid + (m + 1) % merid;
      I.push(a0, a1, b0, b1, b0, a1);
    }
  }
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const cosR = Math.cos(rotZ), sinR = Math.sin(rotZ);
  for (const [bx, by, bz] of base) {
    // scale to ellipsoid
    let x = bx * rx, y = by * ry, z = bz * rz;
    // rotate around Z then around Y then around X (phi,theta = tilt)
    // first rotate about Z by rotZ
    let t = x, tt = y;
    x = cosR * t - sinR * tt; y = sinR * t + cosR * tt;
    // rotate about Y by phi
    t = x; tt = z;
    x = cosP * t + sinP * tt; z = -sinP * t + cosP * tt;
    // rotate about X by theta
    t = y; tt = z;
    y = cosT * t - sinT * tt; z = sinT * t + cosT * tt;
    // jitter
    const j = (1 + (rand() - 0.5) * 0.02);
    P.push(cx + x * j, cy + y * j, cz + z * j);
  }
  return { P, I };
}

/* ------------------------------- corpus construction ------------------------ */
const rand = mulberry32(0xC0FFEE);
const rnd = mulberry32(0xBEEF);

// --- 6 real contact/interpenetration pairs ---
function overlappingPair() {
  // two blobs whose surfaces overlap: place blobB so its center is only a bit
  // less than the sum of extents away, guaranteeing a small negative gap.
  const ax = 0.5 + rnd() * 0.5, ay = 0.4 + rnd() * 0.4, az = 0.4 + rnd() * 0.4;
  const bx = 0.5 + rnd() * 0.5, by = 0.4 + rnd() * 0.4, bz = 0.4 + rnd() * 0.4;
  const d = ax + bx - (0.08 + rnd() * 0.12); // slight overlap along X
  const phi = (rnd() - 0.5) * 0.6, theta = (rnd() - 0.5) * 0.6, rotZ = rnd() * Math.PI;
  const merid = 10, rings = 8;
  const A = blob(0, 0, 0, ax, ay, az, 0, 0, 0, merid, rings, rand);
  const B = blob(d, 0, 0, bx, by, bz, phi, theta, rotZ, merid, rings, rand);
  return [A, B];
}

const pairs = [];
for (let k = 0; k < 6; k++) pairs.push(overlappingPair());

// --- 100 random pairs (exchange inside verify: some already-clear, some contact) ---
// We want "repair success rate >=95%" over pairs that DO need repair (lo<target).
// Build 140 candidates, verify keeps those with lo < target.
const randomPairs = [];
for (let k = 0; k < 140; k++) {
  const ax = 0.4 + rnd() * 0.6, ay = 0.3 + rnd() * 0.5, az = 0.3 + rnd() * 0.5;
  const bx = 0.4 + rnd() * 0.6, by = 0.3 + rnd() * 0.5, bz = 0.3 + rnd() * 0.5;
  const gap = rnd() * 0.06;                    // some overlap (negative via small offset) or near-contact
  const d = ax + bx - gap;
  const phi = (rnd() - 0.5) * 1.0, theta = (rnd() - 0.5) * 1.0, rotZ = rnd() * Math.PI;
  const merid = 8, rings = 7;
  const A = blob(0, 0, 0, ax, ay, az, 0, 0, 0, merid, rings, rand);
  const B = blob(d, 0, 0, bx, by, bz, phi, theta, rotZ, merid, rings, rand);
  randomPairs.push([A, B]);
}

// --- scale cases: ONE base overlapping pair scaled to 5 magnitudes, so the only
// difference between cases is the physical scale (shape is identical). ---
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
const [baseA, baseB] = overlappingPair();

function scaleGeom(geom, s) {
  return { P: geom.P.map((x) => x * s), I: geom.I.slice() };
}

const scaleCases = scales.map((s) => ({
  scale: s, A: scaleGeom(baseA, s), B: scaleGeom(baseB, s),
}));

/* ------------------------------- emit -------------------------------------- */
mkdirSync(dirname(OUT), { recursive: true });
const out = { generator: 'clearance-repair/gen-sample', seed: '0xC0FFEE/0xBEEF', pairs, randomPairs, scaleCases };
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: 6 pairs, ${randomPairs.length} random candidates, ${scales.length} scale cases`);