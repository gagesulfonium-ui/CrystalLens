/**
 * CrystalLens Android - distance / angle measurement.
 *
 * Port of cl::MeasureDistance / MeasureAngle / Make*Measurement from
 * reference/CrystalLens/src/core/Crystal.cpp, projected onto the CONTRACT
 * Measurement shape:
 *   { kind, atomIds, value, points, offsets, label }
 * `points` are render-space world points (already shifted by the structure
 * origin); `offsets` are the periodic-image corrections applied to each atom so
 * the drawn line is the shortest periodic connection.
 *
 * Accepts either a StructureData (atom indices, C++ semantics) or a DisplayModel
 * (DisplayAtom ids, supercell aware). The renderer consumes `points` directly.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var crystal = CL.crystal = CL.crystal || {};
  var M = CL.Math;

  function isDisplayModel(obj) {
    return !!(obj && obj.atoms && obj.atoms.length &&
      obj.atoms[0] && Array.isArray(obj.atoms[0].pos) && Array.isArray(obj.origin));
  }

  function isStructure(obj) {
    return !!(obj && obj.atoms && obj.atoms.length && obj.atoms[0] &&
      Array.isArray(obj.atoms[0].cart));
  }

  function vecLen(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

  /** Resolve the measurement source: atom cart coords, cell and render origin. */
  function resolve(input) {
    if (isDisplayModel(input)) {
      var origin = input.origin || [0, 0, 0];
      return {
        kind: 'model',
        count: input.atoms.length,
        cell: input.cell || null,
        origin: origin,
        cart: function (id) {
          var a = input.atoms[id];
          return [a.pos[0] + origin[0], a.pos[1] + origin[1], a.pos[2] + origin[2]];
        },
        has: function (id) {
          return typeof id === 'number' && id >= 0 && id < input.atoms.length;
        }
      };
    }
    if (isStructure(input)) {
      var center = input.center || [0, 0, 0];
      return {
        kind: 'structure',
        count: input.atoms.length,
        cell: input.cell || null,
        origin: center,
        cart: function (id) {
          var a = input.atoms[id];
          return [a.cart[0], a.cart[1], a.cart[2]];
        },
        has: function (id) {
          return typeof id === 'number' && id >= 0 && id < input.atoms.length;
        }
      };
    }
    // Sites-only structure: derive cartesian from fractional coordinates.
    if (input && input.sites && input.sites.length) {
      var c2 = input.cell || null;
      var ctr = input.center || [0, 0, 0];
      return {
        kind: 'structure',
        count: input.sites.length,
        cell: c2,
        origin: ctr,
        cart: function (id) {
          var s = input.sites[id];
          if (Array.isArray(s.cart)) return [s.cart[0], s.cart[1], s.cart[2]];
          if (c2 && Array.isArray(s.frac)) return M.fracToCart(c2, s.frac);
          return [0, 0, 0];
        },
        has: function (id) {
          return typeof id === 'number' && id >= 0 && id < input.sites.length;
        }
      };
    }
    return null;
  }

  function formatLength(v) {
    if (crystal.formatLength) return crystal.formatLength(v);
    return v.toFixed(3) + ' \u00C5';
  }
  function formatAngle(v) {
    if (crystal.formatAngle) return crystal.formatAngle(v);
    return v.toFixed(2) + '\u00B0';
  }

  /**
   * CL.crystal.measureDistance(source, aAtomId, bAtomId) -> Measurement | null
   * source = DisplayModel (DisplayAtom ids) or StructureData (atom indices).
   */
  function measureDistance(source, a, b) {
    var ctx = resolve(source);
    if (!ctx || !ctx.has(a) || !ctx.has(b) || a === b) return null;
    var pa = ctx.cart(a);
    var pb = ctx.cart(b);
    var direct = vsub(pb, pa);
    var offset = [0, 0, 0];
    var delta = direct;
    if (ctx.cell) {
      delta = M.minimumImage(ctx.cell, pa, pb);
      offset = vsub(delta, direct);
    }
    var value = vecLen(delta);
    var origin = ctx.origin;
    var points = [
      [pa[0] - origin[0], pa[1] - origin[1], pa[2] - origin[2]],
      [pb[0] + offset[0] - origin[0], pb[1] + offset[1] - origin[1], pb[2] + offset[2] - origin[2]]
    ];
    return {
      kind: 'distance',
      atomIds: [a, b],
      value: value,
      points: points,
      offsets: [[0, 0, 0], offset],
      label: formatLength(value),
      // C++-compatible fields (offset semantics identical to Crystal.cpp).
      a: a, b: b, c: -1,
      offsetA: [0, 0, 0],
      offsetB: offset
    };
  }

  /**
   * CL.crystal.measureAngle(source, aAtomId, bAtomId, cAtomId) -> Measurement | null
   * b is the vertex.
   */
  function measureAngle(source, a, b, c) {
    var ctx = resolve(source);
    if (!ctx || !ctx.has(a) || !ctx.has(b) || !ctx.has(c)) return null;
    if (a === b || c === b) return null;
    var pa = ctx.cart(a);
    var pb = ctx.cart(b);
    var pc = ctx.cart(c);
    var va = vsub(pa, pb);
    var vc = vsub(pc, pb);
    var oa = [0, 0, 0];
    var oc = [0, 0, 0];
    if (ctx.cell) {
      va = M.minimumImage(ctx.cell, pb, pa);
      vc = M.minimumImage(ctx.cell, pb, pc);
      oa = vsub(va, vsub(pa, pb));
      oc = vsub(vc, vsub(pc, pb));
    }
    var la = vecLen(va);
    var lc = vecLen(vc);
    if (la < 1e-9 || lc < 1e-9) return null;
    var cosine = (va[0] * vc[0] + va[1] * vc[1] + va[2] * vc[2]) / (la * lc);
    if (cosine > 1) cosine = 1;
    else if (cosine < -1) cosine = -1;
    var degrees = Math.acos(cosine) * (180 / Math.PI);
    var origin = ctx.origin;
    var points = [
      [pa[0] + oa[0] - origin[0], pa[1] + oa[1] - origin[1], pa[2] + oa[2] - origin[2]],
      [pb[0] - origin[0], pb[1] - origin[1], pb[2] - origin[2]],
      [pc[0] + oc[0] - origin[0], pc[1] + oc[1] - origin[1], pc[2] + oc[2] - origin[2]]
    ];
    return {
      kind: 'angle',
      atomIds: [a, b, c],
      value: degrees,
      points: points,
      offsets: [oa, [0, 0, 0], oc],
      label: formatAngle(degrees),
      // C++-compatible fields.
      a: a, b: b, c: c,
      offsetA: oa,
      offsetB: [0, 0, 0],
      offsetC: oc
    };
  }

  /** C++ MakeDistanceMeasurement equivalent (a, b atom indices). */
  function makeDistanceMeasurement(source, a, b) {
    return measureDistance(source, a, b);
  }
  /** C++ MakeAngleMeasurement equivalent (a, b, c atom indices, b vertex). */
  function makeAngleMeasurement(source, a, b, c) {
    return measureAngle(source, a, b, c);
  }

  crystal.measureDistance = measureDistance;
  crystal.measureAngle = measureAngle;
  crystal.makeDistanceMeasurement = makeDistanceMeasurement;
  crystal.makeAngleMeasurement = makeAngleMeasurement;

  // Convenience namespace for UI wiring.
  CL.measure = {
    distance: measureDistance,
    angle: measureAngle,
    makeDistanceMeasurement: makeDistanceMeasurement,
    makeAngleMeasurement: makeAngleMeasurement
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
