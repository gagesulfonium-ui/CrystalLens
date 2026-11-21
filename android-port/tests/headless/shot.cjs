#!/usr/bin/env node
/**
 * CrystalLens Android - headless browser screenshot / DOM-selftest helper.
 *
 * Uses the locally installed Microsoft Edge (Chromium) in headless mode, so no
 * npm dependencies are required. WebGL is rendered through ANGLE/SwiftShader.
 *
 * Examples:
 *   node tests/headless/shot.mjs --url "file:///path/to/android-port/dist/preview/index.html?lib=halite" --out shots/halite.png
 *   node tests/headless/shot.mjs --url "file:///path/to/android-port/dist/preview/index.html?selftest=1" --selftest
 *   node tests/headless/shot.mjs --url "http://127.0.0.1:8000/?lib=quartz&style=polyhedral" --out shots/quartz-poly.png --width 1280 --height 800
 *
 * Exit codes: 0 ok; 1 page failures (selftest), 2 browser/launch error.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const out = { width: 1280, height: 800, budget: 8000, dpr: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') out.selftest = true;
    else if (a === '--dom') out.dom = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function findBrowser() {
  const candidates = [
    process.env.CRYSTAL_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function toFileUrl(p) {
  if (!p) return p;
  if (/^(file|http|https|data):/.test(p)) return p;
  let abs = path.resolve(p).replace(/\\/g, '/');
  return 'file:///' + abs.replace(/^\/+/, '');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('usage: node tests/headless/shot.mjs --url <url> [--out shot.png] [--selftest] [--width N] [--height N] [--budget ms]');
    return 2;
  }
  const browser = findBrowser();
  if (!browser) {
    console.error('[error] no Chromium-based browser found (set CRYSTAL_BROWSER)');
    return 2;
  }
  const out = args.out ? path.resolve(args.out) : null;
  if (out) fs.mkdirSync(path.dirname(out), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-headless-'));
  const url = toFileUrl(args.url);

  const common = [
    '--headless=new',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=' + args.dpr,
    '--window-size=' + args.width + ',' + args.height,
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=' + args.budget,
    '--run-all-compositor-stages-before-draw',
    '--disable-features=Translate,MediaRouter'
  ];

  const captureDom = args.dom || args.selftest;
  const cmdArgs = common.slice();
  if (out) cmdArgs.push('--screenshot=' + out);
  if (captureDom) cmdArgs.push('--dump-dom');
  cmdArgs.push(url);

  const started = Date.now();
  const res = spawnSync(browser, cmdArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: Math.max(30000, Number(args.budget) + 30000)
  });
  const elapsed = Date.now() - started;
  if (res.error) {
    console.error('[error] failed to launch browser:', res.error.message);
    return 2;
  }
  if (res.status !== 0) {
    console.error('[warn] browser exit code', res.status);
    if (res.stderr) console.error(res.stderr.split('\n').slice(-20).join('\n'));
  }
  const dom = res.stdout || '';

  // extract page error log captured by the app (window.onerror -> #cl-error-log)
  const errMatch = dom.match(/<pre[^>]*id="cl-error-log"[^>]*>([\s\S]*?)<\/pre>/);
  let pageErrors = [];
  if (errMatch) {
    try { pageErrors = JSON.parse(decodeURIComponent(errMatch[1].trim()) || '[]'); } catch (e) { pageErrors = [errMatch[1].trim()]; }
  }
  const consoleErrorLines = (res.stderr || '').split('\n').filter(l => {
    // Only page-level diagnostics, not Chromium internals (importer, GCM, etc.).
    if (/CONSOLE\(|Uncaught|WebGL|GL_INVALID|GL_ERROR|THREE\.|CL\./i.test(l) === false) return false;
    if (/importer|QQBrowser|registration_protocol|gcm|GCM|net_error|DevTools/i.test(l)) return false;
    return true;
  }).slice(0, 20);
  const allErrors = pageErrors.concat(consoleErrorLines);

  let selftest = null;
  if (args.selftest) {
    const m = dom.match(/<pre[^>]*id="cl-selftest"[^>]*>([\s\S]*?)<\/pre>/);
    if (!m) {
      console.error('[FAIL] no #cl-selftest element in DOM; app selftest mode not implemented or failed to load');
      console.error('--- dom head ---');
      console.error(dom.slice(0, 2000));
      return 1;
    }
    const raw = m[1].trim();
    try { selftest = JSON.parse(raw); } catch (e) {
      console.error('[FAIL] #cl-selftest is not valid JSON:', raw.slice(0, 500));
      return 1;
    }
  }

  if (args.dom && !args.out) {
    process.stdout.write(dom);
  }

  const report = {
    url,
    browser,
    elapsedMs: elapsed,
    screenshot: out || null,
    screenshotBytes: out && fs.existsSync(out) ? fs.statSync(out).size : 0,
    pageErrors: allErrors,
    selftest
  };
  console.log(JSON.stringify(report, null, 2));

  if (out && (!fs.existsSync(out) || fs.statSync(out).size < 1000)) {
    console.error('[FAIL] screenshot missing or suspiciously small');
    return 1;
  }
  if (allErrors.length) {
    console.error('[FAIL] page reported errors');
    return 1;
  }
  if (selftest && selftest.fail > 0) {
    console.error('[FAIL] selftest failures:', JSON.stringify(selftest.failures || [], null, 2));
    return 1;
  }
  return 0;
}

process.exit(main());
