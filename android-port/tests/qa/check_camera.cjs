#!/usr/bin/env node
/**
 * CrystalLens Android - camera acceptance check (QA-ACCEPTANCE.md §3,
 * docs/spec/camera-cases.md cases A1-A7).
 *
 * Loads the DOM-free render math (web/js/lib/math.js + web/js/render/camera.js)
 * into a Node VM and verifies the exact reference values from the C++
 * test_camera.cpp fixture. No browser required.
 *
 * Usage:
 *   node tests/qa/check_camera.cjs [--json <path>]
 * Exit code: 0 all cases pass, 1 failures, 2 setup error (files missing).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['web/js/lib/math.js', 'web/js/render/camera.js'];
const DEG = Math.PI / 180;

const results = [];
let currentCase = 'setup';

function check(cond, msg, detail) {
  if (cond) return true;
  results.push({ case: currentCase, ok: false, msg: msg + (detail ? ' :: ' + detail : '') });
  return false;
}
function near(actual, expected, eps, msg) {
  const tol = eps * Math.max(1, Math.abs(expected));
  if (typeof actual !== 'number' || !isFinite(actual) || Math.abs(actual - expected) > tol) {
    check(false, msg, `expected ${expected} +/- ${tol}, got ${actual}`);
    return false;
  }
  return true;
}
function nearVec(actual, expected, eps, msg) {
  if (!actual || actual.length < expected.length) { check(false, msg + ' (bad shape)', JSON.stringify(actual)); return false; }
  let ok = true;
  for (let i = 0; i < expected.length; i++) {
    const tol = eps * Math.max(1, Math.abs(expected[i]));
    if (typeof actual[i] !== 'number' || !isFinite(actual[i]) || Math.abs(actual[i] - expected[i]) > tol) {
      check(false, msg + '[' + i + ']', `expected ${expected[i]} +/- ${tol}, got ${actual[i]}`);
      ok = false;
    }
  }
  return ok;
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.sqrt(dot(a, a)); }
function norm(a) { const l = len(a); return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l]; }

function orthoOn(cam, on) {
  if (typeof cam.setProjection === 'function') cam.setProjection(on);
  else cam.orthographic = !!on;
  if (typeof cam._touch === 'function') cam._touch();
}

function setup() {
  const sandbox = {
    console, Math, JSON, Date, parseFloat, parseInt, isFinite, isNaN,
    Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, ArrayBuffer,
    DataView, Map, Set, Promise, setTimeout, clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.error('[error] missing ' + rel); process.exit(2); }
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: rel });
  }
  if (!sandbox.CL || typeof sandbox.CL.Camera !== 'function') {
    console.error('[error] CL.Camera is not defined after loading camera.js');
    process.exit(2);
  }
  return sandbox.CL;
}

// ---------------------------------------------------------------- A1 ------
function A1(CL) {
  currentCase = 'A1 TestFitFramesTheScene';
  const cam = new CL.Camera();
  cam.reset([1, 2, 3], 6.6, 1.15);
  near(cam.distance, 22.704923374109537, 1e-9, 'A1 distance after reset/fit');
  nearVec(cam.eye(), [17.990835003851924, 13.897110750174518, 12.234924314478585], 1e-9, 'A1 eye');
  near(cam.nearPlane(), 8.184923374109538, 1e-12, 'A1 nearPlane');
  near(cam.farPlane(), 65.70492337410954, 1e-12, 'A1 farPlane');

  const center = cam.worldToScreen([1, 2, 3], 1200, 1000);
  check(center.visible, 'A1 center visible');
  near(center.x, 600.0, 1e-6, 'A1 center.x');
  near(center.y, 500.0, 1e-6, 'A1 center.y');
  near(center.depth, 0.461018, 1e-5, 'A1 center.depth');

  const up = cam.up(), right = cam.right();
  const top = cam.worldToScreen(add([1, 2, 3], mul(up, 6.6)), 1200, 1000);
  check(top.visible, 'A1 top visible');
  near(top.y, 77.893493, 1e-5, 'A1 top.y');
  near(top.x, 600.0, 1e-3, 'A1 top.x');
  const side = cam.worldToScreen(add([1, 2, 3], mul(right, 6.6)), 1200, 1000);
  check(side.visible, 'A1 side visible');
  near(side.x, 1022.106507, 1e-5, 'A1 right side.x');
  near(side.y, 500.0, 1e-3, 'A1 right side.y');
  const sideL = cam.worldToScreen(add([1, 2, 3], mul(right, -6.6)), 1200, 1000);
  near(sideL.x, 177.893493, 1e-5, 'A1 left side.x');
  const low = cam.worldToScreen(add([1, 2, 3], mul(up, -6.6)), 1200, 1000);
  near(low.y, 922.106507, 1e-5, 'A1 bottom.y');

  // view matrix (column-major)
  nearVec(Array.from(cam.viewMatrix()), [
    -0.573576436, -0.333179153, 0.748332629, 0,
    0.819152044, -0.233294554, 0.523988148, 0,
    0.0, 0.913545458, 0.406736643, 0,
    -1.064727652, -1.940868112, -25.721442229, 1
  ], 1e-5, 'A1 viewMatrix');
  // projection matrix (aspect 1200/1000 = 1.2)
  nearVec(Array.from(cam.projectionMatrix(1200, 1000)), [
    2.420175731, 0, 0, 0,
    0, 2.904210878, 0, 0,
    0, 0, -1.284593998, -1,
    0, 0, -18.699226812, 0
  ], 1e-5, 'A1 projectionMatrix');
}

// ---------------------------------------------------------------- A2 ------
function A2(CL) {
  currentCase = 'A2 TestRayThroughCenter';
  const cam = new CL.Camera();
  cam.reset([0, 0, 0], 5.0, 1.4);
  near(cam.distance, 17.200699525840555, 1e-9, 'A2 distance');
  const ray = cam.screenRay(700, 500, 1400, 1000);
  near(len(ray.direction), 1.0, 1e-9, 'A2 dir unit');
  const tc = dot(sub([0, 0, 0], ray.origin), ray.direction);
  check(tc > 0, 'A2 center in front of camera');
  const closest = add(ray.origin, mul(ray.direction, tc));
  near(len(closest), 0.0, 0.05, 'A2 ray hits the center');
}

// ---------------------------------------------------------------- A3 ------
function A3(CL) {
  currentCase = 'A3 TestOrbitAndZoom';
  const cam = new CL.Camera();
  cam.reset([0, 0, 0], 5.0, 1.5);
  const yaw0 = cam.yaw, dist0 = cam.distance;
  near(dist0, 17.200699525840555, 1e-9, 'A3 distance before orbit');
  cam.orbit(40, 20);
  check(cam.yaw < yaw0, 'A3 yaw decreases on +dx');
  near(cam.yaw / DEG, 18.49881550023229, 1e-6, 'A3 yaw after orbit(40,20)');
  check(cam.pitch > 24 * DEG, 'A3 pitch increases on +dy');
  near(cam.pitch / DEG, 32.25059224988386, 1e-6, 'A3 pitch after orbit(40,20)');
  cam.zoom(3);
  check(cam.distance < dist0, 'A3 zoom(3) zooms in');
  near(cam.distance, 10.643507194037896, 1e-9, 'A3 distance after zoom(3)');
  cam.orbit(0, -10000);
  check(cam.pitch <= 85 * DEG + 1e-6, 'A3 pitch clamp +85');
  check(cam.pitch >= -85 * DEG - 1e-6, 'A3 pitch clamp -85');
  near(cam.pitch / DEG, -85, 1e-9, 'A3 pitch clamped to -85 deg');

  // basis stays orthonormal after interactive moves
  const f = cam.forward(), r = cam.right(), u = cam.up();
  near(len(f), 1, 1e-9, 'A3 |forward|');
  near(len(r), 1, 1e-9, 'A3 |right|');
  near(len(u), 1, 1e-9, 'A3 |up|');
  near(dot(f, r), 0, 1e-9, 'A3 forward . right');
  near(dot(f, u), 0, 1e-9, 'A3 forward . up');
  near(dot(r, u), 0, 1e-9, 'A3 right . up');
}

// ---------------------------------------------------------------- A4 ------
function A4(CL) {
  currentCase = 'A4 TestOrthographic';
  const cam = new CL.Camera();
  cam.reset([0, 0, 0], 5.0, 1.5);
  orthoOn(cam, true);
  near(cam.nearPlane(), 6.200699525840555, 1e-9, 'A4 nearPlane (ortho)');
  near(cam.farPlane(), 52.200699525840555, 1e-9, 'A4 farPlane (ortho)');
  const c = cam.worldToScreen([0, 0, 0], 1000, 800);
  check(c.visible, 'A4 center visible');
  near(c.x, 500, 1e-9, 'A4 center.x');
  near(c.y, 400, 1e-9, 'A4 center.y');
  near(c.depth, -0.5217391304347826, 1e-9, 'A4 center.depth');
  const ray = cam.screenRay(500, 400, 1000, 800);
  near(len(ray.direction), 1.0, 1e-9, 'A4 dir unit');
  // NOTE: docs/spec/camera-cases.md A4 lists m[0]=0.112561735 (halfW=8.884 = halfH*1.5),
  // but halfW must use the *viewport* aspect (1000/800 = 1.25) as the C++ reference
  // Camera::ProjectionMatrix does: 1/(5.9226758146453555*1.25) = 0.135074079.
  // The JS port matches the C++ source; the doc reference row is wrong (QA report D-DOC-1).
  nearVec(Array.from(cam.projectionMatrix(1000, 800)), [
    0.135074079, 0, 0, 0,
    0, 0.168842603, 0, 0,
    0, 0, -0.043478261, 0,
    0, 0, -1.269595632, 1
  ], 1e-5, 'A4 orthographic projectionMatrix');
}

const A5_POINTS = [];
A5_POINTS.push([-5, -4, -3], [-5, -4, 3], [-5, 4, -3], [-5, 4, 3],
  [5, -4, -3], [5, -4, 3], [5, 4, -3], [5, 4, 3]);
// screen reference from docs/spec/camera-cases.md A5 (1500x1000)
const A5_SCREEN = [
  [730.1992, 506.8580, 0.7747], [728.4442, 218.3893, 0.7407],
  [1096.0681, 613.0894, 0.7124], [1132.2498, 283.9220, 0.6659],
  [353.2868, 724.2538, 0.6473], [305.0014, 354.5817, 0.5853],
  [782.4342, 923.7288, 0.5305], [787.4253, 487.0377, 0.4341]
];

// ---------------------------------------------------------------- A5 ------
function A5(CL) {
  currentCase = 'A5 TestTightPointFit';
  const cam = new CL.Camera();
  cam.setScene([0, 0, 0], 8.0);
  cam.yaw = 35 * DEG;
  cam.pitch = 24 * DEG;
  cam.fit(1.5);
  const spherical = cam.distance;
  near(spherical, 27.521119241344895, 1e-9, 'A5 sphere fit distance');
  cam.fitPoints(A5_POINTS, 1.5, 1.18);
  near(cam.distance, 22.916426781078908, 1e-9, 'A5 point fit distance');
  check(cam.distance < spherical, 'A5 point fit must be tighter than sphere fit');
  near(cam.nearPlane(), 5.316426781078906, 1e-9, 'A5 nearPlane');
  near(cam.farPlane(), 72.91642678107891, 1e-9, 'A5 farPlane');
  let allInside = true, touchesMargin = false;
  for (let i = 0; i < A5_POINTS.length; i++) {
    const s = cam.worldToScreen(A5_POINTS[i], 1500, 1000);
    if (!s.visible) allInside = false;
    if (s.x < 0 || s.x > 1500 || s.y < 0 || s.y > 1000) allInside = false;
    if (s.x < 120 || s.x > 1380 || s.y < 90 || s.y > 910) touchesMargin = true;
    near(s.x, A5_SCREEN[i][0], 0.05, 'A5 corner ' + i + ' screen.x');
    near(s.y, A5_SCREEN[i][1], 0.05, 'A5 corner ' + i + ' screen.y');
    near(s.depth, A5_SCREEN[i][2], 1e-4, 'A5 corner ' + i + ' depth');
  }
  check(allInside, 'A5 all points inside the viewport');
  check(touchesMargin, 'A5 at least one point touches the margin');
}

// ---------------------------------------------------------------- A6 ------
const A6_POINTS = [];
for (const z of [0, 1]) for (const y of [0, 1]) for (const x of [0, 1]) {
  A6_POINTS.push([40 + 6 * x, -11 + 8 * y, 12 * z]);
}
const A6_SCREEN = {
  persp: [[446.9794, 520.9262], [303.8701, 617.7272], [694.1744, 610.3995], [571.1380, 738.9831],
    [438.1195, 105.1306], [265.1430, 145.5185], [732.0585, 142.3878], [588.0533, 199.1733]],
  ortho: [[428.8620, 562.2474], [271.5113, 653.6493], [728.4887, 647.5812], [571.1380, 738.9831],
    [428.8620, 61.0169], [271.5113, 152.4188], [728.4887, 146.3507], [571.1380, 237.7526]]
};

function A6(CL) {
  currentCase = 'A6 TestSupercellFit';
  const cam = new CL.Camera();
  const expect = {
    persp: { dist: 27.308037887654447, near: 10.125488600659807, far: 76.35928626718771 },
    ortho: { dist: 25.407507266415358, near: 8.224957979420719, far: 74.45875564594863 }
  };
  for (const ortho of [false, true]) {
    orthoOn(cam, ortho);
    cam.fitScenePoints(A6_POINTS, 1.25, 1.18);
    nearVec(cam.target, [43, -7, 6], 1e-9, 'A6 target = bbox center (' + (ortho ? 'ortho' : 'persp') + ')');
    const key = ortho ? 'ortho' : 'persp';
    near(cam.distance, expect[key].dist, 1e-9, 'A6 distance (' + key + ')');
    near(cam.nearPlane(), expect[key].near, 1e-9, 'A6 nearPlane (' + key + ')');
    near(cam.farPlane(), expect[key].far, 1e-9, 'A6 farPlane (' + key + ')');
    for (let i = 0; i < A6_POINTS.length; i++) {
      const q = cam.worldToScreen(A6_POINTS[i], 1000, 800);
      check(q.visible && q.x > 0 && q.y > 0 && q.x < 1000 && q.y < 800,
        'A6 corner ' + i + ' inside (' + key + ')', JSON.stringify(q));
      near(q.x, A6_SCREEN[key][i][0], 0.05, 'A6 corner ' + i + ' x (' + key + ')');
      near(q.y, A6_SCREEN[key][i][1], 0.05, 'A6 corner ' + i + ' y (' + key + ')');
    }
  }
}

// ---------------------------------------------------------------- A7 ------
function A7(CL) {
  currentCase = 'A7 defaults / planes / gesture signs';
  const cam = new CL.Camera();
  nearVec(cam.target, [0, 0, 0], 1e-12, 'A7 default target');
  near(cam.distance, 20, 1e-12, 'A7 default distance');
  near(cam.yaw / DEG, 35, 1e-12, 'A7 default yaw');
  near(cam.pitch / DEG, 24, 1e-12, 'A7 default pitch');
  near(cam.fovY / DEG, 38, 1e-12, 'A7 default fovY');
  check(cam.orthographic === false, 'A7 default orthographic=false');

  cam.setScene([0, 0, 0], 0.2);
  const sr = (typeof cam.sceneRadius === 'number') ? cam.sceneRadius : cam.sceneRadius_;
  near(sr, 0.5, 1e-12, 'A7 scene radius clamped to >= 0.5');
  cam.distance = 1.0;
  near(cam.nearPlane(), 0.02, 1e-12, 'A7 nearPlane floor 0.02');
  cam.distance = 30;
  near(cam.farPlane(), Math.max(cam.nearPlane() + 2, cam.distance + 5 * sr + 10), 1e-9, 'A7 farPlane formula');

  // gesture signs
  const c2 = new CL.Camera();
  c2.reset([0, 0, 0], 5, 1.5);
  const p0 = c2.pitch;
  c2.orbit(0, 10);
  check(c2.pitch > p0, 'A7 orbit(0,+y) increases pitch');
  const t0 = c2.target.slice();
  const r0 = c2.right();
  c2.pan(50, 0, 1000, 800);
  const delta = sub(c2.target, t0);
  check(dot(delta, r0) < 0, 'A7 pan(+dx) moves target along -right');
  const d0 = c2.distance;
  c2.zoom(1);
  near(c2.distance / d0, Math.exp(-0.16), 1e-9, 'A7 zoom(+1) factor exp(-0.16)');

  // worldToScreen <-> screenRay round-trip
  orthoOn(c2, false);
  c2.reset([0, 0, 0], 5, 1.5);
  const eye = c2.eye(), fwd = c2.forward();
  for (let i = -2; i <= 2; i++) {
    const p = add(add(eye, mul(fwd, 12)), [i * 1.7, i * -0.9, i * 0.6]);
    const s = c2.worldToScreen(p, 1280, 800);
    if (!check(s.visible, 'A7 roundtrip point ' + i + ' visible')) continue;
    const ray = c2.screenRay(s.x, s.y, 1280, 800);
    const t = dot(sub(p, ray.origin), ray.direction);
    const closest = add(ray.origin, mul(ray.direction, t));
    near(len(sub(closest, p)), 0, 1e-6, 'A7 worldToScreen/screenRay roundtrip point ' + i);
  }
  orthoOn(c2, true);
  // Points behind/at the eye plane are invisible by design (C++ returns
  // visible=false when the view-space z <= 0); check a point in front instead.
  const front = add(c2.eye(), mul(c2.forward(), 10));
  const sc = c2.worldToScreen(front, 1000, 800);
  const rayO = c2.screenRay(500, 400, 1000, 800);
  near(len(rayO.direction), 1, 1e-9, 'A7 ortho ray unit');
  check(sc.visible, 'A7 ortho point in front of the camera is visible');
}

function main() {
  const argv = process.argv.slice(2);
  let jsonOut = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') jsonOut = argv[++i];
  }
  let CL;
  try {
    CL = setup();
    A1(CL); A2(CL); A3(CL); A4(CL); A5(CL); A6(CL); A7(CL);
  } catch (e) {
    results.push({ case: currentCase, ok: false, msg: 'exception: ' + (e && e.stack || e) });
  }
  const caseNames = ['A1 TestFitFramesTheScene', 'A2 TestRayThroughCenter', 'A3 TestOrbitAndZoom',
    'A4 TestOrthographic', 'A5 TestTightPointFit', 'A6 TestSupercellFit', 'A7 defaults / planes / gesture signs'];
  const report = { generatedAt: new Date().toISOString(), cases: [], failures: results };
  for (const name of caseNames) {
    const bad = results.filter(r => r.case === name);
    report.cases.push({ id: name, ok: bad.length === 0, failures: bad.length });
  }
  const total = results.length;
  for (const c of report.cases) console.log((c.ok ? 'ok   ' : 'FAIL ') + c.id + (c.ok ? '' : ' (' + c.failures + ')'));
  for (const f of results) console.log('  - ' + f.case + ' :: ' + f.msg);
  console.log('\ncamera cases: ' + report.cases.filter(c => c.ok).length + '/' + report.cases.length +
    ' passed, ' + total + ' failed assertion(s)');
  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2), 'utf8');
    console.log('report: ' + path.resolve(jsonOut));
  }
  process.exit(total ? 1 : 0);
}

main();
