/**
 * CrystalLens Android - crystal model layer.
 *
 * Faithful JS port of reference/CrystalLens/src/core/Crystal.cpp (expand / bonds /
 * contents / bounds / finalize), plus the display-set algorithms that lived in
 * src/render/Renderer.cpp (supercell interior + boundary images, visible bonds,
 * sub-cell lines) and src/render/PolyhedronMesh.cpp (coordination polyhedra).
 *
 * Classic script, no DOM, no dependencies other than CL.Math / CL.periodic.
 * StructureData is plain JSON; DisplayModel may hold TypedArray-free plain arrays.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var M = CL.Math;
  // Local intrinsic caches: repeated global Math lookups are costly inside
  // sandboxed test contexts and in the O(n^2) bond loop.
  var mathCeil = Math.ceil, mathFloor = Math.floor;

  // ------------------------------------------------------------ constants ---
  var K_MAX_CELL_REPEATS = 16;      // render/Appearance.h
  var K_SUPERCELL_MAX_SITES = 65536; // Renderer.cpp FitsSupercell
  var K_SUPERCELL_MAX_BONDS = 300000;
  var K_MAX_IMAGES = 80000;         // Renderer.cpp RebuildAtoms
  var K_MAX_DISPLAY_ATOMS = 30000;  // core/Crystal.h
  var K_MAX_BONDS = 150000;         // core/Crystal.h
  var K_MAX_COORD_POINTS = 14;      // PolyhedronMesh.cpp
  var K_EXPAND_TOLERANCE = 1e-3;    // ExpandAsymmetricUnit default
  var K_BOND_TOLERANCE = 1.20;      // BuildBonds default
  var K_MIN_BOND = 0.42;            // shortest accepted atom-atom distance
  var K_MAX_PAIR_CUTOFF = 6.0;
  var K_SPACING_EPS = 1e-7;         // fractional snap for boundary limits
  var K_HULL_EPS = 1e-6;
  var K_BOND_COLOR = [0.66, 0.70, 0.76];
  var K_POLY_EDGE_COLOR = [145 / 255, 180 / 255, 211 / 255]; // 0x91B4D3
  var K_MAX_POLY_TRIANGLES = 400000;  // safety cap for the model layer
  var K_MAX_POLY_INSTANCES = 60000;

  var LIGAND_Z = { 7: 1, 8: 1, 9: 1, 16: 1, 17: 1, 34: 1, 35: 1, 53: 1 };
  var NONMETAL = { 1: 1, 2: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 15: 1, 16: 1, 17: 1, 18: 1,
    34: 1, 35: 1, 36: 1, 53: 1, 54: 1, 85: 1, 86: 1, 117: 1, 118: 1 };
  var METALLOID = { 5: 1, 14: 1, 32: 1, 33: 1, 51: 1, 52: 1, 84: 1 };
  var ALKALI = { 3: 1, 4: 1, 11: 1, 12: 1, 19: 1, 20: 1, 37: 1, 38: 1, 55: 1, 56: 1, 87: 1, 88: 1 };

  // Fallback periodic data (docs/spec/elements.json, z = 1..118 then X) used only
  // when CL.periodic is missing. symbol,covalent,vdw,colorU32
  var FALLBACK_RAW = 'H,0.31,1.2,0xF2F4F8;He,0.28,1.4,0xD9E7F2;Li,1.28,1.82,0xC7A6FF;Be,0.96,1.53,0x9FE3B0;' +
    'B,0.84,1.92,0xF0A98B;C,0.76,1.7,0x7F8A9A;N,0.71,1.55,0x5B8CFF;O,0.66,1.52,0xFF5C6C;' +
    'F,0.57,1.47,0x66E0A3;Ne,0.58,1.54,0x9CD7E8;Na,1.66,2.27,0xD8C34A;Mg,1.41,1.73,0x8FE58C;' +
    'Al,1.21,1.84,0x4FA3FF;Si,1.11,2.1,0x5A7CFF;P,1.07,1.8,0xFF9F43;S,1.05,1.8,0xFFD54A;' +
    'Cl,1.02,1.75,0x4ADF7A;Ar,1.06,1.88,0x88D6E8;K,2.03,2.75,0xB26BFF;Ca,1.76,2.31,0x7FE08A;' +
    'Sc,1.7,2.15,0xC9D18A;Ti,1.6,2.11,0x93A8C7;V,1.53,2.07,0xE4B563;Cr,1.39,2.06,0xE040B0;' +
    'Mn,1.39,2.05,0xC58BC9;Fe,1.32,2.04,0xE3753F;Co,1.26,2,0x2F5BD8;Ni,1.24,1.97,0x9AA7B8;' +
    'Cu,1.32,1.96,0xD98246;Zn,1.22,2.01,0xA99BD8;Ga,1.22,1.87,0xC9A16B;Ge,1.2,2.11,0x9DBF9D;' +
    'As,1.19,1.85,0xC99BCB;Se,1.2,1.9,0xF2A65A;Br,1.2,1.85,0xA65A38;Kr,1.16,2.02,0x92D8E8;' +
    'Rb,2.2,3.03,0xC36BFF;Sr,1.95,2.49,0x7FE08A;Y,1.9,2.32,0x9BBFD1;Zr,1.75,2.23,0x99B873;' +
    'Nb,1.64,2.14,0x92A8C4;Mo,1.54,2.17,0x7FA9DD;Tc,1.47,2.16,0xC9A46B;Ru,1.46,2.13,0x8FC0B8;' +
    'Rh,1.42,2.1,0xA4B6D8;Pd,1.39,2.05,0xA8B8C8;Ag,1.45,2.03,0xCFD6E2;Cd,1.44,2.18,0xD5C58A;' +
    'In,1.42,1.93,0xC6A5D8;Sn,1.39,2.17,0xA6B8C5;Sb,1.39,2.06,0xC89BD8;Te,1.38,2.06,0xD8A45A;' +
    'I,1.39,1.98,0xA97BFF;Xe,1.4,2.16,0x8FD8E8;Cs,2.44,3.43,0xB36BFF;Ba,2.15,2.68,0x8CE38A;' +
    'La,2.07,2.4,0x9BC98F;Ce,2.04,2.35,0xB8D18A;Pr,2.03,2.39,0xA6D19A;Nd,2.01,2.29,0x9CCB9D;' +
    'Pm,1.99,2.36,0x9EC9A8;Sm,1.98,2.29,0x9CC7AA;Eu,1.98,2.33,0xA0C8B8;Gd,1.96,2.37,0x9DC4B5;' +
    'Tb,1.94,2.21,0x99C0B8;Dy,1.92,2.29,0x95BCC0;Ho,1.92,2.16,0x91B8C8;Er,1.89,2.35,0x8DB4CE;' +
    'Tm,1.9,2.27,0x89B0D2;Yb,1.87,2.42,0x85ACD6;Lu,1.87,2.21,0x81A8D8;Hf,1.75,2.12,0x8FB1C2;' +
    'Ta,1.7,2.17,0x8BA8C9;W,1.62,2.1,0x87A0D0;Re,1.51,2.17,0x8398D6;Os,1.44,2.16,0x7F90D8;' +
    'Ir,1.41,2.02,0x7B88D9;Pt,1.36,2.09,0x7780DA;Au,1.36,2.14,0xFFD34E;Hg,1.32,2.23,0xCFC7D8;' +
    'Tl,1.45,1.96,0xA6B29C;Pb,1.46,2.02,0x8C96AE;Bi,1.48,2.07,0xD77AA8;Po,1.4,1.97,0xC96B8F;' +
    'At,1.5,2.02,0xB85A7E;Rn,1.5,2.2,0x8ED0E8;Fr,2.6,3.48,0xC36BFF;Ra,2.21,2.83,0x8CE38A;' +
    'Ac,2.15,2.6,0x9CCBA4;Th,2.06,2.37,0xB0C88A;Pa,2,2.43,0xA6C29A;U,1.96,2.4,0xFFB84D;' +
    'Np,1.9,2.39,0x9AB8C6;Pu,1.87,2.43,0x9AA8D0;Am,1.8,2.44,0x9AA0C0;Cm,1.69,2.45,0x9A98B0;' +
    'Bk,1.68,2.44,0xB0A0B8;Cf,1.68,2.45,0xB0A8C0;Es,1.65,2.45,0xB0B0C8;Fm,1.67,2.45,0xB0B8D0;' +
    'Md,1.73,2.46,0xB8C0D8;No,1.76,2.46,0xB8C8D8;Lr,1.61,2.46,0xC0D0E0;Rf,1.57,2.4,0xC8D0E0;' +
    'Db,1.49,2.38,0xC8C8D8;Sg,1.43,2.32,0xC0C0D0;Bh,1.41,2.3,0xB8B8C8;Hs,1.34,2.26,0xB0B0C0;' +
    'Mt,1.29,2.2,0xA8A8B8;Ds,1.28,2.2,0xA0A0B0;Rg,1.21,2.2,0x9898A8;Cn,1.22,2.2,0x9090A0;' +
    'Nh,1.36,2.4,0x888898;Fl,1.43,2.6,0x808090;Mc,1.62,2.6,0x787888;Lv,1.75,2.6,0x707080;' +
    'Ts,1.65,2.4,0x686878;Og,1.57,2.3,0x606070;X,0.77,1.7,0x9AA4B2';
  var FALLBACK = null;
  function fallbackTable() {
    if (FALLBACK) return FALLBACK;
    FALLBACK = [];
    var rows = FALLBACK_RAW.split(';');
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].split(',');
      if (p.length !== 4) continue;
      FALLBACK.push({ symbol: p[0], covalent: parseFloat(p[1]), vdw: parseFloat(p[2]), color: parseInt(p[3], 16) });
    }
    return FALLBACK;
  }
  function fallbackEntry(z) {
    var table = fallbackTable();
    if (z >= 1 && z <= 118) return table[z - 1];
    return table[118]; // X
  }

  // Element metadata (prefers CL.periodic from lib/periodic_table.js).
  function elementByZ(z) {
    if (CL.periodic && CL.periodic.byZ) {
      var e = CL.periodic.byZ(z);
      if (e) return e;
    }
    var f = fallbackEntry(z);
    return {
      symbol: f.symbol, z: z, covalent: f.covalent, vdw: f.vdw,
      colorU32: f.color,
      rgb: [((f.color >> 16) & 0xFF) / 255, ((f.color >> 8) & 0xFF) / 255, (f.color & 0xFF) / 255]
    };
  }
  function symbolOf(z) { return elementByZ(z).symbol; }
  function rgbOf(z) { return elementByZ(z).rgb; }

  function isNonMetal(z) {
    if (CL.periodic && CL.periodic.isNonMetal) return CL.periodic.isNonMetal(z);
    return !!NONMETAL[z];
  }
  function isMetalloid(z) {
    if (CL.periodic && CL.periodic.isMetalloid) return CL.periodic.isMetalloid(z);
    return !!METALLOID[z];
  }
  function isAlkaliOrAlkaline(z) {
    if (CL.periodic && CL.periodic.isAlkaliOrAlkaline) return CL.periodic.isAlkaliOrAlkaline(z);
    return !!ALKALI[z];
  }
  function isTransitionMetal(z) {
    return (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || z >= 89;
  }
  function pairBondCutoff(za, zb) {
    if (CL.periodic && CL.periodic.pairBondCutoff) return CL.periodic.pairBondCutoff(za, zb);
    var ca = elementByZ(za).covalent, cb = elementByZ(zb).covalent;
    var aNon = isNonMetal(za), bNon = isNonMetal(zb);
    var aMetal = !aNon && !isMetalloid(za), bMetal = !bNon && !isMetalloid(zb);
    if (aMetal && bMetal) {
      if (isAlkaliOrAlkaline(za) || isAlkaliOrAlkaline(zb)) return 0;
      return ca + cb + 0.12;
    }
    if ((aMetal && bNon) || (bMetal && aNon)) return ca + cb + 0.35;
    return ca + cb + 0.12;
  }

  // --------------------------------------------------------------- utils ----
  function isFiniteVec(v) {
    return !!v && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2]);
  }
  function cloneVec(v) { return v ? [v[0], v[1], v[2]] : [0, 0, 0]; }
  function clamp01Limit(n, lo, hi) {
    n = Math.round(n);
    if (!isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }
  function cloneAtomFields(src) {
    return {
      label: src.label, baseLabel: src.baseLabel, element: src.element, z: src.z,
      frac: cloneVec(src.frac), cart: cloneVec(src.cart),
      occupancy: src.occupancy, uiso: src.uiso, hasUiso: !!src.hasUiso,
      disorderGroup: src.disorderGroup, disorderAssembly: src.disorderAssembly,
      siteIndex: src.siteIndex, symmetryIndex: src.symmetryIndex,
      symmetryGenerated: !!src.symmetryGenerated
    };
  }
  function appendNote(structure, text) {
    if (structure.note == null) structure.note = '';
    if (structure.note.indexOf(text) < 0) structure.note += text;
  }
  function identityOp() {
    return { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], text: 'x,y,z' };
  }
  function applySymOp(op, frac) {
    var m = op.m, t = op.t;
    return [
      m[0][0] * frac[0] + m[0][1] * frac[1] + m[0][2] * frac[2] + t[0],
      m[1][0] * frac[0] + m[1][1] * frac[1] + m[1][2] * frac[2] + t[1],
      m[2][0] * frac[0] + m[2][1] * frac[1] + m[2][2] * frac[2] + t[2]
    ];
  }
  function ensureSite(site, index) {
    // Guarantees the Site invariants the model layer relies on.
    if (site.siteIndex === undefined || site.siteIndex === null) site.siteIndex = index;
    if (site.baseLabel === undefined || site.baseLabel === null) site.baseLabel = '';
    if (site.label === undefined || site.label === null) site.label = '';
    if (site.element === undefined || site.element === null) site.element = 'X';
    if (site.z === undefined || site.z === null) site.z = 0;
    if (site.occupancy === undefined || site.occupancy === null) site.occupancy = 1;
    if (site.uiso === undefined || site.uiso === null) site.uiso = 0;
    if (site.hasUiso === undefined || site.hasUiso === null) site.hasUiso = false;
    if (!site.disorderGroup) site.disorderGroup = '';
    if (!site.disorderAssembly) site.disorderAssembly = '';
    if (site.frac === undefined) site.frac = null;
    if (site.cart === undefined) site.cart = null;
  }

  // --------------------------------------------------------------- expand ---
  /**
   * CL.crystal.expand(structure, tolerance?)
   * Rebuilds structure.atoms from structure.sites + structure.symops (identity
   * when no operations are present). Idempotent: atoms are never an input.
   */
  function expand(structure, tolerance) {
    if (!structure) return null;
    var tol = (typeof tolerance === 'number' && tolerance > 0) ? tolerance : K_EXPAND_TOLERANCE;
    var sites = structure.sites || [];
    var cell = structure.cell || null;
    for (var si = 0; si < sites.length; si++) ensureSite(sites[si], si);

    var out = [];
    if (!cell || sites.length === 0) {
      for (var i = 0; i < sites.length; i++) {
        var s = sites[i];
        var atom = cloneAtomFields(s);
        atom.frac = s.frac ? cloneVec(s.frac) : [0, 0, 0];
        atom.cart = s.cart ? cloneVec(s.cart) : [0, 0, 0];
        if (!atom.baseLabel) atom.baseLabel = atom.label;
        atom.siteIndex = i;
        atom.symmetryIndex = 0;
        atom.symmetryGenerated = false;
        out.push(atom);
      }
      structure.atoms = out;
      structure.symmetryExpanded = false;
      structure.truncated = false;
      structure.asymmetricAtomCount = sites.length;
      if (typeof structure.symmetryOperatorCount !== 'number') {
        structure.symmetryOperatorCount = (structure.symops && structure.symops.length) || 1;
      }
      return structure;
    }

    var ops = Array.isArray(structure.symops) ? structure.symops.slice() : [];
    if (ops.length === 0) ops.push(identityOp());
    else structure.symmetryExpanded = true;

    structure.truncated = false;
    var truncated = false;
    for (var siteIndex = 0; siteIndex < sites.length; siteIndex++) {
      var src = sites[siteIndex];
      if (src.occupancy <= 0) continue;
      var srcFrac = isFiniteVec(src.frac) ? src.frac : [0, 0, 0];
      var positions = [];
      var opIndices = [];
      for (var oi = 0; oi < ops.length; oi++) {
        var frac = M.wrap01Vec(applySymOp(ops[oi], srcFrac));
        var duplicate = false;
        for (var p = 0; p < positions.length; p++) {
          var delta = M.minimumFractionalDelta(cell, [
            frac[0] - positions[p][0], frac[1] - positions[p][1], frac[2] - positions[p][2]
          ]);
          var dcart = M.fracToCart(cell, delta);
          if (Math.sqrt(dcart[0] * dcart[0] + dcart[1] * dcart[1] + dcart[2] * dcart[2]) < tol) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) { positions.push(frac); opIndices.push(oi); }
      }
      if (!positions.length) continue;
      for (var copy = 0; copy < positions.length; copy++) {
        if (out.length >= K_MAX_DISPLAY_ATOMS) { truncated = true; break; }
        var a = cloneAtomFields(src);
        a.frac = positions[copy];
        a.cart = M.fracToCart(cell, a.frac);
        a.siteIndex = siteIndex;
        a.symmetryIndex = opIndices[copy];
        a.symmetryGenerated = (opIndices[copy] !== 0);
        if (!a.baseLabel) a.baseLabel = a.label;
        a.label = (positions.length > 1) ? a.baseLabel + '_' + (copy + 1) : a.baseLabel;
        out.push(a);
      }
      if (truncated) break;
    }
    structure.atoms = out;
    structure.truncated = truncated;
    if (truncated) appendNote(structure, ' 原子数超过 30,000，显示已截断。');
    structure.symmetryOperatorCount = structure.symops && structure.symops.length ? structure.symops.length : 1;
    return structure;
  }

  // ---------------------------------------------------------- pair cutoff ---
  function knownGroup(g) { return !!g && g !== '.' && g !== '?'; }

  // ----------------------------------------------------------- bond build ---
  function buildBondsBruteForce(structure, tolerance, state) {
    var atoms = structure.atoms;
    var n = atoms.length;
    for (var i = 0; i < n; i++) {
      for (var j = i; j < n; j++) {
        considerPair(structure, i, j, tolerance, state);
        if (state.truncated) return;
      }
    }
  }

  // Cached PairBondCutoff(x, y) values for one buildBonds() call.
  function cutoffForPair(a, b, state) {
    if (knownGroup(a.disorderGroup) && knownGroup(b.disorderGroup) &&
        a.disorderAssembly === b.disorderAssembly &&
        a.disorderAssembly !== '?' &&
        a.disorderGroup !== b.disorderGroup) return 0;
    var za = a.z | 0, zb = b.z | 0;
    if (za === 0 || zb === 0) return 0;
    var key = za * 128 + zb;
    var cached = state.cutoffs[key];
    if (cached !== undefined) return cached;
    var cutoff = pairBondCutoff(za, zb) * state.cutoffScale;
    if (!(cutoff > 0)) cutoff = 0;
    else if (cutoff > K_MAX_PAIR_CUTOFF) cutoff = K_MAX_PAIR_CUTOFF;
    state.cutoffs[key] = cutoff;
    return cutoff;
  }

  function considerPair(structure, i, j, tolerance, state) {
    var a = structure.atoms[i];
    var b = structure.atoms[j];
    var cutoff = cutoffForPair(a, b, state);
    if (cutoff < K_MIN_BOND) return;
    var cell = structure.cell;
    var dx = b.cart[0] - a.cart[0];
    var dy = b.cart[1] - a.cart[1];
    var dz = b.cart[2] - a.cart[2];
    var cutoffSq = cutoff * cutoff + 1e-12;
    var minSq = K_MIN_BOND * K_MIN_BOND;

    if (!cell) {
      if (i === j) return;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < minSq || d2 > cutoffSq) return;
      pushBond(state, i, j, [0, 0, 0], [0, 0, 0], Math.sqrt(d2), false);
      return;
    }

    var self = (i === j);
    var truncated = false;
    if (cell.alpha === 90 && cell.beta === 90 && cell.gamma === 90) {
      // Orthogonal fast path: an image can only be within `cutoff` when every
      // per-axis component is within +-cutoff, which bounds the integer box.
      var Lx = cell.a, Ly = cell.b, Lz = cell.c;
      var ix0 = mathCeil((-cutoff - dx) / Lx), ix1 = mathFloor((cutoff - dx) / Lx);
      var iy0 = mathCeil((-cutoff - dy) / Ly), iy1 = mathFloor((cutoff - dy) / Ly);
      var iz0 = mathCeil((-cutoff - dz) / Lz), iz1 = mathFloor((cutoff - dz) / Lz);
      for (var tz = iz0; tz <= iz1; tz++) {
        var oz = tz * Lz;
        for (var ty = iy0; ty <= iy1; ty++) {
          var oy = ty * Ly;
          for (var tx = ix0; tx <= ix1; tx++) {
            if (self && (tz < 0 || (tz === 0 && (ty < 0 || (ty === 0 && tx <= 0))))) continue;
            var ox = tx * Lx;
            var rx = dx + ox, ry = dy + oy, rz = dz + oz;
            var distSq = rx * rx + ry * ry + rz * rz;
            if (distSq < minSq || distSq > cutoffSq) continue;
            var offset = [ox, oy, oz];
            pushBond(state, i, j, [tx, ty, tz], offset, Math.sqrt(distSq), true);
            if (state.truncated) return;
          }
        }
      }
      return;
    }

    var df = [b.frac[0] - a.frac[0], b.frac[1] - a.frac[1], b.frac[2] - a.frac[2]];
    var cellRef = cell;
    M.visitImageRows(cell, df, cutoffSq, function (iy, iz, xCenter, xRadius) {
      var ixFirst = mathCeil(xCenter - xRadius);
      var ixLast = mathFloor(xCenter + xRadius);
      for (var ix = ixFirst; ix <= ixLast; ix++) {
        if (self) {
          // C++ filter: skip when [tz,ty,tx] <= [0,0,0] (component order preserved).
          if (iz < 0 || (iz === 0 && (iy < 0 || (iy === 0 && ix <= 0)))) continue;
        }
        var offset = M.fracToCart(cellRef, [ix, iy, iz]);
        var rx = dx + offset[0], ry = dy + offset[1], rz = dz + offset[2];
        var distSq = rx * rx + ry * ry + rz * rz;
        if (distSq < minSq || distSq > cutoffSq) continue;
        pushBond(state, i, j, [ix, iy, iz], offset, Math.sqrt(distSq), true);
        if (state.truncated) return false;
      }
      return true;
    });
  }

  function pushBond(state, i, j, shift, imageOffset, length, periodic) {
    if (state.bonds.length >= K_MAX_BONDS) { state.truncated = true; return; }
    state.bonds.push({
      a: i, b: j, length: length,
      shift: [shift[0], shift[1], shift[2]],
      imageOffset: [imageOffset[0], imageOffset[1], imageOffset[2]],
      periodic: periodic
    });
  }

  function buildBondsGrid(structure, tolerance, state) {
    var atoms = structure.atoms;
    var n = atoms.length;
    var bins = [1, 1, 1];
    var binIndex = new Int32Array(n);
    var cell = structure.cell;
    var origin = [0, 0, 0];
    var extent = [1, 1, 1];
    var i, axis;
    if (cell) {
      var lenA = cell.volume / vecLen(M.vec3.cross(cell.bVec, cell.cVec));
      var lenB = cell.volume / vecLen(M.vec3.cross(cell.aVec, cell.cVec));
      var lenC = cell.volume / vecLen(M.vec3.cross(cell.aVec, cell.bVec));
      var lengths = [lenA, lenB, lenC];
      for (axis = 0; axis < 3; axis++) {
        var b = mathFloor(lengths[axis] / 6.0);
        bins[axis] = b < 1 ? 1 : (b > 40 ? 40 : b);
      }
      for (i = 0; i < n; i++) {
        var f = M.wrap01Vec(atoms[i].frac);
        var x = Math.min(bins[0] - 1, mathFloor(f[0] * bins[0]));
        var y = Math.min(bins[1] - 1, mathFloor(f[1] * bins[1]));
        var z = Math.min(bins[2] - 1, mathFloor(f[2] * bins[2]));
        binIndex[i] = (z * bins[1] + y) * bins[0] + x;
      }
    } else {
      var lo = [Infinity, Infinity, Infinity];
      var hi = [-Infinity, -Infinity, -Infinity];
      for (i = 0; i < n; i++) {
        var c = atoms[i].cart;
        if (c[0] < lo[0]) lo[0] = c[0];
        if (c[1] < lo[1]) lo[1] = c[1];
        if (c[2] < lo[2]) lo[2] = c[2];
        if (c[0] > hi[0]) hi[0] = c[0];
        if (c[1] > hi[1]) hi[1] = c[1];
        if (c[2] > hi[2]) hi[2] = c[2];
      }
      origin = lo;
      extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      for (axis = 0; axis < 3; axis++) {
        var nb = mathFloor(extent[axis] / 6.0);
        bins[axis] = nb < 1 ? 1 : (nb > 48 ? 48 : nb);
      }
      for (i = 0; i < n; i++) {
        var cart = atoms[i].cart;
        var lx = (cart[0] - origin[0]) / Math.max(1e-9, extent[0]);
        var ly = (cart[1] - origin[1]) / Math.max(1e-9, extent[1]);
        var lz = (cart[2] - origin[2]) / Math.max(1e-9, extent[2]);
        var bx = Math.max(0, Math.min(bins[0] - 1, mathFloor(lx * bins[0])));
        var by = Math.max(0, Math.min(bins[1] - 1, mathFloor(ly * bins[1])));
        var bz = Math.max(0, Math.min(bins[2] - 1, mathFloor(lz * bins[2])));
        binIndex[i] = (bz * bins[1] + by) * bins[0] + bx;
      }
    }
    var totalBins = bins[0] * bins[1] * bins[2];
    var cells = new Array(totalBins);
    for (i = 0; i < totalBins; i++) cells[i] = [];
    for (i = 0; i < n; i++) cells[binIndex[i]].push(i);

    var first = [-1, -1, -1];
    var last = [1, 1, 1];
    if (cell) {
      for (axis = 0; axis < 3; axis++) {
        if (bins[axis] <= 2) first[axis] = 0;
        if (bins[axis] === 1) last[axis] = 0;
      }
    }
    for (i = 0; i < n; i++) {
      var bx0 = binIndex[i] % bins[0];
      var by0 = ((binIndex[i] / bins[0]) | 0) % bins[1];
      var bz0 = (binIndex[i] / (bins[0] * bins[1])) | 0;
      for (var dz = first[2]; dz <= last[2]; dz++) {
        for (var dy = first[1]; dy <= last[1]; dy++) {
          for (var dx = first[0]; dx <= last[0]; dx++) {
            var xx = bx0 + dx, yy = by0 + dy, zz = bz0 + dz;
            if (cell) {
              xx = (xx + bins[0]) % bins[0];
              yy = (yy + bins[1]) % bins[1];
              zz = (zz + bins[2]) % bins[2];
            } else if (xx < 0 || yy < 0 || zz < 0 || xx >= bins[0] || yy >= bins[1] || zz >= bins[2]) {
              continue;
            }
            var list = cells[(zz * bins[1] + yy) * bins[0] + xx];
            for (var k = 0; k < list.length; k++) {
              var j = list[k];
              if (j < i) continue;
              considerPair(structure, i, j, tolerance, state);
              if (state.truncated) return;
            }
          }
        }
      }
    }
  }
  function vecLen(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }

  /**
   * CL.crystal.buildBonds(structure, tolerance = 1.20)
   * Single-cell periodic bond table. Sorted by (a, b, shift[0..2]).
   */
  function buildBonds(structure, tolerance) {
    if (!structure) return null;
    var tol = (typeof tolerance === 'number' && tolerance > 0) ? tolerance : K_BOND_TOLERANCE;
    var atoms = structure.atoms || [];
    var state = { bonds: [], truncated: false, cutoffs: {}, cutoffScale: tol / K_BOND_TOLERANCE };
    if (atoms.length > 0) {
      if (atoms.length < 1600) buildBondsBruteForce(structure, tol, state);
      else buildBondsGrid(structure, tol, state);
    }
    var bonds = state.bonds;
    bonds.sort(function (a, b) {
      if (a.a !== b.a) return a.a - b.a;
      if (a.b !== b.b) return a.b - b.b;
      if (a.shift[0] !== b.shift[0]) return a.shift[0] - b.shift[0];
      if (a.shift[1] !== b.shift[1]) return a.shift[1] - b.shift[1];
      return a.shift[2] - b.shift[2];
    });
    structure.bonds = bonds;
    if (state.truncated) {
      structure.truncated = true;
      appendNote(structure, ' 化学键数量过多，已截断显示。');
    }
    return structure;
  }

  // --------------------------------------------------- contents and bounds --
  /** Port of Structure::ComputeContents (z ascending, no reduction). */
  function computeContents(structure) {
    var atoms = structure.atoms || [];
    var counts = {};
    var i, z;
    for (i = 0; i < atoms.length; i++) {
      z = atoms[i].z | 0;
      counts[z] = (counts[z] || 0) + 1;
    }
    var keys = [];
    for (var key in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, key)) keys.push(parseInt(key, 10));
    }
    keys.sort(function (a, b) { return a - b; });
    var elementCounts = {};
    var parts = [];
    for (i = 0; i < keys.length; i++) {
      z = keys[i];
      var count = counts[z];
      elementCounts[String(z)] = count;
      parts.push(symbolOf(z) + (count !== 1 ? String(count) : ''));
    }
    structure.elementCounts = elementCounts;
    structure.cellContents = parts.join(' ');
    if (!structure.formula) structure.formula = structure.cellContents;
    return structure;
  }

  /** Port of Structure::ComputeBounds. */
  function computeBounds(structure) {
    var cell = structure.cell;
    var atoms = structure.atoms || [];
    var i;
    if (cell) {
      var center = [
        (cell.aVec[0] + cell.bVec[0] + cell.cVec[0]) * 0.5,
        (cell.aVec[1] + cell.bVec[1] + cell.cVec[1]) * 0.5,
        (cell.aVec[2] + cell.bVec[2] + cell.cVec[2]) * 0.5
      ];
      var maxDist = 0;
      var corners = M.cellCorners(cell);
      for (i = 0; i < corners.length; i++) {
        var dc = Math.sqrt(sq(corners[i][0] - center[0]) + sq(corners[i][1] - center[1]) + sq(corners[i][2] - center[2]));
        if (dc > maxDist) maxDist = dc;
      }
      for (i = 0; i < atoms.length; i++) {
        var c = atoms[i].cart;
        var da = Math.sqrt(sq(c[0] - center[0]) + sq(c[1] - center[1]) + sq(c[2] - center[2]));
        if (da > maxDist) maxDist = da;
      }
      structure.center = center;
      structure.boundRadius = Math.max(2.0, maxDist + 1.2) * 1.06;
      return structure;
    }
    if (atoms.length === 0) {
      structure.center = [0, 0, 0];
      structure.boundRadius = 8.0;
      return structure;
    }
    var lo = [Infinity, Infinity, Infinity];
    var hi = [-Infinity, -Infinity, -Infinity];
    for (i = 0; i < atoms.length; i++) {
      var p = atoms[i].cart;
      for (var k = 0; k < 3; k++) {
        if (p[k] < lo[k]) lo[k] = p[k];
        if (p[k] > hi[k]) hi[k] = p[k];
      }
    }
    var mid = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
    var maxD = 0;
    for (i = 0; i < atoms.length; i++) {
      var q = atoms[i].cart;
      var d = Math.sqrt(sq(q[0] - mid[0]) + sq(q[1] - mid[1]) + sq(q[2] - mid[2]));
      if (d > maxD) maxD = d;
    }
    var diag = Math.sqrt(sq(hi[0] - lo[0]) + sq(hi[1] - lo[1]) + sq(hi[2] - lo[2]));
    structure.center = mid;
    structure.boundRadius = Math.max(2.5, maxD + 0.8, diag * 0.5 + 0.8);
    return structure;
  }
  function sq(v) { return v * v; }

  /**
   * CL.crystal.finalize(structure)
   * Rebuilds every derived field: sites.cart, atoms, contents, bounds, bonds.
   */
  function finalize(structure) {
    if (!structure) return null;
    var sites = structure.sites || (structure.sites = []);
    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      ensureSite(site, i);
      if (!site.baseLabel) site.baseLabel = site.label;
      if (structure.cell) {
        if (!isFiniteVec(site.frac)) {
          if (isFiniteVec(site.cart)) site.frac = M.wrap01Vec(M.cartToFrac(structure.cell, site.cart));
          else site.frac = [0, 0, 0];
        }
        site.cart = M.fracToCart(structure.cell, site.frac);
      } else {
        if (!isFiniteVec(site.cart)) site.cart = isFiniteVec(site.frac) ? cloneVec(site.frac) : [0, 0, 0];
        if (!site.frac) site.frac = [0, 0, 0];
      }
    }
    expand(structure);
    structure.periodic = !!structure.cell;
    structure.asymmetricAtomCount = sites.length;
    if (!structure.symops) structure.symops = [];
    if (structure.cell) {
      structure.symmetryOperatorCount = structure.symops.length || 1;
    } else if (typeof structure.symmetryOperatorCount !== 'number') {
      structure.symmetryOperatorCount = 1;
    }
    computeContents(structure);
    computeBounds(structure);
    buildBonds(structure);
    return structure;
  }

  // -------------------------------------------------------- display model ---
  /** CL.crystal.fitsSupercell(structure, copies) -> {ok, limited, requested} */
  function fitsSupercell(structure, copies) {
    var nx, ny, nz;
    if (Array.isArray(copies)) { nx = copies[0]; ny = copies[1]; nz = copies[2]; }
    else { nx = copies; ny = copies; nz = copies; }
    nx = clamp01Limit(nx || 1, 1, K_MAX_CELL_REPEATS);
    ny = clamp01Limit(ny || 1, 1, K_MAX_CELL_REPEATS);
    nz = clamp01Limit(nz || 1, 1, K_MAX_CELL_REPEATS);
    var requested = nx * ny * nz;
    var periodic = !!(structure && structure.cell && structure.atoms && structure.atoms.length);
    var ok = true;
    if (periodic && requested > 1) {
      ok = (structure.atoms.length * requested <= K_SUPERCELL_MAX_SITES &&
            (structure.bonds ? structure.bonds.length : 0) * requested <= K_SUPERCELL_MAX_BONDS);
    }
    return { ok: ok, limited: periodic && requested > 1 && !ok, requested: requested };
  }

  function isTransitionMetalRadiusRule(z) { return isTransitionMetal(z); }

  /** Ball-and-stick element base radius (C++: transition metal covalent, else vdw). */
  function baseRadiusOf(z) {
    var e = elementByZ(z);
    return isTransitionMetal(z) ? e.covalent : e.vdw;
  }

  // ---- polyhedra (PolyhedronMesh.cpp: CoordinationMeshes / CoordinationHull) --
  function coordinationHull(ligands) {
    var pts = [];
    for (var i = 0; i < ligands.length; i++) {
      var p = ligands[i];
      var dup = false;
      for (var q = 0; q < pts.length; q++) {
        var dx = p[0] - pts[q][0], dy = p[1] - pts[q][1], dz = p[2] - pts[q][2];
        if (dx * dx + dy * dy + dz * dz < K_HULL_EPS * K_HULL_EPS) { dup = true; break; }
      }
      if (!dup) {
        pts.push(p);
        if (pts.length > K_MAX_COORD_POINTS) return null;
      }
    }
    if (pts.length < 4) return null;
    var hull = M.convexHull3D(pts);
    if (!hull.triangles.length) return null;
    return { points: pts, triangles: hull.triangles, edges: hull.edges };
  }

  /**
   * Port of CoordinationMeshes: per expanded-cell atom index, a coordination hull
   * (or null). Requires a valid cell and a non-empty bond table.
   */
  function buildCoordinationMeshes(structure) {
    var atoms = (structure && structure.atoms) || [];
    var out = new Array(atoms.length);
    for (var i = 0; i < atoms.length; i++) out[i] = null;
    if (!structure || !structure.cell || !structure.bonds || !structure.bonds.length) return out;
    var shells = new Array(atoms.length);
    for (var s = 0; s < atoms.length; s++) shells[s] = [];
    var bonds = structure.bonds;
    for (var b = 0; b < bonds.length; b++) {
      var bond = bonds[b];
      var ba = atoms[bond.a], bb = atoms[bond.b];
      if (!ba || !bb) continue;
      var d = [
        bb.cart[0] + bond.imageOffset[0] - ba.cart[0],
        bb.cart[1] + bond.imageOffset[1] - ba.cart[1],
        bb.cart[2] + bond.imageOffset[2] - ba.cart[2]
      ];
      shells[bond.a].push(d);
      shells[bond.b].push([-d[0], -d[1], -d[2]]);
    }
    var any = false;
    var rounds = [false, true];
    for (var r = 0; r < 2; r++) {
      var ionicCenters = rounds[r];
      var found = false;
      for (var site = 0; site < atoms.length; site++) {
        var z = atoms[site].z | 0;
        if (z === 0) continue;
        if (LIGAND_Z[z]) continue;
        if (isAlkaliOrAlkaline(z) !== ionicCenters) continue;
        if (shells[site].length < 4) continue;
        var hull = coordinationHull(shells[site]);
        out[site] = hull;
        if (hull) found = true;
      }
      if (found) return out;
      // reset any hulls produced in this (empty) round; there must be none when found=false
    }
    return new Array(0); // signals "no mesh at all" like C++ empty outer vector
  }

  /**
   * CL.crystal.buildPolyhedra(displayModel, structure) -> DisplayPolyhedra
   * Copies per-site hull topology to every displayed instance of a center atom.
   */
  function buildPolyhedra(displayModel, structure) {
    var result = { enabled: false, centers: [], triangles: [], edges: [], centerCount: 0 };
    if (!displayModel || !structure || !structure.cell) return result;
    var meshes = buildCoordinationMeshes(structure);
    if (!meshes || meshes.length === 0) return result;

    // Map (siteIndex, symmetryIndex) -> structure atom index.
    var atomIndexByKey = {};
    var atoms = structure.atoms || [];
    for (var i = 0; i < atoms.length; i++) {
      atomIndexByKey[atoms[i].siteIndex + ':' + atoms[i].symmetryIndex] = i;
    }
    var origin = displayModel.origin || structure.center || [0, 0, 0];
    var modelAtoms = displayModel.atoms || [];

    // Estimate output size first (safety cap for huge supercells).
    var centerIds = [];
    var triangleTotal = 0;
    var srcIndexFor = new Int32Array(modelAtoms.length);
    for (var a = 0; a < modelAtoms.length; a++) {
      var key = modelAtoms[a].siteId + ':' + modelAtoms[a].symmetryIndex;
      var srcIndex = atomIndexByKey[key];
      if (srcIndex === undefined) { srcIndexFor[a] = -1; continue; }
      srcIndexFor[a] = srcIndex;
      var mesh = meshes[srcIndex];
      if (mesh) {
        centerIds.push(a);
        triangleTotal += mesh.triangles.length;
      }
    }
    result.centerCount = centerIds.length;
    if (centerIds.length === 0) return result;
    if (centerIds.length > K_MAX_POLY_INSTANCES || triangleTotal > K_MAX_POLY_TRIANGLES) {
      result.limited = true;
      return result;
    }

    var colors = {};
    function colorFor(z) {
      if (!colors[z]) colors[z] = rgbOf(z);
      return colors[z];
    }
    for (var c = 0; c < centerIds.length; c++) {
      var id = centerIds[c];
      var disp = modelAtoms[id];
      var srcAtoms = atoms[srcIndexFor[id]];
      if (!srcAtoms) continue;
      var mesh2 = meshes[srcIndexFor[id]];
      var color = colorFor(srcAtoms.z);
      var px = disp.pos[0], py = disp.pos[1], pz = disp.pos[2];
      var tris = mesh2.triangles;
      for (var t = 0; t < tris.length; t++) {
        var tri = tris[t];
        var pa = mesh2.points[tri.a], pb = mesh2.points[tri.b], pc = mesh2.points[tri.c];
        var v0 = [px + pa[0], py + pa[1], pz + pa[2]];
        var v1 = [px + pb[0], py + pb[1], pz + pb[2]];
        var v2 = [px + pc[0], py + pc[1], pz + pc[2]];
        result.triangles.push({
          v: [v0, v1, v2],
          n: tri.normal,
          center: [(v0[0] + v1[0] + v2[0]) / 3, (v0[1] + v1[1] + v2[1]) / 3, (v0[2] + v1[2] + v2[2]) / 3],
          color: color
        });
      }
      var edges = mesh2.edges;
      for (var e = 0; e < edges.length; e++) {
        var ea = mesh2.points[edges[e][0]], eb = mesh2.points[edges[e][1]];
        result.edges.push({
          p0: [px + ea[0], py + ea[1], pz + ea[2]],
          p1: [px + eb[0], py + eb[1], pz + eb[2]],
          color: K_POLY_EDGE_COLOR
        });
      }
      result.centers.push(id);
    }
    result.enabled = result.triangles.length > 0;
    return result;
  }

  // ------------------------------------------------------ buildDisplayModel --
  /**
   * CL.crystal.buildDisplayModel(structure, opts)
   * opts: {supercell:[nx,ny,nz], showBoundary:boolean, style?, polyhedra?}
   * Always emits the complete display set (interior + boundary images) and the
   * full visible bond list, independent of style (lead 2026-11 decision).
   * Polyhedra geometry is computed only for style==='polyhedral' or polyhedra:true.
   */
  function buildDisplayModel(structure, opts) {
    if (!structure) return null;
    opts = opts || {};
    var cell = structure.cell || null;
    if (!structure.atoms) finalize(structure);
    if (!structure.sites) structure.sites = [];
    var atoms = structure.atoms || [];
    var origin = structure.center ? cloneVec(structure.center) : [0, 0, 0];

    var reqNx = opts.supercell ? opts.supercell[0] : 1;
    var reqNy = opts.supercell ? opts.supercell[1] : 1;
    var reqNz = opts.supercell ? opts.supercell[2] : 1;
    var nx = clamp01Limit(reqNx, 1, K_MAX_CELL_REPEATS);
    var ny = clamp01Limit(reqNy, 1, K_MAX_CELL_REPEATS);
    var nz = clamp01Limit(reqNz, 1, K_MAX_CELL_REPEATS);
    var showBoundary = opts.showBoundary !== false;
    var periodic = !!cell && atoms.length > 0;
    var requested = nx * ny * nz;
    var fits = true;
    if (periodic && requested > 1) {
      fits = (atoms.length * requested <= K_SUPERCELL_MAX_SITES &&
              structure.bonds.length * requested <= K_SUPERCELL_MAX_BONDS);
    }
    var supercellLimited = periodic && requested > 1 && !fits;
    var displayed = (!periodic || supercellLimited) ? [1, 1, 1] : [nx, ny, nz];
    var mx = displayed[0], my = displayed[1], mz = displayed[2];
    var interiorCount = atoms.length * mx * my * mz;

    var modelAtoms = [];
    var imagesAtom = [];       // structure atom index per image
    var imagesTx = [], imagesTy = [], imagesTz = [];
    var copies = new Array(atoms.length);
    for (var ci = 0; ci < atoms.length; ci++) copies[ci] = [];

    function appendImage(atomIndex, cart, tx, ty, tz, selectableKind) {
      var pos = [cart[0] - origin[0], cart[1] - origin[1], cart[2] - origin[2]];
      var src = atoms[atomIndex];
      var id = modelAtoms.length;
      var elem = elementByZ(src.z);
      var fracSuper = [src.frac[0] + tx, src.frac[1] + ty, src.frac[2] + tz];
      var atom = {
        id: id,
        siteId: src.siteIndex | 0,
        symmetryIndex: src.symmetryIndex | 0,
        label: src.label,
        element: src.element,
        z: src.z | 0,
        frac: fracSuper,
        pos: pos,
        color: elem.rgb,
        baseRadius: baseRadiusOf(src.z),
        kind: selectableKind,
        pickable: selectableKind === 'cell'
      };
      modelAtoms.push(atom);
      imagesAtom.push(atomIndex);
      imagesTx.push(tx);
      imagesTy.push(ty);
      imagesTz.push(tz);
      copies[atomIndex].push(id);
      return id;
    }

    // A. original cell atoms first (always present, never dropped by the budget).
    var i;
    for (i = 0; i < atoms.length; i++) appendImage(i, atoms[i].cart, 0, 0, 0, 'cell');

    // B. periodic images over the closed interval [0, N]^3.
    var boundaryBudget = K_MAX_IMAGES - Math.min(K_MAX_IMAGES, interiorCount);
    var boundaryLimited = false;
    var boundaryCount = 0;
    if (periodic) {
      for (i = 0; i < atoms.length; i++) {
        var atom = atoms[i];
        var fx = atom.frac[0], fy = atom.frac[1], fz = atom.frac[2];
        var x0, x1, y0, y1, z0, z1;
        if (showBoundary) {
          x0 = mathCeil(-K_SPACING_EPS - fx); x1 = mathFloor(mx + K_SPACING_EPS - fx);
          y0 = mathCeil(-K_SPACING_EPS - fy); y1 = mathFloor(my + K_SPACING_EPS - fy);
          z0 = mathCeil(-K_SPACING_EPS - fz); z1 = mathFloor(mz + K_SPACING_EPS - fz);
        } else {
          x0 = 0; x1 = mx - 1; y0 = 0; y1 = my - 1; z0 = 0; z1 = mz - 1;
        }
        for (var tx = x0; tx <= x1; tx++) {
          for (var ty = y0; ty <= y1; ty++) {
            for (var tz = z0; tz <= z1; tz++) {
              if (tx === 0 && ty === 0 && tz === 0) continue;
              var outside = (tx < 0 || ty < 0 || tz < 0 || tx >= mx || ty >= my || tz >= mz);
              if (outside) {
                if (boundaryBudget === 0) { boundaryLimited = true; continue; }
                boundaryBudget--;
                boundaryCount++;
              }
              var offset = M.fracToCart(cell, [tx, ty, tz]);
              appendImage(i, [
                atom.cart[0] + offset[0], atom.cart[1] + offset[1], atom.cart[2] + offset[2]
              ], tx, ty, tz, outside ? 'boundary' : 'cell');
            }
          }
        }
      }
    }

    // ---- visible bonds (Renderer.cpp RebuildLines) ----
    var visibleBonds = [];
    if (modelAtoms.length > 0) {
      var SHIFT_BASE = 32;
      var lookup = new Map();
      for (var mi = 0; mi < modelAtoms.length; mi++) {
        var k = ((imagesAtom[mi] * SHIFT_BASE + (imagesTx[mi] + 1)) * SHIFT_BASE + (imagesTy[mi] + 1)) * SHIFT_BASE + (imagesTz[mi] + 1);
        lookup.set(k, mi);
      }
      var bonds = structure.bonds || [];
      for (var bi = 0; bi < bonds.length; bi++) {
        var bond = bonds[bi];
        var bondColor = K_BOND_COLOR;
        var srcList = copies[bond.a];
        if (!srcList) continue;
        for (var li = 0; li < srcList.length; li++) {
          var srcId = srcList[li];
          var endKey = ((bond.b * SHIFT_BASE + (imagesTx[srcId] + bond.shift[0] + 1)) * SHIFT_BASE +
            (imagesTy[srcId] + bond.shift[1] + 1)) * SHIFT_BASE + (imagesTz[srcId] + bond.shift[2] + 1);
          var endId = lookup.get(endKey);
          if (endId === undefined) continue;
          var radius = bond.radius || 0.105;
          var za = atoms[bond.a].z, zb = atoms[bond.b].z;
          if (za === 1 || zb === 1) radius *= 0.82;
          visibleBonds.push({
            id: visibleBonds.length,
            a: srcId,
            b: endId,
            radius: radius,
            color: bondColor,
            periodic: !!bond.periodic
          });
        }
      }
    }

    // ---- cell + axes lines ----
    var lines = [];
    if (cell) {
      function edgePoint(ix, iy, iz) {
        var p = M.fracToCart(cell, [ix, iy, iz]);
        return [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      }
      var y, z, x;
      for (y = 0; y <= my; y++) {
        for (z = 0; z <= mz; z++) {
          lines.push({ p0: edgePoint(0, y, z), p1: edgePoint(mx, y, z), kind: 'cell' });
        }
      }
      for (x = 0; x <= mx; x++) {
        for (z = 0; z <= mz; z++) {
          lines.push({ p0: edgePoint(x, 0, z), p1: edgePoint(x, my, z), kind: 'cell' });
        }
      }
      for (x = 0; x <= mx; x++) {
        for (y = 0; y <= my; y++) {
          lines.push({ p0: edgePoint(x, y, 0), p1: edgePoint(x, y, mz), kind: 'cell' });
        }
      }
      // Axes: from the cell origin along a, b, c (renderer colours by order).
      var o0 = edgePoint(0, 0, 0);
      lines.push({ p0: cloneVec(o0), p1: edgePoint(1, 0, 0), kind: 'axes' });
      lines.push({ p0: cloneVec(o0), p1: edgePoint(0, 1, 0), kind: 'axes' });
      lines.push({ p0: cloneVec(o0), p1: edgePoint(0, 0, 1), kind: 'axes' });
    }

    var model = {
      title: structure.title || '',
      formula: structure.formula || '',
      cellContents: structure.cellContents || '',
      spaceGroup: structure.spaceGroup || '',
      note: structure.note || '',
      format: structure.format || '',
      sourceName: structure.sourceName || '',
      cell: cell,
      supercell: [nx, ny, nz],
      displayedCells: displayed,
      showBoundary: showBoundary,
      origin: origin,
      stats: null,
      atoms: modelAtoms,
      bonds: visibleBonds,
      lines: lines,
      polyhedra: { enabled: false, centers: [], triangles: [], edges: [] },
      hasCell: !!cell,
      truncated: !!structure.truncated
    };

    var computePoly = opts.polyhedra === true ||
      (opts.style === 'polyhedral' && opts.polyhedra !== false);
    if (computePoly) {
      model.polyhedra = buildPolyhedra(model, structure);
    }

    var visibleAtomCount = modelAtoms.length;
    var stats = {
      asymmetricAtomCount: structure.sites ? structure.sites.length : 0,
      symmetryOperatorCount: structure.symmetryOperatorCount || 1,
      cellAtomCount: interiorCount,
      visibleAtomCount: visibleAtomCount,
      boundaryAtomCount: periodic ? boundaryCount : 0,
      visibleBondCount: visibleBonds.length,
      cellBondCount: (structure.bonds || []).length,
      polyhedronCenterCount: 0,
      polyhedronCount: 0,
      polyhedronTriangleCount: 0,
      supercellLimited: supercellLimited,
      boundaryLimited: boundaryLimited
    };
    if (model.polyhedra && model.polyhedra.enabled) {
      stats.polyhedronCenterCount = model.polyhedra.centers.length;
      stats.polyhedronCount = model.polyhedra.centers.length;
      stats.polyhedronTriangleCount = model.polyhedra.triangles.length;
    }
    model.stats = stats;
    return model;
  }

  /**
   * CL.crystal.getVisiblePoints(displayModel) -> Vec3[]
   * Bounds of everything rendered (screen-fit input, C++ Renderer::GetVisiblePoints).
   */
  function getVisiblePoints(model) {
    var points = [];
    if (!model) return points;
    var cell = model.cell;
    if (cell) {
      var n = model.displayedCells || [1, 1, 1];
      for (var i = 0; i < 8; i++) {
        var frac = [(i & 1) ? n[0] : 0, (i & 2) ? n[1] : 0, (i & 4) ? n[2] : 0];
        var p = M.fracToCart(cell, frac);
        points.push([p[0] - model.origin[0], p[1] - model.origin[1], p[2] - model.origin[2]]);
      }
    }
    var atoms = model.atoms || [];
    for (var a = 0; a < atoms.length; a++) {
      var atom = atoms[a];
      var r = atom.radius || atom.baseRadius || 0.5;
      var pos = atom.pos;
      for (var k = 0; k < 8; k++) {
        points.push([
          pos[0] + ((k & 1) ? r : -r),
          pos[1] + ((k & 2) ? r : -r),
          pos[2] + ((k & 4) ? r : -r)
        ]);
      }
    }
    var poly = model.polyhedra;
    if (poly && poly.enabled && poly.triangles) {
      for (var t = 0; t < poly.triangles.length; t++) {
        var tri = poly.triangles[t];
        points.push(tri.v[0], tri.v[1], tri.v[2]);
      }
    }
    return points;
  }

  CL.crystal = {
    // constants (mirrored in docs/spec/core.md §14)
    K_MAX_CELL_REPEATS: K_MAX_CELL_REPEATS,
    K_SUPERCELL_MAX_SITES: K_SUPERCELL_MAX_SITES,
    K_SUPERCELL_MAX_BONDS: K_SUPERCELL_MAX_BONDS,
    K_MAX_IMAGES: K_MAX_IMAGES,
    K_MAX_DISPLAY_ATOMS: K_MAX_DISPLAY_ATOMS,
    K_MAX_BONDS: K_MAX_BONDS,
    K_MAX_COORD_POINTS: K_MAX_COORD_POINTS,
    // geometry / structure pipeline
    expand: expand,
    buildBonds: buildBonds,
    finalize: finalize,
    computeContents: computeContents,
    computeBounds: computeBounds,
    fitsSupercell: fitsSupercell,
    buildDisplayModel: buildDisplayModel,
    buildPolyhedra: buildPolyhedra,
    buildCoordinationMeshes: buildCoordinationMeshes,
    getVisiblePoints: getVisiblePoints,
    // element helpers shared with edit/export/renderer
    elementByZ: elementByZ,
    symbolOf: symbolOf,
    rgbOf: rgbOf,
    baseRadiusOf: baseRadiusOf,
    isTransitionMetal: isTransitionMetal,
    pairBondCutoff: pairBondCutoff,
    applySymOp: applySymOp,
    identityOp: identityOp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
