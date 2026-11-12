// main.js — render + interaction only. All numbers come from src/core.mjs.
// Read the corpus (fetched at runtime), pick a pair, run repairSeparation in the
// browser with the same core used in node, and display the resulting dual cert.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeMesh, repairSeparation, translateMesh } from './src/core.mjs';

const app = document.getElementById('three');
const statusEl = document.getElementById('status');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1018);
const camera = new THREE.PerspectiveCamera(55, app.clientWidth / app.clientHeight, 0.01, 100);
camera.position.set(2.2, 1.6, 2.4);
const controls = new OrbitControls(camera, renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff, 0x334, 1));
const key = new THREE.DirectionalLight(0xfff, 1.2);
key.position.set(2, 3, 2);
scene.add(key);
const key2 = new THREE.DirectionalLight(0x88c, 0.6);
key2.position.set(-2, -1, -2);
scene.add(key2);

const group = new THREE.Group();
scene.add(group);

const WHITE = new THREE.MeshStandardMaterial({ color: 0x79b8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, flatShading: true });
const RED = new THREE.MeshStandardMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, flatShading: true });

function buildMesh(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

async function loadCorpus() {
  const res = await fetch('./data/corpus.json');
  return await res.json();
}

let corpus = null;
try { corpus = await loadCorpus(); } catch (e) {
  statusEl.textContent = '无法加载 data/corpus.json：' + e.message;
}

function runPair(k) {
  const [GA, GB] = corpus.pairs[k];
  const A = makeMesh(GA.P, GA.I, 'A');
  const B0 = makeMesh(GB.P, GB.I, 'B');
  const scale = parseFloat(document.getElementById('targetScale').value);
  const target = scale * Math.min(A.diag, B0.diag);
  const tol = Math.max(1e-12, 1e-4 * Math.min(A.diag, B0.diag));
  const config = { tol, maxPairs: 4_000_000, iters: 34, target };
  const r = repairSeparation(A, B0, config);

  // replace scene content
  while (group.children.length) group.remove(group.children[0]);
  const ga = buildMesh(A);
  const gaMesh = new THREE.Mesh(ga, WHITE);
  group.add(gaMesh);

  const Bshift = r.repairable && r.translation
    ? translateMesh(B0, r.translation[0], r.translation[1], r.translation[2])
    : B0;
  const gb = buildMesh(Bshift);
  const gbMesh = new THREE.Mesh(gb, RED);
  group.add(gbMesh);

  // recenter on combined
  const box = new THREE.Box3().setFromObject(group);
  const c = box.getCenter(new THREE.Vector3());
  camera.position.copy(c).add(new THREE.Vector3(1, 0.7, 1));
  camera.lookAt(c);
  controls.target.copy(c);
  controls.update();

  const fmt = (x) => (x === null || x === undefined) ? '—' : x.toExponential(3);
  const bInt = r.before ? r.before.interval : null;
  const rInt = r.repaired ? r.repaired.interval : null;
  statusEl.innerHTML =
    `<b>pair P${k} · 目标间隙</b> target = ${(target).toExponential(3)}<br/>` +
    `<b>修复前间隙</b> [lo, hi] = [${fmt(bInt && bInt[0])}, ${fmt(bInt && bInt[1])}] ` +
    `(certified=${r.before ? r.before.certified : '—'})<br/>` +
    `<b>修复平移</b> magnitude = <span class="num">${r.magnitude === null ? '—' : r.magnitude.toExponential(3)}</span> ` +
    `(方向 ${r.direction ? r.direction.map((x) => x.toFixed(3)).join(', ') : '—'})<br/>` +
    `<b>修复后间隙</b> [lo, hi] = [${fmt(rInt && rInt[0])}, ${fmt(rInt && rInt[1])}] ` +
    `(certified=${r.repaired ? r.repaired.certified : '—'})<br/>` +
    `<span class="${r.repairable && r.repaired && r.repaired.interval[0] > 0 ? 'ok' : 'no'}">` +
    `→ 修复后 lo = ${fmt(rInt && rInt[0])} ${r.repairable && r.repaired && r.repaired.interval[0] > 0 ? '> 0 ✓' : 'NOT REPAIRED'}</span>`;
}

document.getElementById('pair0').addEventListener('click', () => runPair(0));
document.getElementById('pair3').addEventListener('click', () => runPair(3));
document.getElementById('pair4').addEventListener('click', () => runPair(4));
document.getElementById('targetScale').addEventListener('change', () => {
  document.getElementById('targetVal').textContent = document.getElementById('targetScale').value;
  if (corpus) runPair(0);
});
runPair(0);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
window.addEventListener('resize', () => {
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
});