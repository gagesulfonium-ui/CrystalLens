#!/usr/bin/env node
/**
 * CrystalLens Android - install-free preview checker (QA-ACCEPTANCE.md §5).
 *
 * Verifies:
 *   - dist/CrystalLens-Android-Preview.html is a real single self-contained file
 *     (no local <script src>/<link href>/<img src>, no fetch/XHR/Worker/module
 *     imports, no external CDN URLs) and stays under the 2 MB budget;
 *   - the embedded offline data contains the whole 12-structure crystal library
 *     and the 6 examples (CL.data.library / CL.data.examples);
 *   - dist/preview/ folder build exists, has no dangling local references and
 *     carries build.json metadata.
 *
 * Usage:
 *   node tests/qa/check_preview.cjs [--json <path>]
 * Exit code: 0 pass, 1 failure, 2 setup error.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SINGLE = path.join(ROOT, 'dist', 'CrystalLens-Android-Preview.html');
const PREVIEW = path.join(ROOT, 'dist', 'preview');
const MAX_SINGLE_BYTES = 2 * 1024 * 1024; // CONTRACT §3: single-file HTML <= 2 MB

const checks = [];
function check(id, ok, detail) {
  checks.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  return !!ok;
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

// URLs that are harmless (XML namespaces / SVG / metadata, never fetched).
const URL_WHITELIST = [
  /^http:\/\/www\.w3\.org\//i,
  /^https?:\/\/www\.crystallography\.net\//i,   // CIF provenance comments (data, not a request)
  /^https?:\/\/rruff\.geo\.arizona\.edu\//i,
  /^https?:\/\/pubs\./i,
  /^https?:\/\/dx\.doi\.org\//i
];

function scanExternalUrls(text) {
  const found = [];
  const re = /https?:\/\/[^\s"'<>)\]]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = m[0];
    if (URL_WHITELIST.some(rx => rx.test(url))) continue;
    found.push(url);
  }
  return [...new Set(found)];
}

function scanLocalRefs(text) {
  const refs = [];
  // Require whitespace/line-start before src|href so build_web.py's
  // <script data-src="js/..."> provenance attribute is not mis-flagged.
  const re = /(?:^|[\s"'])(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[1];
    if (!v) continue;
    if (/^(data:|#|mailto:|tel:|javascript:)/i.test(v)) continue;
    if (/^https?:/i.test(v)) continue;
    refs.push(v);
  }
  return [...new Set(refs)];
}

function checkSingleFile() {
  if (!check('single.exists', fs.existsSync(SINGLE), SINGLE)) return;
  const text = read(SINGLE);
  const bytes = fs.statSync(SINGLE).size;
  check('single.size', bytes > 20000 && bytes <= MAX_SINGLE_BYTES,
    bytes + ' bytes (budget ' + MAX_SINGLE_BYTES + ')');
  check('single.has-doctype', /<!DOCTYPE html>/i.test(text), '');
  check('single.inline-script-count', (text.match(/<script\b/gi) || []).length >= 20,
    (text.match(/<script\b/gi) || []).length + ' <script> blocks');

  // 1) no local references (script src / stylesheet / images)
  const scriptSrc = /<script[^>]*\ssrc\s*=/i.test(text);
  check('single.no-script-src', !scriptSrc, scriptSrc ? 'found <script src=...>' : '');
  const cssLink = /<link[^>]+rel=["']stylesheet["']/i.test(text);
  check('single.no-css-link', !cssLink, cssLink ? 'found <link rel=stylesheet>' : '');
  const localRefs = scanLocalRefs(text);
  check('single.no-local-refs', localRefs.length === 0, localRefs.slice(0, 8).join(', '));

  // 2) no network APIs / module imports / workers
  const network = [];
  if (/\bfetch\s*\(/.test(text)) network.push('fetch(');
  if (/\bXMLHttpRequest\b/.test(text)) network.push('XMLHttpRequest');
  if (/\bnew\s+Worker\s*\(/.test(text)) network.push('new Worker(');
  if (/type\s*=\s*["']module["']/i.test(text)) network.push('type="module"');
  if (/\bimport\s*\(\s*["']/.test(text)) network.push('dynamic import(');
  if (/\bWebSocket\s*\(/.test(text)) network.push('WebSocket(');
  if (/\bserviceWorker\b/.test(text)) network.push('serviceWorker');
  check('single.offline-apis', network.length === 0, network.join(', '));

  // 3) no external URLs except harmless namespace/provenance strings
  const ext = scanExternalUrls(text);
  check('single.no-external-urls', ext.length === 0, ext.slice(0, 8).join(', '));

  // 4) embedded library + examples
  const crystals = (text.match(/"kind":\s*"crystal"/g) || []).length;
  const examples = (text.match(/"kind":\s*"example"/g) || []).length;
  check('single.embedded-crystals', crystals === 12, crystals + ' embedded crystal entries');
  check('single.embedded-examples', examples === 6, examples + ' embedded example entries');
  check('single.embedded-cif-count', (text.match(/data_9003308|data_alpha_quartz|data_diamond/g) || []).length >= 2,
    'spot-check CIF payloads');
  check('single.has-CL.assets', /CL\.assets\s*=\s*\{/.test(text), 'build_web.py must inject CL.assets');
  check('single.has-build-meta', /name="crystallens-build"/.test(text), '');

  // 5) inline data: URIs for brand images
  const dataUris = (text.match(/data:image\/png;base64,/g) || []).length;
  check('single.inline-images', dataUris >= 1, dataUris + ' inline PNG data URIs');
  console.log('[single] ' + bytes + ' bytes, ' + crystals + ' crystals, ' + examples +
    ' examples, ' + dataUris + ' inline PNGs');
}

function checkFolder() {
  const index = path.join(PREVIEW, 'index.html');
  if (!check('folder.exists', fs.existsSync(index), PREVIEW)) return;
  const text = read(index);
  const refs = scanLocalRefs(text);
  const missing = refs.filter(r => !fs.existsSync(path.join(PREVIEW, r.split('?')[0])));
  check('folder.refs-exist', missing.length === 0, missing.slice(0, 8).join(', '));
  check('folder.script-tag-present', /<script[^>]+src=/i.test(text), '');
  const buildJson = path.join(PREVIEW, 'build.json');
  let meta = null;
  try { meta = JSON.parse(read(buildJson)); } catch (e) { /* missing */ }
  check('folder.build-json', !!meta && meta.app === 'CrystalLens' && meta.version === '1.1.0',
    meta ? JSON.stringify(meta) : 'missing dist/preview/build.json');
  // data dir is intentionally not shipped (embedded in js/data/library.js)
  check('folder.no-web-data-dir', !fs.existsSync(path.join(PREVIEW, 'data')),
    'dist/preview/data must not exist (library is embedded)');
  let count = 0;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else count++;
    }
  })(PREVIEW);
  check('folder.file-count', count >= 20, count + ' files');
  console.log('[folder] ' + count + ' files');
}

function main() {
  const argv = process.argv.slice(2);
  let jsonOut = null;
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--json') jsonOut = argv[++i];
  try {
    checkSingleFile();
    checkFolder();
  } catch (e) {
    checks.push({ id: 'exception', ok: false, detail: String(e && e.stack || e) });
  }
  const failed = checks.filter(c => !c.ok);
  for (const c of checks) {
    if (!c.ok) console.log('FAIL ' + c.id + (c.detail ? ' :: ' + c.detail : ''));
  }
  console.log('\npreview checks: ' + (checks.length - failed.length) + '/' + checks.length +
    ' passed, ' + failed.length + ' failed');
  const report = { generatedAt: new Date().toISOString(), singleFile: SINGLE, checks, failed: failed.length };
  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(report, null, 2), 'utf8');
    console.log('report: ' + path.resolve(jsonOut));
  }
  process.exit(failed.length ? 1 : 0);
}

main();
