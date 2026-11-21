/**
 * CrystalLens Android - render layer self-test demo (NOT part of the app).
 *
 * Builds a mock DisplayModel (rock-salt NaCl, 2x2x2 supercell + boundary
 * images + polyhedra) and drives CL.Renderer directly, so the renderer can be
 * verified without core/parser/model files.
 *
 * URL parameters:
 *   ?style=ball-stick|space-fill|polyhedral   render style
 *   ?poly=1        force-enable polyhedra geometry (also works in other styles)
 *   ?labels=1      show atom labels
 *   ?ghost=0       render boundary atoms opaque (matches C++ v1.1.0)
 *   ?boundary=0    hide boundary atoms entirely
 *   ?cells=0 ?axes=0 ?bonds=0
 *   ?measure=1     show one mock distance measurement (+ overlay label)
 *   ?shot=1        screenshot mode (hides the debug readout)
 */
(function () {
  'use strict';
  var CL = window.CL;
  if (!CL || !CL.Renderer || !CL.Camera) throw new Error('CL render modules failed to load');

  var errors = [];
  var errLog = document.getElementById('cl-error-log');
  var renderLog = document.getElementById('cl-render-log');
  function flushErrors() { if (errLog) errLog.textContent = JSON.stringify(errors); }
  flushErrors();
  window.addEventListener('error', function (ev) {
    errors.push(String((ev && ev.message) || (ev && ev.error) || 'error'));
    flushErrors();
  });
  window.addEventListener('unhandledrejection', function (ev) {
    errors.push('unhandled rejection: ' + String(ev && ev.reason));
    flushErrors();
  });

  var params = new URLSearchParams(window.location.search);
  function flag(name, dflt) {
    var v = params.get(name);
    if (v === null) return dflt;
    return v === '1' || v === 'true' || v === '';
  }
  var style = params.get('style') || 'ball-stick';
  if (style === 'spacefill') style = 'space-fill';
  if (style !== 'space-fill' && style !== 'polyhedral') style = 'ball-stick';
  var refcheck = flag('refcheck', false);
  if (refcheck && !params.get('style')) style = 'polyhedral';
  var wantPoly = (style === 'polyhedral') || flag('poly', false) || refcheck;
  var opts = {
    style: style,
    labels: flag('labels', false),
    ghost: params.get('ghost') === '1',
    boundary: params.get('boundary') !== '0',
    cells: params.get('cells') !== '0',
    axes: params.get('axes') === '1',          // 3D lattice axis lines (off by default)
    bonds: params.get('bonds') !== '0',
    measure: flag('measure', false),
    atomScale: parseFloat(params.get('atomScale') || '0.30'),
    shot: flag('shot', false),
    // refcheck: halite 2x2x2 polyhedral, boundary centres included, matching the
    // reference doc shot (reference/CrystalLens/docs/halite-polyhedra-v11.png).
    polyAll: refcheck,
    light: flag('light', false),
    polyTransparency: params.get('transp') !== null ? parseFloat(params.get('transp')) : 66,
    polyEdgeWidth: params.get('edgew') !== null ? parseFloat(params.get('edgew')) : 1.2
  };

  // ----------------------------------------------------------- mock model ---
  var A = 5.64;                 // rock-salt lattice constant (A)
  var N = 2;                    // 2x2x2 supercell
  var MOTIF = [
    { el: 'Na', frac: [0, 0, 0] },
    { el: 'Na', frac: [0.5, 0.5, 0] },
    { el: 'Na', frac: [0.5, 0, 0.5] },
    { el: 'Na', frac: [0, 0.5, 0.5] },
    { el: 'Cl', frac: [0.5, 0, 0] },
    { el: 'Cl', frac: [0, 0.5, 0] },
    { el: 'Cl', frac: [0, 0, 0.5] },
    { el: 'Cl', frac: [0.5, 0.5, 0.5] }
  ];

  function isTransition(z) {
    return (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || z >= 89;
  }
  function elInfo(sym) {
    var e = (CL.periodic && CL.periodic.get) ? CL.periodic.get(sym) : null;
    if (e) return e;
    return { z: 0, symbol: sym, covalent: 0.77, vdw: 1.70, rgb: [0.6, 0.64, 0.7] };
  }
  function baseRadiusOf(e) {
    return isTransition(e.z) ? e.covalent : e.vdw;
  }

  function buildModel(o) {
    var origin = [A * N / 2, A * N / 2, A * N / 2];
    var eps = 1e-7;
    var atoms = [];
    var cellCount = 0, boundaryCount = 0;
    for (var mi = 0; mi < MOTIF.length; mi++) {
      var m = MOTIF[mi];
      var limits = [];
      for (var ax = 0; ax < 3; ax++) {
        var f = m.frac[ax];
        if (o.boundary) limits.push([Math.ceil(-eps - f), Math.floor(N + eps - f)]);
        else limits.push([0, N - 1]);
      }
      for (var tx = limits[0][0]; tx <= limits[0][1]; tx++) {
        for (var ty = limits[1][0]; ty <= limits[1][1]; ty++) {
          for (var tz = limits[2][0]; tz <= limits[2][1]; tz++) {
            var interior = tx >= 0 && tx < N && ty >= 0 && ty < N && tz >= 0 && tz < N;
            var frac = [m.frac[0] + tx, m.frac[1] + ty, m.frac[2] + tz];
            var cart = [frac[0] * A, frac[1] * A, frac[2] * A];
            var e = elInfo(m.el);
            var kind = interior ? 'cell' : 'boundary';
            if (interior) cellCount++; else boundaryCount++;
            atoms.push({
              id: atoms.length,
              siteId: mi,
              symmetryIndex: 0,
              label: m.el + (atoms.length + 1),
              element: m.el,
              z: e.z,
              frac: frac,
              pos: [cart[0] - origin[0], cart[1] - origin[1], cart[2] - origin[2]],
              color: e.rgb,
              baseRadius: baseRadiusOf(e),
              kind: kind,
              pickable: interior
            });
          }
        }
      }
    }

    // bonds: Na-Cl pairs whose displayed images are within 3.1 A
    var bonds = [];
    var cutoff2 = 3.10 * 3.10;
    for (var i = 0; i < atoms.length; i++) {
      if (atoms[i].element !== 'Na') continue;
      for (var j = 0; j < atoms.length; j++) {
        if (atoms[j].element !== 'Cl') continue;
        var pa = atoms[i].pos, pb = atoms[j].pos;
        var dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
        if (dx * dx + dy * dy + dz * dz > cutoff2) continue;
        bonds.push({
          id: bonds.length, a: i, b: j,
          radius: 0.105, color: [0.66, 0.70, 0.76], periodic: true
        });
      }
    }

    // cell lines: outer box + sub-cell dividers (C++ RebuildLines layout)
    var lines = [];
    function edgePoint(ix, iy, iz) {
      return [ix * A - origin[0], iy * A - origin[1], iz * A - origin[2]];
    }
    var nx = N, ny = N, nz = N;
    var iy, iz, ix;
    for (iy = 0; iy <= ny; iy++) for (iz = 0; iz <= nz; iz++) {
      lines.push({ p0: edgePoint(0, iy, iz), p1: edgePoint(nx, iy, iz), kind: 'cell' });
    }
    for (ix = 0; ix <= nx; ix++) for (iz = 0; iz <= nz; iz++) {
      lines.push({ p0: edgePoint(ix, 0, iz), p1: edgePoint(ix, ny, iz), kind: 'cell' });
    }
    for (ix = 0; ix <= nx; ix++) for (iy = 0; iy <= ny; iy++) {
      lines.push({ p0: edgePoint(ix, iy, 0), p1: edgePoint(ix, iy, nz), kind: 'cell' });
    }
    // body axes a, b, c (red / green / blue) through the box centre so they are
    // distinguishable from the cell edges (kind='axes' is renderer-filtered)
    lines.push({ p0: edgePoint(1, 1, 1), p1: edgePoint(2, 1, 1), kind: 'axes' });
    lines.push({ p0: edgePoint(1, 1, 1), p1: edgePoint(1, 2, 1), kind: 'axes' });
    lines.push({ p0: edgePoint(1, 1, 1), p1: edgePoint(1, 1, 2), kind: 'axes' });

    // polyhedra: Na-centred octahedra built from periodic Cl neighbours.
    // refcheck includes boundary centres (the reference halite shot shows the
    // complete cluster with octahedra extending outside the displayed box).
    var poly = { enabled: false, centers: [], triangles: [], edges: [] };
    if (o.poly) {
      poly.enabled = true;
      var translations = [];
      for (var sx = -1; sx <= 1; sx++)
        for (var sy = -1; sy <= 1; sy++)
          for (var sz = -1; sz <= 1; sz++) translations.push([sx, sy, sz]);
      var half = A * 0.5;
      for (var ai = 0; ai < atoms.length; ai++) {
        var atom = atoms[ai];
        if (atom.element !== 'Na') continue;
        if (atom.kind !== 'cell' && !o.polyAll) continue;
        var verts = [[null, null], [null, null], [null, null]];
        for (var ci = 0; ci < atoms.length; ci++) {
          if (atoms[ci].element !== 'Cl') continue;
          for (var ti = 0; ti < translations.length; ti++) {
            var t = translations[ti];
            var p = [
              atoms[ci].pos[0] + t[0] * A,
              atoms[ci].pos[1] + t[1] * A,
              atoms[ci].pos[2] + t[2] * A
            ];
            var d = [p[0] - atom.pos[0], p[1] - atom.pos[1], p[2] - atom.pos[2]];
            var dist = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
            if (Math.abs(dist - half) > 0.15) continue;
            var ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
            var axis = (ax >= ay && ax >= az) ? 0 : (ay >= az ? 1 : 2);
            var sign = d[axis] >= 0 ? 1 : 0;
            if (!verts[axis][sign]) verts[axis][sign] = p;
          }
        }
        if (!verts[0][0] || !verts[0][1] || !verts[1][0] || !verts[1][1] || !verts[2][0] || !verts[2][1]) continue;
        var centerPos = atom.pos;
        var faceColor = atom.color;
        poly.centers.push(atom.id);
        for (var fx = 0; fx < 2; fx++) {
          for (var fy = 0; fy < 2; fy++) {
            for (var fz = 0; fz < 2; fz++) {
              var v0 = verts[0][fx], v1 = verts[1][fy], v2 = verts[2][fz];
              var e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
              var e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
              var n = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0]
              ];
              var nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
              n = [n[0] / nl, n[1] / nl, n[2] / nl];
              var cen = [(v0[0] + v1[0] + v2[0]) / 3 - centerPos[0],
                (v0[1] + v1[1] + v2[1]) / 3 - centerPos[1],
                (v0[2] + v1[2] + v2[2]) / 3 - centerPos[2]];
              if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) n = [-n[0], -n[1], -n[2]];
              poly.triangles.push({
                v: [[v0[0], v0[1], v0[2]], [v1[0], v1[1], v1[2]], [v2[0], v2[1], v2[2]]],
                n: n, center: [centerPos[0], centerPos[1], centerPos[2]], color: faceColor
              });
            }
          }
        }
        // 12 octahedron edges (only used by external consumers)
        for (var ea = 0; ea < 3; ea++) {
          for (var eb = ea + 1; eb < 3; eb++) {
            for (var sa = 0; sa < 2; sa++) {
              for (var sb = 0; sb < 2; sb++) {
                poly.edges.push({ p0: verts[ea][sa], p1: verts[eb][sb], color: faceColor });
              }
            }
          }
        }
      }
    }

    var maxExtent = 0;
    for (var k = 0; k < atoms.length; k++) {
      var pp = atoms[k].pos;
      var dd = Math.sqrt(pp[0] * pp[0] + pp[1] * pp[1] + pp[2] * pp[2]) + atoms[k].baseRadius;
      if (dd > maxExtent) maxExtent = dd;
    }
    var boundRadius = Math.max(2.0, maxExtent + 1.2) * 1.06;
    var cell = CL.Math.buildCell(A, A, A, 90, 90, 90);
    return {
      model: {
        title: 'NaCl (mock 2\u00d72\u00d72)',
        formula: 'Na4Cl4',
        cellContents: 'Na4Cl4',
        spaceGroup: 'Fm-3m (mock)',
        note: 'renderer self-test mock model',
        format: 'mock',
        sourceName: 'render-demo.js',
        cell: cell,
        supercell: [N, N, N],
        displayedCells: [N, N, N],
        showBoundary: o.boundary,
        origin: origin,
        stats: {
          asymmetricAtomCount: MOTIF.length,
          symmetryOperatorCount: 1,
          cellAtomCount: 8,
          visibleAtomCount: atoms.length,
          boundaryAtomCount: boundaryCount,
          visibleBondCount: bonds.length,
          cellBondCount: bonds.length,
          polyhedronCount: poly.centers.length,
          polyhedronTriangleCount: poly.triangles.length,
          supercellLimited: false,
          boundaryLimited: false
        },
        atoms: atoms,
        bonds: bonds,
        lines: lines,
        polyhedra: poly,
        hasCell: true
      },
      boundRadius: boundRadius,
      cellCount: cellCount,
      boundaryCount: boundaryCount
    };
  }

  var built = buildModel({ boundary: opts.boundary, poly: wantPoly, polyAll: opts.polyAll });
  var model = built.model;

  // ------------------------------------------------------------- renderer ---
  var container = document.getElementById('viewport');
  var renderer = new CL.Renderer(container);
  var camera = new CL.Camera();

  var appearance = {
    cellColor: 0xD6DEE9,
    backgroundColor: opts.light ? 0xF7F8FB : 0x020305,
    cellLineWidth: 1.0,
    polyTransparency: opts.polyTransparency,
    polyEdgeWidth: opts.polyEdgeWidth,
    polyEdgeColor: 0x91B4D3
  };
  var hudAll = { gizmo: true, legend: true, labels: true, measurements: true };
  renderer.setModel(model);
  renderer.setOptions({
    style: style,
    showCell: opts.cells,
    showAxes: true,
    show3dAxes: opts.axes,
    showBonds: opts.bonds,
    showLabels: opts.labels,
    showBoundary: opts.boundary,
    atomScale: opts.atomScale,
    bondRadius: 0.105,
    supercell: [N, N, N],
    appearance: appearance,
    language: 'zh',
    boundaryGhost: opts.ghost,
    overlay: hudAll
  });

  var annotations = { measurements: [], pending: [] };
  if (opts.measure) {
    var best = null;
    for (var bi = 0; bi < model.bonds.length; bi++) {
      var bd = model.bonds[bi];
      var pa = model.atoms[bd.a], pb = model.atoms[bd.b];
      if (!pa || !pb || pa.kind !== 'cell' || pb.kind !== 'cell') continue;
      var d = Math.sqrt(
        (pa.pos[0] - pb.pos[0]) * (pa.pos[0] - pb.pos[0]) +
        (pa.pos[1] - pb.pos[1]) * (pa.pos[1] - pb.pos[1]) +
        (pa.pos[2] - pb.pos[2]) * (pa.pos[2] - pb.pos[2]));
      if (!best || Math.abs(d - 2.82) < Math.abs(best.value - 2.82)) best = { a: bd.a, b: bd.b, value: d };
    }
    if (best) {
      annotations.measurements.push({
        kind: 'distance',
        atomIds: [best.a, best.b],
        value: best.value,
        points: [model.atoms[best.a].pos, model.atoms[best.b].pos],
        offsets: [[0, 0, 0], [0, 0, 0]],
        label: best.value.toFixed(3) + ' \u00c5'
      });
    }
  }
  renderer.setAnnotations(annotations);

  function aspectOf() {
    var w = renderer._width > 0 ? renderer._width : window.innerWidth;
    var h = renderer._height > 0 ? renderer._height : window.innerHeight;
    return h > 0 ? w / h : 1.6;
  }

  function fitView() {
    var aspect = aspectOf();
    camera.setScene([0, 0, 0], built.boundRadius);
    camera.yaw = CL.Camera.DEFAULTS.yawDeg * Math.PI / 180;
    camera.pitch = CL.Camera.DEFAULTS.pitchDeg * Math.PI / 180;
    camera.fit(aspect, 1.12);
    var pts = renderer.getVisiblePoints();
    if (pts && pts.length) camera.fitScenePoints(pts, aspect, 1.18);
  }

  // first render builds the instance/poly buffers, then fit on real extents
  renderer.render(camera);
  fitView();
  renderer.render(camera);
  // Publish diagnostics immediately: headless --dump-dom may snapshot before
  // any requestAnimationFrame callback runs.
  try { publishInfo(); } catch (e) { errors.push('publish: ' + e); flushErrors(); }

  var dirty = true;
  var frameCount = 2;
  var ready = false;

  function publishInfo() {
    if (!renderLog) return;
    var info = renderer.info();
    info.style = style;
    info.ghost = opts.ghost;
    info.labels = opts.labels;
    info.measure = opts.measure;
    info.model = {
      atoms: model.atoms.length,
      cellAtoms: built.cellCount,
      boundaryAtoms: built.boundaryCount,
      bonds: model.bonds.length,
      lines: model.lines.length,
      polyCenters: model.polyhedra.centers.length,
      polyTriangles: model.polyhedra.triangles.length
    };
    info.frames = frameCount;
    info.errors = errors.slice();
    renderLog.textContent = JSON.stringify(info);
    document.title = (errors.length === 0 && renderer.supported) ? 'render-ok' : 'render-fail';
    window.__CL_RENDER_INFO__ = info;
  }

  function frame() {
    if (dirty) {
      dirty = false;
      renderer.render(camera);
      frameCount++;
      if (!ready && frameCount >= 4) { ready = true; publishInfo(); }
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  // ------------------------------------------------------------- input -----
  var selected = [];
  var hovered = -1;
  var drag = null;
  var WHEEL_DELTA = 120;

  function localXY(ev) {
    var rect = container.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  container.addEventListener('pointerdown', function (ev) {
    var p = localXY(ev);
    drag = { x: p.x, y: p.y, lastX: p.x, lastY: p.y, button: ev.button, moved: 0 };
    if (container.setPointerCapture && ev.pointerId !== undefined) {
      try { container.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    ev.preventDefault();
  });

  container.addEventListener('pointermove', function (ev) {
    var p = localXY(ev);
    if (drag) {
      var dx = p.x - drag.lastX, dy = p.y - drag.lastY;
      drag.lastX = p.x; drag.lastY = p.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.button === 0) camera.orbit(dx, dy);
      else camera.pan(dx, dy, renderer._width, renderer._height);
      dirty = true;
      return;
    }
    var id = renderer.pick(camera, p.x, p.y);
    if (id !== hovered) {
      hovered = id;
      renderer.setHighlight({ selected: selected, hovered: hovered });
      dirty = true;
    }
  });

  container.addEventListener('pointerup', function (ev) {
    if (!drag) return;
    var wasClick = drag.moved < 4 && drag.button === 0;
    drag = null;
    if (!wasClick) return;
    var p = localXY(ev);
    var id = renderer.pick(camera, p.x, p.y);
    if (id >= 0) {
      if (selected.indexOf(id) >= 0) selected = selected.filter(function (v) { return v !== id; });
      else { selected.push(id); if (selected.length > 3) selected.shift(); }
    } else {
      selected = [];
    }
    renderer.setHighlight({ selected: selected, hovered: hovered });
    dirty = true;
  });

  container.addEventListener('pointerleave', function () {
    hovered = -1;
    renderer.setHighlight({ selected: selected, hovered: -1 });
    dirty = true;
  });

  container.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    camera.zoom(ev.deltaY / WHEEL_DELTA);
    dirty = true;
  }, { passive: false });

  container.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  container.addEventListener('dblclick', function () {
    fitView();
    dirty = true;
  });

  window.addEventListener('resize', function () {
    dirty = true;
  });

  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'f' || ev.key === 'F') { fitView(); dirty = true; }
    else if (ev.key === 'r' || ev.key === 'R') { fitView(); dirty = true; }
  });

  // expose for manual console inspection
  window.__CL_DEMO__ = {
    renderer: renderer,
    camera: camera,
    model: model,
    fit: function () { fitView(); dirty = true; },
    camera_: camera
  };
})();
