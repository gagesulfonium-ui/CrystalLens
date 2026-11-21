/**
 * CrystalLens Android - shared math utilities.
 * Classic script: attaches CL.Math. Plain arrays are used for Vec3 = [x,y,z].
 * Row-major 3x3 matrices for crystal work; column-major Float32Array for WebGL.
 *
 * The crystal-specific routines (buildCell / fracToCart / cartToFrac /
 * minimumFractionalDelta / minimumImage / convexHull3D) are byte-faithful ports
 * of reference/CrystalLens/src/core/Math.h, Crystal.cpp (Cell) and
 * render/PolyhedronMesh.cpp. Skew-cell minimum images must match the C++ search
 * exactly (tests/node/test_math.js).
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  var EPS = 1e-9;
  var DEG2RAD = Math.PI / 180;
  var RAD2DEG = 180 / Math.PI;

  // ---------------------------------------------------------------- vec3 ----
  var vec3 = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    mul: function (a, b) { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; },
    scale: function (a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    neg: function (a) { return [-a[0], -a[1], -a[2]]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross: function (a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    },
    length: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
    length2: function (a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; },
    distance: function (a, b) {
      var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    normalize: function (a) {
      var l = vec3.length(a);
      if (l < 1e-15) return [0, 0, 0];
      return [a[0] / l, a[1] / l, a[2] / l];
    },
    lerp: function (a, b, t) {
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    },
    min: function (a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]; },
    max: function (a, b) { return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]; },
    clone: function (a) { return [a[0], a[1], a[2]]; },
    isFinite: function (a) {
      return !!a && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]);
    }
  };

  // --------------------------------------------------------- scalar wraps ---
  // C++ Math.h: wrap a fractional coordinate into [0, 1); snap near-1 to 0.
  function wrap01(v) {
    var r = v % 1;
    if (r < 0) r += 1;
    if (r >= 1 - 1e-12) r = 0;
    return r;
  }
  // C++ Math.h: wrap a fractional displacement into [-0.5, 0.5).
  function wrapHalf(v) {
    var r = (v + 0.5) % 1;
    if (r < 0) r += 1;
    return r - 0.5;
  }
  function wrap01Vec(v) { return [wrap01(v[0]), wrap01(v[1]), wrap01(v[2])]; }
  function wrapHalfVec(v) { return [wrapHalf(v[0]), wrapHalf(v[1]), wrapHalf(v[2])]; }
  // C++ std::round: halfway cases round away from zero (JS Math.round rounds
  // towards +Infinity). Used by the minimum-image candidate search.
  function roundAway(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }

  // --------------------------------------------------------------- mat3 -----
  // Row-major 3x3: m[row][col]
  var mat3 = {
    identity: function () { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; },
    mul: function (a, b) {
      var out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
        }
      }
      return out;
    },
    mulVec: function (m, v) {
      return [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
      ];
    },
    // v * m (row vector, used by CIF symmetry text parsing)
    vecMul: function (v, m) {
      return [
        v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
        v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
        v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2]
      ];
    },
    transpose: function (m) {
      return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
    },
    det: function (m) {
      return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    },
    inverse: function (m) {
      var d = mat3.det(m);
      if (Math.abs(d) < 1e-12) return null;
      var inv = [
        [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d,
         (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d,
         (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d],
        [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d,
         (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d,
         (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d],
        [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d,
         (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d,
         (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d]
      ];
      return inv;
    }
  };

  // ------------------------------------------------------- cell geometry ----
  // Standard crystallographic convention used by CrystalLens (see docs/spec/core.md):
  //   aVec = (a, 0, 0)
  //   bVec = (b cos g, b sin g, 0)
  //   cVec = (c cos b, c (cos a - cos b cos g)/sin g, sqrt(c^2 - cx^2 - cy^2))
  // Returns null exactly when cl::Cell::SetFromParameters returns false.
  function buildCell(a, b, c, alpha, beta, gamma) {
    var values = [a, b, c, alpha, beta, gamma];
    for (var i = 0; i < 6; i++) {
      if (typeof values[i] !== 'number' || !isFinite(values[i])) return null;
    }
    if (!(a > 0) || !(b > 0) || !(c > 0)) return null;
    if (!(alpha > 0 && alpha < 180) || !(beta > 0 && beta < 180) || !(gamma > 0 && gamma < 180)) return null;
    var ar = alpha * DEG2RAD, br = beta * DEG2RAD, gr = gamma * DEG2RAD;
    var ca = Math.cos(ar), cb = Math.cos(br), cg = Math.cos(gr), sg = Math.sin(gr);
    if (Math.abs(sg) < 1e-10) return null;
    var cx = c * cb;
    var cy = c * (ca - cb * cg) / sg;
    var cz2 = c * c - cx * cx - cy * cy;
    if (cz2 <= 1e-12) return null;
    var cz = Math.sqrt(cz2);
    var aVec = [a, 0, 0];
    var bVec = [b * cg, b * sg, 0];
    var cVec = [cx, cy, cz];
    var volume = Math.abs(aVec[0] * (bVec[1] * cVec[2] - bVec[2] * cVec[1])
      - aVec[1] * (bVec[0] * cVec[2] - bVec[2] * cVec[0])
      + aVec[2] * (bVec[0] * cVec[1] - bVec[1] * cVec[0]));
    if (!isFinite(volume) || !(volume > 1e-9)) return null;
    return {
      a: a, b: b, c: c, alpha: alpha, beta: beta, gamma: gamma,
      aVec: aVec, bVec: bVec, cVec: cVec, volume: volume
    };
  }

  function fracToCart(cell, frac) {
    if (!cell) return [frac[0], frac[1], frac[2]];
    var av = cell.aVec, bv = cell.bVec, cv = cell.cVec;
    return [
      av[0] * frac[0] + bv[0] * frac[1] + cv[0] * frac[2],
      av[1] * frac[0] + bv[1] * frac[1] + cv[1] * frac[2],
      av[2] * frac[0] + bv[2] * frac[1] + cv[2] * frac[2]
    ];
  }

  function cartToFrac(cell, cart) {
    if (!cell) return [cart[0], cart[1], cart[2]];
    var av = cell.aVec, bv = cell.bVec, cv = cell.cVec;
    var det = av[0] * (bv[1] * cv[2] - bv[2] * cv[1])
      - av[1] * (bv[0] * cv[2] - bv[2] * cv[0])
      + av[2] * (bv[0] * cv[1] - bv[1] * cv[0]);
    if (Math.abs(det) < 1e-15) return [0, 0, 0];
    var px = cart[0], py = cart[1], pz = cart[2];
    var bc = [bv[1] * cv[2] - bv[2] * cv[1], bv[2] * cv[0] - bv[0] * cv[2], bv[0] * cv[1] - bv[1] * cv[0]];
    var pc = [py * cv[2] - pz * cv[1], pz * cv[0] - px * cv[2], px * cv[1] - py * cv[0]];
    var bp = [bv[1] * pz - bv[2] * py, bv[2] * px - bv[0] * pz, bv[0] * py - bv[1] * px];
    return [
      (px * bc[0] + py * bc[1] + pz * bc[2]) / det,
      (av[0] * pc[0] + av[1] * pc[1] + av[2] * pc[2]) / det,
      (av[0] * bp[0] + av[1] * bp[1] + av[2] * bp[2]) / det
    ];
  }

  // Port of cl::VisitImageRows: slice the search sphere (radius sqrt(radiusSq)
  // around the fractional displacement df) by lattice planes/rows so only a 1-D
  // integer interval is left per row. `visitor(iy, iz, xCenter, xRadius)` may
  // return false to stop the enumeration.
  function visitImageRows(cell, df, radiusSq, visitor) {
    if (!cell) return;
    var bv = cell.bVec, cv = cell.cVec, a = cell.a;
    var radius = Math.sqrt(radiusSq);
    var zFirst = Math.ceil(-df[2] - radius / cv[2]);
    var zLast = Math.floor(-df[2] + radius / cv[2]);
    for (var iz = zFirst; iz <= zLast; iz++) {
      var fz = df[2] + iz;
      var z = cv[2] * fz;
      var yzRoom = radiusSq - z * z;
      if (yzRoom < 0) continue;
      var yCenter = -df[1] - cv[1] * fz / bv[1];
      var yRadius = Math.sqrt(yzRoom) / bv[1];
      var yFirst = Math.ceil(yCenter - yRadius);
      var yLast = Math.floor(yCenter + yRadius);
      for (var iy = yFirst; iy <= yLast; iy++) {
        var fy = df[1] + iy;
        var y = bv[1] * fy + cv[1] * fz;
        var room = radiusSq - z * z - y * y;
        if (room < 0) continue;
        var xCenter = -df[0] - (bv[0] * fy + cv[0] * fz) / a;
        if (visitor(iy, iz, xCenter, Math.sqrt(room) / a) === false) return;
      }
    }
  }

  // Port of cl::Cell::MinimumFractionalDelta: find the integer translation that
  // makes fracToCart(delta + n) shortest. Orthogonal cells return WrapHalf.
  function minimumFractionalDelta(cell, delta) {
    var best = wrapHalfVec(delta);
    if (!cell) return best;
    if (cell.alpha === 90 && cell.beta === 90 && cell.gamma === 90) return best;
    var df = [best[0], best[1], best[2]];
    var seed = [best[0], best[1], best[2]];
    seed[1] -= roundAway(seed[1] + cell.cVec[1] * seed[2] / cell.bVec[1]);
    seed[0] -= roundAway(seed[0] + (cell.bVec[0] * seed[1] + cell.cVec[0] * seed[2]) / cell.a);
    var radiusSq = vec3.length2(fracToCart(cell, best));
    var seedSq = vec3.length2(fracToCart(cell, seed));
    if (seedSq < radiusSq) { best = seed; radiusSq = seedSq; }
    visitImageRows(cell, df, radiusSq, function (iy, iz, xCenter) {
      var candidate = [df[0] + roundAway(xCenter), df[1] + iy, df[2] + iz];
      var lengthSq = vec3.length2(fracToCart(cell, candidate));
      if (lengthSq < radiusSq) { best = candidate; radiusSq = lengthSq; }
      return true;
    });
    return best;
  }

  // Returns the Cartesian vector pointing from `fromCart` to the closest
  // periodic image of `toCart`. Matches cl::Cell::MinimumImageVector.
  function minimumImage(cell, fromCart, toCart) {
    var d = vec3.sub(toCart, fromCart);
    if (!cell) return d;
    var frac = cartToFrac(cell, d);
    var wrapped = minimumFractionalDelta(cell, frac);
    return fracToCart(cell, wrapped);
  }

  // Offset that must be added to `toCart` so it lands on the closest image.
  // Matches cl::Cell::ImageOffset.
  function imageOffset(cell, fromCart, toCart) {
    if (!cell) return [0, 0, 0];
    return vec3.sub(minimumImage(cell, fromCart, toCart), vec3.sub(toCart, fromCart));
  }

  // C++ Corners() order: z outer, y middle, x inner -> index = x + 2y + 4z.
  function cellCorners(cell) {
    if (!cell) return [];
    var out = [];
    for (var z = 0; z <= 1; z++) {
      for (var y = 0; y <= 1; y++) {
        for (var x = 0; x <= 1; x++) out.push(fracToCart(cell, [x, y, z]));
      }
    }
    return out;
  }

  // ------------------------------------------------------------- mat4 ------
  // Column-major float arrays for WebGL.
  var mat4 = {
    identity: function () {
      return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    },
    mul: function (a, b) { // a * b
      var out = new Float32Array(16);
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) {
          out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1]
            + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
        }
      }
      return out;
    },
    perspective: function (fovY, aspect, near, far) {
      var f = 1.0 / Math.tan(fovY / 2);
      var nf = 1.0 / (near - far);
      var out = new Float32Array(16);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[14] = 2 * far * near * nf;
      return out;
    },
    ortho: function (left, right, bottom, top, near, far) {
      var out = new Float32Array(16);
      out[0] = 2 / (right - left);
      out[5] = 2 / (top - bottom);
      out[10] = 2 / (near - far);
      out[12] = (left + right) / (left - right);
      out[13] = (top + bottom) / (bottom - top);
      out[14] = (near + far) / (near - far);
      out[15] = 1;
      return out;
    },
    lookAt: function (eye, center, up) {
      var f = vec3.normalize(vec3.sub(center, eye));
      var s = vec3.normalize(vec3.cross(f, up));
      var u = vec3.cross(s, f);
      var out = new Float32Array(16);
      out[0] = s[0]; out[4] = s[1]; out[8] = s[2];
      out[1] = u[0]; out[5] = u[1]; out[9] = u[2];
      out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2];
      out[12] = -vec3.dot(s, eye);
      out[13] = -vec3.dot(u, eye);
      out[14] = vec3.dot(f, eye);
      out[15] = 1;
      return out;
    },
    transformPoint: function (m, p) {
      var x = p[0], y = p[1], z = p[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (Math.abs(w) < 1e-12) w = 1;
      return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
      ];
    }
  };

  // ------------------------------------------------------- convex hull -----
  // Port of cl::CoordinationHull + cl::FaceBoundary (PolyhedronMesh.cpp) for an
  // arbitrary point set. Merges coplanar faces (keyed by the coplanar point
  // mask), drops interior/collinear points through a 2-D monotone chain, and
  // returns outward-facing index triangles plus the true ridge edges.
  //   { triangles: [{a,b,c,normal}], edges: [[i,j]], polygons: [{indices, normal}] }
  var HULL_EPS = 1e-6;

  function hullFaceBoundary(points, indices, normal) {
    var sorted = indices.slice();
    var u = vec3.normalize(vec3.sub(points[sorted[1]], points[sorted[0]]));
    var v = vec3.cross(normal, u);
    var pu = {}, pv = {};
    for (var t = 0; t < sorted.length; t++) {
      pu[sorted[t]] = vec3.dot(points[sorted[t]], u);
      pv[sorted[t]] = vec3.dot(points[sorted[t]], v);
    }
    sorted.sort(function (ia, ib) {
      if (pu[ia] !== pu[ib]) return pu[ia] - pu[ib];
      return pv[ia] - pv[ib];
    });
    var hull = [];
    function append(id, base) {
      while (hull.length >= base + 2) {
        var a = points[hull[hull.length - 2]];
        var b = points[hull[hull.length - 1]];
        var c = points[id];
        var cross = [
          (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
          (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        ];
        if (vec3.dot(normal, cross) > HULL_EPS) break;
        hull.pop();
      }
      hull.push(id);
    }
    for (var i = 0; i < sorted.length; i++) append(sorted[i], 0);
    var split = hull.length - 1;
    for (var k = sorted.length - 2; k >= 0; k--) append(sorted[k], split);
    hull.pop();
    return hull;
  }

  function convexHull3D(points) {
    var empty = { triangles: [], edges: [], polygons: [] };
    if (!points || points.length < 4) return empty;
    // Dedupe identical points (C++ uses |p-q|^2 < eps^2).
    var pts = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var duplicate = false;
      for (var q = 0; q < pts.length; q++) {
        var dx = p[0] - pts[q][0], dy = p[1] - pts[q][1], dz = p[2] - pts[q][2];
        if (dx * dx + dy * dy + dz * dz < HULL_EPS * HULL_EPS) { duplicate = true; break; }
      }
      if (!duplicate) pts.push(p);
    }
    var n = pts.length;
    if (n < 4) return empty;

    var planes = {};
    var faces = [];
    for (var a = 0; a < n - 2; a++) {
      for (var b = a + 1; b < n - 1; b++) {
        for (var c = b + 1; c < n; c++) {
          var e1 = [pts[b][0] - pts[a][0], pts[b][1] - pts[a][1], pts[b][2] - pts[a][2]];
          var e2 = [pts[c][0] - pts[a][0], pts[c][1] - pts[a][1], pts[c][2] - pts[a][2]];
          var normal = vec3.cross(e1, e2);
          var len = vec3.length(normal);
          if (len < HULL_EPS) continue;
          normal = [normal[0] / len, normal[1] / len, normal[2] / len];
          var above = false, below = false, mask = 0;
          for (var m = 0; m < n; m++) {
            var d = normal[0] * (pts[m][0] - pts[a][0]) + normal[1] * (pts[m][1] - pts[a][1])
              + normal[2] * (pts[m][2] - pts[a][2]);
            if (d > HULL_EPS) above = true;
            else if (d < -HULL_EPS) below = true;
            else mask |= (1 << m);
          }
          if (above === below) continue;
          if (planes[mask]) continue;
          planes[mask] = true;
          if (above) normal = [-normal[0], -normal[1], -normal[2]];
          var faceIndices = [];
          for (var f = 0; f < n; f++) if (mask & (1 << f)) faceIndices.push(f);
          faces.push({ indices: faceIndices, normal: normal });
        }
      }
    }
    if (!faces.length) return empty;

    var triangles = [];
    var polygons = [];
    var edges = [];
    var edgeSet = {};
    for (var fi = 0; fi < faces.length; fi++) {
      var face = faces[fi];
      var polygon = hullFaceBoundary(pts, face.indices, face.normal);
      if (polygon.length < 3) continue;
      polygons.push({ indices: polygon, normal: face.normal });
      for (var t = 1; t + 1 < polygon.length; t++) {
        triangles.push({
          a: polygon[0], b: polygon[t], c: polygon[t + 1], normal: face.normal
        });
      }
      for (var e = 0; e < polygon.length; e++) {
        var ia = polygon[e], ib = polygon[(e + 1) % polygon.length];
        var key = ia < ib ? ia + ':' + ib : ib + ':' + ia;
        if (!edgeSet[key]) {
          edgeSet[key] = true;
          edges.push([ia, ib]);
        }
      }
    }
    return { triangles: triangles, edges: edges, polygons: polygons };
  }

  // ---------------------------------------------------------- small utils ---
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function deg2rad(d) { return d * DEG2RAD; }
  function rad2deg(r) { return r * RAD2DEG; }
  function nearlyEqual(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }

  CL.Math = {
    EPS: EPS,
    DEG2RAD: DEG2RAD,
    RAD2DEG: RAD2DEG,
    vec3: vec3,
    mat3: mat3,
    mat4: mat4,
    buildCell: buildCell,
    fracToCart: fracToCart,
    cartToFrac: cartToFrac,
    minimumImage: minimumImage,
    imageOffset: imageOffset,
    minimumFractionalDelta: minimumFractionalDelta,
    visitImageRows: visitImageRows,
    cellCorners: cellCorners,
    convexHull3D: convexHull3D,
    wrap01: wrap01,
    wrapHalf: wrapHalf,
    wrap01Vec: wrap01Vec,
    wrapHalfVec: wrapHalfVec,
    roundAway: roundAway,
    clamp: clamp,
    lerp: lerp,
    deg2rad: deg2rad,
    rad2deg: rad2deg,
    nearlyEqual: nearlyEqual
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
