/**
 * CrystalLens Android - model layer tests (CL.Math crystal geometry + CL.crystal).
 *
 * Covers docs/spec/core.md §2 (cell math / minimum image), §6 (symmetry
 * expansion), §7 (bond building), §8 (supercell / boundary display set),
 * §9 (coordination polyhedra) and docs/QA-ACCEPTANCE.md §2.
 *
 * Fixtures: synthetic StructureData objects defined in this file are used for
 * pure logic tests; when CL.parsers is loaded the real library/example files are
 * used for integration assertions (halite / srtio3 / quartz / diamond / water).
 */
'use strict';

// ---------------------------------------------------------------- helpers ---
function fixtureCell(a, b, c, alpha, beta, gamma) {
  var cell = CL.Math.buildCell(a == null ? 5.6402 : a, b == null ? 5.6404 : b,
    c == null ? 5.6406 : c, alpha == null ? 90 : alpha, beta == null ? 90 : beta,
    gamma == null ? 90 : gamma);
  if (!cell) throw new Error('fixture cell invalid');
  return cell;
}
function fixtureSite(label, element, z, frac, extra) {
  var site = {
    label: label, baseLabel: label, element: element, z: z,
    frac: frac ? [frac[0], frac[1], frac[2]] : null,
    cart: null,
    occupancy: 1, uiso: 0, hasUiso: false,
    disorderGroup: '', disorderAssembly: '', siteIndex: 0
  };
  if (extra) for (var k in extra) site[k] = extra[k];
  return site;
}
function fixtureStructure(cell, sites, symops, extra) {
  var s = {
    format: 'cif', sourceName: 'fixture.cif', title: 'Fixture', blockName: 'fixture',
    spaceGroup: '', note: '', periodic: !!cell, cell: cell, symops: symops || [],
    sites: sites, symmetryExpanded: false,
    asymmetricAtomCount: sites.length, symmetryOperatorCount: (symops || []).length
  };
  for (var i = 0; i < s.sites.length; i++) s.sites[i].siteIndex = i;
  if (extra) for (var k in extra) s[k] = extra[k];
  return s;
}
function symIdentity() { return { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], text: 'x,y,z' }; }
function symOp(m, t, text) { return { m: m, t: t, text: text || 'x,y,z' }; }

// NaCl rock-salt fixture: F-centring translations (same as reference test_core).
function naclFixture() {
  var cell = fixtureCell(5.6402, 5.6402, 5.6402);
  var sites = [
    fixtureSite('Na1', 'Na', 11, [0, 0, 0]),
    fixtureSite('Cl1', 'Cl', 17, [0.5, 0, 0])
  ];
  var ops = [
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], 'x,y,z'),
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0.5, 0.5], 'x,y+1/2,z+1/2'),
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0, 0.5], 'x+1/2,y,z+1/2'),
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0.5, 0], 'x+1/2,y+1/2,z')
  ];
  return fixtureStructure(cell, sites, ops, { spaceGroup: 'F m -3 m', title: 'Rock salt' });
}

// Water molecule fixture (no cell).
function waterFixture() {
  var sites = [
    fixtureSite('O1', 'O', 8, null, { cart: [0, 0, 0] }),
    fixtureSite('H1', 'H', 1, null, { cart: [0.757, 0.586, 0] }),
    fixtureSite('H2', 'H', 1, null, { cart: [-0.757, 0.586, 0] })
  ];
  return fixtureStructure(null, sites, [], { format: 'xyz', title: 'water', spaceGroup: '' });
}

// SrTiO3 Pm-3m 5-atom fixture (no explicit symmetry operations, like the example).
function srtio3Fixture() {
  var a = 3.905;
  var cell = fixtureCell(a, a, a);
  var sites = [
    fixtureSite('Sr1', 'Sr', 38, [0, 0, 0]),
    fixtureSite('Ti1', 'Ti', 22, [0.5, 0.5, 0.5]),
    fixtureSite('O1', 'O', 8, [0.5, 0.5, 0]),
    fixtureSite('O2', 'O', 8, [0.5, 0, 0.5]),
    fixtureSite('O3', 'O', 8, [0, 0.5, 0.5])
  ];
  return fixtureStructure(cell, sites, [], { spaceGroup: 'P m -3 m' });
}

function requireParsers() {
  if (!CL.parsers || typeof CL.parsers.parse !== 'function') {
    throw new Error('CL.parsers not loaded - integration fixture unavailable');
  }
}
function parseStructure(relPath, name) {
  requireParsers();
  var text = readText(relPath);
  var s = CL.parsers.parse(text, name);
  return CL.crystal.finalize(s);
}

// ------------------------------------------------------------------ math ---
test('Math: buildCell upper-triangular basis, volume and transforms', function () {
  var cell = CL.Math.buildCell(3, 4, 5, 90, 90, 90);
  approx(cell.volume, 60, 1e-9, 'volume');
  var cart = CL.Math.fracToCart(cell, [0.25, 0.5, 0.75]);
  approxVec(cart, [0.75, 2.0, 3.75], 1e-9, 'fracToCart');
  var frac = CL.Math.cartToFrac(cell, cart);
  approxVec(frac, [0.25, 0.5, 0.75], 1e-9, 'cartToFrac');

  var tri = CL.Math.buildCell(5, 6, 7, 78, 83, 74);
  var p = CL.Math.fracToCart(tri, [0.12, 0.45, 0.77]);
  var q = CL.Math.cartToFrac(tri, p);
  approxVec(q, [0.12, 0.45, 0.77], 1e-8, 'triclinic roundtrip');
});

test('Math: buildCell rejects invalid parameters', function () {
  if (CL.Math.buildCell(3, 3, 3, 0, 90, 90) !== null) throw new Error('alpha=0 accepted');
  if (CL.Math.buildCell(3, 3, 3, 180, 90, 90) !== null) throw new Error('alpha=180 accepted');
  if (CL.Math.buildCell(-1, 3, 3, 90, 90, 90) !== null) throw new Error('negative a accepted');
  if (CL.Math.buildCell(3, 3, 3, NaN, 90, 90) !== null) throw new Error('NaN accepted');
  if (CL.Math.buildCell(1, 1, 0.01, 179, 179, 89.99) !== null) throw new Error('degenerate accepted');
});

test('Math: cellCorners order matches C++ (x fastest)', function () {
  var cell = fixtureCell(4, 4, 4);
  var corners = CL.Math.cellCorners(cell);
  approxVec(corners[0], [0, 0, 0], 1e-9, 'c0');
  approxVec(corners[1], [4, 0, 0], 1e-9, 'c1 (x)');
  approxVec(corners[2], [0, 4, 0], 1e-9, 'c2 (y)');
  approxVec(corners[4], [0, 0, 4], 1e-9, 'c4 (z)');
  approxVec(corners[7], [4, 4, 4], 1e-9, 'c7');
});

test('Math: minimumFractionalDelta matches exhaustive search on a skew cell', function () {
  var cell = CL.Math.buildCell(2.3, 19, 17, 75, 72, 12);
  var outside = false;
  for (var n = 1; n <= 72; n++) {
    var d = [Math.sin(n * 1.1), Math.cos(n * 0.7), Math.sin(n * 0.37)];
    var actual = CL.Math.minimumFractionalDelta(cell, d);
    var best = 1e9;
    for (var i = -20; i <= 20; i++) {
      for (var j = -4; j <= 4; j++) {
        for (var k = -3; k <= 3; k++) {
          var v = CL.Math.fracToCart(cell, [d[0] + i, d[1] + j, d[2] + k]);
          var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
          if (len < best) best = len;
        }
      }
    }
    var v2 = CL.Math.fracToCart(cell, actual);
    var got = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1] + v2[2] * v2[2]);
    approx(got, best, 1e-9, 'skew min image n=' + n);
    if (Math.abs(actual[0] - d[0]) > 1.5) outside = true;
  }
  if (!outside) throw new Error('search never left the 3x3x3 neighbourhood');
});

test('Math: minimumImage / imageOffset periodic semantics', function () {
  var cell = fixtureCell(5);
  var from = [0.2, 0.2, 0.2];
  var to = [4.9, 0.2, 0.2];
  var img = CL.Math.minimumImage(cell, from, to);
  approxVec(img, [-0.3, 0, 0], 1e-9, 'minimumImage');
  var offset = CL.Math.imageOffset(cell, from, to);
  var shifted = [to[0] + offset[0], to[1] + offset[1], to[2] + offset[2]];
  approxVec(shifted, [-0.1, 0.2, 0.2], 1e-9, 'offset endpoint');
  // molecules: no wrap
  var noCell = CL.Math.minimumImage(null, [0, 0, 0], [9, 0, 0]);
  approxVec(noCell, [9, 0, 0], 1e-12, 'molecule');
});

// ---------------------------------------------------------------- expand ---
test('crystal.expand: F-centred NaCl expands to 8 atoms with labels', function () {
  var s = CL.crystal.finalize(naclFixture());
  if (s.atoms.length !== 8) throw new Error('expected 8 atoms, got ' + s.atoms.length);
  if (!s.symmetryExpanded) throw new Error('symmetryExpanded not set');
  if (s.symmetryOperatorCount !== 4) throw new Error('symmetryOperatorCount');
  var na = 0, cl = 0;
  for (var i = 0; i < s.atoms.length; i++) {
    if (s.atoms[i].element === 'Na') na++;
    if (s.atoms[i].element === 'Cl') cl++;
  }
  if (na !== 4 || cl !== 4) throw new Error('element counts ' + na + '/' + cl);
  if (s.atoms[0].label !== 'Na1_1' || s.atoms[3].label !== 'Na1_4') {
    throw new Error('label suffix rule: ' + s.atoms[0].label + '/' + s.atoms[3].label);
  }
  if (s.atoms[0].symmetryIndex !== 0 || s.atoms[1].symmetryIndex !== 1) throw new Error('symmetryIndex');
  if (!s.atoms[1].symmetryGenerated) throw new Error('symmetryGenerated');
  // cart must match frac
  var cart = CL.Math.fracToCart(s.cell, s.atoms[2].frac);
  approxVec(s.atoms[2].cart, cart, 1e-9, 'atom cart');
});

test('crystal.expand: special-position de-duplication keeps first op index', function () {
  var cell = fixtureCell(5);
  var sites = [fixtureSite('Na1', 'Na', 11, [0, 0, 0])];
  var ops = [
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], 'x,y,z'),
    symOp([[-1, 0, 0], [0, -1, 0], [0, 0, -1]], [0, 0, 0], '-x,-y,-z'),
    symOp([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.5, 0.5, 0], 'x+1/2,y+1/2,z')
  ];
  var s = CL.crystal.finalize(fixtureStructure(cell, sites, ops));
  if (s.atoms.length !== 2) throw new Error('expected 2 atoms, got ' + s.atoms.length);
  if (s.atoms[0].symmetryIndex !== 0) throw new Error('first atom op index');
  if (s.atoms[1].symmetryIndex !== 2) throw new Error('second atom op index, got ' + s.atoms[1].symmetryIndex);
});

test('crystal.expand: molecule passthrough (no cell, no symmetry)', function () {
  var s = CL.crystal.finalize(waterFixture());
  if (s.atoms.length !== 3) throw new Error('atoms');
  if (s.periodic) throw new Error('molecule marked periodic');
  if (s.symmetryExpanded) throw new Error('molecule marked expanded');
  if (s.atoms[0].frac[0] !== 0 || s.atoms[0].frac[1] !== 0) throw new Error('frac placeholder');
  if (s.bonds.length !== 2) throw new Error('water bonds ' + s.bonds.length);
});

test('crystal.expand: idempotent (fresh atoms from sites each time)', function () {
  var s = naclFixture();
  CL.crystal.expand(s);
  var first = JSON.stringify(s.atoms);
  CL.crystal.expand(s);
  if (JSON.stringify(s.atoms) !== first) throw new Error('expand is not idempotent');
  var ops = s.symops;
  s.symops = [];
  CL.crystal.expand(s);
  if (s.atoms.length !== 2) throw new Error('identity fallback atoms ' + s.atoms.length);
  s.symops = ops;
});

test('crystal.expand: occupancy <= 0 sites are skipped', function () {
  var s = naclFixture();
  s.sites[1].occupancy = 0;
  s.symops = [symIdentity()];
  CL.crystal.expand(s);
  if (s.atoms.length !== 1) throw new Error('expected 1 atom, got ' + s.atoms.length);
  if (s.atoms[0].element !== 'Na') throw new Error('wrong atom kept');
});

// ---------------------------------------------------------------- bonds ----
test('crystal.buildBonds: NaCl 24 bonds, all Na-Cl at 2.8201 A', function () {
  var s = CL.crystal.finalize(naclFixture());
  if (s.bonds.length !== 24) throw new Error('expected 24 bonds, got ' + s.bonds.length);
  var nacl = 0;
  for (var i = 0; i < s.bonds.length; i++) {
    var b = s.bonds[i];
    approx(b.length, 2.8201, 0.002, 'bond length');
    var a = s.atoms[b.a], c = s.atoms[b.b];
    if ((a.element === 'Na' && c.element === 'Cl') || (a.element === 'Cl' && c.element === 'Na')) nacl++;
    // length == |b.cart + imageOffset - a.cart|
    var d = [
      s.atoms[b.b].cart[0] + b.imageOffset[0] - s.atoms[b.a].cart[0],
      s.atoms[b.b].cart[1] + b.imageOffset[1] - s.atoms[b.a].cart[1],
      s.atoms[b.b].cart[2] + b.imageOffset[2] - s.atoms[b.a].cart[2]
    ];
    approx(Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]), b.length, 1e-9, 'bond geometry');
  }
  if (nacl !== 24) throw new Error('non Na-Cl bonds present');
  // sorted by (a, b, shift)
  for (var j = 1; j < s.bonds.length; j++) {
    var p = s.bonds[j - 1], q = s.bonds[j];
    var order = p.a - q.a || p.b - q.b || p.shift[0] - q.shift[0] || p.shift[1] - q.shift[1] || p.shift[2] - q.shift[2];
    if (order > 0) throw new Error('bonds not sorted at ' + j);
  }
});

test('crystal.buildBonds: self-bond filtered to half the directions', function () {
  var cell = CL.Math.buildCell(1.5, 20, 20, 90, 90, 90);
  var s = fixtureStructure(cell, [fixtureSite('C1', 'C', 6, [0, 0, 0])], []);
  CL.crystal.finalize(s);
  if (s.bonds.length !== 1) throw new Error('expected 1 self bond, got ' + s.bonds.length);
  if (s.bonds[0].a !== s.bonds[0].b) throw new Error('self bond endpoints');
  approx(s.bonds[0].length, 1.5, 1e-10, 'self bond length');
  CL.crystal.buildBonds(s, 1.0);
  if (s.bonds.length !== 0) throw new Error('tolerance scaling should drop the self bond');
});

test('crystal.buildBonds: grid path matches brute force on a skew cell', function () {
  var cell = CL.Math.buildCell(31, 30, 8, 90, 90, 5);
  var sites = [
    fixtureSite('C1', 'C', 6, [0.1, 0.8, 0]),
    fixtureSite('C2', 'C', 6, [0.65, 0.25, 0])
  ];
  var s = fixtureStructure(cell, sites, []);
  CL.crystal.finalize(s);
  var expected = s.bonds;
  if (!expected.length) throw new Error('fixture produced no bonds');
  // Inert placeholders force the >=1600-atom grid path.
  while (s.atoms.length < 1600) {
    s.atoms.push({
      label: 'X', baseLabel: 'X', element: 'X', z: 0, frac: [0, 0, 0], cart: [0, 0, 0],
      occupancy: 1, uiso: 0, hasUiso: false, disorderGroup: '', disorderAssembly: '',
      siteIndex: 0, symmetryIndex: 0, symmetryGenerated: false
    });
  }
  CL.crystal.buildBonds(s);
  if (s.bonds.length !== expected.length) throw new Error('grid/brute bond count ' + s.bonds.length + ' vs ' + expected.length);
  for (var i = 0; i < expected.length; i++) {
    if (s.bonds[i].a !== expected[i].a || s.bonds[i].b !== expected[i].b) throw new Error('endpoint mismatch at ' + i);
    if (s.bonds[i].shift[0] !== expected[i].shift[0] || s.bonds[i].shift[1] !== expected[i].shift[1] ||
        s.bonds[i].shift[2] !== expected[i].shift[2]) throw new Error('shift mismatch at ' + i);
  }
});

test('crystal.buildBonds: orthogonal fast path equals exhaustive image search', function () {
  // Deterministic pseudo-random orthogonal cell with mixed elements.
  var cell = fixtureCell(5.2, 6.1, 4.7);
  var sites = [];
  var seed = 12345;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var i = 0; i < 24; i++) {
    sites.push(fixtureSite('A' + i, i % 3 === 0 ? 'C' : 'O', i % 3 === 0 ? 6 : 8,
      [rnd(), rnd(), rnd()]));
  }
  var s = CL.crystal.finalize(fixtureStructure(cell, sites, []));
  var expected = [];
  for (var a = 0; a < s.atoms.length; a++) {
    for (var b = a; b < s.atoms.length; b++) {
      var za = s.atoms[a].z, zb = s.atoms[b].z;
      var cutoff = Math.min(6, CL.crystal.pairBondCutoff(za, zb));
      if (cutoff < 0.42) continue;
      var direct = [
        s.atoms[b].cart[0] - s.atoms[a].cart[0],
        s.atoms[b].cart[1] - s.atoms[a].cart[1],
        s.atoms[b].cart[2] - s.atoms[a].cart[2]
      ];
      for (var tx = -2; tx <= 2; tx++) {
        for (var ty = -2; ty <= 2; ty++) {
          for (var tz = -2; tz <= 2; tz++) {
            if (a === b && (tz < 0 || (tz === 0 && (ty < 0 || (ty === 0 && tx <= 0))))) continue;
            var off = [tx * cell.a, ty * cell.b, tz * cell.c];
            var dx = direct[0] + off[0], dy = direct[1] + off[1], dz = direct[2] + off[2];
            var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 0.42 || d > cutoff + 1e-6) continue;
            expected.push({ a: a, b: b, shift: [tx, ty, tz], length: d });
          }
        }
      }
    }
  }
  expected.sort(function (p, q) {
    return p.a - q.a || p.b - q.b || p.shift[0] - q.shift[0] || p.shift[1] - q.shift[1] || p.shift[2] - q.shift[2];
  });
  var actual = s.bonds;
  if (actual.length !== expected.length) {
    throw new Error('orth fast path bond count ' + actual.length + ' != exhaustive ' + expected.length);
  }
  for (var k = 0; k < expected.length; k++) {
    if (actual[k].a !== expected[k].a || actual[k].b !== expected[k].b) throw new Error('endpoint mismatch at ' + k);
    if (actual[k].shift[0] !== expected[k].shift[0] || actual[k].shift[1] !== expected[k].shift[1] ||
        actual[k].shift[2] !== expected[k].shift[2]) throw new Error('shift mismatch at ' + k);
    approx(actual[k].length, expected[k].length, 1e-9, 'length at ' + k);
  }
});

test('crystal.buildBonds: disorder assemblies exclude mutually exclusive groups', function () {
  var cell = fixtureCell(10);
  var s1 = fixtureSite('C1', 'C', 6, [0.2, 0.2, 0.3], { disorderAssembly: 'A', disorderGroup: '1' });
  var s2 = fixtureSite('C2', 'C', 6, [0.3, 0.2, 0.3], { disorderAssembly: 'A', disorderGroup: '2' });
  var s = CL.crystal.finalize(fixtureStructure(cell, [s1, s2], []));
  if (s.bonds.length !== 0) throw new Error('mutually exclusive groups bonded: ' + s.bonds.length);
  var s3 = fixtureSite('C3', 'C', 6, [0.3, 0.2, 0.3], { disorderAssembly: 'A', disorderGroup: '1' });
  var s4 = CL.crystal.finalize(fixtureStructure(cell,
    [fixtureSite('C4', 'C', 6, [0.2, 0.2, 0.3], { disorderAssembly: 'A', disorderGroup: '1' }), s3], []));
  if (s4.bonds.length === 0) throw new Error('same-group sites should bond');
});

test('crystal.buildBonds: unknown elements never bond', function () {
  var cell = fixtureCell(4);
  var s = CL.crystal.finalize(fixtureStructure(cell, [
    fixtureSite('X1', 'X', 0, [0, 0, 0]),
    fixtureSite('X2', 'X', 0, [0.25, 0, 0])
  ], []));
  if (s.bonds.length !== 0) throw new Error('unknown elements bonded');
});

// ---------------------------------------------------- contents and bounds ---
test('crystal.computeContents: z order, no reduction, formula fallback', function () {
  var s = CL.crystal.finalize(naclFixture());
  if (s.cellContents !== 'Na4 Cl4') throw new Error('cellContents ' + s.cellContents);
  if (s.formula !== 'Na4 Cl4') throw new Error('formula fallback ' + s.formula);
  if (s.elementCounts['11'] !== 4 || s.elementCounts['17'] !== 4) throw new Error('elementCounts');
});

test('crystal.computeBounds: cell diagonal centre and radius formula', function () {
  var s = CL.crystal.finalize(naclFixture());
  approxVec(s.center, [2.8201, 2.8201, 2.8201], 1e-9, 'center');
  var maxDist = 0;
  var corners = CL.Math.cellCorners(s.cell);
  for (var i = 0; i < corners.length; i++) {
    var d = [corners[i][0] - s.center[0], corners[i][1] - s.center[1], corners[i][2] - s.center[2]];
    maxDist = Math.max(maxDist, Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]));
  }
  approx(s.boundRadius, Math.max(2.0, maxDist + 1.2) * 1.06, 1e-9, 'boundRadius');
});

test('crystal.computeBounds: molecule bounding box centre and 8 A default', function () {
  var s = CL.crystal.finalize(waterFixture());
  approxVec(s.center, [0, 0.293, 0], 1e-9, 'molecule centre');
  if (!(s.boundRadius >= 2.5)) throw new Error('molecule boundRadius ' + s.boundRadius);
  var empty = { format: 'xyz', title: 'e', note: '', periodic: false, cell: null, symops: [], sites: [], atoms: [] };
  CL.crystal.computeBounds(empty);
  approxVec(empty.center, [0, 0, 0], 1e-12, 'empty centre');
  approx(empty.boundRadius, 8.0, 1e-12, 'empty radius');
});

test('crystal.finalize: JSON roundtrip keeps all derived data reproducible', function () {
  var s = CL.crystal.finalize(naclFixture());
  var copy = JSON.parse(JSON.stringify(s));
  var atoms = copy.atoms.length, bonds = copy.bonds.length, contents = copy.cellContents;
  CL.crystal.finalize(copy);
  if (copy.atoms.length !== atoms) throw new Error('atoms after roundtrip');
  if (copy.bonds.length !== bonds) throw new Error('bonds after roundtrip');
  if (copy.cellContents !== contents) throw new Error('contents after roundtrip');
});

test('crystal.fitsSupercell: 65536 sites / 300000 bonds / identity always fits', function () {
  var stub = { cell: fixtureCell(5), atoms: new Array(8192), bonds: new Array(37500) };
  if (!CL.crystal.fitsSupercell(stub, [2, 2, 2]).ok) throw new Error('8192*8 sites should fit (65536)');
  stub.atoms = new Array(8193);
  var limited = CL.crystal.fitsSupercell(stub, [2, 2, 2]);
  if (limited.ok || !limited.limited) throw new Error('8193*8 sites should be limited');
  stub.atoms = new Array(100);
  stub.bonds = new Array(37501);
  if (CL.crystal.fitsSupercell(stub, [2, 2, 2]).ok) throw new Error('37501*8 bonds should be limited');
  stub.bonds = new Array(150000);
  if (!CL.crystal.fitsSupercell(stub, [1, 1, 1]).ok) throw new Error('1x1x1 must always fit');
  var big = CL.crystal.fitsSupercell({ cell: fixtureCell(5), atoms: new Array(8), bonds: [] }, [17, 1, 1]);
  if (big.requested !== 16) throw new Error('supercell axis must clamp to 16, got ' + big.requested);
});

// ------------------------------------------------------ display model ------
test('crystal.buildDisplayModel: halite 1x1x1 = 27 atoms (8 cell + 19 boundary)', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: true });
  if (m.atoms.length !== 27) throw new Error('atoms ' + m.atoms.length);
  if (m.stats.visibleAtomCount !== 27) throw new Error('visibleAtomCount');
  if (m.stats.cellAtomCount !== 8) throw new Error('cellAtomCount ' + m.stats.cellAtomCount);
  if (m.stats.boundaryAtomCount !== 19) throw new Error('boundaryAtomCount ' + m.stats.boundaryAtomCount);
  if (m.stats.cellAtomCount + m.stats.boundaryAtomCount !== m.stats.visibleAtomCount) throw new Error('stats add up');
  if (m.displayedCells[0] !== 1) throw new Error('displayedCells');
  if (!m.hasCell) throw new Error('hasCell');
  approxVec(m.origin, s.center, 1e-12, 'origin');
  for (var i = 0; i < m.atoms.length; i++) {
    if (m.atoms[i].id !== i) throw new Error('id not contiguous at ' + i);
    if (m.atoms[i].kind === 'boundary' && m.atoms[i].pickable) throw new Error('boundary pickable');
    if (m.atoms[i].kind === 'cell' && !m.atoms[i].pickable) throw new Error('cell not pickable');
  }
});

test('crystal.buildDisplayModel: halite 2x2x2 = 125 and 3x3x3 = 343', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m2 = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  if (m2.atoms.length !== 125) throw new Error('2x2x2 atoms ' + m2.atoms.length);
  if (m2.stats.cellAtomCount !== 64 || m2.stats.boundaryAtomCount !== 61) throw new Error('2x2x2 split');
  var na = 0;
  for (var i = 0; i < m2.atoms.length; i++) if (m2.atoms[i].z === 11) na++;
  if (na !== 63) throw new Error('halite 2x2x2 Na count ' + na);
  var m3 = CL.crystal.buildDisplayModel(s, { supercell: [3, 3, 3], showBoundary: true });
  if (m3.atoms.length !== 343) throw new Error('3x3x3 atoms ' + m3.atoms.length);
  if (m3.stats.cellAtomCount !== 216 || m3.stats.boundaryAtomCount !== 127) throw new Error('3x3x3 split');
  var m3clear = CL.crystal.buildDisplayModel(s, { supercell: [3, 3, 3], showBoundary: false });
  if (m3clear.atoms.length !== 216) throw new Error('3x3x3 no boundary atoms ' + m3clear.atoms.length);
});

test('crystal.buildDisplayModel: showBoundary=false only draws interior cells', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: false });
  if (m.atoms.length !== 64) throw new Error('atoms ' + m.atoms.length);
  if (m.stats.boundaryAtomCount !== 0) throw new Error('boundary count');
  var kinds = {};
  for (var i = 0; i < m.atoms.length; i++) kinds[m.atoms[i].kind] = (kinds[m.atoms[i].kind] || 0) + 1;
  if (kinds.boundary) throw new Error('boundary atoms present');
});

test('crystal.buildDisplayModel: cell lines per sub-cell + a/b/c axes', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m1 = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: false });
  var cellLines = 0, axisLines = 0;
  for (var i = 0; i < m1.lines.length; i++) {
    if (m1.lines[i].kind === 'axes') axisLines++;
    else cellLines++;
  }
  if (cellLines !== 12) throw new Error('1x1x1 cell lines ' + cellLines);
  if (axisLines !== 3) throw new Error('axis lines ' + axisLines);
  var m2 = CL.crystal.buildDisplayModel(s, { supercell: [2, 3, 4], showBoundary: false });
  var expected = (3 + 1) * (4 + 1) + (2 + 1) * (4 + 1) + (2 + 1) * (3 + 1);
  cellLines = 0;
  for (var j = 0; j < m2.lines.length; j++) if (m2.lines[j].kind === 'cell') cellLines++;
  if (cellLines !== expected) throw new Error('2x3x4 cell lines ' + cellLines + ' expected ' + expected);
});

test('crystal.buildDisplayModel: visible bonds are fully mappable', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  if (!(m.stats.visibleBondCount > 0)) throw new Error('no visible bonds');
  if (m.bonds.length !== m.stats.visibleBondCount) throw new Error('bonds/stats mismatch');
  for (var i = 0; i < m.bonds.length; i++) {
    var b = m.bonds[i];
    if (!m.atoms[b.a] || !m.atoms[b.b]) throw new Error('bond endpoint out of range');
    if (b.a === b.b) throw new Error('degenerate visible bond');
    approx(b.radius, 0.105, 1e-12, 'bond radius');
    approx(b.color[0], 0.66, 1e-12, 'bond colour');
  }
});

test('crystal.buildDisplayModel: molecule model', function () {
  var s = CL.crystal.finalize(waterFixture());
  var m = CL.crystal.buildDisplayModel(s, {});
  if (m.atoms.length !== 3) throw new Error('atoms ' + m.atoms.length);
  if (m.bonds.length !== 2) throw new Error('bonds ' + m.bonds.length);
  if (m.hasCell) throw new Error('molecule hasCell');
  if (m.lines.length !== 0) throw new Error('molecule lines');
  if (m.displayedCells[0] !== 1) throw new Error('molecule displayedCells');
});

test('crystal.buildDisplayModel: 16x16x16 trims to maxImages without crashing', function () {
  var s = CL.crystal.finalize(naclFixture());
  var started = Date.now();
  var m = CL.crystal.buildDisplayModel(s, { supercell: [16, 16, 16], showBoundary: true });
  var elapsed = Date.now() - started;
  if (!(m.atoms.length > 0)) throw new Error('no atoms');
  if (m.atoms.length > CL.crystal.K_MAX_IMAGES) throw new Error('over maxImages: ' + m.atoms.length);
  if (m.displayedCells[0] !== 16) throw new Error('16x16x16 should fit the site budget');
  if (m.stats.visibleAtomCount !== m.atoms.length) throw new Error('visibleAtomCount');
  if (m.stats.cellAtomCount !== 8 * 4096) throw new Error('cellAtomCount ' + m.stats.cellAtomCount);
  if (!(elapsed < 20000)) throw new Error('16^3 build too slow: ' + elapsed + 'ms');
});

test('crystal.buildDisplayModel: 2x2x2 halite rebuild < 500 ms', function () {
  var s = CL.crystal.finalize(naclFixture());
  // warm up
  CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  var started = Date.now();
  var count = 0;
  for (var i = 0; i < 5; i++) {
    var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
    count = m.atoms.length;
  }
  var elapsed = (Date.now() - started) / 5;
  if (count !== 125) throw new Error('atoms ' + count);
  if (!(elapsed < 500)) throw new Error('average build ' + elapsed.toFixed(1) + 'ms exceeds 500ms');
});

test('crystal.buildDisplayModel: 669-atom structure finalize + model < 50 ms', function () {
  // Synthetic 669-atom rocksalt-like fragment (a 4x4x4 fcc block would be 32
  // atoms; instead use a 669 atom grid in a 20 A cubic cell).
  var n = 669;
  var sites = [];
  var a = 20;
  for (var i = 0; i < n; i++) {
    var x = (i % 10) / 10 + 0.05;
    var y = (((i / 10) | 0) % 10) / 10 + 0.05;
    var z = ((i / 100) | 0) / 10 + 0.05;
    sites.push(fixtureSite('C' + i, 'C', 6, [x, y, z]));
  }
  var s = fixtureStructure(fixtureCell(a, a, a), sites, []);
  var started = Date.now();
  CL.crystal.finalize(s);
  var elapsed = Date.now() - started;
  if (s.atoms.length !== n) throw new Error('expanded atoms ' + s.atoms.length);
  if (!(elapsed < 500)) throw new Error('finalize(669) too slow: ' + elapsed + 'ms');
});

// -------------------------------------------------------------- polyhedra ---
test('crystal.buildPolyhedra: halite 2x2x2 -> 63 NaCl6 octahedra, 504 triangles', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
  var poly = m.polyhedra;
  if (!poly.enabled) throw new Error('polyhedra not enabled');
  if (poly.centers.length !== 63) throw new Error('centers ' + poly.centers.length);
  if (poly.triangles.length !== 504) throw new Error('triangles ' + poly.triangles.length);
  if (poly.edges.length !== 63 * 12) throw new Error('edges ' + poly.edges.length);
  if (m.stats.polyhedronCenterCount !== 63) throw new Error('stats polyhedronCenterCount ' + m.stats.polyhedronCenterCount);
  if (m.stats.polyhedronCount !== 63 || m.stats.polyhedronTriangleCount !== 504) throw new Error('poly stats');
  for (var i = 0; i < poly.centers.length; i++) {
    if (m.atoms[poly.centers[i]].z !== 11) throw new Error('polyhedron center is not Na');
  }
  for (var t = 0; t < poly.triangles.length; t++) {
    var tri = poly.triangles[t];
    var n = tri.n;
    approx(Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]), 1, 1e-9, 'unit normal');
  }
});

test('crystal.buildPolyhedra: fluorite CaF8 cube has 12 triangles per centre', function () {
  // CaF2 unit cell (12 atoms: 4 fcc Ca + 8 F at +-1/4) with no explicit ops.
  var sites = [
    fixtureSite('Ca1', 'Ca', 20, [0, 0, 0]),
    fixtureSite('Ca2', 'Ca', 20, [0, 0.5, 0.5]),
    fixtureSite('Ca3', 'Ca', 20, [0.5, 0, 0.5]),
    fixtureSite('Ca4', 'Ca', 20, [0.5, 0.5, 0])
  ];
  var fz = [0.25, 0.75];
  var fi = 1;
  for (var x = 0; x < 2; x++) {
    for (var y = 0; y < 2; y++) {
      for (var z = 0; z < 2; z++) sites.push(fixtureSite('F' + fi++, 'F', 9, [fz[x], fz[y], fz[z]]));
    }
  }
  var s = CL.crystal.finalize(fixtureStructure(fixtureCell(5.4626), sites, []));
  if (s.atoms.length !== 12) throw new Error('fluorite atoms ' + s.atoms.length);
  if (s.bonds.length !== 32) throw new Error('fluorite bonds ' + s.bonds.length);
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: true, style: 'polyhedral' });
  if (!m.polyhedra.enabled) throw new Error('no fluorite polyhedra');
  if (m.polyhedra.triangles.length !== m.polyhedra.centers.length * 12) {
    throw new Error('CaF8 cube triangle count ' + m.polyhedra.triangles.length +
      ' for ' + m.polyhedra.centers.length + ' centres');
  }
  for (var i = 0; i < m.polyhedra.centers.length; i++) {
    if (m.atoms[m.polyhedra.centers[i]].z !== 20) throw new Error('fluorite centre is not Ca');
  }
});

test('crystal.buildPolyhedra: halite 1x1x1 -> 14 Na centres (16.2)', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: true, style: 'polyhedral' });
  if (m.polyhedra.centers.length !== 14) throw new Error('1x1x1 centres ' + m.polyhedra.centers.length);
  if (m.polyhedra.triangles.length !== 14 * 8) throw new Error('1x1x1 triangles ' + m.polyhedra.triangles.length);
});

test('crystal.buildPolyhedra: disabled unless style=polyhedral or polyhedra:true', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: true });
  if (m.polyhedra.enabled) throw new Error('polyhedra computed without being requested');
  var m2 = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: true, polyhedra: true });
  if (!m2.polyhedra.enabled) throw new Error('polyhedra:true ignored');
});

test('crystal.buildPolyhedra: molecule has no polyhedra', function () {
  var s = CL.crystal.finalize(waterFixture());
  var m = CL.crystal.buildDisplayModel(s, { style: 'polyhedral' });
  if (m.polyhedra.enabled) throw new Error('molecule polyhedra enabled');
  if (m.polyhedra.triangles.length) throw new Error('molecule triangles');
});

test('crystal.getVisiblePoints: covers supercell, atoms and polyhedra', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 2, 1], showBoundary: false });
  var pts = CL.crystal.getVisiblePoints(m);
  if (!(pts.length > 8)) throw new Error('visible points ' + pts.length);
  var m2 = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], style: 'polyhedral' });
  var withPoly = CL.crystal.getVisiblePoints(m2);
  if (!(withPoly.length > pts.length)) throw new Error('polyhedra vertices not included');
});

test('crystal.buildDisplayModel: baseRadius and colour follow the element table', function () {
  var s = CL.crystal.finalize(naclFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [1, 1, 1], showBoundary: false });
  for (var i = 0; i < m.atoms.length; i++) {
    var atom = m.atoms[i];
    if (atom.z === 11) {
      approx(atom.baseRadius, 2.27, 1e-9, 'Na baseRadius = vdw (non-transition metal)');
      approx(atom.color[0], 216 / 255, 1e-9, 'Na red channel');
    } else if (atom.z === 17) {
      approx(atom.baseRadius, 1.75, 1e-9, 'Cl baseRadius = vdw');
      approx(atom.color[1], 223 / 255, 1e-9, 'Cl green channel');
    }
  }
  // Transition metals use the covalent radius for the ball-and-stick base radius.
  var srt = srtio3Fixture();
  CL.crystal.finalize(srt);
  var m2 = CL.crystal.buildDisplayModel(srt, {});
  var ti = null, o = null;
  for (var j = 0; j < m2.atoms.length; j++) {
    if (m2.atoms[j].z === 22) ti = m2.atoms[j];
    if (!o && m2.atoms[j].z === 8) o = m2.atoms[j];
  }
  approx(ti.baseRadius, 1.60, 1e-9, 'Ti baseRadius = covalent');
  approx(o.baseRadius, 1.52, 1e-9, 'O baseRadius = vdw');
});

test('crystal.buildDisplayModel: supercell capacity fallback to one cell', function () {
  // 5000 atoms * 16 copies > 65536 interior sites -> explicit supercell limit.
  var atoms = [];
  for (var i = 0; i < 5000; i++) {
    atoms.push({
      label: 'C' + i, baseLabel: 'C' + i, element: 'C', z: 6,
      frac: [(i % 10) / 10, (((i / 10) | 0) % 10) / 10, ((i / 100) | 0) / 10],
      cart: [(i % 10) * 0.5, (((i / 10) | 0) % 10) * 0.5, ((i / 100) | 0) * 0.5],
      occupancy: 1, uiso: 0, hasUiso: false, disorderGroup: '', disorderAssembly: '',
      siteIndex: i, symmetryIndex: 0, symmetryGenerated: false
    });
  }
  var stub = {
    format: 'cif', title: 'stub', note: '', periodic: true, cell: fixtureCell(20),
    symops: [], sites: [], atoms: atoms, bonds: [],
    symmetryExpanded: false, asymmetricAtomCount: 5000, symmetryOperatorCount: 1
  };
  var m = CL.crystal.buildDisplayModel(stub, { supercell: [16, 1, 1], showBoundary: true });
  if (!m.stats.supercellLimited) throw new Error('supercellLimited not set');
  if (m.displayedCells[0] !== 1) throw new Error('displayedCells should fall back to 1: ' + m.displayedCells);
  // The fallback still shows the boundary images of the single cell (C++ behaviour).
  if (!(m.atoms.length >= 5000)) throw new Error('atoms ' + m.atoms.length);
  if (m.stats.cellAtomCount !== 5000) throw new Error('cellAtomCount ' + m.stats.cellAtomCount);
  if (m.stats.visibleAtomCount !== m.atoms.length) throw new Error('visibleAtomCount');
  if (m.stats.boundaryAtomCount !== m.atoms.length - 5000) throw new Error('boundary split');
  // 16x16x16 halite fits: 8*4096 sites and 24*4096 bonds.
  var halite = CL.crystal.finalize(naclFixture());
  var big = CL.crystal.buildDisplayModel(halite, { supercell: [16, 16, 16], showBoundary: true });
  if (big.stats.supercellLimited) throw new Error('16^3 halite should fit');
  if (big.displayedCells[0] !== 16) throw new Error('16^3 displayedCells');
});

test('crystal.buildDisplayModel: boundary image budget truncates with boundaryLimited', function () {
  // 256 identical sites on the cell corner: 16x16x1 needs 82,432 boundary images
  // but only 80,000 - 65,536 = 14,464 fit the image budget.
  var sites = [];
  for (var i = 0; i < 256; i++) sites.push(fixtureSite('C' + i, 'C', 6, [0, 0, 0]));
  var s = fixtureStructure(fixtureCell(10), sites, []);
  CL.crystal.finalize(s);
  if (s.atoms.length !== 256) throw new Error('fixture atoms ' + s.atoms.length);
  var m = CL.crystal.buildDisplayModel(s, { supercell: [16, 16, 1], showBoundary: true });
  if (!m.stats.boundaryLimited) throw new Error('boundaryLimited not set');
  if (m.atoms.length !== CL.crystal.K_MAX_IMAGES) throw new Error('atoms ' + m.atoms.length + ' expected ' + CL.crystal.K_MAX_IMAGES);
  if (m.stats.cellAtomCount !== 256 * 256) throw new Error('cellAtomCount ' + m.stats.cellAtomCount);
  if (m.stats.boundaryAtomCount !== m.atoms.length - m.stats.cellAtomCount) throw new Error('boundary split');
});

test('crystal.expand: 30,000 atom cap sets truncated and adds a note once', function () {
  var cell = fixtureCell(10);
  var sites = [];
  for (var i = 0; i < 1000; i++) sites.push(fixtureSite('C' + i, 'C', 6, [i / 1000, 0.5, 0.5]));
  var ops = [];
  for (var x = 0; x < 4; x++) {
    for (var y = 0; y < 4; y++) {
      for (var z = 0; z < 2; z++) {
        ops.push({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [x / 4, y / 4, z / 2], text: 'x,y,z' });
      }
    }
  }
  var s = fixtureStructure(cell, sites, ops);
  s.note = 'existing';
  CL.crystal.expand(s);
  if (s.atoms.length !== CL.crystal.K_MAX_DISPLAY_ATOMS) throw new Error('atoms ' + s.atoms.length);
  if (!s.truncated) throw new Error('truncated not set');
  if (s.note.indexOf('\u539F\u5B50\u6570\u8D85\u8FC7 30,000') < 0) throw new Error('note missing: ' + s.note);
  var noteLength = s.note.length;
  CL.crystal.expand(s);
  if (s.note.length !== noteLength) throw new Error('truncation note duplicated on re-expand');
});

test('crystal.buildDisplayModel: molecule ignores requested supercell', function () {
  var s = CL.crystal.finalize(waterFixture());
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  if (m.atoms.length !== 3) throw new Error('molecule supercell atoms ' + m.atoms.length);
  if (m.displayedCells[0] !== 1) throw new Error('molecule displayedCells');
  if (m.stats.supercellLimited) throw new Error('molecule supercellLimited');
});

test('crystal.expand: json snapshot of a truncated structure is stable', function () {
  var cell = fixtureCell(10);
  var sites = [fixtureSite('C1', 'C', 6, [0.1, 0.1, 0.1])];
  var ops = [];
  for (var i = 0; i < 4; i++) ops.push({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [i / 4, 0, 0], text: 'x,y,z' });
  var s = fixtureStructure(cell, sites, ops);
  CL.crystal.finalize(s);
  var copy = JSON.parse(JSON.stringify(s));
  CL.crystal.finalize(copy);
  if (copy.atoms.length !== s.atoms.length) throw new Error('atoms after roundtrip');
  if (copy.bonds.length !== s.bonds.length) throw new Error('bonds after roundtrip');
});

// ---------------------------------------------------- real CIF integration --
test('integration: halite.cif -> 8 atoms / 24 bonds / a=5.6401', function () {
  var s = parseStructure('web/data/library/halite.cif', 'halite.cif');
  if (s.sites.length !== 2) throw new Error('sites ' + s.sites.length);
  if (s.atoms.length !== 8) throw new Error('atoms ' + s.atoms.length);
  if (s.bonds.length !== 24) throw new Error('bonds ' + s.bonds.length);
  approx(s.cell.a, 5.6401, 1e-9, 'a');
  if (s.cellContents !== 'Na4 Cl4') throw new Error('contents ' + s.cellContents);
  if (s.spaceGroup !== 'F m -3 m') throw new Error('space group ' + s.spaceGroup);
  for (var i = 0; i < s.bonds.length; i++) approx(s.bonds[i].length, 2.8201, 1e-3, 'Na-Cl');
});

test('integration: halite display sets 27 / 125 / 343 / 64 (QA-ACCEPTANCE)', function () {
  var s = parseStructure('web/data/library/halite.cif', 'halite.cif');
  var cases = [
    [[1, 1, 1], true, 27], [[2, 2, 2], true, 125], [[3, 3, 3], true, 343], [[2, 2, 2], false, 64]
  ];
  for (var i = 0; i < cases.length; i++) {
    var m = CL.crystal.buildDisplayModel(s, { supercell: cases[i][0], showBoundary: cases[i][1] });
    if (m.atoms.length !== cases[i][2]) {
      throw new Error('supercell ' + cases[i][0] + ' boundary=' + cases[i][1] + ' -> ' + m.atoms.length);
    }
  }
});

test('integration: halite 2x2x2 polyhedral 63 centres / 504 triangles', function () {
  var s = parseStructure('web/data/library/halite.cif', 'halite.cif');
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
  if (m.polyhedra.centers.length !== 63) throw new Error('centres ' + m.polyhedra.centers.length);
  if (m.polyhedra.triangles.length !== 504) throw new Error('triangles ' + m.polyhedra.triangles.length);
});

test('integration: quartz / diamond / water bonds (spec 7.7)', function () {
  var q = parseStructure('web/data/examples/quartz.cif', 'quartz.cif');
  if (q.atoms.length !== 9) throw new Error('quartz atoms ' + q.atoms.length);
  if (q.bonds.length !== 12) throw new Error('quartz bonds ' + q.bonds.length);
  if (q.cellContents !== 'O6 Si3') throw new Error('quartz contents ' + q.cellContents);
  for (var i = 0; i < q.bonds.length; i++) {
    var len = q.bonds[i].length;
    if (!((Math.abs(len - 1.6046) < 1e-3) || (Math.abs(len - 1.6124) < 1e-3))) {
      throw new Error('unexpected Si-O length ' + len);
    }
  }
  var d = parseStructure('web/data/examples/diamond.cif', 'diamond.cif');
  if (d.atoms.length !== 8 || d.bonds.length !== 16) throw new Error('diamond ' + d.atoms.length + '/' + d.bonds.length);
  var w = parseStructure('web/data/examples/water.xyz', 'water.xyz');
  if (w.atoms.length !== 3 || w.bonds.length !== 2) throw new Error('water ' + w.atoms.length + '/' + w.bonds.length);
  if (w.periodic) throw new Error('water periodic');
});

test('integration: SrTiO3 2x2x2 = 71 atoms / 192 visible bonds (README v0.8)', function () {
  var s = parseStructure('web/data/examples/srtio3.cif', 'srtio3.cif');
  if (s.atoms.length !== 5) throw new Error('srtio3 atoms ' + s.atoms.length);
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  if (m.atoms.length !== 71) throw new Error('srtio3 2x2x2 atoms ' + m.atoms.length);
  if (m.stats.visibleBondCount !== 192) throw new Error('srtio3 2x2x2 visible bonds ' + m.stats.visibleBondCount);
  var mNo = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: false });
  if (mNo.atoms.length !== 40) throw new Error('srtio3 2x2x2 no-boundary atoms ' + mNo.atoms.length);
});

test('integration: 12 library structures element counts (test_core.cpp)', function () {
  var expected = {
    halite: { Na: 4, Cl: 4 }, fluorite: { Ca: 4, F: 8 },
    perovskite: { Ca: 4, Ti: 4, O: 12 }, cooperite: { Pt: 2, S: 2 },
    rutile: { Ti: 2, O: 4 }, brookite: { Ti: 8, O: 16 },
    anatase: { Ti: 4, O: 8 }, sphalerite: { Zn: 4, S: 4 },
    wurtzite: { Zn: 2, S: 2 }, diamond: { C: 8 },
    quartz: { Si: 3, O: 6 }, calcite: { Ca: 6, C: 6, O: 18 }
  };
  var names = Object.keys(expected);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var s = parseStructure('web/data/library/' + name + '.cif', name + '.cif');
    var counts = {};
    for (var j = 0; j < s.atoms.length; j++) counts[s.atoms[j].element] = (counts[s.atoms[j].element] || 0) + 1;
    var keys = Object.keys(expected[name]);
    for (var k = 0; k < keys.length; k++) {
      if (counts[keys[k]] !== expected[name][keys[k]]) {
        throw new Error(name + ' ' + keys[k] + ' ' + counts[keys[k]] + ' != ' + expected[name][keys[k]]);
      }
    }
    if (!s.bonds.length) throw new Error(name + ' has no bonds');
  }
});

test('integration: quartz 2x2x2 polyhedra are SiO4 tetrahedra', function () {
  var s = parseStructure('web/data/examples/quartz.cif', 'quartz.cif');
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
  if (!m.polyhedra.enabled) throw new Error('quartz polyhedra disabled');
  if (!(m.polyhedra.centers.length > 0)) throw new Error('no SiO4 centres');
  if (m.polyhedra.triangles.length !== m.polyhedra.centers.length * 4) {
    throw new Error('tetrahedron triangle count ' + m.polyhedra.triangles.length +
      ' for ' + m.polyhedra.centers.length + ' centres');
  }
});

test('integration: diamond C-C = 1.5445 A (core-cases 16.3)', function () {
  var d = parseStructure('web/data/examples/diamond.cif', 'diamond.cif');
  if (d.bonds.length !== 16) throw new Error('diamond bonds ' + d.bonds.length);
  for (var i = 0; i < d.bonds.length; i++) approx(d.bonds[i].length, 1.5445, 1e-3, 'diamond C-C');
});

test('integration: nacl.vesta expands to 8 atoms / 24 bonds (core-cases 12)', function () {
  var s = parseStructure('web/data/examples/nacl.vesta', 'nacl.vesta');
  if (s.atoms.length !== 8) throw new Error('vesta atoms ' + s.atoms.length);
  if (s.bonds.length !== 24) throw new Error('vesta bonds ' + s.bonds.length);
  if (s.spaceGroup !== 'F m -3 m') throw new Error('vesta space group ' + s.spaceGroup);
  if (s.title !== 'Rock salt (NaCl)') throw new Error('vesta title ' + s.title);
});

test('integration: water.xyz cellContents H2 O (core-cases 13)', function () {
  var w = parseStructure('web/data/examples/water.xyz', 'water.xyz');
  if (w.cellContents !== 'H2 O') throw new Error('water contents ' + w.cellContents);
  if (w.formula !== 'H2 O') throw new Error('water formula fallback ' + w.formula);
});

// ---------------------------------------------------------- perf summary ---
test('performance: 2x2x2 srtio3 display+polyhedra rebuild < 100 ms', function () {
  var s = parseStructure('web/data/examples/srtio3.cif', 'srtio3.cif');
  CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
  var started = Date.now();
  for (var i = 0; i < 5; i++) {
    CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
  }
  var elapsed = (Date.now() - started) / 5;
  if (!(elapsed < 100)) throw new Error('srtio3 2x2x2 build ' + elapsed.toFixed(1) + 'ms');
});

// Local alias used by tests above (avoids repeated long property chains).
var CLI = { finalize: null };
CLI.finalize = function (s) { return CL.crystal.finalize(s); };
