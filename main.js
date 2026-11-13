// Rendering + interaction only. Every geometric number comes from src/core.mjs.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeMesh, repairClearance } from './src/core.mjs';

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(3.2, 2.4, 4.2);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0a0a12, 1.1));
const dir = new THREE.DirectionalLight(0xffffff, 1.6); dir.position.set(4, 6, 5); scene.add(dir);
const grid = new THREE.GridHelper(10, 20, 0x30363d, 0x21262d); grid.position.y = -1.6; scene.add(grid);

const corpus = await (await fetch('./data/corpus.json')).json();
const reference = await (await fetch('./data/reference.json')).json();
const state = { index: 0, result: null, group: null };

const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, flatShading: false, side: THREE.DoubleSide });

function toGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function build(offset) {
  if (state.group) { scene.remove(state.group); state.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
  const c = corpus.cases[state.index];
  const A = makeMesh(c.meshA.positions, c.meshA.indices, 'A');
  const B0 = makeMesh(c.meshB.positions, c.meshB.indices, 'B');
  const B = makeMesh(B0.positions.map((v, i) => v + offset[i % 3]), B0.indices, 'B');
  const g = new THREE.Group();
  g.add(new THREE.Mesh(toGeometry(A), mat(0x58a6ff)));
  g.add(new THREE.Mesh(toGeometry(B), mat(0xf0883e)));
  scene.add(g);
  state.group = g;
  return { A, B0 };
}

function fmt(x, d = 5) { return Number.isFinite(x) ? x.toFixed(d) : 'n/a'; }

function render() {
  const c = corpus.cases[state.index];
  const ref = reference.cases[state.index];
  const { A, B0 } = build(state.result ? state.result.translation : [0, 0, 0]);
  const target = state.result ? state.result.target : c.target;
  const r = repairClearance(A, B0, target);
  const rows = [
    ['verdict', r.verdict],
    ['before [lo, hi]', `[${fmt(r.before.lo)}, ${fmt(r.before.hi)}]`],
    ['after  [lo, hi]', `[${fmt(r.after.lo)}, ${fmt(r.after.hi)}]`],
    ['moved', fmt(r.moved)],
    ['sound floor', fmt(r.lowerBound)],
    ['moved / floor', fmt(r.gapRatio, 4)],
    ['steps', String(r.steps.length)],
    ['target', fmt(target)],
  ];
  document.getElementById('tbl').innerHTML = '<tr><th>live (browser core)</th><th></th></tr>'
    + rows.map(([k, v]) => `<tr><td class="dim">${k}</td><td>${v}</td></tr>`).join('');
  const match = r.verified === ref.verified && Math.abs(r.moved - ref.moved) < 1e-9
    && Math.abs(r.after.lo - ref.after.lo) < 1e-9;
  document.getElementById('hud').innerHTML =
    `<b>${c.id}</b> — ${c.kind}<br>node reference: moved ${fmt(ref.moved)} · verified ${ref.verified}<br>`
    + `browser: moved ${fmt(r.moved)} · verified ${r.verified}<br>`
    + `<span class="${match ? 'ok' : 'bad'}">${match ? 'MATCHES node reference (1e-9)' : 'MISMATCH vs node reference'}</span>`
    + `<br><span class="dim">${c.note}</span>`;
}

function syncTarget() {
  const c = corpus.cases[state.index];
  const slider = document.getElementById('target');
  const lo = c.target * 0.4, hi = c.target * 2.2;
  slider.min = String(lo); slider.max = String(hi); slider.step = String(c.target / 200);
  slider.value = String(c.target);
  document.getElementById('tv').textContent = `= ${Number(slider.value).toFixed(3)}`;
}

const sel = document.getElementById('case');
sel.innerHTML = corpus.cases.map((c, i) => `<option value="${i}">${c.id} — ${c.kind}</option>`).join('');
sel.onchange = () => { state.index = Number(sel.value); state.result = null; syncTarget(); render(); };
document.getElementById('target').oninput = (e) => { document.getElementById('tv').textContent = `= ${Number(e.target.value).toFixed(3)}`; render(); };
document.getElementById('repair').onclick = () => {
  const c = corpus.cases[state.index];
  const target = Number(document.getElementById('target').value);
  const A = makeMesh(c.meshA.positions, c.meshA.indices, 'A');
  const B = makeMesh(c.meshB.positions, c.meshB.indices, 'B');
  const r = repairClearance(A, B, target);
  state.result = r.verified ? { translation: r.translation, target } : { translation: r.translation, target };
  render();
};
document.getElementById('reset').onclick = () => { state.result = null; syncTarget(); render(); };

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize(); syncTarget(); render();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
