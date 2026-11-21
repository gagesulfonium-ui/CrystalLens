/**
 * CrystalLens Android - 2D HUD overlay (Canvas2D).
 *
 * Draws on a transparent canvas that sits exactly on top of the WebGL2 canvas:
 * atom labels, element legend, measurement value boxes + endpoint markers,
 * hover tooltip and the camera axis gizmo.
 *
 * All layout constants are "design pixels" from docs/spec/render.md §13 and are
 * multiplied by the device pixel ratio; the canvas itself is sized in device
 * pixels so text stays crisp on high-dpi phones.
 *
 * Classic script, attaches CL.Overlay.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  // HUD palette (render-constants.json -> palette.hud).
  var PALETTE = {
    text: 0xEAF0F8,
    dim: 0x9DABBF,
    faint: 0x718097,
    accent: 0x6392FF,
    accentLight: 0x8DB0FF,
    teal: 0x35D3AF,
    gold: 0xFFC95B,
    cyan: 0x5BCCFF,
    red: 0xFF6B7A,
    panel: 0x0B111B,
    panelSoft: 0x0A0F18,
    panelBorder: 0x2A3549,
    gizmoFill: 0x0A0F18,
    gizmoBorder: 0x253044,
    gizmoRing: 0x94A5BE,
    axisA: 0xFF6B7A,
    axisB: 0x35D3AF,
    axisC: 0x5BCCFF,
    measureFill: 0x0A0F18
  };

  var FONT_FAMILY = '"Microsoft YaHei UI", "Segoe UI", "Noto Sans SC", "PingFang SC", system-ui, sans-serif';
  var TEXT_CACHE_LIMIT = 600;

  function rgba(hex, alpha) {
    var v = hex >>> 0;
    var r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff;
    if (alpha === undefined || alpha >= 1) return 'rgb(' + r + ',' + g + ',' + b + ')';
    if (alpha <= 0) return 'rgba(' + r + ',' + g + ',' + b + ',0)';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function Overlay(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;      // device pixels
    this.height = 0;     // device pixels
    this.dpr = 1;
    this._measureCache = Object.create(null);
    this._measureCount = 0;
    this._fontFamily = FONT_FAMILY;
    this.visible = true;
  }

  Overlay.prototype.resize = function (width, height, dpr) {
    dpr = (isNum(dpr) && dpr > 0) ? dpr : 1;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    this.width = width;       // CSS pixels (drawing coordinate space)
    this.height = height;
    this.dpr = dpr;
    var pw = Math.max(1, Math.round(width * dpr));
    var ph = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    // Draw in CSS pixels; the transform maps them onto device pixels so text
    // and hairlines stay crisp on high-dpi (Android) screens.
    if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // HUD design-pixel helper. Kept as a function (all layout code uses S(v)) so
  // the CSS-pixel drawing space can be swapped without touching call sites.
  Overlay.prototype.S = function (v) { return v; };

  Overlay.prototype.clear = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  Overlay.prototype.setFont = function (pixelSize, bold) {
    var px = Math.max(1, Math.round(pixelSize));
    this.ctx.font = (bold ? '600 ' : '') + px + 'px ' + this._fontFamily;
    return px;
  };

  Overlay.prototype.measure = function (text, pixelSize, bold) {
    var px = Math.max(1, Math.round(pixelSize));
    var key = (bold ? 'b' : 'n') + '|' + px + '|' + text;
    var cached = this._measureCache[key];
    if (cached !== undefined) return cached;
    this.setFont(px, !!bold);
    var w = this.ctx.measureText(String(text)).width;
    if (this._measureCount > TEXT_CACHE_LIMIT) {
      this._measureCache = Object.create(null);
      this._measureCount = 0;
    }
    this._measureCache[key] = w;
    this._measureCount++;
    return w;
  };

  Overlay.prototype.textHeight = function (pixelSize) {
    // Canvas has no cheap ascent+descent split; 1.22em is a good match for the
    // Win32 GDI text metrics used by the original HUD.
    return Math.max(1, Math.round(pixelSize)) * 1.22;
  };

  Overlay.prototype.ellipsize = function (text, pixelSize, bold, maxWidth) {
    text = String(text == null ? '' : text);
    if (this.measure(text, pixelSize, bold) <= maxWidth) return text;
    var ell = '\u2026';
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (this.measure(text.slice(0, mid) + ell, pixelSize, bold) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo) + ell : ell;
  };

  // ------------------------------------------------------------ primitives --
  Overlay.prototype.fillRect = function (x, y, w, h, color, alpha) {
    if (w <= 0 || h <= 0) return;
    var ctx = this.ctx;
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillRect(x, y, w, h);
  };

  Overlay.prototype._roundRectPath = function (x, y, w, h, r) {
    var ctx = this.ctx;
    var minSide = Math.min(w, h);
    r = clamp(r || 0, 0, minSide * 0.5);
    ctx.beginPath();
    if (r < 0.6) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

  Overlay.prototype.fillRoundedRect = function (x, y, w, h, r, color, alpha) {
    if (w <= 0 || h <= 0) return;
    this._roundRectPath(x, y, w, h, r);
    this.ctx.fillStyle = rgba(color, alpha);
    this.ctx.fill();
  };

  Overlay.prototype.strokeRoundedRect = function (x, y, w, h, r, thickness, color, alpha) {
    if (w <= 0 || h <= 0) return;
    this._roundRectPath(x, y, w, h, r);
    this.ctx.lineWidth = Math.max(0.5, thickness);
    this.ctx.strokeStyle = rgba(color, alpha);
    this.ctx.stroke();
  };

  // Panel = border rounded rect + inset fill (matches Overlay::Panel in C++).
  Overlay.prototype.panel = function (x, y, w, h, radius, fillColor, fillAlpha, borderColor, borderAlpha, thickness) {
    thickness = Math.max(0.5, isNum(thickness) ? thickness : 1);
    if (borderColor !== undefined && borderAlpha !== undefined) {
      this.strokeRoundedRect(x, y, w, h, radius, thickness, borderColor, borderAlpha);
      var inset = thickness;
      this.fillRoundedRect(x + inset, y + inset, w - inset * 2, h - inset * 2,
        Math.max(0, radius - inset), fillColor, fillAlpha);
    } else {
      this.fillRoundedRect(x, y, w, h, radius, fillColor, fillAlpha);
    }
  };

  Overlay.prototype.line = function (x0, y0, x1, y1, thickness, color, alpha) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = Math.max(0.5, thickness);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  Overlay.prototype.circle = function (cx, cy, r, color, alpha, segments) {
    if (r <= 0) return;
    var ctx = this.ctx;
    segments = Math.max(8, segments || 20);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill();
  };

  Overlay.prototype.ring = function (cx, cy, r, thickness, color, alpha, segments) {
    if (r <= 0) return;
    var ctx = this.ctx;
    segments = Math.max(8, segments || 20);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, r - thickness * 0.5), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(0.5, thickness);
    ctx.strokeStyle = rgba(color, alpha);
    ctx.stroke();
  };

  Overlay.prototype.text = function (str, x, y, pixelSize, color, alpha, align, vAlign, bold) {
    var ctx = this.ctx;
    var px = this.setFont(pixelSize, bold);
    ctx.fillStyle = rgba(color, alpha);
    ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
    ctx.textBaseline = vAlign === 'middle' ? 'middle' : (vAlign === 'bottom' ? 'bottom' : 'top');
    ctx.fillText(String(str == null ? '' : str), x, y);
    return px;
  };

  // ----------------------------------------------------------------- draw ---
  // state = {
  //   camera, model, options, annotations, selected, hovered,
  //   width, height, dpr, visibleAtoms (array of atom ids actually rendered),
  //   showGizmo, showLegend, showLabels, showMeasurements (default true)
  // }
  Overlay.prototype.draw = function (state) {
    var ctx = this.ctx;
    if (!ctx || !state) return;
    this.clear();
    if (!this.visible) return;
    // Drawing happens in CSS pixels (the canvas transform applies dpr), so the
    // HUD design-pixel helper is the identity here.
    var S = function (v) { return v; };
    var model = state.model || null;
    var options = state.options || {};
    var camera = state.camera || null;
    var showGizmo = state.showGizmo !== false;
    var showLegend = state.showLegend !== false;
    var showLabels = state.showLabels !== false;
    var showMeasurements = state.showMeasurements !== false;
    if (!camera || !model || !model.atoms || model.atoms.length === 0) {
      if (camera && showGizmo && model) this._drawGizmo(state, S);
      return;
    }
    var visibleAtoms = state.visibleAtoms || null;

    // 1. camera axis gizmo (bottom-right) - drawn first so text wins.
    if (showGizmo) this._drawGizmo(state, S);

    // 2. atom labels.
    if (showLabels) this._drawAtomLabels(state, S, visibleAtoms);

    // 3. element legend.
    if (showLegend) this._drawElementLegend(state, S, visibleAtoms);

    // 4. measurements: endpoint markers + value boxes.
    if (showMeasurements) this._drawMeasurements(state, S);

    // 5. hover tooltip is always drawn (renderer owns hover feedback).
    this._drawHoverTooltip(state, S);
  };

  Overlay.prototype._drawAtomLabels = function (state, S, visibleAtoms) {
    var model = state.model, camera = state.camera;
    var atoms = model.atoms;
    if (atoms.length > 400) return;         // HUD budget (render.md §2.5)
    if (!visibleAtoms || visibleAtoms.length === 0) return;
    var w = this.width, h = this.height;
    var margin = S(8);
    var textSize = S(9);
    var lineH = this.textHeight(textSize);
    var maxDrawn = 90;

    var candidates = [];
    for (var i = 0; i < visibleAtoms.length; i++) {
      var id = visibleAtoms[i];
      var atom = atoms[id];
      if (!atom) continue;
      var s = camera.worldToScreen(atom.pos, w, h);
      if (!s.visible) continue;
      if (s.x < margin || s.x > w - margin || s.y < margin || s.y > h - margin) continue;
      candidates.push({ atom: atom, x: s.x, y: s.y, depth: s.depth });
    }
    if (candidates.length === 0) return;
    candidates.sort(function (a, b) { return a.depth - b.depth; });

    var placed = [];
    var drawn = 0;
    for (var c = 0; c < candidates.length && drawn < maxDrawn; c++) {
      var item = candidates[c];
      var atom2 = item.atom;
      var label = atom2.label != null && atom2.label !== '' ? String(atom2.label) : (atom2.element || '');
      if (label.length > 12) label = label.slice(0, 11) + '\u2026';
      var textW = this.measure(label, textSize, false);
      var x = item.x + S(5);
      var y = item.y - lineH - S(3);
      var box = { x: x - 2, y: y - 1, w: textW + 4, h: lineH + 2 };
      var hit = false;
      for (var p = 0; p < placed.length; p++) {
        var b = placed[p];
        if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) { hit = true; break; }
      }
      if (hit) continue;
      placed.push(box);
      drawn++;
      var rgb = atom2.color || [0.6, 0.64, 0.7];
      var col = {
        r: clamp(0.38 + 0.62 * rgb[0], 0, 1),
        g: clamp(0.38 + 0.62 * rgb[1], 0, 1),
        b: clamp(0.38 + 0.62 * rgb[2], 0, 1)
      };
      var colorU32 = ((col.r * 255) << 16) | ((col.g * 255) << 8) | (col.b * 255);
      this.text(label, x + S(1), y + S(1), textSize, 0x000000, 0.65, 'left', 'top', false);
      this.text(label, x, y, textSize, colorU32, 0.96, 'left', 'top', false);
    }
  };

  Overlay.prototype._drawElementLegend = function (state, S, visibleAtoms) {
    var model = state.model;
    if (this.width < S(560)) return;
    if (!visibleAtoms || visibleAtoms.length === 0) return;
    var atoms = model.atoms;
    var seen = Object.create(null);
    var entries = [];
    for (var i = 0; i < visibleAtoms.length && entries.length < 8; i++) {
      var atom = atoms[visibleAtoms[i]];
      if (!atom) continue;
      var z = atom.z || 0;
      if (seen[z]) continue;
      seen[z] = true;
      entries.push({ z: z, symbol: atom.element || '?', color: atom.color || [0.6, 0.64, 0.7] });
    }
    if (entries.length === 0) return;
    entries.sort(function (a, b) { return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0); });
    var rowH = S(20);
    var panelW = S(50);
    var panelX = this.width - S(18) - panelW;
    var panelY = S(54);
    for (var e = 0; e < entries.length; e++) {
      var cy = panelY + rowH * e + rowH * 0.5;
      var rgb = entries[e].color;
      var col = ((rgb[0] * 255) << 16) | ((rgb[1] * 255) << 8) | (rgb[2] * 255);
      this.circle(panelX + S(6), cy, S(4.2), col, 0.90, 20);
      this.text(entries[e].symbol, panelX + panelW, cy, S(9.2), PALETTE.dim, 1, 'right', 'middle', false);
    }
  };

  Overlay.prototype._drawMeasurements = function (state, S) {
    var annotations = state.annotations;
    if (!annotations || !annotations.measurements || annotations.measurements.length === 0) return;
    var camera = state.camera;
    var w = this.width, h = this.height;
    var margin = S(20);
    var placed = [];
    var maxLabels = 24;
    var drawn = 0;
    var measurements = annotations.measurements;

    for (var i = 0; i < measurements.length; i++) {
      var m = measurements[i];
      var pts = m.points;
      if (!pts || pts.length < 2) continue;
      var isDistance = m.kind !== 'angle';
      var color = isDistance ? PALETTE.gold : PALETTE.cyan;
      var colorRgb = isDistance ? 0xFFC247 : 0x61D4FF;

      // measurement line endpoint markers
      for (var p = 0; p < pts.length; p++) {
        var sp = camera.worldToScreen(pts[p], w, h);
        if (!sp.visible) continue;
        if (sp.x < 0 || sp.x > w || sp.y < 0 || sp.y > h) continue;
        this.circle(sp.x, sp.y, S(2.6), colorRgb, 0.92, 16);
        this.ring(sp.x, sp.y, S(4.4), S(0.9), color, 0.45, 16);
      }
      if (drawn >= maxLabels) continue;

      // label anchor
      var world;
      if (isDistance) {
        world = [
          (pts[0][0] + pts[1][0]) * 0.5,
          (pts[0][1] + pts[1][1]) * 0.5,
          (pts[0][2] + pts[1][2]) * 0.5
        ];
      } else {
        if (pts.length < 3) continue;
        var vtx = pts[1];
        var ua = norm3([pts[0][0] - vtx[0], pts[0][1] - vtx[1], pts[0][2] - vtx[2]]);
        var uc = norm3([pts[2][0] - vtx[0], pts[2][1] - vtx[1], pts[2][2] - vtx[2]]);
        var bis = norm3([ua[0] + uc[0], ua[1] + uc[1], ua[2] + uc[2]]);
        if (len3(bis) < 1e-4) {
          var up = camera.up();
          bis = norm3(cross3(ua, up));
          if (len3(bis) < 1e-4) bis = up;
        }
        var bisLen = 0.7;
        world = [vtx[0] + bis[0] * bisLen, vtx[1] + bis[1] * bisLen, vtx[2] + bis[2] * bisLen];
      }
      var s = camera.worldToScreen(world, w, h);
      if (!s.visible) continue;
      if (s.x < margin || s.x > w - margin || s.y < margin || s.y > h - margin) continue;

      var value = m.label;
      if (value == null || value === '') {
        value = isDistance
          ? (isNum(m.value) ? m.value.toFixed(3) : '?') + ' \u00c5'
          : (isNum(m.value) ? m.value.toFixed(2) : '?') + '\u00b0';
      }
      var textSize = S(10);
      var boxW = this.measure(value, textSize, true) + S(16);
      var boxH = S(22);
      var left = s.x + S(8);
      var top = s.y - boxH - S(4);
      // collision lift (max 5 attempts)
      for (var attempt = 0; attempt < 5; attempt++) {
        var overlap = false;
        for (var q = 0; q < placed.length; q++) {
          var pb = placed[q];
          if (left < pb.x + pb.w && left + boxW > pb.x && top < pb.y + pb.h && top + boxH > pb.y) { overlap = true; break; }
        }
        if (!overlap) break;
        top -= boxH + S(3);
      }
      if (left + boxW > w - S(4)) left = w - S(4) - boxW;
      if (top < S(4)) top = S(4);
      placed.push({ x: left, y: top, w: boxW, h: boxH });
      drawn++;
      this.panel(left, top, boxW, boxH, S(7), PALETTE.measureFill, 0.88, color, 0.55, S(0.9));
      this.text(value, left + boxW * 0.5, top + boxH * 0.5, textSize, color, 1, 'center', 'middle', true);
    }
  };

  Overlay.prototype._drawHoverTooltip = function (state, S) {
    var hovered = state.hovered;
    if (hovered === undefined || hovered === null || hovered < 0) return;
    var model = state.model;
    var atom = model.atoms[hovered];
    if (!atom) return;
    var camera = state.camera;
    var sp = camera.worldToScreen(atom.pos, this.width, this.height);
    if (!sp.visible) return;
    var text = (atom.label || atom.element || '') + '  \u00b7  ' + (atom.element || '');
    var textSize = S(10);
    var padX = S(10), padY = S(5);
    var boxW = this.measure(text, textSize, false) + padX * 2;
    var boxH = this.textHeight(textSize) + padY * 2;
    var x = sp.x - boxW * 0.5;
    var y = sp.y - S(16) - boxH;
    if (y < S(4)) y = sp.y + S(16);
    x = clamp(x, S(4), this.width - S(4) - boxW);
    if (y + boxH > this.height - S(4)) y = this.height - S(4) - boxH;
    this.panel(x, y, boxW, boxH, S(7), PALETTE.panel, 0.92, PALETTE.panelBorder, 0.9, S(0.9));
    this.text(text, x + boxW * 0.5, y + boxH * 0.5, textSize, PALETTE.text, 1, 'center', 'middle', false);
  };

  Overlay.prototype._drawGizmo = function (state, S) {
    var camera = state.camera;
    if (!camera) return;
    var compact = this.width < S(700);
    var size = compact ? S(86) : S(100);
    var x = this.width - S(16) - size;
    var y = this.height - S(16) - size;
    this.panel(x, y, size, size, S(11), PALETTE.gizmoFill, 0.58, PALETTE.gizmoBorder, 0.65, S(0.8));

    var model = state.model;
    var axes;
    if (model && model.cell && model.cell.aVec && model.cell.bVec && model.cell.cVec) {
      axes = [
        { dir: norm3(model.cell.aVec), label: 'a', color: PALETTE.axisA },
        { dir: norm3(model.cell.bVec), label: 'b', color: PALETTE.axisB },
        { dir: norm3(model.cell.cVec), label: 'c', color: PALETTE.axisC }
      ];
    } else {
      axes = [
        { dir: [1, 0, 0], label: 'x', color: PALETTE.axisA },
        { dir: [0, 1, 0], label: 'y', color: PALETTE.axisB },
        { dir: [0, 0, 1], label: 'z', color: PALETTE.axisC }
      ];
    }
    var forward = camera.forward();
    var right = camera.right();
    var up = camera.up();
    for (var i = 0; i < axes.length; i++) {
      axes[i].depth = axes[i].dir[0] * forward[0] + axes[i].dir[1] * forward[1] + axes[i].dir[2] * forward[2];
    }
    axes.sort(function (a, b) { return b.depth - a.depth; });

    var cx = x + size * 0.5;
    var cy = y + size * 0.53;
    var len = size * 0.27;
    this.ring(cx, cy, S(2.2), S(0.8), PALETTE.gizmoRing, 0.5, 20);

    for (var a = 0; a < axes.length; a++) {
      var ax = axes[a];
      var dx = ax.dir[0] * right[0] + ax.dir[1] * right[1] + ax.dir[2] * right[2];
      var dy = -(ax.dir[0] * up[0] + ax.dir[1] * up[1] + ax.dir[2] * up[2]);
      var l = Math.sqrt(dx * dx + dy * dy);
      if (l < 1e-4) { dx = 1; dy = 0; l = 1; }
      var ex = cx + dx * len;
      var ey = cy + dy * len;
      var alpha = ax.depth > 0 ? 0.55 : 1.0;
      this.line(cx, cy, ex, ey, S(1.7), ax.color, alpha);
      this.circle(ex, ey, S(2.2), ax.color, alpha, 20);
      var labelPos = [ex + (dx / l) * S(10), ey + (dy / l) * S(10)];
      this.text(ax.label, labelPos[0], labelPos[1], S(9.5), ax.color, alpha * 0.9, 'center', 'middle', true);
    }
  };

  // ----------------------------------------------------------- small math ---
  function norm3(v) {
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (l < 1e-12) return [0, 0, 0];
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function len3(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  Overlay.PALETTE = PALETTE;
  Overlay.rgba = rgba;
  CL.Overlay = Overlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
