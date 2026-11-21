#!/usr/bin/env node
/**
 * CrystalLens Android - headless visual QA suite.
 *
 * Runs the single-file preview (or dist/preview) through a matrix of scenarios
 * with the Chromium headless screenshot helper and writes a contact sheet
 * (tests/headless/out/index.html) plus a machine-readable report.
 *
 * Usage:
 *   node tests/headless/run_suite.cjs [--target single|folder] [--only <substr>]
 *
 * Exit code: 0 if every scenario rendered without page errors, 1 otherwise.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const SHOT = path.join(__dirname, 'shot.cjs');
const BUDGET = 15000;

function parseArgs() {
  const args = { target: 'single', only: null, width: null, height: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--only') args.only = argv[++i];
  }
  return args;
}

function baseUrl(target) {
  if (target === 'folder') {
    return 'file:///' + path.join(ROOT, 'dist', 'preview', 'index.html').replace(/\\/g, '/');
  }
  return 'file:///' + path.join(ROOT, 'dist', 'CrystalLens-Android-Preview.html').replace(/\\/g, '/');
}

// Scenarios: name, url params, viewport.
const SCENARIOS = [
  // desktop / tablet
  { name: 'desktop-halite', q: '?lib=halite', w: 1280, h: 800 },
  { name: 'desktop-quartz-poly', q: '?lib=quartz&style=polyhedral', w: 1280, h: 800 },
  { name: 'desktop-fluorite-spacefill', q: '?lib=fluorite&style=space-fill', w: 1280, h: 800 },
  { name: 'desktop-srtio3-supercell', q: '?lib=perovskite&supercell=2x2x2', w: 1280, h: 800 },
  { name: 'desktop-halite-en', q: '?lib=halite&lang=en', w: 1280, h: 800 },
  // phone portrait
  { name: 'phone-halite', q: '?lib=halite', w: 390, h: 844 },
  { name: 'phone-quartz-poly', q: '?lib=quartz&style=polyhedral', w: 390, h: 844 },
  { name: 'phone-diamond', q: '?lib=diamond&supercell=2x2x2', w: 390, h: 844 },
  { name: 'phone-fluorite-spacefill', q: '?lib=fluorite&style=space-fill', w: 390, h: 844 },
  // phone landscape
  { name: 'land-quartz', q: '?lib=quartz', w: 844, h: 390 },
  { name: 'land-poly', q: '?lib=quartz&style=polyhedral', w: 844, h: 390 },
  // examples + library entry points
  { name: 'example-water', q: '?example=water.xyz', w: 390, h: 844 },
  { name: 'example-nacl-vesta', q: '?example=nacl.vesta', w: 390, h: 844 },
  { name: 'library-open', q: '?library=1', w: 390, h: 844 }
];

function main() {
  const args = parseArgs();
  fs.mkdirSync(OUT, { recursive: true });
  const url = baseUrl(args.target);
  const report = { target: url, generatedAt: new Date().toISOString(), scenarios: [] };
  let failures = 0;

  for (const sc of SCENARIOS) {
    if (args.only && !sc.name.includes(args.only)) continue;
    const out = path.join(OUT, sc.name + '.png');
    const fullUrl = url + sc.q;
    process.stdout.write(`[shot] ${sc.name} (${sc.w}x${sc.h}) ... `);
    const res = spawnSync(process.execPath, [
      SHOT,
      '--url', fullUrl,
      '--out', out,
      '--width', String(sc.w),
      '--height', String(sc.h),
      '--budget', String(BUDGET)
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: BUDGET + 60000 });
    let info = null;
    try { info = JSON.parse(res.stdout.slice(res.stdout.indexOf('{'))); } catch (e) { /* keep null */ }
    const ok = res.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 2000;
    if (!ok) failures++;
    report.scenarios.push({
      name: sc.name,
      url: fullUrl,
      width: sc.w,
      height: sc.h,
      screenshot: path.relative(ROOT, out).replace(/\\/g, '/'),
      bytes: fs.existsSync(out) ? fs.statSync(out).size : 0,
      ok,
      errors: info ? info.pageErrors : (res.stderr || '').slice(-500)
    });
    console.log(ok ? 'ok' : 'FAIL');
    if (!ok && res.stderr) console.error(res.stderr.split('\n').slice(-6).join('\n'));
  }

  // contact sheet
  const rows = report.scenarios.map(sc => {
    const rel = path.basename(sc.screenshot);
    return `<figure><a href="${rel}"><img src="${rel}" loading="lazy" alt="${sc.name}" width="${
      Math.round(sc.width / 3)}"></a><figcaption>${sc.name} · ${sc.width}×${sc.height} · ${
      sc.bytes} B ${sc.ok ? '' : '❌'}</figcaption></figure>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CrystalLens visual QA</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px system-ui;margin:24px}
h1{font-size:18px}figure{display:inline-block;vertical-align:top;margin:8px;border:1px solid #30363d;border-radius:8px;padding:6px;background:#161b22}
img{display:block;border-radius:4px}figcaption{color:#8b949e;font-size:12px;margin-top:4px;max-width:420px}</style></head>
<body><h1>CrystalLens visual QA — ${report.scenarios.length} scenarios (${failures} failed)</h1>${rows}</body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
  const reportPath = path.join(__dirname, 'visual-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nreport: ${reportPath}`);
  console.log(`contact sheet: ${path.join(OUT, 'index.html')}`);
  console.log(`${report.scenarios.length - failures}/${report.scenarios.length} scenarios ok`);
  process.exit(failures ? 1 : 0);
}

main();
