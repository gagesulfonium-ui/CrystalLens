/**
 * CrystalLens Android - WebGL2 scene renderer.
 *
 * Port of reference/src/render/Renderer.cpp onto WebGL2 + Canvas2D overlay.
 * Consumes CL.DisplayModel (docs/CONTRACT.md §5.3) and CL.RenderOptions (§5.4);
 * see docs/spec/render.md for the implementation-level specification.
 *
 * Pipeline (render.md §9): background -> lines (cell/bonds/measurements) ->
 * atoms (instanced impostors) -> ghost atoms -> polyhedra -> cell "see-through"
 * overlay pass -> 2D HUD.
 *
 * Classic script, attaches CL.Renderer. Requires CL.GL; uses CL.Overlay when
 * present for the 2D HUD.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  // ------------------------------------------------------------- defaults ---
  var DEFAULT_APPEARANCE = {
    cellColor: 0xD6DEE9,
    backgroundColor: 0x020305,
    cellLineWidth: 1.0,
    polyTransparency: 66,
    polyEdgeWidth: 1.2,
    polyEdgeColor: 0x91B4D3
  };

  var DEFAULT_OPTIONS = {
    style: 'ball-stick',            // 'ball-stick' | 'space-fill' | 'polyhedral'
    showCell: true,
    showAxes: true,                 // kept for contract compatibility (dead: gizmo always on)
    show3dAxes: false,              // draw model.lines kind='axes' inside the 3D scene
    showBonds: true,
    showLabels: false,
    showBoundary: true,
    atomScale: 0.30,
    bondRadius: 0.105,
    supercell: [1, 1, 1],
    appearance: DEFAULT_APPEARANCE,
    language: 'zh',
    boundaryGhost: false,           // render.md §7.8: C++ ghosts_ is never populated in
                                    // v1.1.0, so boundary copies default to opaque.
                                    // Set true to use the semi-transparent ghost material.
    // HUD responsibility split (CONTRACT §5.4): the app UI draws gizmo/legend/
    // atom labels in DOM; the renderer overlay keeps measurement annotations.
    overlay: { gizmo: true, legend: true, labels: true, measurements: true }
  };

  // Shader / geometry constants (render-constants.json).
  var BOND_COLOR = [0.66, 0.70, 0.76];
  var MEASURE_DISTANCE_COLOR = [1.00, 0.76, 0.28];
  var MEASURE_ANGLE_COLOR = [0.38, 0.83, 1.00];
  var CELL_INNER_RADIUS_SCALE = 0.52;
  var CELL_OUTER_FLAGS = 2;
  var CELL_INNER_FLAGS = 6;
  var CELL_OVERLAY_ALPHA = 0.18;
  var MEASURE_RADIUS = 0.028;
  var PENDING_MEASURE_RADIUS = 0.030;
  var DASHED_FLAGS = 1;
  var GHOST_FLAGS = 4;
  var CLEAR_COLOR = [0.007, 0.008, 0.011, 1.0];
  var POLY_SORT_EPS2 = 1e-14;
  var POLY_SORT_THROTTLE_COUNT = 60000;
  var MAX_POLY_TRIANGLES_SORT = 400000;

  // -------------------------------------------------------------- helpers ---
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function colorRgb(color) {
    return (CL.GL && CL.GL.colorToRgb) ? CL.GL.colorToRgb(color) : [0.84, 0.87, 0.91];
  }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function lenSq3(v) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; }
  function isTransitionMetal(z) {
    z = z | 0;
    return (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || z >= 89;
  }
  function elementOf(z) {
    if (CL.periodic && CL.periodic.get) {
      var e = CL.periodic.get(z);
      if (e) return e;
    }
    return null;
  }
  function cloneOptions(base) {
    var out = {};
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
      var v = base[k];
      if ((k === 'appearance' || k === 'overlay') && v && typeof v === 'object') {
        var nested = {};
        for (var nk in v) if (Object.prototype.hasOwnProperty.call(v, nk)) nested[nk] = v[nk];
        out[k] = nested;
      } else if (k === 'supercell' && v && v.length) {
        out.supercell = [v[0], v[1], v[2]];
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  function mergeOptions(base, incoming) {
    var out = cloneOptions(base);
    if (!incoming || typeof incoming !== 'object') return out;
    for (var k in incoming) {
      if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
      var v = incoming[k];
      if ((k === 'appearance' || k === 'overlay') && v && typeof v === 'object') {
        var nested = out[k] || {};
        for (var nk in v) if (Object.prototype.hasOwnProperty.call(v, nk)) nested[nk] = v[nk];
        out[k] = nested;
      } else if (k === 'supercell') {
        if (v && v.length >= 3) out.supercell = [v[0], v[1], v[2]];
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    // Some UI code passes appearance keys at the top level as a convenience.
    var topAp = ['cellColor', 'backgroundColor', 'cellLineWidth', 'polyTransparency', 'polyEdgeWidth', 'polyEdgeColor'];
    for (var i = 0; i < topAp.length; i++) {
      if (incoming[topAp[i]] !== undefined) out.appearance[topAp[i]] = incoming[topAp[i]];
    }
    return out;
  }

  // Fractional <-> cartesian using a DisplayModel cell ({aVec,bVec,cVec}).
  function fracToCartF(cell, f) {
    return [
      f[0] * cell.aVec[0] + f[1] * cell.bVec[0] + f[2] * cell.cVec[0],
      f[0] * cell.aVec[1] + f[1] * cell.bVec[1] + f[2] * cell.cVec[1],
      f[0] * cell.aVec[2] + f[1] * cell.bVec[2] + f[2] * cell.cVec[2]
    ];
  }
  function cartToFracF(cell, p) {
    var a = cell.aVec, b = cell.bVec, c = cell.cVec;
    var bc = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
    var det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
    if (Math.abs(det) < 1e-12) return [0, 0, 0];
    var cx = [b[1] * p[2] - b[2] * p[1], b[2] * p[0] - b[0] * p[2], b[0] * p[1] - b[1] * p[0]];
    var cx2 = [p[1] * c[2] - p[2] * c[1], p[2] * c[0] - p[0] * c[2], p[0] * c[1] - p[1] * c[0]];
    return [
      (p[0] * bc[0] + p[1] * bc[1] + p[2] * bc[2]) / det,
      (a[0] * cx2[0] + a[1] * cx2[1] + a[2] * cx2[2]) / det,
      (a[0] * cx[0] + a[1] * cx[1] + a[2] * cx[2]) / det
    ];
  }

  // ============================================================== Renderer ===
  function Renderer(container) {
    var doc = (container && container.ownerDocument) || root.document;
    if (!container) container = doc.createElement('div');
    this.container = container;
    this.supported = false;
    this.error = null;
    this.glInfo = null;
    this._disposed = false;
    this._gl = null;
    this._contextLost = false;
    this._programs = null;
    this._res = null;

    this._width = 0;    // CSS pixels
    this._height = 0;
    this._dpr = 1;

    // scene state
    this._model = null;
    this._options = cloneOptions(DEFAULT_OPTIONS);
    this._highlight = { selected: [], hovered: -1 };
    this._annotations = { measurements: [], pending: [] };
    this._lastCamera = null;

    this._geometryDirty = true;
    this._linesDirty = true;
    this._polyDirty = true;

    // geometry caches
    this._atomData = new Float32Array(0);
    this._atomCount = 0;
    this._ghostData = new Float32Array(0);
    this._ghostCount = 0;
    this._labelAtomIds = [];
    this._lineData = new Float32Array(0);
    this._lineCount = 0;
    this._cellLineCount = 0;
    this._cellBaseRadius = 0.028;
    this._polyVertices = new Float32Array(0);
    this._polyVertexCount = 0;
    this._polyTriangleCount = 0;
    this._polyCenters = new Float32Array(0);
    this._polyIndices = new Uint32Array(0);
    this._polySortKeys = new Float64Array(0);
    this._polySortOrder = new Uint32Array(0);
    this._polySortedDir = null;
    this._polySortedTime = 0;
    this._polyIndexDirty = true;
    this._modelRadius = 1;
    this._bounds = null;

    // canvases
    var glCanvas = doc.createElement('canvas');
    glCanvas.className = 'cl-gl-canvas';
    glCanvas.setAttribute('data-cl-render', 'gl');
    applyCanvasStyle(glCanvas, 0, false);
    var overlayCanvas = doc.createElement('canvas');
    overlayCanvas.className = 'cl-overlay-canvas';
    overlayCanvas.setAttribute('data-cl-render', 'overlay');
    applyCanvasStyle(overlayCanvas, 1, true);

    this.glCanvas = glCanvas;
    this.overlayCanvas = overlayCanvas;
    try {
      if (root.getComputedStyle) {
        var pos = root.getComputedStyle(container).position;
        if (!pos || pos === 'static') container.style.position = 'relative';
      }
      container.appendChild(glCanvas);
      container.appendChild(overlayCanvas);
    } catch (e) { /* detached container: keep going */ }

    // 2D overlay works even without WebGL2 (fallback message).
    if (CL.Overlay) {
      try { this.overlay = new CL.Overlay(overlayCanvas); } catch (e) { this.overlay = null; }
    } else {
      this.overlay = null;
    }
    this.overlayCtx = overlayCanvas.getContext('2d');

    var gl = null;
    try { gl = CL.GL.createContext(glCanvas, { antialias: true, depth: true }); } catch (e) { gl = null; }
    if (!gl) {
      this.error = 'WebGL2 unavailable';
      this._resizeToContainer(true);
      return;
    }
    this._gl = gl;
    this.glInfo = CL.GL.contextInfo(gl);
    this._samples = (this.glInfo.samples > 1) ? this.glInfo.samples : 1;
    try {
      this._initGL();
      this.supported = true;
    } catch (e) {
      this.error = String((e && e.message) || e);
      this.supported = false;
    }

    this._resizeToContainer(true);
    this._bindEvents();
  }

  function applyCanvasStyle(canvas, zIndex, transparent) {
    var s = canvas.style;
    s.position = 'absolute';
    s.left = '0px';
    s.top = '0px';
    s.display = 'block';
    s.zIndex = String(zIndex);
    if (transparent) s.pointerEvents = 'none';
    s.touchAction = 'none';
    s.background = 'transparent';
  }

  // ------------------------------------------------------------- GL setup ---
  Renderer.prototype._initGL = function () {
    var gl = this._gl;
    var P = CL.GL.Program;
    var sh = CL.GL.shaders;
    this._programs = {
      atom: new P(gl, 'atom', sh.atomVS, sh.atomFS),
      line: new P(gl, 'line', sh.lineVS, sh.lineFS),
      background: new P(gl, 'background', sh.backgroundVS, sh.backgroundFS),
      poly: new P(gl, 'poly', sh.polyVS, sh.polyFS)
    };
    var res = {
      quadVBO: gl.createBuffer(),
      atomVBO: gl.createBuffer(),
      ghostVBO: gl.createBuffer(),
      cylVBO: gl.createBuffer(),
      lineVBO: gl.createBuffer(),
      polyVBO: gl.createBuffer(),
      polyIBO: gl.createBuffer(),
      atomVAO: gl.createVertexArray(),
      ghostVAO: gl.createVertexArray(),
      lineVAO: gl.createVertexArray(),
      polyVAO: gl.createVertexArray(),
      emptyVAO: gl.createVertexArray()
    };
    this._res = res;

    // billboard quad
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, CL.GL.quadTemplate(), gl.STATIC_DRAW);

    // atom VAO
    gl.bindVertexArray(res.atomVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    bindAtomInstanceAttribs(gl, res.atomVBO);
    this._configureAtomVAO(res.atomVAO);

    // ghost VAO
    gl.bindVertexArray(res.ghostVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    bindAtomInstanceAttribs(gl, res.ghostVBO);
    this._configureAtomVAO(res.ghostVAO);

    // line VAO
    var cyl = CL.GL.cylinderTemplate();
    gl.bindBuffer(gl.ARRAY_BUFFER, res.cylVBO);
    gl.bufferData(gl.ARRAY_BUFFER, cyl, gl.STATIC_DRAW);
    gl.bindVertexArray(res.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.cylVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.lineVBO);
    var lineStride = 14 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, lineStride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, lineStride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, lineStride, 24);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, lineStride, 28);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, lineStride, 40);
    gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, lineStride, 52);
    gl.vertexAttribDivisor(6, 1);

    // poly VAO (21 floats/vertex: pos, normal, color, edge mask, tri A/B/C)
    gl.bindVertexArray(res.polyVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.polyVBO);
    var polyStride = 21 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, polyStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, polyStride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, polyStride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, polyStride, 36);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, polyStride, 48);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, polyStride, 60);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, polyStride, 72);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.polyIBO);

    gl.bindVertexArray(res.emptyVAO);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  };

  function bindAtomInstanceAttribs(gl, buffer) {
    var stride = 9 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 28);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(5, 1);
  }

  Renderer.prototype._configureAtomVAO = function (vao) {
    // all atom instance attribs already bound; keep divisor defaults.
    this._gl.bindVertexArray(vao);
  };

  // --------------------------------------------------------------- public ---
  Renderer.prototype.setModel = function (model) {
    this._model = (model && typeof model === 'object') ? model : null;
    this._geometryDirty = true;
    this._linesDirty = true;
    this._polyDirty = true;
    this._computeModelBounds();
    return this;
  };

  Renderer.prototype.setOptions = function (options) {
    var previous = this._options;
    var next = mergeOptions(previous, options);
    var geomChanged = geometrySignature(previous) !== geometrySignature(next);
    var cellAppearanceChanged = previous.appearance.cellColor !== next.appearance.cellColor ||
      previous.appearance.cellLineWidth !== next.appearance.cellLineWidth;
    this._options = next;
    if (geomChanged) {
      this._geometryDirty = true;
    } else if (cellAppearanceChanged && this.supported && this._lineCount > 0) {
      this._patchCellLines();
    }
    return this;
  };

  Renderer.prototype.setHighlight = function (highlight) {
    var h = highlight || {};
    var selected = Array.isArray(h.selected) ? h.selected : [];
    this._highlight = {
      selected: selected.slice(0, 3),
      hovered: isNum(h.hovered) ? h.hovered : -1
    };
    return this;
  };

  Renderer.prototype.setAnnotations = function (annotations) {
    var a = annotations || {};
    this._annotations = {
      measurements: Array.isArray(a.measurements) ? a.measurements : [],
      pending: Array.isArray(a.pending) ? a.pending : []
    };
    this._linesDirty = true;
    return this;
  };

  Renderer.prototype.getOptions = function () { return this._options; };
  Renderer.prototype.getModel = function () { return this._model; };

  // Explicit resize (contract §6.5). Coordinates for pick() stay CSS pixels.
  Renderer.prototype.resize = function (width, height, dpr) {
    if (!isNum(width) || !isNum(height)) return this;
    this._applySize(width, height, dpr);
    return this;
  };

  // -------------------------------------------------------------- sizing ----
  Renderer.prototype._resizeToContainer = function (force) {
    if (!this.container) return;
    var w = 0, h = 0;
    try {
      w = this.container.clientWidth || 0;
      h = this.container.clientHeight || 0;
      if ((w <= 0 || h <= 0) && this.container.getBoundingClientRect) {
        var r = this.container.getBoundingClientRect();
        w = Math.round(r.width) || w;
        h = Math.round(r.height) || h;
      }
    } catch (e) { /* ignore */ }
    if (w <= 0) w = this._width || 1;
    if (h <= 0) h = this._height || 1;
    var dpr = isNum(root.devicePixelRatio) && root.devicePixelRatio > 0 ? root.devicePixelRatio : 1;
    if (force || w !== this._width || h !== this._height || dpr !== this._dpr) {
      this._applySize(w, h, dpr);
    }
  };

  Renderer.prototype._applySize = function (width, height, dpr) {
    dpr = (isNum(dpr) && dpr > 0) ? dpr : 1;
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    this._width = width;
    this._height = height;
    this._dpr = dpr;
    var pw = Math.max(1, Math.round(width * dpr));
    var ph = Math.max(1, Math.round(height * dpr));
    if (this.glCanvas.width !== pw) this.glCanvas.width = pw;
    if (this.glCanvas.height !== ph) this.glCanvas.height = ph;
    this.glCanvas.style.width = width + 'px';
    this.glCanvas.style.height = height + 'px';
    if (this.overlay) this.overlay.resize(width, height, dpr);
    else {
      this.overlayCanvas.width = pw;
      this.overlayCanvas.height = ph;
      this.overlayCanvas.style.width = width + 'px';
      this.overlayCanvas.style.height = height + 'px';
    }
  };

  Renderer.prototype._bindEvents = function () {
    var self = this;
    this._onWinResize = function () {
      var oldW = self._width, oldH = self._height, oldDpr = self._dpr;
      self._resizeToContainer(false);
      if (self._width !== oldW || self._height !== oldH || self._dpr !== oldDpr) self._requestRender();
    };
    if (root.addEventListener) root.addEventListener('resize', this._onWinResize);
    if (root.ResizeObserver && this.container) {
      try {
        this._observer = new root.ResizeObserver(function () { self._onWinResize(); });
        this._observer.observe(this.container);
      } catch (e) { this._observer = null; }
    }
    var canvas = this.glCanvas;
    this._onContextLost = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      self._contextLost = true;
    };
    this._onContextRestored = function () {
      self._contextLost = false;
      try {
        self._initGL();
        self.supported = true;
        self.error = null;
        self._geometryDirty = true;
        self._linesDirty = true;
        self._polyDirty = true;
        self._requestRender();
      } catch (e) {
        self.supported = false;
        self.error = String((e && e.message) || e);
      }
    };
    if (canvas && canvas.addEventListener) {
      canvas.addEventListener('webglcontextlost', this._onContextLost, false);
      canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
    }
  };

  Renderer.prototype._requestRender = function () {
    if (this._disposed || this._contextLost || !this._lastCamera) return;
    var self = this;
    var raf = root.requestAnimationFrame;
    if (!raf) { this.render(this._lastCamera); return; }
    if (this._rafPending) return;
    this._rafPending = true;
    this._rafId = raf(function () {
      self._rafPending = false;
      self._rafId = 0;
      if (!self._disposed && self._lastCamera) self.render(self._lastCamera);
    });
  };

  // -------------------------------------------------------------- bounds ----
  Renderer.prototype._computeModelBounds = function () {
    var model = this._model;
    this._bounds = null;
    this._modelRadius = 1;
    if (!model) return;
    var origin = model.origin || [0, 0, 0];
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    var atoms = model.atoms || [];
    var i, p;
    for (i = 0; i < atoms.length; i++) {
      p = atoms[i] && atoms[i].pos;
      if (!p) continue;
      if (p[0] < lo[0]) lo[0] = p[0];
      if (p[1] < lo[1]) lo[1] = p[1];
      if (p[2] < lo[2]) lo[2] = p[2];
      if (p[0] > hi[0]) hi[0] = p[0];
      if (p[1] > hi[1]) hi[1] = p[1];
      if (p[2] > hi[2]) hi[2] = p[2];
    }
    var cell = model.cell;
    if (cell && cell.aVec && cell.bVec && cell.cVec) {
      var disp = model.displayedCells || [1, 1, 1];
      var nx = Math.max(1, Math.round(disp[0] || 1));
      var ny = Math.max(1, Math.round(disp[1] || 1));
      var nz = Math.max(1, Math.round(disp[2] || 1));
      for (var ci = 0; ci < 8; ci++) {
        var f = [(ci & 1) ? nx : 0, (ci & 2) ? ny : 0, (ci & 4) ? nz : 0];
        var c = fracToCartF(cell, f);
        p = [c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]];
        if (p[0] < lo[0]) lo[0] = p[0];
        if (p[1] < lo[1]) lo[1] = p[1];
        if (p[2] < lo[2]) lo[2] = p[2];
        if (p[0] > hi[0]) hi[0] = p[0];
        if (p[1] > hi[1]) hi[1] = p[1];
        if (p[2] > hi[2]) hi[2] = p[2];
      }
    }
    if (isFinite(lo[0])) {
      var maxR = 0;
      for (i = 0; i < atoms.length; i++) {
        var at = atoms[i];
        if (!at || !at.pos) continue;
        var d = Math.sqrt(at.pos[0] * at.pos[0] + at.pos[1] * at.pos[1] + at.pos[2] * at.pos[2]);
        if (d > maxR) maxR = d;
        var br = isNum(at.baseRadius) ? at.baseRadius : 1.0;
        if (d + br > maxR) maxR = d + br;
      }
      this._bounds = { min: lo, max: hi };
      this._modelRadius = Math.max(1, maxR);
    }
  };

  // ------------------------------------------------------- geometry build ---
  Renderer.prototype._rebuildAll = function () {
    if (!this._model || !this.supported || !this._gl) {
      this._geometryDirty = false;
      return;
    }
    this._rebuildAtoms();
    this._rebuildPoly();
    this._rebuildLines();
    this._uploadAtoms();
    this._uploadLines();
    this._uploadPoly();
    this._geometryDirty = false;
    this._linesDirty = false;
    this._polyDirty = false;
  };

  Renderer.prototype._atomRadius = function (atom, styleScale, style, shrinkPoly) {
    var z = atom.z | 0;
    var base = isNum(atom.baseRadius) && atom.baseRadius > 0 ? atom.baseRadius : 0;
    var radius;
    if (style === 'space-fill') {
      var el = elementOf(z);
      var vdw = (el && isNum(el.vdw) && el.vdw > 0) ? el.vdw : (base > 0 ? base : 1.70);
      radius = Math.max(0.10, vdw * 0.92);
      return radius;
    }
    if (base <= 0) {
      var el2 = elementOf(z);
      base = el2 ? (isTransitionMetal(z) ? el2.covalent : el2.vdw) : 1.70;
    }
    radius = Math.max(0.10, base * styleScale);
    if (shrinkPoly) radius *= 0.72;
    return radius;
  };

  Renderer.prototype._rebuildAtoms = function () {
    var model = this._model;
    var options = this._options;
    var style = options.style || 'ball-stick';
    var atoms = (model && model.atoms) || [];
    var poly = model && model.polyhedra;
    var polyEnabled = !!(poly && poly.enabled && poly.triangles && poly.triangles.length > 0);
    var hideNonCenters = (style === 'polyhedral') && polyEnabled;
    var centerSet = null;
    if (hideNonCenters) {
      centerSet = Object.create(null);
      var centers = poly.centers || [];
      for (var ci = 0; ci < centers.length; ci++) centerSet[centers[ci] | 0] = true;
    }
    var styleScale = (style === 'space-fill') ? 0.92 : clamp(isNum(options.atomScale) ? options.atomScale : 0.30, 0.10, 0.85);
    var ghostBoundary = options.boundaryGhost !== false;

    // First pass: decide which atoms become instances.
    var mainIds = [];      // atom indices in instance order
    var ghostIds = [];
    var labelIds = [];
    for (var i = 0; i < atoms.length; i++) {
      var atom = atoms[i];
      if (!atom || !atom.pos) continue;
      var isBoundary = atom.kind === 'boundary';
      if (!isBoundary && atom.pickable === false) continue;      // hidden cell atom
      if (hideNonCenters && !centerSet[atom.id]) continue;       // polyhedral: center atoms only
      if (isBoundary) {
        if (ghostBoundary) ghostIds.push(i);
        else mainIds.push(i);
      } else {
        mainIds.push(i);
        labelIds.push(i);
      }
    }
    this._labelAtomIds = labelIds;

    var main = new Float32Array(mainIds.length * 9);
    var k = 0;
    for (var m = 0; m < mainIds.length; m++) {
      var a = atoms[mainIds[m]];
      var r = this._atomRadius(a, styleScale, style, hideNonCenters);
      var col = colorRgb(a.color);
      main[k++] = a.pos[0]; main[k++] = a.pos[1]; main[k++] = a.pos[2];
      main[k++] = r;
      main[k++] = col[0]; main[k++] = col[1]; main[k++] = col[2];
      main[k++] = 0;
      main[k++] = (a.pickable !== false && a.kind !== 'boundary') ? (a.id | 0) : -1;
    }
    this._atomData = main;
    this._atomCount = mainIds.length;

    var ghost = new Float32Array(ghostIds.length * 9);
    k = 0;
    for (var g = 0; g < ghostIds.length; g++) {
      var ga = atoms[ghostIds[g]];
      var gr = this._atomRadius(ga, styleScale, style, hideNonCenters);
      var gcol = colorRgb(ga.color);
      ghost[k++] = ga.pos[0]; ghost[k++] = ga.pos[1]; ghost[k++] = ga.pos[2];
      ghost[k++] = gr;
      ghost[k++] = gcol[0]; ghost[k++] = gcol[1]; ghost[k++] = gcol[2];
      ghost[k++] = GHOST_FLAGS;
      ghost[k++] = -1;
    }
    this._ghostData = ghost;
    this._ghostCount = ghostIds.length;
  };

  Renderer.prototype._rebuildLines = function () {
    var model = this._model;
    var options = this._options;
    var atoms = (model && model.atoms) || [];
    var appearance = options.appearance || DEFAULT_APPEARANCE;
    var style = options.style || 'ball-stick';
    var poly = model && model.polyhedra;
    var polyEnabled = !!(poly && poly.enabled && poly.triangles && poly.triangles.length > 0);
    var polyDrawing = (style === 'polyhedral') && polyEnabled;

    var cellRgb = colorRgb(appearance.cellColor);
    var cellLineWidth = clamp(isNum(appearance.cellLineWidth) ? appearance.cellLineWidth : 1, 0.5, 4.0);
    var cell = model && model.cell;
    var cellBase = 0.028;
    if (cell && isNum(cell.a) && isNum(cell.b) && isNum(cell.c)) {
      cellBase = clamp(0.005 * Math.min(cell.a, cell.b, cell.c), 0.017, 0.065);
    }
    this._cellBaseRadius = cellBase;
    var cellRadius = cellBase * cellLineWidth;

    var displayCells = (model && model.displayedCells) || [1, 1, 1];
    var nCells = [Math.max(1, Math.round(displayCells[0] || 1)),
      Math.max(1, Math.round(displayCells[1] || 1)),
      Math.max(1, Math.round(displayCells[2] || 1))];
    var origin = (model && model.origin) || [0, 0, 0];

    // count (style filtering is the renderer's job per CONTRACT §5.3 addendum)
    var cellLines = [];
    var axisLines = [];
    var modelLines = (model && model.lines) || [];
    var showCellLines = options.showCell !== false;
    // v1.1.0 never drew 3D axis lines (showAxes is a dead option; the gizmo is
    // the only axis display), so this is opt-in and off by default.
    var showAxesLines = options.show3dAxes === true;
    var li;
    for (li = 0; li < modelLines.length; li++) {
      var line = modelLines[li];
      if (!line || !line.p0 || !line.p1) continue;
      if (line.kind === 'axes') {
        if (showAxesLines) axisLines.push(line);
      } else if (showCellLines) {
        cellLines.push(line);
      }
    }
    var bonds = [];
    if (style !== 'space-fill' && options.showBonds && !polyDrawing && model && model.bonds) {
      var bondList = model.bonds;
      for (var bi = 0; bi < bondList.length; bi++) {
        var bond = bondList[bi];
        var ba = atoms[bond.a], bb = atoms[bond.b];
        if (!ba || !bb || !ba.pos || !bb.pos) continue;
        var radius = isNum(bond.radius) ? bond.radius : (isNum(options.bondRadius) ? options.bondRadius : 0.105);
        if (!(radius > 0)) radius = 0.105;
        if (ba.z === 1 || bb.z === 1) radius *= 0.82;
        bonds.push({ a: ba, b: bb, radius: radius, color: bond.color });
      }
    }
    var measurements = (this._annotations && this._annotations.measurements) || [];
    var pending = (this._annotations && this._annotations.pending) || [];
    var measurementSegments = [];
    for (var mi = 0; mi < measurements.length; mi++) {
      var mm = measurements[mi];
      var pts = mm.points;
      if (!pts || pts.length < 2) continue;
      if (mm.kind === 'angle') {
        if (pts.length < 3) continue;
        measurementSegments.push({ p0: pts[1], p1: pts[0], color: MEASURE_ANGLE_COLOR, radius: MEASURE_RADIUS });
        measurementSegments.push({ p0: pts[1], p1: pts[2], color: MEASURE_ANGLE_COLOR, radius: MEASURE_RADIUS });
      } else {
        measurementSegments.push({ p0: pts[0], p1: pts[1], color: MEASURE_DISTANCE_COLOR, radius: MEASURE_RADIUS });
      }
    }
    for (var pi = 1; pi < pending.length; pi++) {
      var pa = atoms[pending[pi - 1]], pb = atoms[pending[pi]];
      if (!pa || !pb || !pa.pos || !pb.pos) continue;
      measurementSegments.push({ p0: pa.pos, p1: pb.pos, color: MEASURE_DISTANCE_COLOR, radius: PENDING_MEASURE_RADIUS });
    }

    var total = cellLines.length + axisLines.length + bonds.length + measurementSegments.length;
    var data = new Float32Array(total * 14);
    var w = 0;
    var cellCount = 0;
    var i;

    // 1. cell lines (must be first: the see-through pass redraws only these).
    for (i = 0; i < cellLines.length; i++) {
      var cl = cellLines[i];
      var outer = this._cellLineIsOuter(cl.p0, cl.p1, cell, origin, nCells);
      var rad = cellRadius * (outer ? 1 : CELL_INNER_RADIUS_SCALE);
      var flags = outer ? CELL_OUTER_FLAGS : CELL_INNER_FLAGS;
      w = writeLine(data, w, cl.p0, cl.p1, rad, cellRgb, cellRgb, flags);
      cellCount++;
    }
    this._cellLineCount = cellCount;

    // 2. axis lines (a/b/c order = red/green/blue per UI contract).
    for (i = 0; i < axisLines.length; i++) {
      var al = axisLines[i];
      var col = this._axisLineColor(al.p0, al.p1, cell, i, axisLines.length);
      w = writeLine(data, w, al.p0, al.p1, cellRadius, col, col, 0);
    }

    // 3. bonds.
    for (i = 0; i < bonds.length; i++) {
      var bd = bonds[i];
      var bcol = bd.color ? colorRgb(bd.color) : BOND_COLOR;
      w = writeLine(data, w, bd.a.pos, bd.b.pos, bd.radius, bcol, bcol, 0);
    }

    // 4. measurement / pending lines (dashed).
    for (i = 0; i < measurementSegments.length; i++) {
      var seg = measurementSegments[i];
      w = writeLine(data, w, seg.p0, seg.p1, seg.radius, seg.color, seg.color, DASHED_FLAGS);
    }

    this._lineData = data;
    this._lineCount = total;
  };

  function writeLine(data, w, p0, p1, radius, c0, c1, flags) {
    data[w++] = p0[0]; data[w++] = p0[1]; data[w++] = p0[2];
    data[w++] = p1[0]; data[w++] = p1[1]; data[w++] = p1[2];
    data[w++] = radius;
    data[w++] = c0[0]; data[w++] = c0[1]; data[w++] = c0[2];
    data[w++] = c1[0]; data[w++] = c1[1]; data[w++] = c1[2];
    data[w++] = flags;
    return w;
  }

  // Outer cell edges are the ones on the displayed box boundary; all others are
  // the (darker, thinner) sub-cell dividers.
  Renderer.prototype._cellLineIsOuter = function (p0, p1, cell, origin, nCells) {
    if (!cell || !cell.aVec || !cell.bVec || !cell.cVec) return true;
    var f0 = cartToFracF(cell, [p0[0] + origin[0], p0[1] + origin[1], p0[2] + origin[2]]);
    var f1 = cartToFracF(cell, [p1[0] + origin[0], p1[1] + origin[1], p1[2] + origin[2]]);
    var dx = Math.abs(f1[0] - f0[0]), dy = Math.abs(f1[1] - f0[1]), dz = Math.abs(f1[2] - f0[2]);
    var nx = nCells[0], ny = nCells[1], nz = nCells[2];
    if (dx >= dy && dx >= dz) {
      var iy = Math.round(f0[1]), iz = Math.round(f0[2]);
      return (iy === 0 || iy === ny) && (iz === 0 || iz === nz);
    }
    if (dy >= dz) {
      var ix = Math.round(f0[0]), iz2 = Math.round(f0[2]);
      return (ix === 0 || ix === nx) && (iz2 === 0 || iz2 === nz);
    }
    var ix2 = Math.round(f0[0]), iy2 = Math.round(f0[1]);
    return (ix2 === 0 || ix2 === nx) && (iy2 === 0 || iy2 === ny);
  };

  Renderer.prototype._axisLineColor = function (p0, p1, cell, index, axisCount) {
    var axRgb = colorRgb(0xFF6B7A), bRgb = colorRgb(0x35D3AF), cRgb = colorRgb(0x5BCCFF);
    // model.lines kind='axes' is emitted in a,b,c order: colour by index.
    if (isNum(index) && isNum(axisCount) && axisCount <= 3) {
      if (index === 0) return axRgb;
      if (index === 1) return bRgb;
      return cRgb;
    }
    if (cell && cell.aVec && cell.bVec && cell.cVec) {
      var f0 = cartToFracF(cell, p0);
      var f1 = cartToFracF(cell, p1);
      var d = [Math.abs(f1[0] - f0[0]), Math.abs(f1[1] - f0[1]), Math.abs(f1[2] - f0[2])];
      if (d[0] >= d[1] && d[0] >= d[2]) return axRgb;
      if (d[1] >= d[2]) return bRgb;
      return cRgb;
    }
    var dx = Math.abs(p1[0] - p0[0]), dy = Math.abs(p1[1] - p0[1]), dz = Math.abs(p1[2] - p0[2]);
    if (dx >= dy && dx >= dz) return axRgb;
    if (dy >= dz) return bRgb;
    return cRgb;
  };

  // ---------------------------------------------------------- polyhedra -----
  Renderer.prototype._rebuildPoly = function () {
    var model = this._model;
    var poly = model && model.polyhedra;
    var tris = (poly && poly.triangles) || [];
    this._polyVertices = new Float32Array(0);
    this._polyVertexCount = 0;
    this._polyTriangleCount = 0;
    this._polyCenters = new Float32Array(0);
    this._polySortedDir = null;
    this._polyIndexDirty = true;
    if (!poly || !poly.enabled || tris.length === 0) return;

    var n = tris.length;
    var POLY_STRIDE = 21;                 // floats per vertex
    var verts = new Float32Array(n * 3 * POLY_STRIDE);
    var centers = new Float32Array(n * 3);
    var indices = new Uint32Array(n * 3);
    var i, j;

    // Reconstruct the per-triangle boundary encoding (render.md §7.3/§7.4):
    // edges shared by two triangles inside the same coplanar fan are fan
    // diagonals (not outlined); every other edge of a face is a hull ridge.
    var usePlaneMerge = n <= MAX_POLY_TRIANGLES_SORT;
    var planeMaps = usePlaneMerge ? Object.create(null) : null;
    var edgeKeys = new Array(n);
    var t;
    if (usePlaneMerge) {
      for (t = 0; t < n; t++) {
        var tri = tris[t];
        if (!tri || !tri.v || tri.v.length < 3) { edgeKeys[t] = null; continue; }
        var nrm = tri.n || [0, 0, 1];
        var nk = Math.round(nrm[0] * 1e4) + ',' + Math.round(nrm[1] * 1e4) + ',' + Math.round(nrm[2] * 1e4);
        var d = nrm[0] * tri.v[0][0] + nrm[1] * tri.v[0][1] + nrm[2] * tri.v[0][2];
        var pk = nk + ',' + Math.round(d * 1e4);
        var map = planeMaps[pk];
        if (!map) { map = planeMaps[pk] = Object.create(null); }
        var ek = [vertexKey(tri.v[0]), vertexKey(tri.v[1]), vertexKey(tri.v[2])];
        edgeKeys[t] = ek;
        var e0 = edgeKeyOf(ek[1], ek[2]);
        var e1 = edgeKeyOf(ek[2], ek[0]);
        var e2 = edgeKeyOf(ek[0], ek[1]);
        map[e0] = (map[e0] || 0) + 1;
        map[e1] = (map[e1] || 0) + 1;
        map[e2] = (map[e2] || 0) + 1;
      }
    }

    for (t = 0; t < n; t++) {
      var triangle = tris[t];
      if (!triangle || !triangle.v || triangle.v.length < 3) continue;
      var color = triangle.color ? colorRgb(triangle.color) : [0.6, 0.64, 0.7];
      var normal = triangle.n || [0, 0, 1];
      var boundary = [true, true, true];
      if (usePlaneMerge && edgeKeys[t]) {
        var nrm2 = normal;
        var nk2 = Math.round(nrm2[0] * 1e4) + ',' + Math.round(nrm2[1] * 1e4) + ',' + Math.round(nrm2[2] * 1e4);
        var d2 = nrm2[0] * triangle.v[0][0] + nrm2[1] * triangle.v[0][1] + nrm2[2] * triangle.v[0][2];
        var pk2 = nk2 + ',' + Math.round(d2 * 1e4);
        var map2 = planeMaps[pk2];
        var ek2 = edgeKeys[t];
        if (map2) {
          // boundary[j] refers to the edge opposite vertex j
          boundary[0] = (map2[edgeKeyOf(ek2[1], ek2[2])] || 0) === 1;
          boundary[1] = (map2[edgeKeyOf(ek2[2], ek2[0])] || 0) === 1;
          boundary[2] = (map2[edgeKeyOf(ek2[0], ek2[1])] || 0) === 1;
        }
      }
      var base = t * 3 * POLY_STRIDE;
      for (i = 0; i < 3; i++) {
        var vp = triangle.v[i];
        var o = base + i * POLY_STRIDE;
        verts[o] = vp[0]; verts[o + 1] = vp[1]; verts[o + 2] = vp[2];
        verts[o + 3] = normal[0]; verts[o + 4] = normal[1]; verts[o + 5] = normal[2];
        verts[o + 6] = color[0]; verts[o + 7] = color[1]; verts[o + 8] = color[2];
        // per-triangle outlined-edge mask (screen space edge AA in the FS)
        verts[o + 9] = boundary[0] ? 1 : 0;
        verts[o + 10] = boundary[1] ? 1 : 0;
        verts[o + 11] = boundary[2] ? 1 : 0;
        // triangle screen positions (projected in the vertex shader)
        for (j = 0; j < 3; j++) {
          var tv = triangle.v[j];
          verts[o + 12 + j * 3] = tv[0];
          verts[o + 13 + j * 3] = tv[1];
          verts[o + 14 + j * 3] = tv[2];
        }
      }
      var center = triangle.center;
      if (center && isNum(center[0])) {
        centers[t * 3] = center[0]; centers[t * 3 + 1] = center[1]; centers[t * 3 + 2] = center[2];
      } else {
        centers[t * 3] = (triangle.v[0][0] + triangle.v[1][0] + triangle.v[2][0]) / 3;
        centers[t * 3 + 1] = (triangle.v[0][1] + triangle.v[1][1] + triangle.v[2][1]) / 3;
        centers[t * 3 + 2] = (triangle.v[0][2] + triangle.v[1][2] + triangle.v[2][2]) / 3;
      }
      indices[t * 3] = t * 3;
      indices[t * 3 + 1] = t * 3 + 1;
      indices[t * 3 + 2] = t * 3 + 2;
    }
    this._polyVertices = verts;
    this._polyVertexCount = n * 3;
    this._polyTriangleCount = n;
    this._polyCenters = centers;
    this._polyIndices = indices;
    this._polySortKeys = new Float64Array(n);
    this._polySortOrder = new Uint32Array(n);
  };

  function vertexKey(v) {
    return Math.round(v[0] * 1e4) + ',' + Math.round(v[1] * 1e4) + ',' + Math.round(v[2] * 1e4);
  }
  function edgeKeyOf(k1, k2) {
    return k1 < k2 ? (k1 + '|' + k2) : (k2 + '|' + k1);
  }

  Renderer.prototype._sortPolyhedra = function (forward) {
    var n = this._polyTriangleCount;
    if (n <= 0) return;
    if (this._polySortedDir) {
      var d = [forward[0] - this._polySortedDir[0], forward[1] - this._polySortedDir[1], forward[2] - this._polySortedDir[2]];
      if (lenSq3(d) < POLY_SORT_EPS2) return;
      if (n > POLY_SORT_THROTTLE_COUNT) {
        var dir = this._polySortedDir;
        if (dot3(forward, dir) > 0.9995) return;   // angle < ~1.8 deg: reuse
      }
    }
    this._polySortedDir = [forward[0], forward[1], forward[2]];
    var centers = this._polyCenters;
    var keys = this._polySortKeys;
    var order = this._polySortOrder;
    var i;
    for (i = 0; i < n; i++) {
      keys[i] = -(forward[0] * centers[i * 3] + forward[1] * centers[i * 3 + 1] + forward[2] * centers[i * 3 + 2]);
      order[i] = i;
    }
    var kk = keys;
    var sub = order.subarray(0, n);
    Array.prototype.sort.call(sub, function (a, b) {
      var diff = kk[a] - kk[b];
      return diff !== 0 ? diff : (a - b);
    });
    var indices = this._polyIndices;
    for (i = 0; i < n; i++) {
      var t = order[i] * 3;
      indices[i * 3] = t;
      indices[i * 3 + 1] = t + 1;
      indices[i * 3 + 2] = t + 2;
    }
    this._polyIndexDirty = true;
  };

  // -------------------------------------------------------------- uploads ---
  Renderer.prototype._uploadAtoms = function () {
    var gl = this._gl, res = this._res;
    if (!gl || !res) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.atomVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._atomData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.ghostVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._ghostData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  Renderer.prototype._uploadLines = function () {
    var gl = this._gl, res = this._res;
    if (!gl || !res) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.lineVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._lineData, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  Renderer.prototype._uploadPoly = function () {
    var gl = this._gl, res = this._res;
    if (!gl || !res) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.polyVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this._polyVertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(res.polyVAO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.polyIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this._polyIndices, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this._polyIndexDirty = false;
  };

  Renderer.prototype._patchCellLines = function () {
    var gl = this._gl, res = this._res;
    if (!gl || !res || this._cellLineCount <= 0) return;
    var appearance = this._options.appearance || DEFAULT_APPEARANCE;
    var rgb = colorRgb(appearance.cellColor);
    var width = clamp(isNum(appearance.cellLineWidth) ? appearance.cellLineWidth : 1, 0.5, 4.0);
    var data = this._lineData;
    var cellRadius = this._cellBaseRadius * width;
    for (var i = 0; i < this._cellLineCount; i++) {
      var off = i * 14;
      var flags = data[off + 13];
      data[off + 6] = cellRadius * ((flags & 4) ? CELL_INNER_RADIUS_SCALE : 1);
      data[off + 7] = rgb[0]; data[off + 8] = rgb[1]; data[off + 9] = rgb[2];
      data[off + 10] = rgb[0]; data[off + 11] = rgb[1]; data[off + 12] = rgb[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, res.lineVBO);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  // ================================================================= draw ===
  Renderer.prototype.render = function (camera) {
    if (camera) this._lastCamera = camera;
    if (this._disposed) return;
    if (!this.supported || !this._gl || this._contextLost) {
      this._drawFallback();
      return;
    }
    if (this._width <= 0 || this._height <= 0) this._resizeToContainer(true);
    if (this._geometryDirty) this._rebuildAll();
    if (this._linesDirty) {
      this._rebuildLines();
      this._uploadLines();
      this._linesDirty = false;
    }
    var cam = this._lastCamera;
    if (!cam) return;
    var gl = this._gl;
    var res = this._res;
    var width = this._width, height = this._height;
    var dw = this.glCanvas.width, dh = this.glCanvas.height;
    if (dw <= 0 || dh <= 0) return;

    var options = this._options;
    var appearance = options.appearance || DEFAULT_APPEARANCE;
    var bg = colorRgb(appearance.backgroundColor);
    var view = cam.viewMatrix();
    var proj = cam.projectionMatrix(width, height);
    var useAlphaToCoverage = this._samples > 1 && gl.SAMPLE_ALPHA_TO_COVERAGE !== undefined;

    var p = this._programs;

    // ---- pass 1: background ------------------------------------------------
    gl.viewport(0, 0, dw, dh);
    gl.depthMask(true);
    gl.clearColor(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], CLEAR_COLOR[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    p.background.use();
    p.background.set2f('uResolution', dw, dh);
    p.background.set3f('uBackgroundColor', bg[0], bg[1], bg[2]);
    gl.bindVertexArray(res.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // ---- pass 3: lines (cell + bonds + measurements) ----------------------
    if (this._lineCount > 0) {
      gl.disable(gl.BLEND);
      p.line.use();
      p.line.setMat4('uView', view);
      p.line.setMat4('uProj', proj);
      p.line.set1f('uOverlayAlpha', 1.0);
      gl.bindVertexArray(res.lineVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 14, this._lineCount);
    }

    // ---- pass 4: atoms (alpha-to-coverage or blended edges) ---------------
    if (this._atomCount > 0) {
      p.atom.use();
      p.atom.setMat4('uView', view);
      p.atom.setMat4('uProj', proj);
      var selected = this._highlight.selected || [];
      p.atom.set1i('uHovered', this._highlight.hovered);
      p.atom.set1i('uSelected0', selected.length > 0 ? selected[0] : -1);
      p.atom.set1i('uSelected1', selected.length > 1 ? selected[1] : -1);
      p.atom.set1i('uSelected2', selected.length > 2 ? selected[2] : -1);
      if (useAlphaToCoverage) {
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.disable(gl.BLEND);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.depthMask(true);
      gl.bindVertexArray(res.atomVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this._atomCount);
      if (useAlphaToCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.disable(gl.BLEND);
    }

    // ---- pass 5: ghost atoms (boundary copies) ----------------------------
    if (this._ghostCount > 0) {
      p.atom.use();
      p.atom.setMat4('uView', view);
      p.atom.setMat4('uProj', proj);
      p.atom.set1i('uHovered', -1);
      p.atom.set1i('uSelected0', -1);
      p.atom.set1i('uSelected1', -1);
      p.atom.set1i('uSelected2', -1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      if (useAlphaToCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(res.ghostVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this._ghostCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- pass 6: polyhedra ------------------------------------------------
    var transparency = isNum(appearance.polyTransparency) ? appearance.polyTransparency : 66;
    var edgeWidth = isNum(appearance.polyEdgeWidth) ? appearance.polyEdgeWidth : 1.2;
    if (this._polyTriangleCount > 0 && (transparency < 100 || edgeWidth > 0)) {
      var alpha = 1 - clamp(transparency, 0, 100) / 100;
      var edgeRgb = colorRgb(appearance.polyEdgeColor);
      p.poly.use();
      p.poly.setMat4('uView', view);
      p.poly.setMat4('uProj', proj);
      p.poly.set2f('uResolution', dw, dh);
      p.poly.set1f('uAlpha', alpha);
      p.poly.set1f('uEdgeWidth', edgeWidth * this._dpr);
      p.poly.set3f('uEdgeColor', edgeRgb[0], edgeRgb[1], edgeRgb[2]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      var opaque = (transparency <= 0);
      gl.depthMask(opaque);
      gl.disable(gl.CULL_FACE);
      if (useAlphaToCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(res.polyVAO);
      if (opaque) {
        gl.drawArrays(gl.TRIANGLES, 0, this._polyVertexCount);
      } else {
        this._sortPolyhedra(cam.forward());
        if (this._polyIndexDirty) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.polyIBO);
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this._polyIndices);
          this._polyIndexDirty = false;
        }
        gl.drawElements(gl.TRIANGLES, this._polyVertexCount, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- pass 7: cell line see-through overlay ----------------------------
    if (this._cellLineCount > 0 && options.showCell !== false) {
      p.line.use();
      p.line.setMat4('uView', view);
      p.line.setMat4('uProj', proj);
      p.line.set1f('uOverlayAlpha', CELL_OVERLAY_ALPHA);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.GREATER);
      gl.enable(gl.CULL_FACE);
      if (useAlphaToCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(res.lineVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 14, this._cellLineCount);
      p.line.set1f('uOverlayAlpha', 1.0);
      gl.disable(gl.CULL_FACE);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (useAlphaToCoverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);

    this._drawOverlay();
  };

  Renderer.prototype._drawOverlay = function () {
    if (!this.overlay) return;
    var model = this._model;
    var flags = this._options.overlay || {};
    this.overlay.draw({
      camera: this._lastCamera,
      model: model,
      options: this._options,
      annotations: this._annotations,
      selected: this._highlight.selected,
      hovered: this._highlight.hovered,
      visibleAtoms: this._labelAtomIds,
      width: this._width,
      height: this._height,
      dpr: this._dpr,
      showGizmo: flags.gizmo !== false,
      showLegend: flags.legend !== false,
      showLabels: this._options.showLabels !== false && flags.labels !== false,
      showMeasurements: flags.measurements !== false
    });
  };

  // render.md §13.9 fallback overlay when WebGL2 is unavailable/shader failed.
  Renderer.prototype._drawFallback = function () {
    if (!this.overlay) return;
    var ov = this.overlay;
    var S = function (v) { return v; };
    ov.clear();
    ov.fillRect(0, 0, ov.width, ov.height, 0x090D15, 1);
    var w = ov.width, h = ov.height;
    var cx = w * 0.5, cy = h * 0.5;
    ov.text('3D \u89c6\u56fe\u4e0d\u53ef\u7528', cx, cy - S(34), S(18), 0xE8EEF8, 1, 'center', 'middle', true);
    ov.text('WebGL2 \u521d\u59cb\u5316\u5931\u8d25\uff0c\u8bf7\u66f4\u65b0\u6d4f\u89c8\u5668/WebView \u6216\u5f00\u542f\u786c\u4ef6\u52a0\u901f\u3002',
      cx, cy, S(11), 0x9BA8BC, 1, 'center', 'middle', false);
    ov.text(this.error || 'unknown error', cx, cy + S(28), S(9), 0x6C798F, 1, 'center', 'middle', false);
  };

  // ============================================================ picking ====
  Renderer.prototype.pick = function (camera, x, y) {
    if (!this.supported || !camera || !this._model) return -1;
    if (this._width <= 0 || this._height <= 0) return -1;
    var ray = camera.screenRay(x, y, this._width, this._height);
    var origin = ray.origin, dir = ray.direction;
    var data = this._atomData;
    var count = this._atomCount;
    var minR = this._modelRadius * 0.007;
    var best = -1;
    var bestT = Infinity;
    for (var i = 0; i < count; i++) {
      var o = i * 9;
      var id = data[o + 8];
      if (id < 0) continue;
      var radius = data[o + 3];
      if (!(radius > 0)) continue;
      var pickR = Math.max(radius * 1.04, minR);
      var ocx = data[o] - origin[0], ocy = data[o + 1] - origin[1], ocz = data[o + 2] - origin[2];
      var tca = ocx * dir[0] + ocy * dir[1] + ocz * dir[2];
      if (tca < 0) continue;
      var d2 = ocx * ocx + ocy * ocy + ocz * ocz - tca * tca;
      var r2 = pickR * pickR;
      if (d2 > r2) continue;
      var thc = Math.sqrt(Math.max(0, r2 - d2));
      var t = tca - thc;
      if (t > 0 && t < bestT) { bestT = t; best = id; }
    }
    return best;
  };

  // ===================================================== visible points =====
  Renderer.prototype.getVisiblePoints = function () {
    var model = this._model;
    var points = [];
    if (!model) return points;
    var origin = model.origin || [0, 0, 0];
    var cell = model.cell;
    if (cell && cell.aVec && cell.bVec && cell.cVec) {
      var disp = model.displayedCells || [1, 1, 1];
      var nx = Math.max(1, Math.round(disp[0] || 1));
      var ny = Math.max(1, Math.round(disp[1] || 1));
      var nz = Math.max(1, Math.round(disp[2] || 1));
      for (var i = 0; i < 8; i++) {
        var f = [(i & 1) ? nx : 0, (i & 2) ? ny : 0, (i & 4) ? nz : 0];
        var c = fracToCartF(cell, f);
        points.push([c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]]);
      }
    }
    // Atom AABB union (exact per-atom boxes were only needed for the original
    // Win32 fit; the union is a superset and keeps this O(n) for 50k atoms).
    var atoms = model.atoms || [];
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    var i2, p;
    for (i2 = 0; i2 < atoms.length; i2++) {
      p = atoms[i2] && atoms[i2].pos;
      if (!p) continue;
      if (p[0] < lo[0]) lo[0] = p[0];
      if (p[1] < lo[1]) lo[1] = p[1];
      if (p[2] < lo[2]) lo[2] = p[2];
      if (p[0] > hi[0]) hi[0] = p[0];
      if (p[1] > hi[1]) hi[1] = p[1];
      if (p[2] > hi[2]) hi[2] = p[2];
    }
    if (isFinite(lo[0])) {
      var maxR = 0;
      var data = this._atomData;
      for (i2 = 0; i2 < this._atomCount; i2++) {
        var r = data[i2 * 9 + 3];
        if (r > maxR) maxR = r;
      }
      var pad = Math.max(0.10, maxR);
      for (var bi = 0; bi < 8; bi++) {
        points.push([
          ((bi & 1) ? hi[0] : lo[0]) + ((bi & 1) ? pad : -pad),
          ((bi & 2) ? hi[1] : lo[1]) + ((bi & 2) ? pad : -pad),
          ((bi & 4) ? hi[2] : lo[2]) + ((bi & 4) ? pad : -pad)
        ]);
      }
    }
    if (this._polyTriangleCount > 0) {
      // poly vertices are already included by the atom box + cell corners in
      // practice; sample a few for safety.
      var verts = this._polyVertices;
      var stride = Math.max(1, Math.floor(this._polyVertexCount / 64));
      for (var vi = 0; vi < this._polyVertexCount; vi += stride) {
        points.push([verts[vi * 21], verts[vi * 21 + 1], verts[vi * 21 + 2]]);
      }
    }
    return points;
  };

  // =========================================================== screenshot ===
  Renderer.prototype.screenshot = function () {
    if (!this.supported) return '';
    try {
      var out = (root.document || this.glCanvas.ownerDocument).createElement('canvas');
      out.width = this.glCanvas.width;
      out.height = this.glCanvas.height;
      var ctx = out.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(this.glCanvas, 0, 0);
      if (this.overlayCanvas && this.overlayCanvas.width > 0) ctx.drawImage(this.overlayCanvas, 0, 0);
      return out.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  };

  // ============================================================== dispose ===
  Renderer.prototype.dispose = function () {
    if (this._disposed) return;
    this._disposed = true;
    try { if (this._rafId && root.cancelAnimationFrame) root.cancelAnimationFrame(this._rafId); } catch (e) { /* ignore */ }
    if (this._observer) { try { this._observer.disconnect(); } catch (e) { /* ignore */ } this._observer = null; }
    if (root.removeEventListener && this._onWinResize) root.removeEventListener('resize', this._onWinResize);
    if (this.glCanvas && this.glCanvas.removeEventListener) {
      if (this._onContextLost) this.glCanvas.removeEventListener('webglcontextlost', this._onContextLost);
      if (this._onContextRestored) this.glCanvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    }
    var gl = this._gl;
    if (gl) {
      try {
        var res = this._res;
        if (res) {
          var buffers = [res.quadVBO, res.atomVBO, res.ghostVBO, res.cylVBO, res.lineVBO, res.polyVBO, res.polyIBO];
          for (var i = 0; i < buffers.length; i++) if (buffers[i]) gl.deleteBuffer(buffers[i]);
          var vaos = [res.atomVAO, res.ghostVAO, res.lineVAO, res.polyVAO, res.emptyVAO];
          for (var v = 0; v < vaos.length; v++) if (vaos[v]) gl.deleteVertexArray(vaos[v]);
        }
        if (this._programs) {
          for (var k in this._programs) {
            if (this._programs[k] && this._programs[k].dispose) this._programs[k].dispose();
          }
        }
      } catch (e) { /* context may already be gone */ }
    }
    try {
      if (this.glCanvas && this.glCanvas.parentNode) this.glCanvas.parentNode.removeChild(this.glCanvas);
      if (this.overlayCanvas && this.overlayCanvas.parentNode) this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    } catch (e) { /* ignore */ }
    this._programs = null;
    this._res = null;
    this._gl = null;
    this.overlay = null;
  };

  // --------------------------------------------------------------- info ----
  Renderer.prototype.info = function () {
    return {
      supported: this.supported,
      error: this.error,
      gl: this.glInfo,
      width: this._width,
      height: this._height,
      dpr: this._dpr,
      samples: this._samples || 1,
      atoms: this._atomCount,
      ghosts: this._ghostCount,
      lines: this._lineCount,
      cellLines: this._cellLineCount,
      polyVertices: this._polyVertexCount,
      polyTriangles: this._polyTriangleCount,
      drawCalls: this._estimateDrawCalls()
    };
  };

  Renderer.prototype._estimateDrawCalls = function () {
    var n = 1; // background
    if (this._lineCount > 0) n++;
    if (this._atomCount > 0) n++;
    if (this._ghostCount > 0) n++;
    if (this._polyTriangleCount > 0) n++;
    if (this._cellLineCount > 0) n++;
    return n;
  };

  function geometrySignature(options) {
    var ap = options.appearance || {};
    // Only flags that change vertex/instance data belong here. Colors that can
    // be patched (cell color/width) are excluded on purpose.
    return [
      options.style,
      options.showCell ? 1 : 0,
      options.show3dAxes === true ? 1 : 0,
      options.showBonds ? 1 : 0,
      isNum(options.atomScale) ? Math.round(options.atomScale * 1000) : 300,
      isNum(options.bondRadius) ? Math.round(options.bondRadius * 10000) : 1050,
      options.boundaryGhost ? 1 : 0,
      options.showBoundary ? 1 : 0,
      options.supercell ? options.supercell.join(',') : '1,1,1',
      isNum(ap.cellLineWidth) ? Math.round(ap.cellLineWidth * 100) : 100
    ].join('|');
  }

  // Defaults are exposed for UI/tests.
  Renderer.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
  Renderer.DEFAULT_APPEARANCE = DEFAULT_APPEARANCE;

  CL.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
