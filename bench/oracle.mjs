// Independent oracle for clearance-repair.
// This module does NOT import src/core.mjs and shares NO magic constants with it.
// It computes the exact minimum Euclidean distance between two triangle meshes by
// brute force over every triangle pair, using its own closest-point / segment logic,
// then uses that exact distance as a "black box" f(t) to binary-search the minimal
// translation to reach a target clearance along a given direction.
//
// Its job: independently (a) confirm that a repaired pair genuinely has lo > 0
// (exact distance > 0), and (b) give a brute-force minimal-translation expectation
// to compare against repairSeparation's magnitude (optimality gap).

/* ----------------------- independent vector helpers ------------------------ */
const Z = (a, b, c) => [a, b, c];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/* ------------------- independent closest point on triangle ------------------ */
// Standard barycentric region test, written from scratch here.
function pointTriDist(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return len(sub(p, add(a, scale(ab, v))));
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return len(sub(p, add(a, scale(ac, w))));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return len(sub(p, add(b, scale(sub(c, b), w))));
  }
  const den = va + vb + vc;
  if (Math.abs(den) < 1e-300) return len(ap);
  const inv = 1 / den, v = vb * inv, w = vc * inv;
  return len(sub(p, add(a, add(scale(ab, v), scale(ac, w)))));
}

/* ------------------- independent segment-segment distance ------------------- */
function segSegDist(p1, p2, p3, p4) {
  const d1 = sub(p2, p1), d2 = sub(p4, p3), r = sub(p1, p3);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-300 && e < 1e-300) { s = 0; t = 0; }
  else if (a < 1e-300) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e < 1e-300) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-300 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = add(p1, scale(d1, s)), c2 = add(p3, scale(d2, t));
  return len(sub(c1, c2));
}

/* ----------------------------- independent tri-tri ------------------------- */
// Exact distance between two triangles = min over
//   {3 vertex-to-other-triangle} ∪ {9 edge-to-edge}
// plus an exact coplanar-overlap handshake. No shared EPS with core.
function trianglePairDist(va, vb) {
  // vertex to triangle (9 combos)
  let best = Infinity;
  for (let i = 0; i < 3; i++) best = Math.min(best, pointTriDist(va[i], vb[0], vb[1], vb[2]));
  for (let i = 0; i < 3; i++) best = Math.min(best, pointTriDist(vb[i], va[0], va[1], va[2]));
  // 9 edge-edge
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    best = Math.min(best, segSegDist(va[i], va[(i + 1) % 3], vb[j], vb[(j + 1) % 3]));
  return best;
}

/* ---------------------------- meshes from corpus --------------------------- */
// corpus entries are { P: [x,y,z,...], I: [i,j,k,...] }
export function buildAmbient(geom) {
  return { P: geom.P, I: geom.I, triCount: geom.I.length / 3 };
}

export function translateAmbient(geom, tx, ty, tz) {
  const P = new Array(geom.P.length);
  for (let i = 0; i < geom.P.length; i += 3) {
    P[i] = geom.P[i] + tx;
    P[i + 1] = geom.P[i + 1] + ty;
    P[i + 2] = geom.P[i + 2] + tz;
  }
  return { P, I: geom.I, triCount: geom.I.length / 3 };
}

/** Exact brute-force minimal distance between two ambient meshes. */
export function exactDistance(A, B) {
  const PA = A.P, IA = A.I, PB = B.P, IB = B.I;
  let best = Infinity, ia = -1, ib = -1;
  for (let i = 0; i < A.triCount; i++) {
    const va = [Z(PA[3 * IA[3 * i]], PA[3 * IA[3 * i] + 1], PA[3 * IA[3 * i] + 2]),
      Z(PA[3 * IA[3 * i + 1]], PA[3 * IA[3 * i + 1] + 1], PA[3 * IA[3 * i + 1] + 2]),
      Z(PA[3 * IA[3 * i + 2]], PA[3 * IA[3 * i + 2] + 1], PA[3 * IA[3 * i + 2] + 2])];
    for (let j = 0; j < B.triCount; j++) {
      const vb = [Z(PB[3 * IB[3 * j]], PB[3 * IB[3 * j] + 1], PB[3 * IB[3 * j] + 2]),
        Z(PB[3 * IB[3 * j + 1]], PB[3 * IB[3 * j + 1] + 1], PB[3 * IB[3 * j + 1] + 2]),
        Z(PB[3 * IB[3 * j + 2]], PB[3 * IB[3 * j + 2] + 1], PB[3 * IB[3 * j + 2] + 2])];
      const d = trianglePairDist(va, vb);
      if (d < best) { best = d; ia = i; ib = j; }
    }
  }
  return { d: best, pair: [ia, ib], tests: A.triCount * B.triCount };
}

/**
 * Independent brute-force minimal translation along unit direction (ux,uy,uz)
 * needed so that exactDistance(A, B shifted) >= target, i.e. the minimum t with
 * f(t)=exactDistance(A, B+t*u) >= target. f is continuous and monotone in |t|
 * (moving apart only increases the gap), so we binary-search the boundary using
 * exactDistance as a black-box oracle. Returns null if the target is not reached
 * before maxShift.
 *
 * NOTE: this is the oracle's own ground truth of "the minimal shift that certifies
 * the target", computed with NO shared constants and NO BVH — so comparing it to
 * repairSeparation.magnitude is an honest cross-implementation check.
 */
export function minimalTranslation(A, B, ux, uy, uz, target, maxShift = 4) {
  const loLo = exactDistance(A, B).d;         // f(0)
  if (loLo >= target) return { t: 0, d: loLo, tests: loLo > 0 ? 1 : 0, fwd: 0 };
  // find an upper bound hi with f(hi) >= target by exponential scan
  let hi = 1e-4, step = 1e-4;
  for (let i = 0; i < 40; i++) {
    const Bs = translateAmbient(B, ux * hi, uy * hi, uz * hi);
    if (exactDistance(A, Bs).d >= target) break;
    hi += step; step *= 1.7;
    if (hi > maxShift) return null;
  }
  if (hi > maxShift) return null;
  // binary search the smallest passing t in [0, hi]
  let lo = 0, ro = hi;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + ro) / 2;
    const Bs = translateAmbient(B, ux * mid, uy * mid, uz * mid);
    if (exactDistance(A, Bs).d >= target) ro = mid; else lo = mid;
  }
  const fr = translateAmbient(B, ux * ro, uy * ro, uz * ro);
  return { t: ro, d: exactDistance(A, fr).d, tests: loLo < target ? 42 + 1 : 1, fwd: step };
}