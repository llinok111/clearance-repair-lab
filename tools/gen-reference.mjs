#!/usr/bin/env node
// Bake the node-side repair numbers into data/reference.json.
// The browser recomputes with the same src/core.mjs and compares digit-for-digit.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMesh, repairClearance } from '../src/core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(join(ROOT, 'data', 'corpus.json'), 'utf8'));
const cases = corpus.cases.map((c) => {
  const A = makeMesh(c.meshA.positions, c.meshA.indices, 'A');
  const B = makeMesh(c.meshB.positions, c.meshB.indices, 'B');
  const r = repairClearance(A, B, c.target);
  return {
    id: c.id, target: c.target, verdict: r.verdict, verified: r.verified,
    before: r.before, after: r.after, translation: r.translation, moved: r.moved,
    lowerBound: r.lowerBound, gapRatio: r.gapRatio, steps: r.steps.length,
  };
});
writeFileSync(join(ROOT, 'data', 'reference.json'), JSON.stringify({
  generator: 'tools/gen-reference.mjs (node core, no browser)', runtime: process.version, cases,
}, null, 2) + '\n');
console.log(`wrote ${cases.length} reference rows`);
