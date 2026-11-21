/**
 * CrystalLens Android - application controller (CL.App).
 *
 * Owns: settings persistence, multi-document sessions (tabs), file open,
 * renderer + camera wiring, pointer/keyboard interaction, selection,
 * measurement, editing with undo/redo, save/export/share, drawers and the
 * Android back-button / shared-file hooks, QA URL hooks and the self test.
 *
 * Classic script: attaches CL.App and CL.ui helpers. No ES modules / fetch.
 * Contract: docs/CONTRACT.md 6.9, 6.10, 8; UI spec: docs/spec/ui.md.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = root.document;
  var ui = CL.ui = CL.ui || {};

  // ------------------------------------------------------------ constants --
  var APP_VERSION = (CL.data && CL.data.app && CL.data.app.version) || '1.1.0';
  var SETTINGS_KEY = 'crystallens.settings.v1';
  var UNDO_DEPTH = 50;
  var SUPERCELL_MIN = 1;
  var SUPERCELL_MAX = 16;
  var ORBIT_SENSITIVITY = 0.0072;
  var PITCH_LIMIT = 85 * Math.PI / 180;
  var ZOOM_STEP = 0.16;
  var FIT_MARGIN = 1.18;
  var TAU = Math.PI * 2;
  var reduceMotion = false;
  try { reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { reduceMotion = false; }

  var DEFAULT_APPEARANCE = {
    cellColor: 0xD6DEE9,
    backgroundColor: 0x020305,
    cellLineWidth: 1.0,
    polyTransparency: 66,
    polyEdgeWidth: 1.2,
    polyEdgeColor: 0x91B4D3
  };

  var DEFAULT_SETTINGS = {
    version: 1,
    language: 'zh',
    leftPanel: true,
    rightPanel: true,
    showCell: true,
    showBonds: true,
    showLabels: false,
    showBoundary: true,
    showAxes: true,
    orthographic: false,
    style: 'ball-stick',
    atomScale: 0.3,
    bondRadius: 0.105,
    supercell: [1, 1, 1],
    appearance: DEFAULT_APPEARANCE
  };

  var dom = {};

  // ---------------------------------------------------------------- utils --
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function now() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function fmt(v, decimals) {
    var n = num(v);
    if (!isFinite(n)) return '—';
    return n.toFixed(decimals == null ? 3 : decimals);
  }
  function fmtLen(v) {
    if (CL.crystal && typeof CL.crystal.formatLength === 'function') {
      try { var s = CL.crystal.formatLength(v); if (typeof s === 'string' && s) return s; } catch (e) { /* fall through */ }
    }
    return fmt(v, 3) + ' \u00C5';
  }
  function fmtAngle(v) {
    if (CL.crystal && typeof CL.crystal.formatAngle === 'function') {
      try { var s = CL.crystal.formatAngle(v); if (typeof s === 'string' && s) return s; } catch (e) { /* fall through */ }
    }
    return fmt(v, 2) + '\u00B0';
  }
  function fmtCoord(v) {
    if (CL.crystal && typeof CL.crystal.formatCoord === 'function') {
      try { var s = CL.crystal.formatCoord(v); if (typeof s === 'string' && s) return s; } catch (e) { /* fall through */ }
    }
    return fmt(v, 3);
  }
  function fmtVec(vec, decimals) {
    if (!vec) return '—';
    return 'x ' + fmt(vec[0], decimals) + '   y ' + fmt(vec[1], decimals) + '   z ' + fmt(vec[2], decimals);
  }
  function fmtDeg(v) { return fmt(v, 2) + '\u00B0'; }
  function fmtVol(v) { return fmt(v, 2) + ' \u00C5\u00B3'; }

  function u32ToHex(u32) {
    var v = (Number(u32) >>> 0) & 0xFFFFFF;
    var s = v.toString(16).toUpperCase();
    while (s.length < 6) s = '0' + s;
    return '#' + s;
  }
  function hexToU32(hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    return parseInt(m[1], 16);
  }
  function u32ToRgb(u32) {
    var v = (Number(u32) >>> 0) & 0xFFFFFF;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  function rgbToU32(rgb) {
    var r = Math.round(clamp(rgb[0], 0, 1) * 255);
    var g = Math.round(clamp(rgb[1], 0, 1) * 255);
    var b = Math.round(clamp(rgb[2], 0, 1) * 255);
    return (r << 16) | (g << 8) | b;
  }
  function u32ToCss(u32) {
    var v = (Number(u32) >>> 0) & 0xFFFFFF;
    return 'rgb(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ')';
  }
  function u32ToRgba(u32, alpha) {
    var v = (Number(u32) >>> 0) & 0xFFFFFF;
    return 'rgba(' + ((v >> 16) & 255) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + alpha + ')';
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }
  function rgbToHsv(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d > 1e-6) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max <= 1e-6 ? 0 : d / max, max];
  }
  function lightenColor(rgb, amount) {
    return [rgb[0] + (1 - rgb[0]) * amount, rgb[1] + (1 - rgb[1]) * amount, rgb[2] + (1 - rgb[2]) * amount];
  }

  ui.escapeHtml = esc;
  ui.fmt = fmt;
  ui.fmtLen = fmtLen;
  ui.fmtAngle = fmtAngle;
  ui.fmtCoord = fmtCoord;
  ui.fmtVec = fmtVec;
  ui.fmtVol = fmtVol;
  ui.fmtDeg = fmtDeg;
  ui.clamp = clamp;
  ui.u32ToHex = u32ToHex;
  ui.hexToU32 = hexToU32;
  ui.u32ToCss = u32ToCss;
  ui.u32ToRgba = u32ToRgba;
  ui.u32ToRgb = u32ToRgb;
  ui.rgbToU32 = rgbToU32;
  ui.hsvToRgb = hsvToRgb;
  ui.rgbToHsv = rgbToHsv;
  ui.lightenColor = lightenColor;
  ui.now = now;

  // ---------------------------------------------------------------- icons --
  var ICON_PATHS = {
    open: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M3 11h18"/>',
    library: '<path d="M12 3.2 20 7.6 12 12 4 7.6z"/><path d="M4 12.4 12 16.8 20 12.4"/><path d="M4 16.6 12 21 20 16.6"/>',
    undo: '<path d="M5 9h9.5a5.5 5.5 0 0 1 0 11H11"/><path d="M8.5 5.5 5 9l3.5 3.5"/>',
    redo: '<path d="M19 9h-9.5a5.5 5.5 0 0 0 0 11H13"/><path d="M15.5 5.5 19 9l-3.5 3.5"/>',
    save: '<path d="M5 4.5h11L20 8.5v11H5z"/><path d="M8 4.5V10h8V4.5"/><path d="M8 15h8v4.5H8z"/>',
    camera: '<path d="M4 8.5h3l1.4-2h7.2L17 8.5h3v11H4z"/><circle cx="12" cy="13.5" r="3.6"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4.5 4.5v4.6h4.6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    cube: '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M12 12 20 8"/><path d="M12 12 4 8"/><path d="M12 12v8.5"/>',
    cell: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><circle cx="4" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="20" cy="20" r="1.3" fill="currentColor" stroke="none"/>',
    bond: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="7" r="3"/><path d="M9.1 14.9 14.9 9.1"/>',
    label: '<path d="M4 5h9l7 7-7 7H4z"/><circle cx="11.5" cy="12" r="1.6"/>',
    ruler: '<path d="M4.5 15.5 15.5 4.5l4 4-11 11z"/><path d="M8.5 15.5 11 13"/><path d="M6.5 13.5 9 11"/><circle cx="4.5" cy="19.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="19.5" cy="8.5" r="0.9" fill="currentColor" stroke="none"/>',
    angle: '<path d="M5 18 12 7l7 11"/><path d="M8.4 13.6a5.4 5.4 0 0 0 7.2 0"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
    'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15" stroke-width="3.4" opacity="0.45"/><path d="M3.5 4.5h6v15h-6z" fill="currentColor" stroke="none" opacity="0.22"/>',
    'panel-right': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15" stroke-width="3.4" opacity="0.45"/><path d="M14.5 4.5h6v15h-6z" fill="currentColor" stroke="none" opacity="0.22"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/>',
    edit: '<path d="M5 19h3.5L19 8.5 15.5 5 5 15.5z"/><path d="M13.5 7 17 10.5"/>',
    'add-atom': '<circle cx="12" cy="12" r="5"/><path d="M12 6.2V2.8M12 21.2v-3.4M6.2 12H2.8M21.2 12h-3.4"/><path d="M17.5 6.5l1.6-1.6M4.9 19.1l1.6-1.6"/>',
    share: '<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M5 13v6.5h14V13"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 18.5h14"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8.5" cy="9" r="1.4"/><path d="M4 17l5-5 4 4 3-3 4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 5.5V4.5A1.5 1.5 0 0 0 14.5 3h-9A1.5 1.5 0 0 0 4 4.5v9A1.5 1.5 0 0 0 5.5 15h1"/>',
    reload: '<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7"/><path d="M4.5 4.5v4.6h4.6"/>',
    exit: '<path d="M14 4.5H6.5v15H14"/><path d="M11 12h9.5"/><path d="M17 8.5l3.5 3.5-3.5 3.5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.4 2.5c-.9.35-1.4 1-1.4 1.9v.5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    eye: '<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
    axes: '<path d="M5 19V5"/><path d="M5 19h14"/><path d="M5 11l4-4"/><path d="M14 5h5v5"/>'
  };
  function iconSvg(name, size) {
    var body = ICON_PATHS[name];
    var px = size || 20;
    var inner = body || '<circle cx="12" cy="12" r="7.5"/><path d="M12 7v10M7 12h10"/>';
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  ui.icon = function (name, size) { return iconSvg(name, size); };
  ui.hydrateIcons = function (scope) {
    var nodes = (scope || D).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var name = nodes[i].getAttribute('data-icon');
      if (!nodes[i].firstChild) nodes[i].innerHTML = iconSvg(name, 20);
    }
  };

  // ------------------------------------------------------------- settings --
  function cloneAppearance(appearance) {
    var a = appearance || DEFAULT_APPEARANCE;
    return {
      cellColor: Number(a.cellColor) >>> 0,
      backgroundColor: Number(a.backgroundColor) >>> 0,
      cellLineWidth: clamp(num(a.cellLineWidth) || 1, 0.5, 4),
      polyTransparency: Math.round(clamp(num(a.polyTransparency) || 0, 0, 100)),
      polyEdgeWidth: clamp(num(a.polyEdgeWidth) || 0, 0, 4),
      polyEdgeColor: Number(a.polyEdgeColor) >>> 0
    };
  }
  function normalizeSettings(raw) {
    var out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    raw = raw || {};
    out.language = raw.language === 'en' ? 'en' : 'zh';
    var bools = ['leftPanel', 'rightPanel', 'showCell', 'showBonds', 'showLabels', 'showBoundary', 'showAxes', 'orthographic'];
    for (var i = 0; i < bools.length; i++) {
      if (typeof raw[bools[i]] === 'boolean') out[bools[i]] = raw[bools[i]];
    }
    if (raw.style === 'ball-stick' || raw.style === 'space-fill' || raw.style === 'polyhedral') out.style = raw.style;
    if (isFinite(num(raw.atomScale))) out.atomScale = clamp(num(raw.atomScale), 0.15, 0.85);
    if (isFinite(num(raw.bondRadius))) out.bondRadius = clamp(num(raw.bondRadius), 0.02, 0.4);
    if (Array.isArray(raw.supercell)) {
      out.supercell = raw.supercell.map(function (v) {
        var n = Math.round(num(v));
        return isFinite(n) ? clamp(n, SUPERCELL_MIN, SUPERCELL_MAX) : 1;
      });
      if (out.supercell.length !== 3) out.supercell = [1, 1, 1];
    }
    if (raw.appearance && typeof raw.appearance === 'object') out.appearance = cloneAppearance(raw.appearance);
    return out;
  }
  function hasStorage() {
    try { return !!(root.localStorage && root.localStorage.setItem); } catch (e) { return false; }
  }

  // ------------------------------------------------------------- demo data --
  function cellFromMeta(meta) {
    var src = (meta && meta.cell) || null;
    var params = src ?
      [src.a, src.b, src.c, src.alpha, src.beta, src.gamma] :
      [6, 6, 6, 90, 90, 90];
    if (CL.Math && CL.Math.buildCell) {
      try {
        var cellData = CL.Math.buildCell(params[0], params[1], params[2], params[3], params[4], params[5]);
        if (cellData) return cellData;
      } catch (e) { /* fall back below */ }
    }
    var a = params[0], b = params[1], c = params[2];
    var alpha = (params[3] || 90) * Math.PI / 180, beta = (params[4] || 90) * Math.PI / 180, gamma = (params[5] || 90) * Math.PI / 180;
    var aVec = [a, 0, 0];
    var bVec = [b * Math.cos(gamma), b * Math.sin(gamma), 0];
    var cx = c * Math.cos(beta);
    var cy = c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / Math.max(Math.sin(gamma), 1e-9);
    var cz = Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy));
    return {
      a: a, b: b, c: c, alpha: params[3], beta: params[4], gamma: params[5],
      aVec: aVec, bVec: bVec, cVec: [cx, cy, cz],
      volume: Math.abs(aVec[0] * (bVec[1] * cz - bVec[2] * cy) - aVec[1] * (bVec[0] * cz - bVec[2] * cx) + aVec[2] * (bVec[0] * cy - bVec[1] * cx))
    };
  }
  function cellCornersSafe(cell) {
    if (CL.Math && CL.Math.cellCorners) {
      try { return CL.Math.cellCorners(cell); } catch (e) { /* fall through */ }
    }
    var corners = [];
    for (var i = 0; i < 8; i++) {
      var fx = (i & 1) ? 1 : 0, fy = (i & 2) ? 1 : 0, fz = (i & 4) ? 1 : 0;
      corners.push([
        cell.aVec[0] * fx + cell.bVec[0] * fy + cell.cVec[0] * fz,
        cell.aVec[1] * fx + cell.bVec[1] * fy + cell.cVec[1] * fz,
        cell.aVec[2] * fx + cell.bVec[2] * fy + cell.cVec[2] * fz
      ]);
    }
    return corners;
  }
  var CELL_EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];
  function fracToCartSafe(cell, frac) {
    if (CL.Math && CL.Math.fracToCart) {
      try { return CL.Math.fracToCart(cell, frac); } catch (e) { /* fall through */ }
    }
    return [
      cell.aVec[0] * frac[0] + cell.bVec[0] * frac[1] + cell.cVec[0] * frac[2],
      cell.aVec[1] * frac[0] + cell.bVec[1] * frac[1] + cell.cVec[1] * frac[2],
      cell.aVec[2] * frac[0] + cell.bVec[2] * frac[1] + cell.cVec[2] * frac[2]
    ];
  }
  function elementsFromFormula(formula) {
    var out = [];
    var re = /([A-Z][a-z]?)/g, m;
    while ((m = re.exec(String(formula || '')))) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
      if (out.length >= 6) break;
    }
    if (!out.length) out.push('C');
    return out;
  }
  function elementColor(element) {
    if (CL.periodic && CL.periodic.get) {
      try {
        var entry = CL.periodic.get(element);
        if (entry && entry.rgb) return entry.rgb.slice();
        if (entry && entry.colorHex) {
          var u = hexToU32(entry.colorHex);
          if (u != null) return u32ToRgb(u);
        }
      } catch (e) { /* ignore */ }
    }
    return [0.55, 0.62, 0.75];
  }
  function elementBaseRadius(element) {
    if (CL.periodic && CL.periodic.get) {
      try {
        var entry = CL.periodic.get(element);
        if (entry) return (entry.metal ? entry.covalent : entry.vdw) || entry.covalent || 1.2;
      } catch (e) { /* ignore */ }
    }
    return 1.2;
  }
  function siteLabel(element, index) { return String(element || 'X') + (index + 1); }

  // Build a plausible (but fake) display model so the UI has something to show
  // while the parser/renderer agents are still landing. Used only when the real
  // core is unavailable, and clearly marked as a demo.
  function buildDemoModel(meta) {
    var cell = cellFromMeta(meta);
    var corners = cellCornersSafe(cell);
    var origin = [0, 0, 0];
    for (var i = 0; i < corners.length; i++) {
      origin[0] += corners[i][0] / 8; origin[1] += corners[i][1] / 8; origin[2] += corners[i][2] / 8;
    }
    var elements = elementsFromFormula(meta && meta.formula);
    var atoms = [];
    var bondList = [];
    var threshold = Math.min(cell.a, cell.b, cell.c) * 0.62;
    var positionsFrac = [
      [0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
      [0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]
    ];
    for (var k = 0; k < positionsFrac.length; k++) {
      var frac = positionsFrac[k];
      var cart = fracToCartSafe(cell, frac);
      var element = elements[k % elements.length];
      atoms.push({
        id: k,
        siteId: k,
        symmetryIndex: 0,
        label: siteLabel(element, Math.floor(k / elements.length)),
        element: element,
        z: 0,
        frac: frac.slice(),
        pos: [cart[0] - origin[0], cart[1] - origin[1], cart[2] - origin[2]],
        color: elementColor(element),
        baseRadius: elementBaseRadius(element),
        kind: 'cell',
        pickable: true
      });
    }
    var bondId = 0;
    for (var a = 0; a < atoms.length; a++) {
      for (var b = a + 1; b < atoms.length; b++) {
        var dx = atoms[a].pos[0] - atoms[b].pos[0];
        var dy = atoms[a].pos[1] - atoms[b].pos[1];
        var dz = atoms[a].pos[2] - atoms[b].pos[2];
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 0.05 && dist <= threshold) {
          bondList.push({ id: bondId++, a: a, b: b, radius: 0.105, color: [0.55, 0.6, 0.68], periodic: false });
        }
      }
    }
    var lines = [];
    for (var e = 0; e < CELL_EDGES.length; e++) {
      var c0 = corners[CELL_EDGES[e][0]], c1 = corners[CELL_EDGES[e][1]];
      lines.push({
        p0: [c0[0] - origin[0], c0[1] - origin[1], c0[2] - origin[2]],
        p1: [c1[0] - origin[0], c1[1] - origin[1], c1[2] - origin[2]],
        kind: 'cell'
      });
    }
    lines.push({ p0: [0, 0, 0], p1: cell.aVec.slice(), kind: 'axes' });
    lines.push({ p0: [0, 0, 0], p1: cell.bVec.slice(), kind: 'axes' });
    lines.push({ p0: [0, 0, 0], p1: cell.cVec.slice(), kind: 'axes' });
    var lang = currentLanguage();
    var title = meta ? ((lang === 'en' ? meta.titleEn : meta.titleZh) || meta.titleEn || meta.titleZh || meta.file) : 'CrystalLens';
    return {
      title: title || 'CrystalLens',
      formula: (meta && meta.formula) || '—',
      cellContents: (meta && meta.formula) || '—',
      spaceGroup: (meta && meta.spaceGroup) || '',
      note: '',
      format: (meta && meta.format) || 'CIF',
      sourceName: (meta && meta.file) || '',
      cell: cell,
      supercell: [1, 1, 1],
      displayedCells: [1, 1, 1],
      showBoundary: false,
      origin: origin,
      stats: {
        asymmetricAtomCount: atoms.length,
        symmetryOperatorCount: 1,
        cellAtomCount: atoms.length,
        visibleAtomCount: atoms.length,
        boundaryAtomCount: 0,
        visibleBondCount: bondList.length,
        cellBondCount: bondList.length,
        polyhedronCount: 0,
        polyhedronCenterCount: 0,
        polyhedronTriangleCount: 0,
        supercellLimited: false,
        boundaryLimited: false
      },
      atoms: atoms,
      bonds: bondList,
      lines: lines,
      polyhedra: { enabled: false, centers: [], triangles: [], edges: [] },
      hasCell: true,
      demo: true
    };
  }

  // Minimal display-model fallback for a StructureData when the model layer is
  // not ready yet. Renders the asymmetric unit only (no symmetry expansion).
  function buildFallbackModel(structure) {
    var cell = structure && structure.cell;
    var origin = [0, 0, 0];
    var corners = cell ? cellCornersSafe(cell) : [];
    if (corners.length) {
      for (var i = 0; i < corners.length; i++) {
        origin[0] += corners[i][0] / 8; origin[1] += corners[i][1] / 8; origin[2] += corners[i][2] / 8;
      }
    }
    var atoms = [];
    var sites = (structure && structure.sites) || [];
    for (var s = 0; s < sites.length; s++) {
      var site = sites[s];
      var frac = site.frac || [0, 0, 0];
      var cart = site.cart || (cell ? fracToCartSafe(cell, frac) : [0, 0, 0]);
      atoms.push({
        id: s, siteId: s, symmetryIndex: 0,
        label: site.label || siteLabel(site.element, 0),
        element: site.element || 'X', z: site.z || 0,
        frac: frac.slice(),
        pos: [cart[0] - origin[0], cart[1] - origin[1], cart[2] - origin[2]],
        color: elementColor(site.element),
        baseRadius: elementBaseRadius(site.element),
        kind: 'cell', pickable: true
      });
    }
    var lines = [];
    for (var e = 0; e < CELL_EDGES.length; e++) {
      var c0 = corners[CELL_EDGES[e][0]], c1 = corners[CELL_EDGES[e][1]];
      if (!c0 || !c1) break;
      lines.push({
        p0: [c0[0] - origin[0], c0[1] - origin[1], c0[2] - origin[2]],
        p1: [c1[0] - origin[0], c1[1] - origin[1], c1[2] - origin[2]],
        kind: 'cell'
      });
    }
    if (cell) {
      lines.push({ p0: [0, 0, 0], p1: cell.aVec.slice(), kind: 'axes' });
      lines.push({ p0: [0, 0, 0], p1: cell.bVec.slice(), kind: 'axes' });
      lines.push({ p0: [0, 0, 0], p1: cell.cVec.slice(), kind: 'axes' });
    }
    return {
      title: (structure && (structure.title || structure.blockName || structure.sourceName)) || 'CrystalLens',
      formula: (structure && structure.formula) || '—',
      cellContents: (structure && structure.cellContents) || '—',
      spaceGroup: (structure && structure.spaceGroup) || '',
      note: (structure && structure.note) || '',
      format: (structure && structure.format) || 'CIF',
      sourceName: (structure && structure.sourceName) || '',
      cell: cell || null,
      supercell: [1, 1, 1],
      displayedCells: [1, 1, 1],
      showBoundary: false,
      origin: origin,
      stats: {
        asymmetricAtomCount: sites.length,
        symmetryOperatorCount: (structure && structure.symmetryOperatorCount) || 1,
        cellAtomCount: atoms.length,
        visibleAtomCount: atoms.length,
        boundaryAtomCount: 0,
        visibleBondCount: 0,
        cellBondCount: 0,
        polyhedronCount: 0,
        polyhedronCenterCount: 0,
        polyhedronTriangleCount: 0,
        supercellLimited: false,
        boundaryLimited: false
      },
      atoms: atoms,
      bonds: [],
      lines: lines,
      polyhedra: { enabled: false, centers: [], triangles: [], edges: [] },
      hasCell: !!cell,
      demo: false
    };
  }

  // ----------------------------------------------------- fallback camera ----
  function FallbackCamera() {
    this.target = [0, 0, 0];
    this.distance = 20;
    this.yaw = 35 * Math.PI / 180;
    this.pitch = 24 * Math.PI / 180;
    this.fovY = 38 * Math.PI / 180;
    this.orthographic = false;
    this.sceneRadius = 5;
  }
  FallbackCamera.prototype._dir = function () {
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    return [cp * sy, sp, cp * cy];
  };
  FallbackCamera.prototype.eye = function () {
    var d = this._dir();
    return [this.target[0] + d[0] * this.distance, this.target[1] + d[1] * this.distance, this.target[2] + d[2] * this.distance];
  };
  FallbackCamera.prototype.forward = function () {
    var d = this._dir();
    return [-d[0], -d[1], -d[2]];
  };
  FallbackCamera.prototype.right = function () {
    var f = this.forward();
    var r = [f[2], 0, -f[0]];
    var len = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
    if (len < 1e-6) return [1, 0, 0];
    return [r[0] / len, r[1] / len, r[2] / len];
  };
  FallbackCamera.prototype.up = function () {
    var f = this.forward(), r = this.right();
    return [
      r[1] * f[2] - r[2] * f[1],
      r[2] * f[0] - r[0] * f[2],
      r[0] * f[1] - r[1] * f[0]
    ];
  };
  FallbackCamera.prototype.setScene = function (center, radius) {
    this.target = [center[0], center[1], center[2]];
    this.sceneRadius = Math.max(radius || 0.001, 0.001);
  };
  FallbackCamera.prototype.fit = function (aspect, margin) {
    var m = margin || 1.12;
    var a = aspect || 1.5;
    // Fit the bounding sphere in *both* dimensions: the narrow dimension wins.
    // d = r + r * m / (tan(fovY/2) * min(1, aspect))  keeps the sphere inside
    // the frustum with a perspective margin (see ui.md 11.3, margin 1.18).
    var tanHalf = Math.tan(this.fovY / 2) * Math.min(1, a);
    this.distance = this.sceneRadius * (1 + m / Math.max(tanHalf, 1e-4));
    this.distance = clamp(this.distance, this.sceneRadius * 0.05, this.sceneRadius * 200 + 200);
  };
  FallbackCamera.prototype.fitPoints = function (points, aspect, margin) {
    if (!points || !points.length) { this.fit(aspect, margin); return; }
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < points.length; i++) {
      for (var k = 0; k < 3; k++) {
        if (points[i][k] < min[k]) min[k] = points[i][k];
        if (points[i][k] > max[k]) max[k] = points[i][k];
      }
    }
    var center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var radius = 0.001;
    for (var j = 0; j < points.length; j++) {
      var dx = points[j][0] - center[0], dy = points[j][1] - center[1], dz = points[j][2] - center[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    this.target = center;
    this.sceneRadius = radius;
    this.fit(aspect, margin || FIT_MARGIN);
  };
  FallbackCamera.prototype.reset = function (center, radius, aspect) {
    this.target = [center[0], center[1], center[2]];
    this.sceneRadius = Math.max(radius, 0.001);
    this.yaw = 35 * Math.PI / 180;
    this.pitch = 24 * Math.PI / 180;
    this.fit(aspect, 1.14);
  };
  FallbackCamera.prototype.orbit = function (dx, dy) {
    this.yaw -= dx * ORBIT_SENSITIVITY;
    this.pitch = clamp(this.pitch + dy * ORBIT_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  };
  FallbackCamera.prototype.pan = function (dx, dy, width, height) {
    var wpp = 2 * this.distance * Math.tan(this.fovY / 2) / Math.max(height, 1);
    var r = this.right(), u = this.up();
    this.target = [
      this.target[0] - r[0] * dx * wpp + u[0] * dy * wpp,
      this.target[1] - r[1] * dx * wpp + u[1] * dy * wpp,
      this.target[2] - r[2] * dx * wpp + u[2] * dy * wpp
    ];
  };
  FallbackCamera.prototype.zoom = function (steps) {
    var min = this.sceneRadius * 0.035, max = this.sceneRadius * 40 + 100;
    this.distance = clamp(this.distance * Math.exp(-steps * ZOOM_STEP), min, max);
  };
  FallbackCamera.prototype.worldToScreen = function (point, width, height) {
    var eye = this.eye(), f = this.forward(), r = this.right(), u = this.up();
    var vx = point[0] - eye[0], vy = point[1] - eye[1], vz = point[2] - eye[2];
    var depth = vx * f[0] + vy * f[1] + vz * f[2];
    if (depth <= 0.02) return { x: 0, y: 0, depth: depth, visible: false };
    var fpx = (height * 0.5) / Math.tan(this.fovY / 2);
    var sx = width / 2 + (vx * r[0] + vy * r[1] + vz * r[2]) * fpx / depth;
    var sy = height / 2 - (vx * u[0] + vy * u[1] + vz * u[2]) * fpx / depth;
    return { x: sx, y: sy, depth: depth, visible: true };
  };
  FallbackCamera.prototype.screenRay = function (x, y, width, height) {
    var f = this.forward(), r = this.right(), u = this.up();
    var fpx = (height * 0.5) / Math.tan(this.fovY / 2);
    var dir = [
      f[0] + r[0] * ((x - width / 2) / fpx) + u[0] * ((height / 2 - y) / fpx),
      f[1] + r[1] * ((x - width / 2) / fpx) + u[1] * ((height / 2 - y) / fpx),
      f[2] + r[2] * ((x - width / 2) / fpx) + u[2] * ((height / 2 - y) / fpx)
    ];
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
    return { origin: this.eye(), direction: [dir[0] / len, dir[1] / len, dir[2] / len] };
  };
  FallbackCamera.prototype.nearPlane = function () { return this.distance * 0.01; };
  FallbackCamera.prototype.farPlane = function () { return this.distance * 8 + this.sceneRadius * 8 + 100; };

  // --------------------------------------------------- fallback renderer ----
  function FallbackRenderer(container) {
    this.container = container;
    this.canvas = D.createElement('canvas');
    this.canvas.className = 'cl-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.supported = !!this.ctx;
    this.width = Math.max(1, container.clientWidth || 1);
    this.height = Math.max(1, container.clientHeight || 1);
    this.dpr = 1;
    this.model = null;
    this.options = null;
    this.highlight = { selected: [], hovered: -1 };
    this.annotations = { measurements: [], pending: [] };
    this.lastCamera = null;
    this.resize(this.width, this.height, root.devicePixelRatio || 1);
  }
  FallbackRenderer.prototype.resize = function (width, height, dpr) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = dpr || 1;
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  };
  FallbackRenderer.prototype.setModel = function (model) { this.model = model; };
  FallbackRenderer.prototype.setOptions = function (options) { this.options = options; };
  FallbackRenderer.prototype.setHighlight = function (highlight) {
    this.highlight = highlight || { selected: [], hovered: -1 };
  };
  FallbackRenderer.prototype.setAnnotations = function (annotations) {
    this.annotations = annotations || { measurements: [], pending: [] };
  };
  FallbackRenderer.prototype._pxPerUnit = function (camera) {
    var fov = camera.fovY || 38 * Math.PI / 180;
    return (this.height * 0.5) / Math.tan(fov / 2) / Math.max(camera.distance || 1, 0.001);
  };
  FallbackRenderer.prototype._radiusPx = function (atom, camera, style, scale) {
    var base = atom.baseRadius || 1.2;
    var worldRadius = style === 'space-fill' ? base * 1.35 : base * scale * 1.75;
    return clamp(worldRadius * this._pxPerUnit(camera), 1.6, 120);
  };
  FallbackRenderer.prototype.render = function (camera) {
    var ctx = this.ctx;
    if (!ctx) return;
    this.lastCamera = camera;
    var w = this.width, h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var appearance = (this.options && this.options.appearance) || DEFAULT_APPEARANCE;
    var bg = u32ToCss(appearance.backgroundColor || 0x020305);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    var g = ctx.createRadialGradient(w * 0.5, h * 0.38, Math.min(w, h) * 0.05, w * 0.5, h * 0.42, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(30,44,72,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var model = this.model;
    if (!model) return;
    var options = this.options || {};
    var style = options.style || 'ball-stick';
    var proj = function (p) { return camera.worldToScreen(p, w, h); };

    // cell + axes lines
    var cellColor = appearance.cellColor || 0xD6DEE9;
    var lineWidth = clamp(appearance.cellLineWidth || 1, 0.5, 4) * this.dpr;
    var lines = (model.lines || []);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line.kind === 'cell' && options.showCell === false) continue;
      if (line.kind === 'axes' && options.showAxes === false) continue;
      var p0 = proj(line.p0), p1 = proj(line.p1);
      if (!p0.visible || !p1.visible) continue;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      if (line.kind === 'axes') {
        var axisIndex = 0;
        for (var aj = 0; aj < li; aj++) if (lines[aj].kind === 'axes') axisIndex++;
        var axisColors = ['rgba(255,107,122,0.9)', 'rgba(53,211,175,0.9)', 'rgba(91,204,255,0.9)'];
        ctx.strokeStyle = axisColors[axisIndex % 3];
        ctx.lineWidth = Math.max(1.2, lineWidth * 1.4);
      } else {
        ctx.strokeStyle = u32ToRgba(cellColor, 0.62);
        ctx.lineWidth = Math.max(0.8, lineWidth);
      }
      ctx.stroke();
    }

    // bonds
    var atoms = model.atoms || [];
    if (options.showBonds !== false) {
      var bonds = model.bonds || [];
      for (var bi = 0; bi < bonds.length; bi++) {
        var bond = bonds[bi];
        var a0 = atoms[bond.a], a1 = atoms[bond.b];
        if (!a0 || !a1) continue;
        var q0 = proj(a0.pos), q1 = proj(a1.pos);
        if (!q0.visible || !q1.visible) continue;
        ctx.beginPath();
        ctx.moveTo(q0.x, q0.y);
        ctx.lineTo(q1.x, q1.y);
        var c = bond.color || [0.5, 0.55, 0.62];
        ctx.strokeStyle = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
        ctx.lineWidth = clamp((bond.radius || 0.105) * 2 * this._pxPerUnit(camera), 1.1, 16);
        ctx.stroke();
      }
    }

    // atoms, far to near
    var drawList = [];
    for (var ai = 0; ai < atoms.length; ai++) {
      var atom = atoms[ai];
      if (!atom || !atom.pos) continue;
      var sp = proj(atom.pos);
      if (!sp.visible) continue;
      drawList.push({ atom: atom, sp: sp, radius: this._radiusPx(atom, camera, style, options.atomScale == null ? 0.3 : options.atomScale) });
    }
    drawList.sort(function (m, n) { return n.sp.depth - m.sp.depth; });
    var selected = this.highlight.selected || [];
    var hovered = this.highlight.hovered;
    for (var di = 0; di < drawList.length; di++) {
      var item = drawList[di];
      var atomD = item.atom, r = item.radius, cx = item.sp.x, cy = item.sp.y;
      var base = atomD.color || [0.55, 0.62, 0.75];
      var isSelected = selected.indexOf(atomD.id) >= 0;
      var isHovered = hovered === atomD.id;
      var pending = (this.annotations.pending || []).indexOf(atomD.id) >= 0;
      if (isSelected || pending || isHovered) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4, 0, TAU);
        ctx.strokeStyle = pending ? 'rgba(255,201,91,0.95)' : 'rgba(133,171,255,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r + 8, 0, TAU);
        ctx.strokeStyle = pending ? 'rgba(255,201,91,0.28)' : 'rgba(99,146,255,0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      var grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      var light = lightenColor(base, 0.55);
      var dark = [base[0] * 0.42, base[1] * 0.42, base[2] * 0.42];
      grad.addColorStop(0, 'rgb(' + Math.round(light[0] * 255) + ',' + Math.round(light[1] * 255) + ',' + Math.round(light[2] * 255) + ')');
      grad.addColorStop(0.62, 'rgb(' + Math.round(base[0] * 255) + ',' + Math.round(base[1] * 255) + ',' + Math.round(base[2] * 255) + ')');
      grad.addColorStop(1, 'rgb(' + Math.round(dark[0] * 255) + ',' + Math.round(dark[1] * 255) + ',' + Math.round(dark[2] * 255) + ')');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,10,16,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // measurement annotations (lines only; labels are DOM)
    var annotations = this.annotations || {};
    var measurements = annotations.measurements || [];
    for (var mi = 0; mi < measurements.length; mi++) {
      var measurement = measurements[mi];
      var color = measurement.kind === 'angle' ? 'rgba(91,204,255,0.95)' : 'rgba(255,201,91,0.95)';
      var pts = measurement.points || [];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (var pi = 0; pi < pts.length; pi++) {
        var pp = proj(pts[pi]);
        if (!pp.visible) continue;
        if (pi === 0) ctx.moveTo(pp.x, pp.y); else ctx.lineTo(pp.x, pp.y);
      }
      ctx.stroke();
      if (measurement.kind === 'angle' && pts.length >= 3) {
        var vb = proj(pts[1]);
        for (var pi2 = 0; pi2 < pts.length; pi2 += 2) {
          var pe = proj(pts[pi2]);
          if (!vb.visible || !pe.visible) continue;
          ctx.beginPath(); ctx.moveTo(vb.x, vb.y); ctx.lineTo(pe.x, pe.y); ctx.stroke();
        }
      }
    }
    var pendingIds = annotations.pending || [];
    if (pendingIds.length >= 2) {
      ctx.strokeStyle = 'rgba(255,201,91,0.8)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (var pk = 0; pk < pendingIds.length; pk++) {
        var patom = atoms[pendingIds[pk]];
        if (!patom) continue;
        var psp = proj(patom.pos);
        if (!psp.visible) continue;
        if (pk === 0) ctx.moveTo(psp.x, psp.y); else ctx.lineTo(psp.x, psp.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  FallbackRenderer.prototype.getVisiblePoints = function () {
    var model = this.model;
    if (!model) return [];
    var points = [];
    var atoms = model.atoms || [];
    for (var i = 0; i < atoms.length; i++) {
      if (atoms[i].kind === 'cell' && atoms[i].pos) points.push(atoms[i].pos);
      if (points.length > 4000) break;
    }
    if (!points.length) {
      for (var j = 0; j < atoms.length; j++) if (atoms[j].pos) points.push(atoms[j].pos);
    }
    return points;
  };
  FallbackRenderer.prototype.pick = function (camera, x, y) {
    var model = this.model;
    if (!model) return -1;
    var atoms = model.atoms || [];
    var options = this.options || {};
    var style = options.style || 'ball-stick';
    var best = -1, bestDepth = Infinity;
    for (var i = 0; i < atoms.length; i++) {
      var atom = atoms[i];
      if (!atom || atom.pickable === false || !atom.pos) continue;
      var sp = camera.worldToScreen(atom.pos, this.width, this.height);
      if (!sp.visible) continue;
      var r = this._radiusPx(atom, camera, style, options.atomScale == null ? 0.3 : options.atomScale);
      var dx = sp.x - x, dy = sp.y - y;
      if (dx * dx + dy * dy <= (r + 3) * (r + 3) && sp.depth < bestDepth) {
        best = atom.id;
        bestDepth = sp.depth;
      }
    }
    return best;
  };
  FallbackRenderer.prototype.screenshot = function () {
    try { return this.canvas.toDataURL('image/png'); } catch (e) { return ''; }
  };
  FallbackRenderer.prototype.dispose = function () {
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  // ---------------------------------------------------------- app state -----
  var state = {
    settings: normalizeSettings(null),
    docs: [],
    activeId: null,
    nextDocId: 1,
    renderer: null,
    rendererKind: 'none',
    rendererError: '',
    camera: null,
    viewportSize: { width: 1, height: 1 },
    frames: 0,
    ready: false,
    needsRender: true,
    rafId: 0,
    inertia: { yaw: 0, pitch: 0, active: false },
    mode: 'none',              // none | distance | angle
    pending: [],
    selection: -1,
    hovered: -1,
    status: { key: 'status.ready-hint', args: null },
    hoverText: '',
    layoutMode: 'drawer',
    drawer: { left: false, right: false },
    pointer: {
      active: false, id: -1, type: 'mouse', startX: 0, startY: 0, lastX: 0, lastY: 0,
      startTime: 0, moved: false, dragging: false, panning: false, button: 0,
      longPressTimer: 0, lastTap: 0, lastTapX: 0, lastTapY: 0
    },
    pointers: {},
    pinch: null,
    clickSuppressUntil: 0,
    settingsSaveTimer: 0,
    flashTimer: 0
  };

  function currentLanguage() { return (CL.i18n && CL.i18n.language) || state.settings.language || 'zh'; }
  function t(key) {
    if (CL.i18n && CL.i18n.t) {
      var args = Array.prototype.slice.call(arguments, 1);
      return CL.i18n.t.apply(CL.i18n, [key].concat(args));
    }
    return key;
  }
  function activeDoc() {
    for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === state.activeId) return state.docs[i];
    return null;
  }
  function findDoc(id) {
    for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === id) return state.docs[i];
    return null;
  }
  function model() { var doc = activeDoc(); return doc ? doc.model : null; }
  function renderer() { return state.renderer; }
  function camera() { return state.camera; }
  function hasCore() {
    return !!(CL.parsers && typeof CL.parsers.parse === 'function' && CL.crystal &&
      typeof CL.crystal.finalize === 'function' && typeof CL.crystal.buildDisplayModel === 'function');
  }
  function hasCrystal() { return !!(CL.crystal && typeof CL.crystal.finalize === 'function'); }

  // ------------------------------------------------------------ persistence -
  function loadSettings() {
    var stored = null;
    if (hasStorage()) {
      try {
        var raw = root.localStorage.getItem(SETTINGS_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (e) { stored = null; }
    }
    state.settings = normalizeSettings(stored);
    // i18n language might have been restored from its own key already; prefer
    // the settings value only when a settings blob existed.
    if (stored && stored.language && CL.i18n) {
      CL.i18n.setLanguage(stored.language, { persist: false });
    }
    state.settings.language = currentLanguage();
    return state.settings;
  }
  function saveSettingsNow() {
    state.settings.language = currentLanguage();
    if (!hasStorage()) return;
    try { root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* ignore quota */ }
  }
  function scheduleSaveSettings() {
    if (state.settingsSaveTimer) root.clearTimeout(state.settingsSaveTimer);
    state.settingsSaveTimer = root.setTimeout(function () {
      state.settingsSaveTimer = 0;
      saveSettingsNow();
    }, 120);
  }

  // --------------------------------------------------------------- status ---
  function formatStatus() {
    if (state.hoverText) return state.hoverText;
    var status = state.status;
    if (!status) return '';
    if (status.args && status.args.length) {
      return t.apply(null, [status.key].concat(status.args));
    }
    return t(status.key);
  }
  function setStatus(key) {
    state.status = { key: key, args: Array.prototype.slice.call(arguments, 1) };
    if (ui.panels) ui.panels.renderStatus();
  }

  // --------------------------------------------------------------- models ---
  function supercellKey() {
    var s = state.settings.supercell;
    return s[0] + 'x' + s[1] + 'x' + s[2] + ':' + (state.settings.showBoundary ? 1 : 0);
  }
  function buildModelFor(doc) {
    if (!doc) return null;
    if (doc.demo || !doc.structure) return doc.model || buildDemoModel(doc.meta);
    // DisplayModel.atoms/bonds are style independent; polyhedra are only
    // computed by the model layer when style === 'polyhedral' (CONTRACT 5.3).
    var opts = {
      supercell: state.settings.supercell.slice(),
      showBoundary: !!state.settings.showBoundary,
      style: state.settings.style
    };
    try {
      if (hasCore()) {
        var model = CL.crystal.buildDisplayModel(doc.structure, opts);
        if (model && model.atoms) {
          if (!model.title && doc.title) model.title = doc.title;
          return model;
        }
      }
      return buildFallbackModel(doc.structure);
    } catch (e) {
      logError('buildDisplayModel failed: ' + (e && e.message ? e.message : e));
      return buildFallbackModel(doc.structure);
    }
  }
  function ensureDocModel(doc, force) {
    if (!doc) return null;
    if (!force && doc.model && doc.builtKey === supercellKey()) return doc.model;
    doc.model = buildModelFor(doc);
    doc.builtKey = supercellKey();
    if (doc.model && doc.model.hasCell && !doc.cellFromModel) doc.cellFromModel = doc.model.cell;
    return doc.model;
  }
  function renderOptions() {
    var s = state.settings;
    return {
      style: s.style,
      showCell: !!s.showCell,
      showAxes: !!s.showAxes,
      showBonds: !!s.showBonds,
      showLabels: !!s.showLabels,
      showBoundary: !!s.showBoundary,
      atomScale: s.atomScale,
      bondRadius: s.bondRadius,
      supercell: s.supercell.slice(),
      appearance: cloneAppearance(s.appearance),
      language: currentLanguage(),
      // HUD responsibility split (CONTRACT 5.4): the DOM draws gizmo/legend/atom
      // labels; measurement lines + value boxes come from the renderer overlay.
      overlay: { gizmo: false, legend: false, labels: false, measurements: true }
    };
  }
  function applyRenderOptions() {
    if (!state.renderer) return;
    try { state.renderer.setOptions(renderOptions()); } catch (e) { logError('setOptions failed: ' + (e && e.message ? e.message : e)); }
    requestRender();
  }
  function pushModelToRenderer(fit) {
    var doc = activeDoc();
    if (!doc) return;
    var built = ensureDocModel(doc);
    if (!state.renderer) return;
    try { state.renderer.setModel(built); } catch (e) { logError('setModel failed: ' + (e && e.message ? e.message : e)); }
    applyRenderOptions();
    syncAnnotations();
    syncHighlight();
    if (fit) fitView();
    requestRender();
  }
  function visiblePoints() {
    var doc = activeDoc();
    if (!doc || !doc.model) return [];
    if (state.renderer && typeof state.renderer.getVisiblePoints === 'function') {
      try {
        var points = state.renderer.getVisiblePoints();
        if (points && points.length) return points;
      } catch (e) { /* fall back below */ }
    }
    var atoms = doc.model.atoms || [];
    var points = [];
    for (var i = 0; i < atoms.length; i++) if (atoms[i].pos) points.push(atoms[i].pos);
    return points;
  }
  function sceneBounds() {
    var points = visiblePoints();
    if (!points.length) return { center: [0, 0, 0], radius: 5 };
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < points.length; i++) {
      for (var k = 0; k < 3; k++) {
        if (points[i][k] < min[k]) min[k] = points[i][k];
        if (points[i][k] > max[k]) max[k] = points[i][k];
      }
    }
    var center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var radius = 0.001;
    for (var j = 0; j < points.length; j++) {
      var dx = points[j][0] - center[0], dy = points[j][1] - center[1], dz = points[j][2] - center[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) radius = d;
    }
    return { center: center, radius: radius };
  }
  function viewportAspect() {
    var size = viewportSize();
    return size.height > 0 ? size.width / size.height : 1.5;
  }
  function viewportSize() {
    return { width: state.viewportSize.width, height: state.viewportSize.height };
  }
  function fitView() {
    if (!state.camera || !state.renderer) return;
    var points = visiblePoints();
    var aspect = viewportAspect();
    try {
      if (points && points.length && typeof state.camera.fitPoints === 'function') state.camera.fitPoints(points, aspect, FIT_MARGIN);
      else if (typeof state.camera.fit === 'function') state.camera.fit(aspect, FIT_MARGIN);
    } catch (e) { logError('fit failed: ' + (e && e.message ? e.message : e)); }
    var doc = activeDoc();
    if (doc) doc.userAdjusted = false;
    saveCameraToDoc(doc);
    requestRender();
  }
  function resetView() {
    if (!state.camera) return;
    var bounds = sceneBounds();
    var aspect = viewportAspect();
    try {
      if (typeof state.camera.reset === 'function') state.camera.reset(bounds.center, Math.max(bounds.radius, 0.5), aspect);
      else if (typeof state.camera.setScene === 'function') { state.camera.setScene(bounds.center, bounds.radius); state.camera.fit(aspect, FIT_MARGIN); }
    } catch (e) { logError('reset failed: ' + (e && e.message ? e.message : e)); }
    var doc = activeDoc();
    if (doc) doc.userAdjusted = false;
    saveCameraToDoc(doc);
    requestRender();
  }
  function saveCameraToDoc(doc) {
    if (!doc || !state.camera) return;
    var c = state.camera;
    doc.cameraState = {
      target: (c.target || [0, 0, 0]).slice(),
      distance: c.distance,
      yaw: c.yaw,
      pitch: c.pitch,
      orthographic: !!c.orthographic,
      fovY: c.fovY,
      userAdjusted: !!doc.userAdjusted
    };
  }
  function restoreCameraForDoc(doc) {
    if (!state.camera || !doc) return;
    var cs = doc.cameraState;
    if (cs) {
      state.camera.target = (cs.target || [0, 0, 0]).slice();
      state.camera.distance = cs.distance;
      state.camera.yaw = cs.yaw;
      state.camera.pitch = cs.pitch;
      state.camera.fovY = cs.fovY || state.camera.fovY;
      state.camera.orthographic = !!cs.orthographic;
      doc.userAdjusted = !!cs.userAdjusted;
      if (typeof state.camera.setScene === 'function') {
        var b = sceneBounds();
        state.camera.setScene(b.center, b.radius);
      }
      requestRender();
    } else {
      var bounds = sceneBounds();
      if (typeof state.camera.setScene === 'function') state.camera.setScene(bounds.center, bounds.radius);
      if (state.camera.fitPoints) state.camera.fitPoints(visiblePoints(), viewportAspect(), FIT_MARGIN);
      else if (state.camera.fit) state.camera.fit(viewportAspect(), FIT_MARGIN);
      doc.userAdjusted = false;
      saveCameraToDoc(doc);
      requestRender();
    }
  }

  // ------------------------------------------------------------- renderer ---
  function createRenderer() {
    var container = dom.viewport;
    if (!container) return;
    var created = null;
    if (typeof CL.Renderer === 'function') {
      try {
        created = new CL.Renderer(container);
        if (created && created.supported === false) {
          try { if (created.dispose) created.dispose(); } catch (e) { /* ignore */ }
          created = null;
        } else if (created) {
          state.rendererKind = 'webgl2';
        }
      } catch (e) {
        state.rendererError = (e && e.message) ? e.message : String(e);
        logError('renderer init failed: ' + state.rendererError);
        created = null;
      }
    }
    if (!created) {
      created = new FallbackRenderer(container);
      state.rendererKind = 'canvas2d';
    }
    state.renderer = created;
    return created;
  }
  function createCamera() {
    if (typeof CL.Camera === 'function') {
      try {
        var cam = new CL.Camera();
        if (cam && typeof cam.worldToScreen === 'function') return cam;
      } catch (e) { logError('camera init failed: ' + (e && e.message ? e.message : e)); }
    }
    return new FallbackCamera();
  }
  function syncViewportSize() {
    if (!dom.viewport) return;
    var width = Math.max(1, dom.viewport.clientWidth || dom.viewport.offsetWidth || 1);
    var height = Math.max(1, dom.viewport.clientHeight || dom.viewport.offsetHeight || 1);
    if (width === state.viewportSize.width && height === state.viewportSize.height) return;
    state.viewportSize = { width: width, height: height };
    state.resizeCount = (state.resizeCount || 0) + 1;
    if (state.renderer && typeof state.renderer.resize === 'function') {
      try { state.renderer.resize(width, height, root.devicePixelRatio || 1); } catch (e) { /* ignore */ }
    }
    var doc = activeDoc();
    if (doc && doc.model && !doc.userAdjusted) fitView();
    requestRender();
  }
  function requestRender() {
    state.needsRender = true;
    if (!state.rafId) state.rafId = root.requestAnimationFrame(frameLoop);
  }
  function frameLoop() {
    state.rafId = 0;
    var dt = 0.016;
    var tnow = now();
    if (frameLoop._last) dt = clamp((tnow - frameLoop._last) / 1000, 0.001, 0.1);
    frameLoop._last = tnow;

    if (state.inertia.active) {
      var decay = Math.exp(-6 * dt);
      if (Math.abs(state.inertia.yaw) > 0.0004 || Math.abs(state.inertia.pitch) > 0.0004) {
        var dx = state.inertia.yaw * dt * 60;
        var dy = state.inertia.pitch * dt * 60;
        if (state.camera) state.camera.orbit(-dx, -dy);
        state.inertia.yaw *= decay;
        state.inertia.pitch *= decay;
        state.needsRender = true;
      } else {
        state.inertia.active = false;
      }
    }

    if (state.needsRender) {
      state.needsRender = false;
      drawFrame();
      state.frames++;
      if (!state.ready && state.frames >= 2) markReady();
    }
    if (state.inertia.active || state.needsRender) {
      if (!state.rafId) state.rafId = root.requestAnimationFrame(frameLoop);
    }
  }
  function drawFrame() {
    var cam = state.camera;
    var ren = state.renderer;
    if (!ren || !cam) return;
    try { ren.render(cam); } catch (e) {
      if (!state.rendererError) {
        state.rendererError = (e && e.message) ? e.message : String(e);
        logError('render failed: ' + state.rendererError);
        showRendererError();
      }
    }
    if (ui.panels && ui.panels.updateOverlay) {
      try {
        ui.panels.updateOverlay(cam, activeDoc(), viewportSize());
      } catch (e2) {
        if (!drawFrame._overlayError) {
          drawFrame._overlayError = true;
          logError('overlay failed: ' + (e2 && e2.stack ? e2.stack : e2));
        }
      }
    }
  }
  function markReady() {
    state.ready = true;
    root.__clReady = true;
    root.__clFrames = state.frames;
    try {
      D.documentElement.setAttribute('data-cl-ready', '1');
      if (dom.bootScreen) {
        dom.bootScreen.classList.add('is-done');
        root.setTimeout(function () { if (dom.bootScreen && dom.bootScreen.parentNode) dom.bootScreen.parentNode.removeChild(dom.bootScreen); }, 420);
      }
    } catch (e) { /* ignore */ }
    // QA: at least two frames have been rendered before the ready flag.
  }
  function showRendererError() {
    if (!dom.rendererError) return;
    dom.rendererError.hidden = false;
    if (dom.rendererErrorDetail) dom.rendererErrorDetail.textContent = state.rendererError || '';
    if (dom.statusDot) dom.statusDot.classList.add('is-error');
  }

  // -------------------------------------------------------------- overlays --
  function syncHighlight() {
    if (!state.renderer) return;
    var doc = activeDoc();
    var selected = [];
    if (doc && doc.selected >= 0) selected.push(doc.selected);
    if (state.pending.length) {
      for (var i = 0; i < state.pending.length; i++) if (selected.indexOf(state.pending[i]) < 0) selected.push(state.pending[i]);
    }
    try { state.renderer.setHighlight({ selected: selected, hovered: state.hovered }); } catch (e) { /* ignore */ }
    requestRender();
  }
  function syncAnnotations() {
    if (!state.renderer) return;
    var doc = activeDoc();
    var measurements = [];
    if (doc) {
      for (var i = 0; i < doc.measurements.length; i++) {
        var m = doc.measurements[i];
        measurements.push({
          kind: m.kind, atomIds: m.atomIds.slice(), value: m.value,
          points: m.points.map(function (p) { return p.slice(); }),
          offsets: [], label: m.label
        });
      }
    }
    try { state.renderer.setAnnotations({ measurements: measurements, pending: state.pending.slice() }); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ documents ---
  function makeDocument(opts) {
    var doc = {
      id: 'doc-' + (state.nextDocId++),
      title: opts.title || 'CrystalLens',
      sourceName: opts.sourceName || '',
      format: opts.format || 'CIF',
      structure: opts.structure || null,
      model: null,
      builtKey: '',
      meta: opts.meta || null,
      demo: !!opts.demo,
      libId: opts.libId || null,
      sourceText: opts.sourceText || '',
      cameraState: null,
      selected: -1,
      hovered: -1,
      measurements: [],
      undo: [],
      redo: [],
      dirty: false,
      userAdjusted: false,
      modelNote: ''
    };
    doc.model = buildModelFor(doc);
    doc.builtKey = supercellKey();
    return doc;
  }
  function titleForStructure(structure, fallback) {
    if (!structure) return fallback || 'CrystalLens';
    return structure.title || structure.blockName || fallback || structure.sourceName || 'CrystalLens';
  }
  function openText(name, text, options) {
    options = options || {};
    if (!text || !String(text).trim()) {
      ui.dialogs.openError(t('toast.open-failed-title'), t('error.unsupported-format'));
      return false;
    }
    var structure = null;
    try {
      if (!CL.parsers || typeof CL.parsers.parse !== 'function') throw new Error('parsers-unavailable');
      structure = CL.parsers.parse(String(text), name || 'untitled.cif');
      if (!structure) throw new Error('parse-empty');
      if (CL.crystal && typeof CL.crystal.finalize === 'function') {
        structure = CL.crystal.finalize(structure) || structure;
      }
    } catch (err) {
      var message = (err && err.message) ? err.message : String(err);
      var detail = err && err.line ? (t('common.source') + ': ' + name + ' · line ' + err.line) : name;
      logError('parse failed for ' + name + ': ' + message);
      ui.dialogs.openError(t('toast.open-failed-title'), message, detail);
      return false;
    }
    var doc = makeDocument({
      title: titleForStructure(structure, name),
      sourceName: name,
      format: (structure.format || 'CIF').toUpperCase(),
      structure: structure,
      sourceText: String(text),
      demo: false
    });
    addDocument(doc);
    if (options.focus !== false) setStatus('toast.loaded', name);
    return true;
  }
  function openDemoEntry(meta, libId) {
    var doc = makeDocument({
      title: (currentLanguage() === 'en' ? (meta.titleEn || meta.titleZh) : (meta.titleZh || meta.titleEn)) || meta.file || 'CrystalLens',
      sourceName: meta.file || '',
      format: (meta.format || 'CIF').toUpperCase(),
      structure: null,
      meta: meta,
      libId: libId || meta.id || null,
      demo: true
    });
    doc.model = buildDemoModel(meta);
    doc.builtKey = supercellKey();
    doc.modelNote = t('ui.demo.note');
    addDocument(doc);
    return true;
  }
  function openLibraryEntry(id) {
    var entry = null;
    var library = (CL.data && CL.data.library) || [];
    for (var i = 0; i < library.length; i++) if (library[i].id === id) { entry = library[i]; break; }
    if (!entry) {
      ui.dialogs.openError(t('library.title'), t('library.unavailable'));
      return false;
    }
    if (hasCore() && entry.text) {
      var doc = null;
      try {
        var structure = CL.parsers.parse(entry.text, entry.file);
        structure = CL.crystal.finalize(structure) || structure;
        var title = currentLanguage() === 'en' ? (entry.titleEn || entry.titleZh) : (entry.titleZh || entry.titleEn);
        doc = makeDocument({
          title: title || titleForStructure(structure, entry.file),
          sourceName: entry.file,
          format: 'CIF',
          structure: structure,
          sourceText: entry.text,
          libId: entry.id,
          meta: entry
        });
      } catch (err) {
        logError('library parse failed for ' + id + ': ' + (err && err.message ? err.message : err));
        return openDemoEntry(entry, entry.id);
      }
      addDocument(doc);
      setStatus('toast.loaded', doc.sourceName || doc.title);
      return true;
    }
    return openDemoEntry(entry, entry.id);
  }
  function openExample(file) {
    var examples = (CL.data && CL.data.examples) || [];
    var entry = null;
    for (var i = 0; i < examples.length; i++) if (examples[i].file === file) { entry = examples[i]; break; }
    if (!entry) return openLibraryEntry(file);
    if (hasCore() && entry.text) {
      var doc = null;
      try {
        var structure = CL.parsers.parse(entry.text, entry.file);
        structure = CL.crystal.finalize(structure) || structure;
        doc = makeDocument({
          title: titleForStructure(structure, entry.file),
          sourceName: entry.file,
          format: entry.format || (structure.format || 'CIF').toUpperCase(),
          structure: structure,
          sourceText: entry.text,
          meta: entry
        });
      } catch (err) {
        logError('example parse failed: ' + (err && err.message ? err.message : err));
        return openDemoEntry(entry, entry.file);
      }
      addDocument(doc);
      setStatus('toast.loaded', doc.sourceName || doc.title);
      return true;
    }
    return openDemoEntry(entry, entry.file);
  }
  function addDocument(doc) {
    state.docs.push(doc);
    activateDocument(doc.id, { fit: true });
    syncUI();
    return doc;
  }
  function activateDocument(id, options) {
    options = options || {};
    var previous = activeDoc();
    if (previous) {
      saveCameraToDoc(previous);
      previous.hovered = state.hovered;
      previous.selected = state.selection;
    }
    var doc = findDoc(id);
    state.activeId = doc ? doc.id : null;
    state.pending = [];
    state.hovered = -1;
    state.selection = doc ? doc.selected : -1;
    if (!doc) {
      state.renderer && state.renderer.setModel && state.renderer.setModel(null);
      syncUI();
      requestRender();
      return;
    }
    ensureDocModel(doc);
    pushModelToRenderer(false);
    restoreCameraForDoc(doc);
    syncUI();
    if (options.fit) { ensureDocModel(doc); fitView(); }
    requestRender();
  }
  function switchDocument(id) {
    if (id === state.activeId) return;
    activateDocument(id);
    if (ui.dialogs) ui.dialogs.close();
  }
  function closeDocument(id) {
    var doc = findDoc(id);
    if (!doc) return;
    if (doc.dirty) {
      ui.dialogs.openConfirm({
        title: t('dialog.unsaved.title'),
        message: t('dialog.unsaved.message'),
        confirmLabel: t('ui.close'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
        onConfirm: function () { reallyCloseDocument(id); }
      });
      return;
    }
    reallyCloseDocument(id);
  }
  function reallyCloseDocument(id) {
    var index = -1;
    for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === id) { index = i; break; }
    if (index < 0) return;
    var wasActive = state.activeId === id;
    state.docs.splice(index, 1);
    if (wasActive) {
      var next = state.docs[Math.min(index, state.docs.length - 1)];
      if (next) activateDocument(next.id);
      else {
        state.activeId = null;
        state.selection = -1;
        state.pending = [];
        state.hovered = -1;
        if (state.renderer && state.renderer.setModel) state.renderer.setModel(null);
        syncUI();
        requestRender();
      }
    } else {
      syncUI();
    }
  }

  // ---------------------------------------------------------- file opening --
  function handleFileList(files) {
    if (!files || !files.length) return;
    var list = Array.prototype.slice.call(files);
    var opened = 0;
    var index = 0;
    function next() {
      if (index >= list.length) {
        if (!opened && list.length) { /* errors already reported */ }
        return;
      }
      var file = list[index++];
      if (!file) { next(); return; }
      var reader = new root.FileReader();
      reader.onload = function () {
        try { if (openText(file.name, String(reader.result))) opened++; } catch (e) { logError('file open failed: ' + (e && e.message ? e.message : e)); }
        root.setTimeout(next, 30);
      };
      reader.onerror = function () {
        ui.dialogs.openError(t('toast.open-failed-title'), file.name);
        root.setTimeout(next, 30);
      };
      try { reader.readAsText(file, 'utf-8'); } catch (e) { ui.dialogs.openError(t('toast.open-failed-title'), file.name); next(); }
    }
    next();
  }

  // -------------------------------------------------------- measure/select --
  function atomById(modelObj, id) {
    if (!modelObj || !modelObj.atoms || id < 0) return null;
    var fast = modelObj.atoms[id];
    if (fast && fast.id === id) return fast;
    for (var i = 0; i < modelObj.atoms.length; i++) if (modelObj.atoms[i].id === id) return modelObj.atoms[i];
    return null;
  }
  function selectAtom(id, options) {
    options = options || {};
    var doc = activeDoc();
    if (!doc) return;
    doc.selected = id;
    state.selection = id;
    syncHighlight();
    syncUI();
    if (id >= 0) {
      var atom = atomById(doc.model, id);
      if (atom && options.vibrate !== false) ui.nativeVibrate(8);
    }
  }
  function clearSelection() {
    var doc = activeDoc();
    if (!doc) return;
    doc.selected = -1;
    state.selection = -1;
    syncHighlight();
    syncUI();
  }
  function setHovered(id) {
    if (state.hovered === id) return;
    state.hovered = id;
    var doc = activeDoc();
    var atom = id >= 0 && doc ? atomById(doc.model, id) : null;
    state.hoverText = atom ? t('status.hover', atom.label || atom.element, atom.element || 'X') : '';
    syncHighlight();
    if (ui.panels) ui.panels.renderStatus();
    syncUI(false);
  }
  function setMeasureMode(mode) {
    var next = (mode === 'distance' || mode === 'angle') ? mode : 'none';
    state.mode = next;
    state.pending = [];
    syncAnnotations();
    syncHighlight();
    setStatus(next === 'none' ? 'status.ready' : (next === 'distance' ? 'measure.pick.distance' : 'measure.pick.angle'));
    syncUI();
    requestRender();
  }
  function toggleMeasureMode(mode) {
    if (!activeDoc()) { ui.toast(t('measure.distance'), t('toast.no-structure'), 'info'); return; }
    if (state.mode === mode) setMeasureMode('none');
    else setMeasureMode(mode);
  }
  function clearMeasurements() {
    var doc = activeDoc();
    if (!doc) return;
    doc.measurements = [];
    state.pending = [];
    syncAnnotations();
    syncHighlight();
    syncUI();
    requestRender();
  }
  function removeMeasurement(index) {
    var doc = activeDoc();
    if (!doc) return;
    doc.measurements.splice(index, 1);
    syncAnnotations();
    syncUI();
    requestRender();
  }
  function handleTap(x, y) {
    var doc = activeDoc();
    if (!doc) return;
    var id = -1;
    if (state.renderer && typeof state.renderer.pick === 'function' && state.camera) {
      try { id = state.renderer.pick(state.camera, x, y); } catch (e) { id = -1; }
    }
    if (typeof id !== 'number') id = -1;
    if (state.mode !== 'none') {
      if (id < 0) return;
      if (state.pending.indexOf(id) >= 0) return;
      state.pending.push(id);
      var need = state.mode === 'distance' ? 2 : 3;
      if (state.pending.length >= need) {
        var ok = commitMeasurement(doc);
        if (!ok) state.pending = [];
      }
      syncAnnotations();
      syncHighlight();
      syncUI();
      requestRender();
      return;
    }
    if (id >= 0) selectAtom(id);
    else { clearSelection(); }
  }
  function atomPoint(doc, id) {
    var atom = atomById(doc.model, id);
    return atom ? atom.pos.slice() : null;
  }
  function atomTextLabel(doc, id) {
    var atom = atomById(doc.model, id);
    if (!atom) return '?';
    if (atom.label) return atom.label;
    return (atom.element || 'X') + (id + 1);
  }
  function commitMeasurement(doc) {
    var need = state.mode === 'distance' ? 2 : 3;
    var ids = state.pending.slice();
    if (ids.length < need) return false;
    var kind = state.mode;
    var labels = ids.map(function (id) { return atomTextLabel(doc, id); });
    // Canonical path: the model layer applies the periodic minimum image and
    // returns world points (already offset by the cell translation) + label.
    // measure.js: CL.crystal.measureDistance(displayModel, a, b),
    //             CL.crystal.measureAngle(displayModel, a, b, c)  (b = vertex)
    var measurement = null;
    try {
      if (kind === 'distance' && CL.crystal && typeof CL.crystal.measureDistance === 'function') {
        measurement = CL.crystal.measureDistance(doc.model, ids[0], ids[1]);
      } else if (kind === 'angle' && CL.crystal && typeof CL.crystal.measureAngle === 'function') {
        measurement = CL.crystal.measureAngle(doc.model, ids[0], ids[1], ids[2]);
      }
    } catch (e) {
      logError('model measurement failed: ' + (e && e.message ? e.message : e));
      measurement = null;
    }
    var points = [];
    for (var i = 0; i < ids.length; i++) {
      var point = atomPoint(doc, ids[i]);
      if (!point) return false;
      points.push(point);
    }
    if (measurement && typeof measurement.value === 'number' && isFinite(measurement.value)) {
      var modelPoints = measurement.points || measurement.worldPoints;
      var validPoints = modelPoints && modelPoints.length === points.length;
      measurement = {
        kind: kind,
        atomIds: ids.slice(),
        value: measurement.value,
        points: validPoints ? modelPoints.map(function (p) { return [p[0], p[1], p[2]]; }) : points,
        offsets: measurement.offsets ? measurement.offsets.map(function (p) { return [p[0], p[1], p[2]]; }) : [],
        label: measurement.label || (kind === 'distance' ? fmtLen(measurement.value) : fmtAngle(measurement.value)),
        expression: measurement.expression || (kind === 'distance'
          ? labels[0] + '\u2013' + labels[1]
          : labels[0] + '\u2013' + labels[1] + '\u2013' + labels[2])
      };
    } else {
      // Graceful fallback (demo model / model layer unavailable): plain
      // Euclidean distance in display space. Documented in docs/impl/ui-notes.md.
      if (kind === 'distance') {
        var dx = points[0][0] - points[1][0], dy = points[0][1] - points[1][1], dz = points[0][2] - points[1][2];
        var value = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (!(value > 1e-9)) return false;
        measurement = {
          kind: 'distance',
          atomIds: ids.slice(),
          value: value,
          points: points,
          offsets: [],
          label: fmtLen(value),
          expression: labels[0] + '\u2013' + labels[1]
        };
      } else {
        var v1 = [points[0][0] - points[1][0], points[0][1] - points[1][1], points[0][2] - points[1][2]];
        var v2 = [points[2][0] - points[1][0], points[2][1] - points[1][1], points[2][2] - points[1][2]];
        var n1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2]);
        var n2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2]);
        if (n1 < 1e-9 || n2 < 1e-9) return false;
        var cosValue = clamp((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2), -1, 1);
        var angle = Math.acos(cosValue) * 180 / Math.PI;
        measurement = {
          kind: 'angle',
          atomIds: ids.slice(),
          value: angle,
          points: points,
          offsets: [],
          label: fmtAngle(angle),
          expression: labels[0] + '\u2013' + labels[1] + '\u2013' + labels[2]
        };
      }
    }
    doc.measurements.push(measurement);
    state.pending = [];
    ui.nativeVibrate(14);
    showFlash('\u2713  ' + measurement.expression + '    ' + measurement.label);
    setStatus(measurement.kind === 'distance' ? 'measurement.type.distance' : 'measurement.type.angle');
    return true;
  }
  function showFlash(text) {
    if (ui.panels && ui.panels.showFlash) { ui.panels.showFlash(text); return; }
    if (!dom.hudFlash) return;
    dom.hudFlash.hidden = false;
    dom.hudFlash.textContent = text;
    if (state.flashTimer) root.clearTimeout(state.flashTimer);
    state.flashTimer = root.setTimeout(function () { if (dom.hudFlash) dom.hudFlash.hidden = true; }, 2400);
  }

  // ------------------------------------------------------ editing / undo ---
  function snapshotStructure(structure) {
    if (!structure) return null;
    try { return JSON.stringify(structure); } catch (e) { return null; }
  }
  function pushUndo(doc, snapshot) {
    if (!doc) return;
    if (snapshot) doc.undo.push(snapshot);
    while (doc.undo.length > UNDO_DEPTH) doc.undo.shift();
    doc.redo.length = 0;
  }
  function refinalize(doc) {
    if (!doc || !doc.structure) return;
    try {
      if (hasCrystal()) doc.structure = CL.crystal.finalize(doc.structure) || doc.structure;
    } catch (e) { logError('finalize failed: ' + (e && e.message ? e.message : e)); }
    doc.model = buildModelFor(doc);
    doc.builtKey = supercellKey();
  }
  function afterStructureChange(doc, options) {
    options = options || {};
    if (!doc) return;
    refinalize(doc);
    doc.dirty = true;
    if (state.activeId === doc.id) {
      pushModelToRenderer(false);
      syncUI();
      if (options.fit) fitView();
      requestRender();
    }
    setStatus('status.structure-updated');
  }
  function editCell(params) {
    var doc = activeDoc();
    if (!doc || !doc.structure) { ui.toast(t('dialog.edit-cell.title'), t('toast.no-structure'), 'info'); return { ok: false }; }
    if (!hasCrystal() || typeof CL.crystal.setCellParameters !== 'function') {
      ui.toast(t('ui.core.missing'), t('toast.no-structure'), 'error');
      return { ok: false, error: 'core-missing' };
    }
    var snapshot = snapshotStructure(doc.structure);
    var result = null;
    try { result = CL.crystal.setCellParameters(doc.structure, params); } catch (e) {
      result = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    if (!result || result.ok === false) {
      var err = (result && result.error) ? result.error : t('dialog.edit-cell.error.invalid');
      return { ok: false, error: translateCoreError(err) };
    }
    pushUndo(doc, snapshot);
    doc.structure = result.structure || result;
    doc.measurements = [];
    afterStructureChange(doc);
    return { ok: true };
  }
  function siteInputFromParams(params) {
    var input = {
      element: params.element,
      occupancy: params.occupancy,
      label: params.label
    };
    if (params.frac) input.frac = params.frac;
    if (params.cart) input.cart = params.cart;
    return input;
  }
  function addAtom(params) {
    var doc = activeDoc();
    if (!doc || !doc.structure) { ui.toast(t('dialog.add-atom.title'), t('toast.no-structure'), 'info'); return { ok: false }; }
    if (!hasCrystal() || typeof CL.crystal.addAtomSite !== 'function') {
      ui.toast(t('ui.core.missing'), t('toast.no-structure'), 'error');
      return { ok: false, error: 'core-missing' };
    }
    var snapshot = snapshotStructure(doc.structure);
    var result = null;
    try { result = CL.crystal.addAtomSite(doc.structure, siteInputFromParams(params)); } catch (e) {
      result = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    if (!result || result.ok === false) {
      return { ok: false, error: translateCoreError((result && result.error) || 'error') };
    }
    pushUndo(doc, snapshot);
    doc.structure = result.structure || result;
    doc.measurements = [];
    afterStructureChange(doc);
    var sites = doc.structure.sites || [];
    var newIndex = typeof result.siteIndex === 'number' ? result.siteIndex : sites.length - 1;
    selectSiteInModel(doc, newIndex);
    return { ok: true };
  }
  function updateAtom(siteIndex, params) {
    var doc = activeDoc();
    if (!doc || !doc.structure) return { ok: false };
    if (!hasCrystal() || typeof CL.crystal.updateAtomSite !== 'function') {
      ui.toast(t('ui.core.missing'), t('toast.no-structure'), 'error');
      return { ok: false, error: 'core-missing' };
    }
    var snapshot = snapshotStructure(doc.structure);
    var result = null;
    try { result = CL.crystal.updateAtomSite(doc.structure, siteIndex, siteInputFromParams(params)); } catch (e) {
      result = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    if (!result || result.ok === false) {
      return { ok: false, error: translateCoreError((result && result.error) || 'error') };
    }
    pushUndo(doc, snapshot);
    doc.structure = result.structure || result;
    doc.measurements = [];
    afterStructureChange(doc);
    selectSiteInModel(doc, siteIndex);
    return { ok: true };
  }
  function deleteAtom() {
    var doc = activeDoc();
    if (!doc || !doc.structure) return { ok: false };
    var atom = atomById(doc.model, doc.selected);
    if (!atom) { ui.toast(t('edit.delete-atom'), t('toast.select-atom-first'), 'info'); return { ok: false }; }
    if (!hasCrystal() || typeof CL.crystal.deleteAtomSite !== 'function') {
      ui.toast(t('ui.core.missing'), t('toast.no-structure'), 'error');
      return { ok: false, error: 'core-missing' };
    }
    var snapshot = snapshotStructure(doc.structure);
    var result = null;
    try { result = CL.crystal.deleteAtomSite(doc.structure, atom.siteId); } catch (e) {
      result = { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
    if (!result || result.ok === false) {
      ui.toast(t('edit.delete-atom'), translateCoreError((result && result.error) || 'error'), 'error');
      return { ok: false };
    }
    pushUndo(doc, snapshot);
    doc.structure = result.structure || result;
    doc.measurements = [];
    doc.selected = -1;
    state.selection = -1;
    afterStructureChange(doc);
    setStatus('status.atom-deleted');
    return { ok: true };
  }
  function selectSiteInModel(doc, siteId) {
    var atoms = (doc.model && doc.model.atoms) || [];
    for (var i = 0; i < atoms.length; i++) {
      if (atoms[i].siteId === siteId && atoms[i].kind === 'cell') {
        doc.selected = atoms[i].id;
        state.selection = atoms[i].id;
        syncHighlight();
        syncUI();
        return atoms[i].id;
      }
    }
    return -1;
  }
  function translateCoreError(error) {
    if (!error) return t('common.unknown');
    if (typeof error === 'object' && error.message) error = error.message;
    var key = String(error);
    if (CL.i18n && CL.i18n.has && CL.i18n.has(key)) return t(key);
    return key;
  }
  function undo() {
    var doc = activeDoc();
    if (!doc || !doc.undo.length) return;
    var snapshot = snapshotStructure(doc.structure);
    if (snapshot) doc.redo.push(snapshot);
    var previous = doc.undo.pop();
    try { doc.structure = JSON.parse(previous); } catch (e) { return; }
    doc.selected = -1;
    state.selection = -1;
    doc.measurements = [];
    refinalize(doc);
    if (state.activeId === doc.id) pushModelToRenderer(false);
    syncUI();
    setStatus('status.undone');
    requestRender();
  }
  function redo() {
    var doc = activeDoc();
    if (!doc || !doc.redo.length) return;
    var snapshot = snapshotStructure(doc.structure);
    if (snapshot) doc.undo.push(snapshot);
    var next = doc.redo.pop();
    try { doc.structure = JSON.parse(next); } catch (e) { return; }
    doc.selected = -1;
    state.selection = -1;
    doc.measurements = [];
    refinalize(doc);
    if (state.activeId === doc.id) pushModelToRenderer(false);
    syncUI();
    setStatus('status.redone');
    requestRender();
  }

  // --------------------------------------------------------------- export ---
  function sanitizeFileName(text) {
    return String(text || 'CrystalLens').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'CrystalLens';
  }
  function defaultFileName(doc, extension) {
    var stamp = (CL.Native && CL.Native.timestamp) ? CL.Native.timestamp() : '00000000-000000';
    var title = sanitizeFileName(doc ? (doc.title || doc.sourceName || 'CrystalLens') : 'CrystalLens');
    return 'CrystalLens-' + title + '-' + stamp + '.' + extension;
  }
  function exportStructure(kind) {
    var doc = activeDoc();
    if (!doc) { ui.toast(t('file.save'), t('toast.no-structure'), 'info'); return; }
    var text = null;
    var extension = kind === 'xyz' ? 'xyz' : 'cif';
    var mime = kind === 'xyz' ? 'chemical/x-xyz' : 'chemical/x-cif';
    try {
      if (kind === 'xyz') {
        if (!CL.crystal || typeof CL.crystal.exportXyz !== 'function') throw new Error(t('ui.core.missing'));
        text = CL.crystal.exportXyz(doc.model) || CL.crystal.exportXyz(doc.structure);
      } else {
        if (!doc.model || !doc.model.hasCell) {
          ui.toast(t('toast.save.failed'), t('toast.no-cell-for-cif'), 'error');
          return;
        }
        if (!CL.crystal || typeof CL.crystal.exportCif !== 'function') throw new Error(t('ui.core.missing'));
        text = CL.crystal.exportCif(doc.structure);
        if (!text && typeof CL.crystal.exportCifResult === 'function') {
          var result = CL.crystal.exportCifResult(doc.structure);
          if (result && result.ok) text = result.text;
          else if (result && result.error) throw new Error(result.error);
        }
        if (!text) {
          ui.toast(t('toast.save.failed'), t('toast.no-cell-for-cif'), 'error');
          return;
        }
      }
      if (!text) throw new Error(t('ui.export.failed'));
    } catch (e) {
      ui.toast(t('toast.save.failed'), (e && e.message) ? e.message : String(e), 'error');
      return;
    }
    var name = defaultFileName(doc, extension);
    setStatus('status.ready');
    return CL.Native.saveText(name, mime, text, 'save').then(function (result) {
      if (result && result.ok) {
        ui.toast(t('toast.save.saved-title'), t('toast.save.saved', result.uri || name), 'success');
        setStatus('toast.save.saved', result.uri || name);
      } else {
        ui.toast(t('toast.save.failed'), (result && result.error) ? result.error : '', 'error');
      }
    });
  }
  function exportScreenshot(mode) {
    var doc = activeDoc();
    if (!doc || !state.renderer) { ui.toast(t('toast.screenshot.failed'), t('toast.no-structure'), 'info'); return; }
    var dataUrl = '';
    try { dataUrl = state.renderer.screenshot ? state.renderer.screenshot() : ''; } catch (e) { dataUrl = ''; }
    if (!dataUrl) { ui.toast(t('toast.screenshot.failed'), t('ui.core.missing'), 'error'); return; }
    var name = defaultFileName(doc, 'png');
    return CL.Native.saveDataUrl(name, dataUrl, mode === 'share' ? 'share' : 'save').then(function (result) {
      if (result && result.ok) {
        ui.toast(t('toast.screenshot.saved-title'), t('toast.screenshot.saved', result.uri || name), 'success');
        setStatus('toast.screenshot.saved', result.uri || name);
      } else {
        ui.toast(t('toast.screenshot.failed'), (result && result.error) ? result.error : '', 'error');
      }
    });
  }
  function buildSummaryText() {
    var doc = activeDoc();
    if (!doc) return '';
    var docModel = doc.model || {};
    var lines = [];
    lines.push('CrystalLens v' + APP_VERSION);
    lines.push(doc.title || '—');
    lines.push('Format: ' + (doc.format || '未知'));
    lines.push('Formula: ' + (docModel.formula || docModel.cellContents || '—'));
    if (docModel.spaceGroup) lines.push('Space group: ' + docModel.spaceGroup);
    var cell = docModel.cell;
    if (cell) {
      lines.push('Cell: a=' + fmt(cell.a, 5) + ', b=' + fmt(cell.b, 5) + ', c=' + fmt(cell.c, 5) +
        ', alpha=' + fmt(cell.alpha, 3) + ', beta=' + fmt(cell.beta, 3) + ', gamma=' + fmt(cell.gamma, 3));
      lines.push('Volume: ' + fmt(cell.volume, 3) + ' A^3');
    }
    var stats = docModel.stats || {};
    lines.push('Atoms: ' + (stats.visibleAtomCount != null ? stats.visibleAtomCount : 0) + ', bonds: ' + (stats.visibleBondCount != null ? stats.visibleBondCount : 0));
    if (doc.measurements.length) {
      lines.push('Measurements:');
      for (var i = 0; i < doc.measurements.length; i++) {
        lines.push('  ' + (i + 1) + '. ' + doc.measurements[i].expression + '  ' + doc.measurements[i].label);
      }
    }
    if (doc.sourceName) lines.push('Source: ' + doc.sourceName);
    return lines.join('\n');
  }
  function copySummary() {
    var text = buildSummaryText();
    if (!text) { ui.toast(t('edit.copy-summary'), t('toast.no-structure'), 'info'); return; }
    function done() {
      ui.toast(t('edit.copy-summary'), t('toast.copied-summary'), 'success');
      setStatus('toast.copied-summary');
    }
    function fallbackCopy() {
      var area = null;
      try {
        area = D.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        (D.body || D.documentElement).appendChild(area);
        area.focus();
        area.select();
        var ok = D.execCommand && D.execCommand('copy');
        if (area.parentNode) area.parentNode.removeChild(area);
        if (ok) done();
        else ui.toast(t('edit.copy-summary'), t('ui.core.missing'), 'error');
      } catch (e) {
        if (area && area.parentNode) area.parentNode.removeChild(area);
        ui.toast(t('edit.copy-summary'), String(e && e.message ? e.message : e), 'error');
      }
    }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(text).then(done, fallbackCopy);
    } else {
      fallbackCopy();
    }
  }

  // --------------------------------------------------------------- layout ---
  function computeLayoutMode() {
    var w = root.innerWidth || 1280;
    var h = root.innerHeight || 800;
    if (w >= 1200) return 'desktop';
    if (w >= 720 && w > h) return 'landscape';
    return 'drawer';
  }
  function setDrawer(side, open) {
    var el = side === 'left' ? dom.leftPanel : dom.rightPanel;
    if (!el) return;
    state.drawer[side] = open;
    if (open) {
      if (side === 'left') el.classList.add('is-open');
      else el.classList.add('is-open');
      if (state.layoutMode === 'drawer') {
        el.classList.add('is-open');
      }
      showScrim(true);
      ui.nativeVibrate(6);
    } else {
      el.classList.remove('is-open');
      if (!state.drawer.left && !state.drawer.right) showScrim(false);
    }
    if (ui.panels) ui.panels.renderAll();
  }
  function toggleDrawer(side) {
    if (state.layoutMode === 'drawer') {
      setDrawer(side, !state.drawer[side]);
    } else {
      if (side === 'left') {
        state.settings.leftPanel = !state.settings.leftPanel;
      } else {
        state.settings.rightPanel = !state.settings.rightPanel;
      }
      scheduleSaveSettings();
      updateLayout();
      if (ui.panels) ui.panels.renderAll();
      requestRender();
    }
  }
  function closeDrawers() {
    setDrawer('left', false);
    setDrawer('right', false);
  }
  function showScrim(show) {
    if (!dom.scrim) return;
    if (show) { dom.scrim.hidden = false; void dom.scrim.offsetWidth; dom.scrim.classList.add('is-visible'); }
    else {
      dom.scrim.classList.remove('is-visible');
      root.setTimeout(function () { if (!state.drawer.left && !state.drawer.right && dom.scrim && !dom.scrim.classList.contains('is-visible')) dom.scrim.hidden = true; }, 240);
    }
  }
  function updateLayout() {
    state.layoutMode = computeLayoutMode();
    var mode = state.layoutMode;
    if (dom.leftPanel) {
      dom.leftPanel.classList.toggle('is-docked', mode !== 'drawer' && !!state.settings.leftPanel);
      if (mode === 'drawer') dom.leftPanel.classList.remove('is-docked');
    }
    if (dom.rightPanel) {
      dom.rightPanel.classList.toggle('is-docked', mode !== 'drawer' && !!state.settings.rightPanel);
      if (mode === 'drawer') dom.rightPanel.classList.remove('is-docked');
    }
    if (mode === 'drawer') {
      if (dom.leftPanel) dom.leftPanel.classList.remove('is-docked');
      if (dom.rightPanel) dom.rightPanel.classList.remove('is-docked');
      if (dom.leftPanel) dom.leftPanel.classList.toggle('is-open', !!state.drawer.left);
      if (dom.rightPanel) dom.rightPanel.classList.toggle('is-open', !!state.drawer.right);
      showScrim(!!state.drawer.left || !!state.drawer.right);
    } else {
      if (dom.leftPanel) dom.leftPanel.classList.remove('is-open');
      if (dom.rightPanel) dom.rightPanel.classList.remove('is-open');
      state.drawer.left = false;
      state.drawer.right = false;
      showScrim(false);
    }
    if (dom.workspace) dom.workspace.setAttribute('data-mode', mode);
    requestRender();
  }
  // Hidden runtime diagnostics for headless layout QA (read via --dump-dom).
  // Written ~1.2 s after boot and again shortly after every resize, so it
  // reflects the settled layout (Chromium headless resizes the window after
  // the first paint on some Windows configurations).
  var runtimeInfoTimer = 0;
  function scheduleRuntimeInfo(delay) {
    if (runtimeInfoTimer) root.clearTimeout(runtimeInfoTimer);
    runtimeInfoTimer = root.setTimeout(function () {
      runtimeInfoTimer = 0;
      dumpRuntimeInfo();
    }, delay || 1200);
  }
  function dumpRuntimeInfo() {
    try {
      var vsize = viewportSize();
      var live = dom.viewport ? [dom.viewport.clientWidth, dom.viewport.clientHeight] : [0, 0];
      var info = {
        window: [root.innerWidth, root.innerHeight],
        viewport: [vsize.width, vsize.height],
        liveViewport: live,
        dpr: root.devicePixelRatio || 1,
        layoutMode: state.layoutMode,
        renderer: state.rendererKind,
        ready: state.ready,
        frames: state.frames,
        language: currentLanguage()
      };
      var active = activeDoc();
      if (active && active.model && state.camera) {
        info.camera = {
          distance: state.camera.distance,
          aspect: viewportAspect(),
          target: state.camera.target,
          userAdjusted: !!active.userAdjusted
        };
        var atoms = active.model.atoms || [];
        var bounds = [Infinity, Infinity, -Infinity, -Infinity];
        for (var i = 0; i < atoms.length; i++) {
          if (!atoms[i].pos) continue;
          var sp = state.camera.worldToScreen(atoms[i].pos, vsize.width, vsize.height);
          if (!sp.visible) continue;
          if (sp.x < bounds[0]) bounds[0] = sp.x;
          if (sp.y < bounds[1]) bounds[1] = sp.y;
          if (sp.x > bounds[2]) bounds[2] = sp.x;
          if (sp.y > bounds[3]) bounds[3] = sp.y;
        }
        info.atomScreenBounds = bounds;
        info.clipped = bounds[0] < -1 || bounds[1] < -1 || bounds[2] > vsize.width + 1 || bounds[3] > vsize.height + 1;
        info.modelStats = active.model.stats || null;
      }
      var pre = D.getElementById('cl-runtime-info');
      if (!pre) {
        pre = D.createElement('pre');
        pre.id = 'cl-runtime-info';
        pre.style.display = 'none';
        (D.body || D.documentElement).appendChild(pre);
      }
      pre.textContent = JSON.stringify(info);
    } catch (e) {
      if (root.__clLogError) root.__clLogError('runtime info failed: ' + (e && e.message ? e.message : e));
    }
  }

  function onResize() {
    var previousMode = state.layoutMode;
    updateLayout();
    syncViewportSize();
    if (ui.panels) ui.panels.renderAll();
    if (previousMode !== state.layoutMode && ui.dialogs) ui.dialogs.rerender();
    requestRender();
    scheduleRuntimeInfo(220);
  }

  // ------------------------------------------------------------- sync UI ----
  function syncUI(withPanels) {
    var doc = activeDoc();
    // app bar title
    if (dom.appbarTitle) {
      if (doc) {
        dom.appbarTitle.hidden = false;
        dom.appbarTitle.innerHTML = '<span class="doc-name">' + esc(doc.title) + '</span>' +
          (doc.dirty ? '<span class="dirty-dot" title="' + esc(t('ui.modified')) + '"></span>' : '');
      } else {
        dom.appbarTitle.hidden = true;
        dom.appbarTitle.innerHTML = '';
      }
    }
    // empty state
    if (dom.emptyState) dom.emptyState.hidden = !!doc;
    // tabs
    renderTabs();
    // buttons
    var hasDoc = !!doc;
    setButtonEnabled(dom.btnUndo, !!(doc && doc.undo.length));
    setButtonEnabled(dom.btnRedo, !!(doc && doc.redo.length));
    setButtonEnabled(dom.btnSave, hasDoc);
    setButtonEnabled(dom.btnScreenshot, hasDoc);
    if (dom.btnLanguage) dom.btnLanguage.textContent = currentLanguage() === 'zh' ? t('language.chinese') : t('language.english');
    // toolbar active states
    toggleActive(dom.mobileToolbar, '[data-action="measure-distance"]', state.mode === 'distance');
    toggleActive(dom.mobileToolbar, '[data-action="measure-angle"]', state.mode === 'angle');
    toggleActive(dom.mobileToolbar, '[data-action="left"]', state.layoutMode === 'drawer' ? state.drawer.left : state.settings.leftPanel);
    toggleActive(dom.mobileToolbar, '[data-action="right"]', state.layoutMode === 'drawer' ? state.drawer.right : state.settings.rightPanel);
    if (withPanels !== false && ui.panels) ui.panels.renderAll();
    requestRender();
  }
  function toggleActive(scope, selector, active) {
    if (!scope) return;
    var node = scope.querySelector(selector);
    if (node) node.classList.toggle('is-active', !!active);
  }
  function setButtonEnabled(button, enabled) {
    if (!button) return;
    button.classList.toggle('is-disabled', !enabled);
  }
  function renderTabs() {
    if (!dom.tabs || !dom.tabsList) return;
    if (!state.docs.length) {
      dom.tabs.hidden = true;
      dom.tabsList.innerHTML = '';
      return;
    }
    dom.tabs.hidden = false;
    var html = '';
    for (var i = 0; i < state.docs.length; i++) {
      var doc = state.docs[i];
      var active = doc.id === state.activeId;
      var label = doc.title || doc.sourceName || 'CrystalLens';
      html += '<button type="button" class="tab' + (active ? ' is-active' : '') + '" data-action="doc-switch" data-id="' + esc(doc.id) + '">' +
        (doc.dirty ? '<span class="tab-dirty"></span>' : '') +
        '<span class="tab-title">' + esc(label) + '</span>' +
        '<span class="tab-close" role="button" data-action="doc-close" data-id="' + esc(doc.id) + '" title="' + esc(t('ui.tab.close')) + '">' + iconSvg('close', 11) + '</span>' +
        '</button>';
    }
    dom.tabsList.innerHTML = html;
    var activeNode = dom.tabsList.querySelector('.tab.is-active');
    if (activeNode && activeNode.scrollIntoView) {
      try { activeNode.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ language ----
  function setLanguage(lang) {
    if (!CL.i18n) return;
    var next = CL.i18n.normalizeLang ? CL.i18n.normalizeLang(lang) : (lang === 'en' ? 'en' : 'zh');
    CL.i18n.setLanguage(next);
    state.settings.language = next;
    scheduleSaveSettings();
    applyLanguageToChrome();
    syncUI();
    if (ui.dialogs) ui.dialogs.rerender();
    if (ui.panels) ui.panels.renderAll();
    requestRender();
  }
  function applyLanguageToChrome() {
    if (CL.i18n) CL.i18n.apply(D);
    ui.hydrateIcons(D);
    if (dom.btnLanguage) dom.btnLanguage.textContent = currentLanguage() === 'zh' ? t('language.chinese') : t('language.english');
    if (dom.fileInput) dom.fileInput.setAttribute('aria-label', t('dialog.open.title'));
  }
  function onLanguageChanged() {
    state.settings.language = currentLanguage();
    scheduleSaveSettings();
    applyLanguageToChrome();
    syncUI();
    requestRender();
  }

  // -------------------------------------------------------- style/toggles ---
  function setStyle(style) {
    if (style !== 'ball-stick' && style !== 'space-fill' && style !== 'polyhedral') return;
    state.settings.style = style;
    scheduleSaveSettings();
    var doc = activeDoc();
    if (doc && style === 'polyhedral' && (!doc.model || !doc.model.polyhedra || !doc.model.polyhedra.enabled)) {
      // Model layer only computes polyhedra for the polyhedral style.
      ensureDocModel(doc, true);
      pushModelToRenderer(false);
      fitView();
    } else {
      applyRenderOptions();
      fitView();
    }
    syncUI();
  }
  function toggleSetting(name) {
    var allowed = ['showCell', 'showBonds', 'showLabels', 'showBoundary', 'showAxes', 'leftPanel', 'rightPanel'];
    if (allowed.indexOf(name) < 0) return;
    state.settings[name] = !state.settings[name];
    scheduleSaveSettings();
    if (name === 'showBoundary') {
      var doc = activeDoc();
      if (doc) {
        ensureDocModel(doc, true);
        pushModelToRenderer(false);
      }
    }
    applyRenderOptions();
    updateLayout();
    syncUI();
  }
  function setAtomScale(value, final) {
    var scale = clamp(num(value) || 0.3, 0.15, 0.85);
    state.settings.atomScale = scale;
    applyRenderOptions();
    if (final) scheduleSaveSettings();
    if (ui.panels) ui.panels.updateAtomScaleLabel && ui.panels.updateAtomScaleLabel(scale);
  }
  function toggleProjection() {
    if (!state.camera) return;
    state.camera.orthographic = !state.camera.orthographic;
    state.settings.orthographic = !!state.camera.orthographic;
    scheduleSaveSettings();
    requestRender();
    syncUI();
  }
  function setSupercell(values) {
    var next = [1, 1, 1];
    for (var i = 0; i < 3; i++) {
      var n = Math.round(num(values[i]));
      if (!isFinite(n) || n < SUPERCELL_MIN || n > SUPERCELL_MAX) return { ok: false, error: t('dialog.supercell.error.invalid') };
      next[i] = n;
    }
    var doc = activeDoc();
    if (!doc) return { ok: false, error: t('toast.no-structure') };
    if (doc.model && !doc.model.hasCell) return { ok: false, error: t('toast.no-cell-for-edit') };
    // budget check (approximate; authoritative check happens in the model layer)
    var copies = next[0] * next[1] * next[2];
    var stats = doc.model.stats || {};
    var cells = stats.asymmetricAtomCount || (doc.structure && doc.structure.sites ? doc.structure.sites.length : 0) || 1;
    var cellBonds = stats.cellBondCount || stats.visibleBondCount || 0;
    if (copies > 1) {
      if (cells * copies > 65536 || cellBonds * copies > 300000) {
        return { ok: false, error: t('dialog.supercell.error.budget') };
      }
      if (CL.crystal && typeof CL.crystal.fitsSupercell === 'function') {
        try {
          var fit = CL.crystal.fitsSupercell(doc.structure, next);
          if (fit && fit.ok === false) return { ok: false, error: t('dialog.supercell.error.budget') };
        } catch (e) { /* ignore */ }
      }
    }
    state.settings.supercell = next;
    scheduleSaveSettings();
    var activeDocRef = activeDoc();
    if (activeDocRef) {
      ensureDocModel(activeDocRef, true);
      pushModelToRenderer(false);
      fitView();
    }
    applyRenderOptions();
    syncUI();
    setStatus('status.structure-updated');
    return { ok: true };
  }

  // -------------------------------------------------------- appearance -----
  function previewAppearance(appearance) {
    state.settings.appearance = cloneAppearance(appearance);
    applyRenderOptions();
  }
  function commitAppearance() {
    saveSettingsNow();
    applyRenderOptions();
  }
  function resetAppearance() {
    state.settings.appearance = cloneAppearance(DEFAULT_APPEARANCE);
    applyRenderOptions();
    return state.settings.appearance;
  }

  // ------------------------------------------------------------- pointers ---
  function viewportLocalPosition(event) {
    var rect = dom.viewport ? dom.viewport.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function onPointerDown(event) {
    if (!dom.viewport) return;
    if (event.target !== dom.viewport && event.target.parentNode !== dom.viewport) return;
    var pos = viewportLocalPosition(event);
    state.pointers[event.pointerId] = { x: pos.x, y: pos.y, pointerType: event.pointerType, button: event.button };
    if (event.pointerType === 'touch') {
      // prevent scrolling/zooming of the page; the viewport owns the gesture
      if (event.cancelable) event.preventDefault();
    }
    if (Object.keys(state.pointers).length === 2) {
      startPinch();
      return;
    }
    if (Object.keys(state.pointers).length > 2) return;
    var pointer = state.pointer;
    pointer.active = true;
    pointer.id = event.pointerId;
    pointer.type = event.pointerType || 'mouse';
    pointer.button = event.button;
    pointer.startX = pointer.lastX = pos.x;
    pointer.startY = pointer.lastY = pos.y;
    pointer.startTime = now();
    pointer.moved = false;
    pointer.dragging = false;
    pointer.panning = (pointer.type === 'mouse' && (event.button === 1 || event.button === 2));
    state.inertia.active = false;
    state.inertia.yaw = 0;
    state.inertia.pitch = 0;
    state.clickSuppressUntil = 0;
    try {
      if (dom.viewport.setPointerCapture) dom.viewport.setPointerCapture(event.pointerId);
    } catch (e) { /* ignore */ }
    if (pointer.type === 'touch') {
      if (pointer.longPressTimer) root.clearTimeout(pointer.longPressTimer);
      pointer.longPressTimer = root.setTimeout(function () {
        pointer.longPressTimer = 0;
        if (!pointer.active || pointer.moved) return;
        var hit = pickAt(pointer.lastX, pointer.lastY);
        if (hit >= 0) {
          ui.nativeVibrate(18);
          selectAtom(hit);
        }
      }, 520);
    }
  }
  function startPinch() {
    var ids = Object.keys(state.pointers);
    var a = state.pointers[ids[0]], b = state.pointers[ids[1]];
    state.pinch = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2
    };
    state.pointer.active = false;
    if (state.pointer.longPressTimer) { root.clearTimeout(state.pointer.longPressTimer); state.pointer.longPressTimer = 0; }
    state.inertia.active = false;
    if (dom.viewport) dom.viewport.classList.add('is-dragging');
  }
  function onPointerMove(event) {
    var pos = viewportLocalPosition(event);
    if (state.pointers[event.pointerId]) {
      state.pointers[event.pointerId].x = pos.x;
      state.pointers[event.pointerId].y = pos.y;
    }
    var pointer = state.pointer;
    if (state.pinch && Object.keys(state.pointers).length >= 2 && state.camera) {
      var ids = Object.keys(state.pointers);
      var a = state.pointers[ids[0]], b = state.pointers[ids[1]];
      if (a && b) {
        var distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        var midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        var ratio = distance / state.pinch.distance;
        if (Math.abs(ratio - 1) > 0.001) {
          var steps = Math.log(ratio) / ZOOM_STEP;
          try { state.camera.zoom(steps); } catch (e) { /* ignore */ }
        }
        var panDx = midX - state.pinch.midX, panDy = midY - state.pinch.midY;
        if (Math.abs(panDx) > 0.2 || Math.abs(panDy) > 0.2) {
          var size = viewportSize();
          try { state.camera.pan(panDx, panDy, size.width, size.height); } catch (e) { /* ignore */ }
        }
        state.pinch.distance = distance;
        state.pinch.midX = midX;
        state.pinch.midY = midY;
        var doc = activeDoc();
        if (doc) { doc.userAdjusted = true; saveCameraToDoc(doc); }
        requestRender();
      }
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (pointer.type === 'mouse' && !pointer.active) {
      scheduleHover(pos.x, pos.y);
      return;
    }
    if (!pointer.active || event.pointerId !== pointer.id) return;
    var dx = pos.x - pointer.lastX;
    var dy = pos.y - pointer.lastY;
    if (!pointer.moved && (Math.abs(pos.x - pointer.startX) + Math.abs(pos.y - pointer.startY)) > 3) {
      pointer.moved = true;
      pointer.dragging = !pointer.panning;
      if (dom.viewport) dom.viewport.classList.add('is-dragging');
      if (pointer.longPressTimer) { root.clearTimeout(pointer.longPressTimer); pointer.longPressTimer = 0; }
    }
    if (!pointer.moved) return;
    var doc2 = activeDoc();
    if (state.camera) {
      try {
        if (pointer.panning) state.camera.pan(dx, dy, viewportSize().width, viewportSize().height);
        else state.camera.orbit(dx, dy);
      } catch (e) { /* ignore */ }
    }
    if (doc2) { doc2.userAdjusted = true; }
    pointer.lastX = pos.x;
    pointer.lastY = pos.y;
    pointer.lastMoveTime = now();
    pointer.lastDx = dx;
    pointer.lastDy = dy;
    if (state.camera && !pointer.panning) {
      state.inertia.yaw = clamp(dx * 2.4, -4, 4);
      state.inertia.pitch = clamp(dy * 2.4, -4, 4);
    }
    requestRender();
    if (event.cancelable && pointer.type === 'touch') event.preventDefault();
  }
  function onPointerUp(event) {
    var pointer = state.pointer;
    delete state.pointers[event.pointerId];
    if (state.pinch) {
      if (Object.keys(state.pointers).length >= 2) return;
      state.pinch = null;
      if (dom.viewport) dom.viewport.classList.remove('is-dragging');
      if (Object.keys(state.pointers).length === 1) {
        // restart single-pointer tracking for the remaining finger
        var ids = Object.keys(state.pointers);
        var remains = state.pointers[ids[0]];
        pointer.active = true;
        pointer.id = Number(ids[0]);
        pointer.type = 'touch';
        pointer.startX = pointer.lastX = remains.x;
        pointer.startY = pointer.lastY = remains.y;
        pointer.moved = false;
        return;
      }
    }
    if (!pointer.active || event.pointerId !== pointer.id) return;
    pointer.active = false;
    if (pointer.longPressTimer) { root.clearTimeout(pointer.longPressTimer); pointer.longPressTimer = 0; }
    if (dom.viewport) dom.viewport.classList.remove('is-dragging');
    var isTap = !pointer.moved;
    var doc = activeDoc();
    if (isTap) {
      var pos = viewportLocalPosition(event);
      var timeNow = now();
      if (pointer.type === 'mouse' && pointer.button === 2) return;
      var isDoubleTap = (timeNow - pointer.lastTap) < 340 && Math.hypot(pos.x - pointer.lastTapX, pos.y - pointer.lastTapY) < 30;
      pointer.lastTap = timeNow;
      pointer.lastTapX = pos.x;
      pointer.lastTapY = pos.y;
      if (isDoubleTap) {
        pointer.lastTap = 0;
        fitView();
        return;
      }
      handleTap(pos.x, pos.y);
      if (pointer.type === 'mouse' && pointer.type === 'mouse') { /* hover handled on move */ }
    } else if (state.camera && !pointer.panning) {
      state.inertia.active = true;
      if (doc) { doc.userAdjusted = true; saveCameraToDoc(doc); }
      requestRender();
    } else if (doc) {
      if (state.camera) saveCameraToDoc(doc);
    }
  }
  function onPointerCancel(event) {
    delete state.pointers[event.pointerId];
    state.pinch = null;
    state.pointer.active = false;
    if (dom.viewport) dom.viewport.classList.remove('is-dragging');
    if (state.pointer.longPressTimer) { root.clearTimeout(state.pointer.longPressTimer); state.pointer.longPressTimer = 0; }
  }
  var hoverScheduled = false;
  var hoverPoint = { x: 0, y: 0 };
  function scheduleHover(x, y) {
    hoverPoint.x = x;
    hoverPoint.y = y;
    if (hoverScheduled) return;
    hoverScheduled = true;
    root.requestAnimationFrame(function () {
      hoverScheduled = false;
      if (!state.camera || !state.renderer) return;
      var id = -1;
      try { id = state.renderer.pick(state.camera, hoverPoint.x, hoverPoint.y); } catch (e) { id = -1; }
      if (typeof id !== 'number') id = -1;
      if (id !== state.hovered) setHovered(id);
    });
  }
  function pickAt(x, y) {
    if (!state.camera || !state.renderer) return -1;
    try {
      var id = state.renderer.pick(state.camera, x, y);
      return (typeof id === 'number') ? id : -1;
    } catch (e) {
      return -1;
    }
  }
  function onWheel(event) {
    if (!dom.viewport || !state.camera) return;
    var pos = viewportLocalPosition(event);
    if (pos.x < 0 || pos.y < 0 || pos.x > state.viewportSize.width || pos.y > state.viewportSize.height) return;
    if (event.cancelable) event.preventDefault();
    var delta = event.deltaY || event.deltaX || 0;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= 100;
    var steps = -delta / 120;
    try { state.camera.zoom(steps); } catch (e) { /* ignore */ }
    var doc = activeDoc();
    if (doc) { doc.userAdjusted = true; saveCameraToDoc(doc); }
    state.inertia.active = false;
    requestRender();
  }
  function onContextMenu(event) {
    if (event.cancelable) event.preventDefault();
    return false;
  }

  // ------------------------------------------------------------- keyboard ---
  function isTextInput(target) {
    if (!target) return false;
    var tag = (target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }
  function onKeyDown(event) {
    var target = event.target;
    if (isTextInput(target)) return;
    var key = event.key;
    var lower = String(key || '').toLowerCase();
    var ctrl = event.ctrlKey || event.metaKey;
    if (key === 'Escape') {
      if (isTextInput(target)) return;
      event.preventDefault();
      handleBack();
      return;
    }
    if (ctrl) {
      if (lower === 'o') { event.preventDefault(); dom.fileInput && dom.fileInput.click(); return; }
      if (lower === 'l') { event.preventDefault(); ui.dialogs.openLibrary(); return; }
      if (lower === 's') {
        event.preventDefault();
        if (event.shiftKey) exportScreenshot('save');
        else ui.dialogs.openSave();
        return;
      }
      if (lower === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (lower === 'y') { event.preventDefault(); redo(); return; }
      if (lower === 'e') { event.preventDefault(); ui.dialogs.openEditCell(); return; }
      if (lower === 'a' && event.shiftKey) { event.preventDefault(); ui.dialogs.openAtom('add'); return; }
      if (lower === 'c') { event.preventDefault(); copySummary(); return; }
      return;
    }
    switch (lower) {
      case 'f1': event.preventDefault(); ui.dialogs.openHelp(); break;
      case 'f2': if (activeDoc() && activeDoc().selected >= 0) { event.preventDefault(); ui.dialogs.openAtom('edit'); } break;
      case 'delete': case 'backspace': {
        if (!activeDoc() || activeDoc().selected < 0) return;
        event.preventDefault();
        ui.dialogs.confirmDeleteAtom();
        break;
      }
      case 'home': event.preventDefault(); resetView(); break;
      case 'f': event.preventDefault(); fitView(); break;
      case 'd': toggleMeasureMode('distance'); break;
      case 'a': toggleMeasureMode('angle'); break;
      case 'c': toggleSetting('showCell'); break;
      case 'b': toggleSetting('showBonds'); break;
      case 'l': toggleSetting('showLabels'); break;
      case 'p': toggleProjection(); break;
      case '+': case '=': zoomBySteps(1); break;
      case '-': case '_': zoomBySteps(-1); break;
      case 'arrowleft': if (state.camera) { state.camera.orbit(-20, 0); requestRender(); } event.preventDefault(); break;
      case 'arrowright': if (state.camera) { state.camera.orbit(20, 0); requestRender(); } event.preventDefault(); break;
      case 'arrowup': if (state.camera) { state.camera.orbit(0, -20); requestRender(); } event.preventDefault(); break;
      case 'arrowdown': if (state.camera) { state.camera.orbit(0, 20); requestRender(); } event.preventDefault(); break;
      default: break;
    }
  }
  function zoomBySteps(steps) {
    if (!state.camera) return;
    try { state.camera.zoom(steps); } catch (e) { /* ignore */ }
    requestRender();
  }

  // ---------------------------------------------------------- back button ---
  function handleBack() {
    if (ui.dialogs && ui.dialogs.isOpen()) { ui.dialogs.back(); return true; }
    if (ui.dialogs && ui.dialogs.isMenuOpen && ui.dialogs.isMenuOpen()) { ui.dialogs.closeMenu(); return true; }
    if (state.layoutMode === 'drawer' && (state.drawer.left || state.drawer.right)) { closeDrawers(); return true; }
    if (state.mode !== 'none') { setMeasureMode('none'); return true; }
    var doc = activeDoc();
    if (doc && doc.selected >= 0) { clearSelection(); return true; }
    return false;
  }
  root.__clHandleBack = function () {
    try { return handleBack() ? 'true' : 'false'; } catch (e) { logError('back handler failed: ' + (e && e.message ? e.message : e)); return 'false'; }
  };

  // -------------------------------------------------------- share / native --
  function openSharedFile(name, base64) {
    try {
      var text = CL.Native ? CL.Native.decodeBase64Utf8(base64) : atob(base64);
      var ok = openText(name || 'shared.cif', text);
      if (ok && ui.toast) ui.toast(t('toast.loaded', name || ''), '', 'success');
      return ok ? 'true' : 'false';
    } catch (e) {
      logError('shared file failed: ' + (e && e.message ? e.message : e));
      if (ui.dialogs) ui.dialogs.openError(t('toast.open-failed-title'), String(e && e.message ? e.message : e));
      return 'false';
    }
  }
  root.__clOpenSharedFile = function (name, base64) { return openSharedFile(name, base64); };
  function initNativeHooks() {
    if (!CL.Native) return;
    try { CL.Native.setKeepScreenOn(true); } catch (e) { /* ignore */ }
    CL.Native.onSharedFile(function (payload) { openSharedFile(payload.name, payload.base64); });
    if (CL.Native.pollInitialSharedFile) CL.Native.pollInitialSharedFile();
  }
  function nativeVibrate(ms) {
    if (CL.Native && CL.Native.vibrate) { try { CL.Native.vibrate(ms); } catch (e) { /* ignore */ } }
  }
  ui.nativeVibrate = nativeVibrate;

  // -------------------------------------------------------- error logging ---
  function logError(message) {
    try {
      if (root.__clLogError) { root.__clLogError(String(message)); return; }
      if (root.console && root.console.error) root.console.error('[CL.App] ' + message);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ actions -----
  function handleAction(action, target) {
    var doc = activeDoc();
    switch (action) {
      case 'open': dom.fileInput && dom.fileInput.click(); break;
      case 'library': ui.dialogs.openLibrary(); break;
      case 'save': if (doc) ui.dialogs.openSave(); else ui.toast(t('file.save'), t('toast.no-structure'), 'info'); break;
      case 'screenshot': if (doc) exportScreenshot('save'); else ui.toast(t('file.save-screenshot'), t('toast.no-structure'), 'info'); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'menu': ui.dialogs.openMenu(); break;
      case 'lang': setLanguage(currentLanguage() === 'zh' ? 'en' : 'zh'); break;
      case 'language-zh': setLanguage('zh'); break;
      case 'language-en': setLanguage('en'); break;
      case 'left': toggleDrawer('left'); break;
      case 'right': toggleDrawer('right'); break;
      case 'close-left': setDrawer('left', false); break;
      case 'close-right': setDrawer('right', false); break;
      case 'fit': fitView(); break;
      case 'reset': resetView(); break;
      case 'projection': toggleProjection(); break;
      case 'toggle-cell': toggleSetting('showCell'); break;
      case 'toggle-bonds': toggleSetting('showBonds'); break;
      case 'toggle-labels': toggleSetting('showLabels'); break;
      case 'toggle-axes': toggleSetting('showAxes'); break;
      case 'toggle-boundary': toggleSetting('showBoundary'); break;
      case 'toggle-left-panel': toggleSetting('leftPanel'); break;
      case 'toggle-right-panel': toggleSetting('rightPanel'); break;
      case 'style-ball-stick': setStyle('ball-stick'); break;
      case 'style-space-fill': setStyle('space-fill'); break;
      case 'style-polyhedral': setStyle('polyhedral'); break;
      case 'appearance': ui.dialogs.openAppearance(); break;
      case 'supercell': ui.dialogs.openSupercell(); break;
      case 'edit-cell': ui.dialogs.openEditCell(); break;
      case 'add-atom': ui.dialogs.openAtom('add'); break;
      case 'edit-atom': ui.dialogs.openAtom('edit'); break;
      case 'delete-atom': ui.dialogs.confirmDeleteAtom(); break;
      case 'clear-selection': clearSelection(); break;
      case 'measure-distance': toggleMeasureMode('distance'); break;
      case 'measure-angle': toggleMeasureMode('angle'); break;
      case 'measure-exit': setMeasureMode('none'); break;
      case 'measure-clear': clearMeasurements(); break;
      case 'measure-remove': removeMeasurement(Number(target.getAttribute('data-index')) || 0); break;
      case 'doc-switch': switchDocument(target.getAttribute('data-id')); break;
      case 'doc-close': closeDocument(target.getAttribute('data-id')); break;
      case 'reload': reloadDocument(); break;
      case 'help': ui.dialogs.openHelp(); break;
      case 'about': ui.dialogs.openHelp(); break;
      case 'copy-summary': copySummary(); break;
      case 'share-cif': exportStructure('cif'); break;
      case 'share-xyz': exportStructure('xyz'); break;
      case 'share-png': exportScreenshot('share'); break;
      case 'exit': if (CL.Native && CL.Native.isAndroid) CL.Native.exitApp(); else ui.dialogs.openHelp(); break;
      default: break;
    }
  }
  function reloadDocument() {
    var doc = activeDoc();
    if (!doc) { ui.toast(t('file.reload'), t('toast.no-structure'), 'info'); return; }
    if (!doc.sourceText) { ui.toast(t('file.reload'), t('ui.core.missing'), 'info'); return; }
    var doReload = function () {
      var name = doc.sourceName || 'untitled.cif';
      var text = doc.sourceText;
      reallyCloseDocument(doc.id);
      openText(name, text);
    };
    if (doc.dirty) {
      ui.dialogs.openConfirm({
        title: t('dialog.unsaved.title'),
        message: t('dialog.unsaved.message'),
        confirmLabel: t('file.reload'),
        cancelLabel: t('dialog.cancel'),
        danger: true,
        onConfirm: doReload
      });
    } else {
      doReload();
    }
  }
  function bindGlobalClicks() {
    D.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      if (target.closest('#sheet-root')) return;          // dialogs own their actions
      var action = target.getAttribute('data-action');
      var inMenu = !!target.closest('#menu-root');
      if (inMenu && ui.dialogs && ui.dialogs.closeMenu) ui.dialogs.closeMenu();
      handleAction(action, target);
    });
    D.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var scale = target.getAttribute('data-slider');
      if (scale === 'atomScale') setAtomScale(target.value, false);
    });
    D.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var scale = target.getAttribute('data-slider');
      if (scale === 'atomScale') setAtomScale(target.value, true);
    });
  }
  function bindViewportEvents() {
    if (!dom.viewport) return;
    dom.viewport.addEventListener('pointerdown', onPointerDown, { passive: false });
    root.addEventListener('pointermove', onPointerMove, { passive: false });
    root.addEventListener('pointerup', onPointerUp, { passive: false });
    root.addEventListener('pointercancel', onPointerCancel, { passive: false });
    dom.viewport.addEventListener('wheel', onWheel, { passive: false });
    dom.viewport.addEventListener('contextmenu', onContextMenu, { passive: false });
    dom.viewport.addEventListener('dblclick', function (event) { event.preventDefault(); fitView(); }, { passive: false });
    D.addEventListener('keydown', onKeyDown);
    // drag & drop (desktop)
    ['dragenter', 'dragover'].forEach(function (name) {
      D.addEventListener(name, function (event) {
        if (!event.dataTransfer) return;
        event.preventDefault();
        if (dom.dropOverlay) dom.dropOverlay.hidden = false;
      }, { passive: false });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      D.addEventListener(name, function (event) {
        event.preventDefault();
        if (dom.dropOverlay) dom.dropOverlay.hidden = true;
        if (name === 'drop' && event.dataTransfer && event.dataTransfer.files) {
          handleFileList(event.dataTransfer.files);
        }
      }, { passive: false });
    });
    D.addEventListener('paste', function (event) {
      if (!event.clipboardData || !event.clipboardData.files || !event.clipboardData.files.length) return;
      handleFileList(event.clipboardData.files);
    });
    if (dom.fileInput) {
      dom.fileInput.addEventListener('change', function () {
        if (dom.fileInput.files && dom.fileInput.files.length) handleFileList(dom.fileInput.files);
        dom.fileInput.value = '';
      });
    }
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', function () { root.setTimeout(onResize, 250); });
    if (root.ResizeObserver && dom.viewport) {
      try {
        var observer = new root.ResizeObserver(function () { syncViewportSize(); });
        observer.observe(dom.viewport);
      } catch (e) { /* ignore */ }
    }
    if (CL.i18n && CL.i18n.onChange) CL.i18n.onChange(onLanguageChanged);
    if (dom.scrim) dom.scrim.addEventListener('click', closeDrawers);
    if (dom.mobileToolbar) {
      dom.mobileToolbar.addEventListener('click', function (event) {
        var target = event.target.closest('[data-action]');
        if (!target) return;
        handleAction(target.getAttribute('data-action'), target);
      });
    }
  }

  // --------------------------------------------------------------- URL QA ---
  function parseQuery() {
    var query = {};
    try {
      var search = String(root.location.search || '').replace(/^\?/, '');
      if (!search) return query;
      var parts = search.split('&');
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].split('=');
        query[decodeURIComponent(pair[0])] = decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
      }
    } catch (e) { /* ignore malformed query */ }
    return query;
  }
  function applyUrlOptions(query) {
    if (query.lang === 'en' || query.lang === 'zh') {
      CL.i18n && CL.i18n.setLanguage(query.lang, { persist: false });
      state.settings.language = query.lang;
    }
    if (query.style === 'ball-stick' || query.style === 'space-fill' || query.style === 'polyhedral') {
      state.settings.style = query.style;
    }
    if (query.showBoundary != null && query.showBoundary !== '') {
      state.settings.showBoundary = query.showBoundary !== '0' && query.showBoundary !== 'false';
    }
    if (query.supercell) {
      var match = /^(\d+)[xX×](\d+)[xX×](\d+)$/.exec(query.supercell);
      if (match) {
        var values = [Number(match[1]), Number(match[2]), Number(match[3])];
        var valid = values.every(function (v) { return isFinite(v) && v >= SUPERCELL_MIN && v <= SUPERCELL_MAX; });
        if (valid) state.settings.supercell = values.map(function (v) { return Math.round(v); });
      }
    }
    if (query.style) applyRenderOptions();
    if (query.measure === 'distance' || query.measure === 'angle') state.mode = query.measure;
    var opened = false;
    if (query.lib) opened = openLibraryEntry(query.lib);
    else if (query.example) opened = openExample(query.example);
    if (!opened && !state.docs.length && query.selftest) {
      // selftest should still show a representative structure for screenshots
      if ((CL.data && CL.data.library && CL.data.library.length) && !query.selftestOnly) {
        openLibraryEntry(CL.data.library[0].id);
      }
    }
    // QA hooks for layout screenshots of overlays (documented in ui-notes.md).
    if (query.select != null && query.select !== '') {
      root.setTimeout(function () {
        var index = Number(query.select);
        if (isFinite(index)) selectAtom(index);
      }, 140);
    }
    if (query.drawer === 'left' || query.drawer === 'right') {
      root.setTimeout(function () { setDrawer(query.drawer, true); }, 120);
    }
    if (query.sheet) {
      root.setTimeout(function () {
        if (!ui.dialogs) return;
        switch (query.sheet) {
          case 'library': ui.dialogs.openLibrary(); break;
          case 'supercell': ui.dialogs.openSupercell(); break;
          case 'appearance': ui.dialogs.openAppearance(); break;
          case 'edit-cell': ui.dialogs.openEditCell(); break;
          case 'add-atom': ui.dialogs.openAtom('add'); break;
          case 'help': ui.dialogs.openHelp(); break;
          case 'save': ui.dialogs.openSave(); break;
          case 'menu': ui.dialogs.openMenu(); break;
          default: break;
        }
      }, 160);
    }
    if (query.selftest === '1' || query.selftest === 'true') {
      runSelftest();
    }
  }

  // ------------------------------------------------------------ selftest ---
  function runSelftest() {
    var results = { pass: 0, fail: 0, failures: [], info: {} };
    function check(name, fn) {
      try {
        var ok = fn();
        if (ok === false) { results.fail++; results.failures.push(name); }
        else results.pass++;
        return ok;
      } catch (e) {
        results.fail++;
        results.failures.push(name + ': ' + (e && e.message ? e.message : String(e)));
        return false;
      }
    }
    function finish() {
      var pre = D.getElementById('cl-selftest');
      if (!pre) {
        pre = D.createElement('pre');
        pre.id = 'cl-selftest';
        pre.style.display = 'none';
        (D.body || D.documentElement).appendChild(pre);
      }
      pre.textContent = JSON.stringify(results);
      results.info.frames = state.frames;
      results.info.ready = state.ready;
      root.__clSelftest = results;
      if (root.console && root.console.log) root.console.log('[CL selftest]', JSON.stringify(results));
    }
    results.info.renderer = state.rendererKind;
    results.info.core = hasCore();
    results.info.language = currentLanguage();
    results.info.version = APP_VERSION;
    results.info.rendererSupported = !!(state.renderer && state.renderer.supported);
    results.info.i18nKeys = CL.i18n && CL.i18n.count ? CL.i18n.count : 0;

    check('library data present (12)', function () {
      return !!(CL.data && CL.data.library && CL.data.library.length === 12);
    });
    check('examples data present (6)', function () {
      return !!(CL.data && CL.data.examples && CL.data.examples.length === 6);
    });
    check('core modules available (parsers/crystal)', function () {
      var ok = hasCore();
      if (!ok) results.failures.push('note: core missing - demo fallback is rendering');
      return ok;
    });
    check('renderer initialized', function () { return !!(state.renderer); });
    check('renderer.supported', function () { return !!(state.renderer && state.renderer.supported); });
    check('camera initialized', function () { return !!(state.camera && typeof state.camera.worldToScreen === 'function'); });
    // Diagnostics (viewed by QA via #cl-selftest info; also useful for the
    // headless layout checks): viewport size, fitted camera and projected
    // atom bounds so clipping can be detected without eyeballing screenshots.
    try {
      var vsize = viewportSize();
      results.info.viewport = [vsize.width, vsize.height];
      results.info.window = [root.innerWidth, root.innerHeight];
      results.info.liveViewport = dom.viewport ? [dom.viewport.clientWidth, dom.viewport.clientHeight] : null;
      results.info.rendererSize = state.renderer && state.renderer._width ? [state.renderer._width, state.renderer._height] : null;
      results.info.resizeCount = state.resizeCount || 0;
      results.info.aspect = viewportAspect();
      results.info.dpr = root.devicePixelRatio || 1;
      results.info.camera = state.camera ? {
        distance: state.camera.distance,
        yaw: state.camera.yaw,
        pitch: state.camera.pitch,
        target: state.camera.target,
        orthographic: !!state.camera.orthographic
      } : null;
      results.info.visiblePoints = visiblePoints().length;
      var active = activeDoc();
      if (active && active.model && state.camera) {
        var atoms = active.model.atoms || [];
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, visibleAtoms = 0;
        for (var ai = 0; ai < atoms.length; ai++) {
          if (!atoms[ai].pos) continue;
          var sp = state.camera.worldToScreen(atoms[ai].pos, vsize.width, vsize.height);
          if (!sp.visible) continue;
          visibleAtoms++;
          if (sp.x < minX) minX = sp.x;
          if (sp.x > maxX) maxX = sp.x;
          if (sp.y < minY) minY = sp.y;
          if (sp.y > maxY) maxY = sp.y;
        }
        results.info.atomScreenBounds = [minX, minY, maxX, maxY];
        results.info.projectedAtoms = visibleAtoms;
        results.info.clipped = (minX < -1 || minY < -1 || maxX > vsize.width + 1 || maxY > vsize.height + 1);
      }
    } catch (diagError) {
      results.info.diagError = String(diagError && diagError.message ? diagError.message : diagError);
    }
    check('i18n table >= 251 keys', function () { return !!(CL.i18n && CL.i18n.count >= 251); });
    check('i18n critical keys', function () {
      var keys = ['app.title', 'library.title', 'viewport.empty.title', 'panel.section.structure',
        'panel.section.measurements', 'dialog.supercell.title', 'dialog.appearance.title',
        'dialog.edit-cell.title', 'dialog.add-atom.title', 'toast.save.saved-title', 'status.ready'];
      for (var i = 0; i < keys.length; i++) if (!CL.i18n.has(keys[i])) throw new Error('missing i18n key ' + keys[i]);
      return true;
    });
    check('UI elements present', function () {
      var ids = ['appbar', 'viewport', 'left-panel', 'right-panel', 'statusbar', 'hud', 'empty-state',
        'btn-open', 'file-input', 'toast-root', 'sheet-root', 'tabs', 'mobile-toolbar', 'gizmo'];
      for (var i = 0; i < ids.length; i++) {
        if (!D.getElementById(ids[i])) throw new Error('missing element #' + ids[i]);
      }
      return true;
    });
    check('no boot failure', function () { return !state.rendererError || state.rendererKind === 'canvas2d'; });
    // HUD / gizmo layout diagnostics for the headless layout checks.
    try {
      var gizmoNode = D.getElementById('gizmo');
      if (gizmoNode && gizmoNode.getBoundingClientRect) {
        var grect = gizmoNode.getBoundingClientRect();
        var gstyle = root.getComputedStyle ? root.getComputedStyle(gizmoNode) : null;
        results.info.gizmo = {
          rect: [Math.round(grect.left), Math.round(grect.top), Math.round(grect.width), Math.round(grect.height)],
          canvas: [gizmoNode.width, gizmoNode.height],
          display: gstyle ? gstyle.display : '',
          visibility: gstyle ? gstyle.visibility : '',
          opacity: gstyle ? gstyle.opacity : ''
        };
        try {
          var gctx = gizmoNode.getContext('2d');
          if (gctx && gizmoNode.width > 2) {
            var centerPixel = gctx.getImageData(Math.floor(gizmoNode.width / 2), Math.floor(gizmoNode.height / 2), 1, 1).data;
            gctx.getImageData(0, 0, 1, 1);
            results.info.gizmoPixel = [centerPixel[0], centerPixel[1], centerPixel[2], centerPixel[3]];
          }
        } catch (pixelError) { results.info.gizmoPixelError = String(pixelError); }
      }
      var hudNode = D.getElementById('hud');
      if (hudNode) {
        var hrect = hudNode.getBoundingClientRect();
        results.info.hudRect = [Math.round(hrect.left), Math.round(hrect.top), Math.round(hrect.width), Math.round(hrect.height)];
      }
    } catch (hudDiagError) { results.info.hudDiagError = String(hudDiagError); }
    var library = (CL.data && CL.data.library) || [];
    for (var i = 0; i < library.length; i++) (function (entry) {
      check('parse model ' + entry.id, function () {
        if (!hasCore()) {
          var demo = buildDemoModel(entry);
          if (!demo.atoms.length) throw new Error('demo atoms empty');
          return false; // counted as failure: core is required for the real test
        }
        var structure = CL.parsers.parse(entry.text, entry.file);
        structure = CL.crystal.finalize(structure) || structure;
        var dm = CL.crystal.buildDisplayModel(structure, { supercell: [2, 2, 2], showBoundary: true });
        if (!dm || !dm.atoms || !dm.atoms.length) throw new Error('empty display model');
        if (!dm.stats || !dm.cell) throw new Error('incomplete display model');
        results.info['atoms_' + entry.id] = dm.atoms.length;
        return true;
      });
    })(library[i]);
    check('measurement engine', function () {
      var doc = activeDoc();
      if (!doc) return true;
      var atoms = (doc.model && doc.model.atoms) || [];
      if (atoms.length < 3) return true;
      var savedMode = state.mode;
      var savedPending = state.pending;
      state.mode = 'distance';
      state.pending = [atoms[0].id, atoms[1].id];
      var ok = commitMeasurement(doc);
      var created = doc.measurements.length ? doc.measurements[doc.measurements.length - 1] : null;
      state.pending = savedPending;
      state.mode = savedMode;
      if (created) {
        results.info.measureSample = { kind: created.kind, value: created.value, label: created.label, expression: created.expression };
        doc.measurements.pop();
      }
      // Periodic minimum-image sanity: the shortest sampled pair distance must
      // match the model layer (halite Na-Cl 2.8201, never the raw 4.88 image).
      if (CL.crystal && typeof CL.crystal.measureDistance === 'function') {
        var sample = Math.min(24, atoms.length);
        var best = Infinity;
        for (var mi = 0; mi < sample; mi++) {
          for (var mj = mi + 1; mj < sample; mj++) {
            var mm = null;
            try { mm = CL.crystal.measureDistance(doc.model, atoms[mi].id, atoms[mj].id); } catch (me) { mm = null; }
            if (mm && typeof mm.value === 'number' && mm.value > 1e-6 && mm.value < best) best = mm.value;
          }
        }
        if (isFinite(best)) results.info.minMeasuredDistance = best;
      }
      syncUI();
      return ok;
    });
    check('android hooks present', function () {
      if (typeof root.__clHandleBack !== 'function') throw new Error('window.__clHandleBack missing');
      if (typeof root.__clOpenSharedFile !== 'function') throw new Error('window.__clOpenSharedFile missing');
      if (typeof CL.Native.decodeBase64Utf8 !== 'function') throw new Error('CL.Native.decodeBase64Utf8 missing');
      var encoded = CL.Native.encodeText('CrystalLens \u00C5\u00B0');
      var decoded = CL.Native.decodeBase64Utf8(encoded);
      if (decoded !== 'CrystalLens \u00C5\u00B0') throw new Error('base64 utf8 roundtrip failed');
      var back = root.__clHandleBack();
      if (back !== 'false' && back !== 'true') throw new Error('back hook must return a string');
      return true;
    });
    check('dialogs mount', function () {
      if (!ui.dialogs) throw new Error('CL.ui.dialogs missing');
      var names = ['openLibrary', 'openSupercell', 'openAppearance', 'openEditCell', 'openHelp', 'openSave'];
      for (var di = 0; di < names.length; di++) {
        ui.dialogs[names[di]]();
        if (!ui.dialogs.isOpen()) throw new Error(names[di] + ' did not open a sheet');
        ui.dialogs.close();
      }
      ui.dialogs.openMenu();
      if (!ui.dialogs.isMenuOpen()) throw new Error('menu did not open');
      ui.dialogs.closeMenu();
      return true;
    });
    check('dialog forms + validation', function () {
      if (!ui.dialogs || !CL.crystal) return true;
      var doc = activeDoc();
      if (!doc || !doc.model || !doc.model.hasCell) return true;
      ui.dialogs.openSupercell();
      var scA = D.getElementById('dlg-sc-a'), scB = D.getElementById('dlg-sc-b'), scC = D.getElementById('dlg-sc-c');
      if (!scA || !scB || !scC) throw new Error('supercell inputs missing');
      scA.value = '2'; scB.value = '2'; scC.value = '2';
      var applyNode = D.querySelector('#sheet-root [data-dialog-action="apply"]');
      if (!applyNode) throw new Error('sheet apply button missing');
      applyNode.click();
      if (state.settings.supercell.join(',') !== '2,2,2') throw new Error('supercell form did not apply');
      setSupercell([1, 1, 1]);
      ui.dialogs.openEditCell();
      var cellA = D.getElementById('dlg-cell-a');
      if (!cellA) throw new Error('edit-cell input missing');
      cellA.value = '0';
      var apply2 = D.querySelector('#sheet-root [data-dialog-action="apply"]');
      apply2.click();
      var errorNode = D.getElementById('dialog-error');
      if (!errorNode || !errorNode.classList.contains('is-visible')) throw new Error('edit-cell validation did not report an error');
      ui.dialogs.close();
      syncUI();
      return true;
    });
    check('shared file hook', function () {
      var before = state.docs.length;
      var xyz = '2\nselftest shared\nH 0.0 0.0 0.0\nH 0.74 0.0 0.0\n';
      var result = root.__clOpenSharedFile('selftest-shared.xyz', CL.Native.encodeText(xyz));
      if (result !== 'true') throw new Error('shared file hook returned ' + result);
      if (state.docs.length !== before + 1) throw new Error('shared file did not create a tab');
      var created = state.docs[state.docs.length - 1];
      results.info.sharedDoc = created.title;
      reallyCloseDocument(created.id);
      return true;
    });
    check('export pipeline', function () {
      var doc = activeDoc();
      if (!doc || !hasCore()) return true;
      if (typeof CL.crystal.exportXyz !== 'function') throw new Error('exportXyz missing');
      var xyz = CL.crystal.exportXyz(doc.model);
      var cif = CL.crystal.exportCif(doc.structure);
      if (!xyz || typeof xyz !== 'string') throw new Error('exportXyz returned empty');
      if (!cif || typeof cif !== 'string') throw new Error('exportCif returned empty for a cell structure');
      results.info.exportBytes = [xyz.length, cif.length];
      return true;
    });
    check('language switch round-trip', function () {
      var before = CL.App.getLanguage();
      setLanguage('en');
      var en = t('dialog.ok');
      setLanguage('zh');
      var zh = t('dialog.ok');
      if (en === zh) throw new Error('i18n did not switch');
      setLanguage(before);
      return true;
    });
    check('supercell rebuild', function () {
      var doc = activeDoc();
      if (!doc || !hasCore() || !doc.model || !doc.model.hasCell) return true;
      var before = doc.model.stats.visibleAtomCount;
      var res = setSupercell([2, 2, 2]);
      if (!res.ok) throw new Error(res.error || 'setSupercell failed');
      var after = doc.model.stats.visibleAtomCount;
      setSupercell([1, 1, 1]);
      if (!(after > before)) throw new Error('supercell did not grow the model (' + before + ' -> ' + after + ')');
      results.info.supercellAtoms = [before, after];
      return true;
    });
    check('edit + undo round-trip', function () {
      var doc = activeDoc();
      if (!doc || !hasCore() || !doc.model || !doc.model.hasCell) return true;
      var before = (doc.structure.sites || []).length;
      var addResult = addAtom({ element: 'H', occupancy: 1, frac: [0.11, 0.11, 0.11] });
      if (!addResult || addResult.ok === false) throw new Error('addAtom failed: ' + ((addResult && addResult.error) || '?'));
      if ((doc.structure.sites || []).length !== before + 1) throw new Error('site was not added');
      undo();
      if ((doc.structure.sites || []).length !== before) throw new Error('undo did not restore the structure');
      doc.dirty = false;
      doc.undo.length = 0;
      doc.redo.length = 0;
      syncUI();
      return true;
    });
    check('two frames rendered', function () {
      // Headless --dump-dom may snapshot before rAF callbacks, so render two
      // frames synchronously inside the self test itself.
      for (var k = 0; k < 2; k++) {
        try { drawFrame(); state.frames++; } catch (e) { throw new Error('render threw: ' + (e && e.message ? e.message : e)); }
      }
      results.info.frames = state.frames;
      return state.frames >= 2;
    });
    // Synchronous finish (headless dump-dom friendly, no rAF dependency).
    finish();
    if (!state.ready && state.frames >= 2) markReady();
  }

  // ----------------------------------------------------------------- init ---
  // Windows Edge/Chromium headless enforces a minimum window width (~492px),
  // so a 390x844 screenshot ends up as the top-left crop of a 492x844 layout.
  // Pin the app shell to the intended phone width when running headless and the
  // report is clearly the standard 390x844 QA size. Real devices/WebView never
  // match the HeadlessChrome UA, so this does not affect production layout.
  // Override/force with ?vw=<px>&vh=<px>.
  function maybePinQaViewport(query) {
    try {
      var headless = /HeadlessChrome/i.test(root.navigator.userAgent || '');
      var qw = Math.round(Number(query.vw));
      var qh = Math.round(Number(query.vh));
      if (!headless && !(qw > 0) && !(qh > 0)) return;
      if (!(qw > 0) && headless) {
        var innerWidth = root.innerWidth || 0;
        if (innerWidth >= 470 && innerWidth <= 560) qw = 390;
      }
      if (!(qw > 0) && !(qh > 0)) return;
      var rootEl = D.documentElement;
      if (qh > 0) rootEl.style.setProperty('--qa-h', qh + 'px');
      if (qw > 0) rootEl.style.setProperty('--qa-w', qw + 'px');
      rootEl.classList.add('cl-qa-size');
      if (qw > 0) rootEl.classList.add('cl-qa-w');
      if (qh > 0) rootEl.classList.add('cl-qa-h');
      state.qaPinned = { width: qw > 0 ? qw : 0, height: qh > 0 ? qh : 0 };
    } catch (e) { /* cosmetic QA helper only */ }
  }
  function cacheDom() {
    var ids = ['app', 'boot-screen', 'boot-status', 'boot-logo', 'brand-logo', 'appbar', 'appbar-title',
      'btn-open', 'btn-library', 'btn-save', 'btn-screenshot', 'btn-undo', 'btn-redo', 'btn-lang', 'btn-more',
      'tabs', 'tabs-list', 'workspace', 'left-panel', 'right-panel', 'left-content', 'right-content',
      'viewport-region', 'viewport', 'hud', 'hud-title', 'hud-title-text', 'hud-title-suffix', 'hud-banner',
      'hud-banner-text', 'hud-legend', 'hud-hint', 'hud-flash', 'hud-labels', 'gizmo', 'empty-state',
      'renderer-error', 'renderer-error-detail', 'drop-overlay', 'mobile-toolbar', 'statusbar', 'status-dot',
      'status-text', 'status-info', 'scrim', 'sheet-root', 'menu-root', 'toast-root', 'file-input'];
    for (var i = 0; i < ids.length; i++) {
      var key = ids[i].replace(/-([a-z])/g, function (m, ch) { return ch.toUpperCase(); });
      dom[key] = D.getElementById(ids[i]);
    }
    dom.btnLanguage = dom.btnLang;
    dom.mobileToolbar = D.getElementById('mobile-toolbar');
    dom.btnUndo = D.getElementById('btn-undo');
    dom.btnRedo = D.getElementById('btn-redo');
    dom.btnSave = D.getElementById('btn-save');
    dom.btnScreenshot = D.getElementById('btn-screenshot');
  }
  function applyBrandAssets() {
    var logo = (CL.assets && CL.assets.logo) || 'assets/logo.png';
    if (dom.brandLogo) dom.brandLogo.src = logo;
    if (dom.bootLogo) dom.bootLogo.src = (CL.assets && (CL.assets.icon192 || CL.assets.logo)) || 'assets/icons/icon-192.png';
    if (dom.brandLogo) {
      dom.brandLogo.onerror = function () { dom.brandLogo.style.display = 'none'; };
    }
  }
  function init() {
    cacheDom();
    maybePinQaViewport(parseQuery());
    applyBrandAssets();
    ui.hydrateIcons(D);
    loadSettings();
    if (CL.i18n) {
      CL.i18n.setLanguage(state.settings.language, { persist: false });
      CL.i18n.apply(D);
      CL.i18n.onChange(onLanguageChanged);
    }
    if (ui.dialogs && ui.dialogs.init) ui.dialogs.init();
    if (ui.panels && ui.panels.init) ui.panels.init();
    updateLayout();
    syncViewportSize();
    createRenderer();
    state.camera = createCamera();
    if (state.settings.orthographic && state.camera) state.camera.orthographic = true;
    bindViewportEvents();
    bindGlobalClicks();
    initNativeHooks();
    applyRenderOptions();
    if (state.rendererKind === 'canvas2d' && !state.rendererError) {
      // graceful degradation, not an error: the UI must still render
      state.rendererError = '';
    }
    // Reference canvas2d fallback in status only; don't show the fatal error panel.
    syncUI();
    setStatus('status.ready-hint');
    var query = parseQuery();
    applyUrlOptions(query);
    if (!state.docs.length) syncUI();
    else if (!query.lib && !query.example) syncUI();
    requestRender();
    scheduleRuntimeInfo(1200);
    // Safety: make sure the boot screen goes away even without models.
    root.setTimeout(function () { if (!state.ready && state.frames >= 2) markReady(); }, 600);
    if (state.rendererKind === 'canvas2d' && !state.ready) {
      state.needsRender = true;
    }
  }

  // ------------------------------------------------------------- exports ----
  var App = {
    version: APP_VERSION,
    init: init,
    getDoc: activeDoc,
    getDocs: function () { return state.docs; },
    getSettings: function () { return state.settings; },
    getState: function () { return state; },
    getRenderer: renderer,
    getCamera: camera,
    getLayoutMode: function () { return state.layoutMode; },
    getMode: function () { return state.mode; },
    getSelection: function () { return state.selection; },
    getRendererKind: function () { return state.rendererKind; },
    getRendererError: function () { return state.rendererError; },
    getModel: model,
    getLanguage: currentLanguage,
    getViewportSize: viewportSize,
    refresh: function () { syncUI(); },
    syncUI: syncUI,
    requestRender: requestRender,
    fitView: fitView,
    resetView: resetView,
    setStatus: setStatus,
    setLanguage: setLanguage,
    openFilePicker: function () { if (dom.fileInput) dom.fileInput.click(); },
    openLibraryEntry: openLibraryEntry,
    openExample: openExample,
    openText: openText,
    handleFileList: handleFileList,
    switchDocument: switchDocument,
    closeDocument: closeDocument,
    reloadDocument: reloadDocument,
    selectAtom: selectAtom,
    clearSelection: clearSelection,
    setMeasureMode: setMeasureMode,
    toggleMeasureMode: toggleMeasureMode,
    clearMeasurements: clearMeasurements,
    removeMeasurement: removeMeasurement,
    setHovered: setHovered,
    setStyle: setStyle,
    toggleSetting: toggleSetting,
    setAtomScale: setAtomScale,
    toggleProjection: toggleProjection,
    setSupercell: setSupercell,
    editCell: editCell,
    addAtom: addAtom,
    updateAtom: updateAtom,
    deleteAtom: deleteAtom,
    undo: undo,
    redo: redo,
    exportStructure: exportStructure,
    exportScreenshot: exportScreenshot,
    copySummary: copySummary,
    buildSummaryText: buildSummaryText,
    previewAppearance: previewAppearance,
    commitAppearance: commitAppearance,
    resetAppearance: resetAppearance,
    saveSettingsNow: saveSettingsNow,
    toggleDrawer: toggleDrawer,
    closeDrawers: closeDrawers,
    closeAllSheets: function () { if (ui.dialogs) ui.dialogs.close(); },
    showFlash: showFlash,
    toast: function (title, message, type) { if (ui.toast) ui.toast(title, message, type); },
    back: handleBack,
    openSharedFile: openSharedFile,
    runSelftest: runSelftest,
    format: {
      len: fmtLen, angle: fmtAngle, coord: fmtCoord, vec: fmtVec, vol: fmtVol, deg: fmtDeg,
      number: fmt, hex: u32ToHex, colorCss: u32ToCss
    },
    fallback: {
      Camera: FallbackCamera,
      Renderer: FallbackRenderer,
      demoModel: buildDemoModel,
      displayModel: buildFallbackModel
    }
  };
  CL.App = App;
  ui.app = App;
  // expose small helpers used by boot.js
  ui.logError = logError;
})(typeof globalThis !== 'undefined' ? globalThis : this);
