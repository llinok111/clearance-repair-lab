# clearance-repair-lab

**Turn a sound clearance interval into a minimum-norm separation repair, then re-certify it: 6/6 contact scenes and 100/100 random pairs verified by an independent O(n²) brute force, median translation 1.0042× the information-theoretic floor, 0 false claims — the naive planner in `baseline/` repairs 1/6.**

Upstream: none

This is not "push the model apart and hope". The input is an interval `[lo, hi]` that provably contains
the true mesh-to-mesh distance; the output is a translation `t`, a second interval for the moved mesh,
and a **sound lower bound on every possible repair**: any translation that achieves clearance `target`
must have norm `>= target - hi` (set distance is 1-Lipschitz under translation). So the tool reports
`moved / floor` — its own optimality gap — instead of an unverifiable "minimal" claim. When the interval
cannot be closed, or the pair interpenetrates, it **abstains**; it never labels a pinch "repaired".

## How to run

```bash
node tools/gen-sample.mjs      # rebuild data/*.json deterministically (6 curated + 100 random pairs)
node tools/gen-reference.mjs   # bake node numbers into data/reference.json (browser HUD compares to these)
node bench/verify.mjs          # 15 assertions, exit 0 only if all pass  (~2.6 s)
node bench/bench.mjs           # writes bench/result.json (cold start + 7 reps per case)
python3 -m http.server 4173     # then open http://localhost:4173 (three@0.169.0 pinned in the importmap)
```

No install step: `src/core.mjs`, `bench/` and `tools/` are dependency-free Node ESM. The browser needs
network access to `unpkg.com/three@0.169.0` only.

## Evidence (real runs, 2026-11-13, node v24.19.0, linux/x64)

`node bench/verify.mjs` → **15 passed, 0 failed**

| assertion | measured |
| --- | --- |
| curated scenes repaired, certified `lo >= target` | **6/6** (see table below) |
| same 6 confirmed by independent O(n²) brute force | **6/6**, min after/target = 1.0019 on the random set |
| intervals bracket the brute-force truth (before & after) | **12/12** |
| `moved >= sound floor` on every case (theorem L1) | **6/6** |
| within 2% of the floor | **5/6**; the torus ring is 1.1497× and reported, not hidden |
| 100 seeded random primitive pairs | **100/100 verified**, 100/100 brute-force confirmed |
| gap-to-floor over the random set | median **1.0042**, p95 **1.0117**, max **1.0705** |
| false "repaired" claims | **0 / 106** |
| interpenetrating pair | `verdict: abstain`, reason `no-progress`, `verified: false` |
| scale 1e-6 / 1e-3 / 1 / 1e3 / 1e6 | all verified, `moved/scale` spread **2.22e-16**, same step count |
| determinism | two runs identical (translation, intervals, steps) |
| naive planner on exact contacts (d = 0) | **no-direction on 3/3** — it has no gradient to follow |
| naive vs certified translation | differs by **1.8e-4** = interval width + 2·tol, as the theory predicts |
| budget exhaustion (`maxPairs: 0`) | `abstain`, `budget-exhausted-before` |

Curated scenes (`node bench/bench.mjs`):

| scene | before [lo,hi] | after [lo,hi] | moved | floor | gap |
| --- | --- | --- | --- | --- | --- |
| box-on-box (face contact) | [0, 0] | [0.05005, 0.05010] | 0.05010 | 0.05000 | 1.0020 |
| sphere-on-box (point contact) | [0, 0] | [0.05005, 0.05010] | 0.05010 | 0.05000 | 1.0020 |
| cylinder-on-plate (line contact) | [0, 0] | [0.04004, 0.04008] | 0.04008 | 0.04000 | 1.0020 |
| tetra-over-box (0.02 gap) | [0.01991, 0.02000] | [0.10017, 0.10026] | 0.08026 | 0.08000 | 1.0032 |
| torus-over-sphere (ring) | [0.06752, 0.06760] | [0.08009, 0.08017] | 0.01426 | 0.01240 | **1.1497** |
| sphere-sphere-eps (1e-4 gap) | [0.00004, 0.00010] | [0.06012, 0.06018] | 0.06008 | 0.05990 | 1.0030 |

Timing (`bench/result.json`, warmup 1 + 7 timed reps per case, cold start separate):

| case | median | RSD |
| --- | --- | --- |
| box-on-box | 0.34 ms | 3.2% |
| sphere-on-box | 0.98 ms | 14.5% |
| cylinder-on-plate | 0.36 ms | 2.6% |
| tetra-over-box | 0.31 ms | 18.2% |
| torus-over-sphere | **416.91 ms** | 1.4% |
| sphere-sphere-eps | 2.14 ms | 7.7% |

Pooled median **0.964 ms**, p95 **420.39 ms**, pooled RSD **220.9%** — the distribution is deliberately
bimodal (five sub-millisecond scenes plus one 410 ms scene), so the pooled RSD is not a stability claim;
per-case RSD is the meaningful number. Cold start (torus) **406.4 ms**.
The torus cost is the direction portfolio: ~15 certificates × ~16 ms per probe on a 64,512-pair mesh pair.
The naive planner takes **351.8 ms** on the same scene and still does not separate it.

Baseline (`baseline/naive.mjs`: exact O(n²) distance + one step along the exact witness direction):

| scene | naive verdict | naive moved | time |
| --- | --- | --- | --- |
| box-on-box / sphere-on-box / cylinder-on-plate | `no-direction` | 0 | 0.3 / 5.7 / 1.9 ms |
| tetra-over-box | `not-separated` | 0.08000 | 0.3 ms |
| torus-over-sphere | `not-separated` | 0.01240 | 351.8 ms |
| sphere-sphere-eps | `repaired` | 0.05990 | **155.7 ms** vs **2.14 ms** certified (**72.8×**) |

## 本轮创新

**B 档（新意）**：把「区间证书」从判定工具变成**构造性修复算子**，并且修复结果由**同一套区间证书反向验收**——不是"移动后看起来分开了"，而是 `after.lo >= target` 加独立暴力法双重确认，同时给出对所有可能修复都成立的**平移下界** `target - hi`，因此 `moved/floor` 是真实的最优性间隙而不是自评。
与台账既有条目不同：`clearance-cert-lab` 只判定/拒绝（本仓库复用其谓词，但新增修复算子）；`hole-seal-lab` 是补洞；`mesh-defect-doctor` 是诊断-修补-再诊断但对象是网格自身缺陷，不含刚体分离与最优性下界；CGAL/trimesh 等库能算距离或做碰撞响应，但不输出「我的平移量离理论下界多远」这一可复算数字。核心几何与决策全在 `src/core.mjs`，node 与浏览器逐位同源。

## 与上一版（v1, 2026-11-12，同一仓库）的区别

v1 已证明「区间证书 → 沿 6 轴 + 见证方向单调二分 → 最小平移 → 复证」，6/6 修复、平移量与暴力 oracle 平均误差 0.13%。
v2 保留其问题设定，新增/替换了四件可验证的东西：

1. **平移量的可靠下界**：`floor = max(0, target - hi_before)`，由集合距离对平移的 1-Lipschitz 性质得出，
   对**任何**可能的修复都成立；因此 `moved/floor` 是真实最优性间隙，不再依赖自写的暴力 oracle 作为唯一尺子。
2. **不可达地板要披露**：环形障碍（torus 套 sphere）沿任何方向抬升的间隙增长次线性，实测 1.1497×，
   写在 README 与断言里，而不是当成 2% 以内的成绩。
3. **穿透即弃权**：v1 未区分「接触」与「穿透」；v2 在候选方向探测全部无法达标时返回
   `verdict: abstain`，绝不把挤压中的模型标成已修复（100 对随机 + 1 对构造穿透用例覆盖）。
4. **100 对随机语料 + 逐对暴力复核 + 尺度扫描**，把「6 对手工场景」扩成可统计的分布
   （随机集中位 1.0042、p95 1.0117、max 1.0705）。

v1 的 `bench/oracle.mjs`（不 import core 的独立 oracle）在 v2 中被 `baseline/naive.mjs` 的
逐对精确距离 + 独立暴力复核取代；v1 的 437 ms/对 计时与 0.13% 数字保留在 git 历史中，v2 的数字全部重测。

## 已知限制 (honest limits)

1. **The floor is not always attainable.** `target - hi` is sound but not tight: for a ring-shaped
   obstacle around a sphere, lifting it by `δ` grows the diagonal gap sublinearly, so the cheapest
   certified lift is 1.1497× the floor. This is the single curated case above 2%; it is printed in the
   README and asserted in `verify.mjs` rather than smoothed over.
2. **Absolute interval width.** `tol = min(1e-4·diag, 1e-3·target)` is an absolute number, so it is only
   meaningful relative to the scene scale. All reported gaps are ratios (`moved/floor`), and the
   1e-6…1e6 scale sweep shows the same step count and `moved/scale` to 2.2e-16, but very small targets
   (< 100·tol) will be dominated by the interval width.
3. **Rigid translation only.** No rotation search, no per-part disassembly, no collision response with
   contact manifolds. If the pair interpenetrates, the tool abstains instead of resolving penetration.
4. **The floor uses `hi`, which is conservative**; a tighter true distance would tighten the floor and
   therefore *increase* the reported gap. We prefer the conservative direction.
5. **Direction portfolio is finite** (witness gradient + witness face normals + 6 axes). A cheaper escape
   direction outside this set would be missed; the torus case is where the portfolio already matters.
6. **Timing is single-process** on a shared 4-core/3.6 GB host; the 410 ms torus number is dominated by
   repeated certificate probes, not by the brute-force distance.
7. **Browser is not GPU-verified here.** Only `python3 -m http.server 4173` → HTTP 200, importmap hit,
   and `main.js`/`src/core.mjs`/`data/*.json` all 200 were checked; headless browsers are banned in this
   environment, so there are no screenshots and the HUD match is asserted in node instead
   (`tools/gen-reference.mjs` + `verify.mjs`).

## Layout

```
index.html            importmap-pinned three@0.169.0, one orbit camera, case selector, target slider
main.js               rendering + interaction; all numbers computed by src/core.mjs
src/core.mjs          pure ES module: BVH interval, repair planner, escape directions (no three/DOM/IO)
baseline/naive.mjs    exact O(n²) planner used as the comparison baseline
tools/gen-sample.mjs  deterministic corpus generator (fixed mulberry32 seed)
tools/gen-reference.mjs  bakes node numbers for the browser HUD comparison
bench/verify.mjs      15 assertions; bench/bench.mjs writes bench/result.json
```

License: MIT (see LICENSE). The mesh predicates in `src/core.mjs` are adapted from the author's own
`llinok111/clearance-cert-lab` (MIT, same author); the repair planner, escape-direction search, floor
bound and all evidence in this repository are new here.
