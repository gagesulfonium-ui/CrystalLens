#!/usr/bin/env node
/**
 * CrystalLens Android - dependency-free Node test runner.
 *
 * Loads the shared core scripts in the same order as the browser (see
 * docs/CONTRACT.md §4), then runs every tests/node/test_*.js in this VM context.
 * Render/UI files are not loaded here (they need DOM/WebGL); they are covered by
 * headless browser tests (tests/headless).
 *
 * Usage: node tests/node/run.js [filter]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

// Core (DOM-free) scripts, in load order. Keep in sync with CONTRACT §4.
const CORE_FILES = [
  'web/js/lib/math.js',
  'web/js/lib/periodic_table.js',
  'web/js/core/cif.js',
  'web/js/core/xyz.js',
  'web/js/core/vesta.js',
  'web/js/core/parsers.js',
  'web/js/core/crystal.js',
  'web/js/core/measure.js',
  'web/js/core/edit.js',
  'web/js/core/export.js',
  'web/js/core/format.js'
];

const sandbox = {
  console,
  Math,
  JSON,
  Date,
  parseFloat,
  parseInt,
  isFinite,
  isNaN,
  Float32Array,
  Uint32Array,
  Uint16Array,
  Uint8Array,
  Int32Array,
  ArrayBuffer,
  DataView,
  Map,
  Set,
  TextEncoder,
  TextDecoder,
  Promise,
  setTimeout,
  clearTimeout
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

const loaded = [];
const missing = [];
for (const rel of CORE_FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { missing.push(rel); continue; }
  try {
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: rel });
    loaded.push(rel);
  } catch (e) {
    console.error(`[FATAL] failed loading ${rel}: ${e && e.stack || e}`);
    process.exit(2);
  }
}
sandbox.CL = sandbox.CL || {};
console.log(`loaded ${loaded.length} core script(s)` + (missing.length ? ` (missing: ${missing.join(', ')})` : ''));

// ------------------------------------------------------------- harness ----
let numTests = 0, numPassed = 0, numFailed = 0;
const failures = [];
let currentFile = '';

function test(name, fn) {
  numTests++;
  try {
    fn(sandbox.CL);
    numPassed++;
  } catch (e) {
    numFailed++;
    failures.push({ file: currentFile, name, error: e });
    console.error(`[FAIL] ${currentFile} :: ${name}\n       ${(e && e.message || e).toString().split('\n')[0]}`);
  }
}
sandbox.test = test;

// Fixture helper: read a UTF-8 file relative to the repo root. Tests use this to
// load real CIF/XYZ/VESTA files from web/data/.
sandbox.readText = function (relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
};
sandbox.repoRoot = ROOT;

function approx(actual, expected, eps = 1e-6, msg = '') {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${msg || 'approx'} expected ${expected}, got ${actual} (eps ${eps})`);
  }
}
function approxVec(actual, expected, eps = 1e-6, msg = '') {
  if (!actual || actual.length !== expected.length) throw new Error(`${msg || 'vec'} bad shape`);
  for (let i = 0; i < expected.length; i++) {
    if (!(Math.abs(actual[i] - expected[i]) <= eps)) {
      throw new Error(`${msg || 'vec'}[${i}] expected ${expected[i]}, got ${actual[i]}`);
    }
  }
}
sandbox.approx = approx;
sandbox.approxVec = approxVec;

// --------------------------------------------------------------- tests ----
const filter = process.argv[2] || '';
const testDir = path.join(__dirname);
const files = fs.readdirSync(testDir)
  .filter(f => /^test_.*\.js$/.test(f))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error('no tests/node/test_*.js found');
  process.exit(2);
}

for (const file of files) {
  currentFile = file;
  const abs = path.join(testDir, file);
  try {
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox, { filename: `tests/node/${file}` });
  } catch (e) {
    numFailed++;
    failures.push({ file, name: '<load>', error: e });
    console.error(`[FAIL] loading ${file}: ${e && e.stack || e}`);
  }
}

// ------------------------------------------------------------- summary ----
console.log('');
console.log(`tests: ${numTests}  passed: ${numPassed}  failed: ${numFailed}`);
if (numFailed) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`- ${f.file} :: ${f.name}`);
    console.log(`  ${(f.error && f.error.message || f.error)}`);
  }
  process.exit(1);
}
process.exit(0);
