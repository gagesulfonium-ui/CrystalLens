/**
 * CrystalLens Android - measurement tests (CL.crystal.measureDistance/measureAngle).
 *
 * Checks docs/spec/core.md §10: periodic minimum-image distances/angles, image
 * offsets, CONTRACT §5.6 Measurement shape (points/offsets/label), and support
 * for both StructureData atom indices and DisplayModel DisplayAtom ids.
 */
'use strict';

function fixtureCell(a, b, c, alpha, beta, gamma) {
  var cell = CL.Math.buildCell(a, b, c, alpha, beta, gamma);
  if (!cell) throw new Error('fixture cell invalid');
  return cell;
}
function fixtureSite(label, element, z, frac, cart) {
  return {
    label: label, baseLabel: label, element: element, z: z,
    frac: frac ? [frac[0], frac[1], frac[2]] : null,
    cart: cart ? [cart[0], cart[1], cart[2]] : null,
    occupancy: 1, uiso: 0, hasUiso: false,
    disorderGroup: '', disorderAssembly: '', siteIndex: 0
  };
}
function fixtureStructure(cell, sites, symops) {
  var s = {
    format: cell ? 'cif' : 'xyz', sourceName: 'fixture', title: 'fixture', blockName: '',
    spaceGroup: '', note: '', periodic: !!cell, cell: cell, symops: symops || [],
    sites: sites, symmetryExpanded: false,
    asymmetricAtomCount: sites.length, symmetryOperatorCount: (symops || []).length
  };
  for (var i = 0; i < s.sites.length; i++) s.sites[i].siteIndex = i;
  return CL.crystal.finalize(s);
}
function symIdentity() { return { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], text: 'x,y,z' }; }

// NaCl rock salt fixture (F-centring translations).
function naclFixture() {
  var cell = fixtureCell(5.6402, 5.6402, 5.6402, 90, 90, 90);
  var sites = [fixtureSite('Na1', 'Na', 11, [0, 0, 0]), fixtureSite('Cl1', 'Cl', 17, [0.5, 0, 0])];
  var t = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
  var ops = [];
  for (var i = 0; i < 4; i++) {
    ops.push({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: t[i], text: 'x,y,z' });
  }
  return fixtureStructure(cell, sites, ops);
}

test('measure: water O-H distance and H-O-H angle (molecule)', function () {
  var water = fixtureStructure(null, [
    fixtureSite('O1', 'O', 8, null, [0, 0, 0]),
    fixtureSite('H1', 'H', 1, null, [0.757, 0.586, 0]),
    fixtureSite('H2', 'H', 1, null, [-0.757, 0.586, 0])
  ]);
  var d = CL.crystal.measureDistance(water, 0, 1);
  if (!d) throw new Error('distance returned null');
  approx(d.value, Math.sqrt(0.757 * 0.757 + 0.586 * 0.586), 1e-9, 'O-H');
  if (d.kind !== 'distance') throw new Error('kind');
  if (d.atomIds[0] !== 0 || d.atomIds[1] !== 1) throw new Error('atomIds');
  if (d.offsets[0][0] !== 0 || d.offsets[1][0] !== 0) throw new Error('molecule offsets');
  if (!/^0\.957 \u00C5$/.test(d.label)) throw new Error('label ' + d.label);
  // points are render-space (molecule centred on the bounding-box centre).
  var points = d.points;
  var dx = points[0][0] - points[1][0], dy = points[0][1] - points[1][1], dz = points[0][2] - points[1][2];
  approx(Math.sqrt(dx * dx + dy * dy + dz * dz), d.value, 1e-9, 'points length');

  var a = CL.crystal.measureAngle(water, 1, 0, 2);
  if (!a) throw new Error('angle returned null');
  approx(a.value, 104.47, 0.1, 'H-O-H');
  if (!/^104\.\d\d\u00B0$/.test(a.label)) throw new Error('angle label ' + a.label);
  if (a.points.length !== 3) throw new Error('angle points');
});

test('measure: NaCl nearest Na-Cl via periodic minimum image', function () {
  var s = naclFixture();
  // atom 0 = Na at (0,0,0), atom 4 = Cl at (1/2,0,0)
  var d = CL.crystal.measureDistance(s, 0, 4);
  if (!d) throw new Error('null');
  approx(d.value, 2.8201, 1e-3, 'Na-Cl');
  // A fractional displacement of exactly +1/2 wraps to -1/2, so the reported
  // offset may be a full lattice translation (C++ MinimumFractionalDelta).
  var p0 = d.points[0], p1 = d.points[1];
  var dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  approx(Math.sqrt(dx * dx + dy * dy + dz * dz), d.value, 1e-9, 'points distance');
  var offLen = Math.sqrt(d.offsets[1][0] * d.offsets[1][0] + d.offsets[1][1] * d.offsets[1][1] +
    d.offsets[1][2] * d.offsets[1][2]);
  if (offLen > 1e-9) approx(offLen, 5.6402, 1e-3, 'full-lattice offset length');
  // Some pair must need a non-zero periodic offset in the expanded cell.
  var withOffset = 0;
  for (var i = 0; i < s.atoms.length; i++) {
    for (var j = i + 1; j < s.atoms.length; j++) {
      if (s.atoms[i].element === s.atoms[j].element) continue;
      var m = CL.crystal.measureDistance(s, i, j);
      if (Math.abs(m.offsets[1][0]) + Math.abs(m.offsets[1][1]) + Math.abs(m.offsets[1][2]) > 1e-9) withOffset++;
    }
  }
  if (!(withOffset > 0)) throw new Error('no periodic offsets found in NaCl cell');
});

test('measure: offsets make the drawn points match the reported value', function () {
  var s = naclFixture();
  var checked = 0;
  for (var i = 0; i < s.atoms.length; i++) {
    for (var j = 0; j < s.atoms.length; j++) {
      if (i === j) continue;
      var d = CL.crystal.measureDistance(s, i, j);
      if (!d) continue;
      var p0 = d.points[0], p1 = d.points[1];
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      approx(Math.sqrt(dx * dx + dy * dy + dz * dz), d.value, 1e-9, 'points vs value');
      // points are cart-offset by -center
      approxVec([p0[0] + s.center[0], p0[1] + s.center[1], p0[2] + s.center[2]],
        s.atoms[i].cart, 1e-9, 'point0');
      var expected = [
        s.atoms[j].cart[0] + d.offsets[1][0],
        s.atoms[j].cart[1] + d.offsets[1][1],
        s.atoms[j].cart[2] + d.offsets[1][2]
      ];
      approxVec([p1[0] + s.center[0], p1[1] + s.center[1], p1[2] + s.center[2]], expected, 1e-9, 'point1');
      checked++;
    }
  }
  if (!(checked > 10)) throw new Error('too few pairs checked');
});

test('measure: angle around a periodic vertex (O-Ti-O = 90)', function () {
  var a = 3.905;
  var s = fixtureStructure(fixtureCell(a, a, a, 90, 90, 90), [
    fixtureSite('Sr1', 'Sr', 38, [0, 0, 0]),
    fixtureSite('Ti1', 'Ti', 22, [0.5, 0.5, 0.5]),
    fixtureSite('O1', 'O', 8, [0.5, 0.5, 0]),
    fixtureSite('O2', 'O', 8, [0.5, 0, 0.5]),
    fixtureSite('O3', 'O', 8, [0, 0.5, 0.5])
  ]);
  var angle = CL.crystal.measureAngle(s, 2, 1, 3);
  if (!angle) throw new Error('null angle');
  approx(angle.value, 90, 1e-6, 'O-Ti-O');
  var angle2 = CL.crystal.measureAngle(s, 3, 1, 4);
  approx(angle2.value, 90, 1e-6, 'second O-Ti-O');
  if (angle.atomIds.length !== 3 || angle.atomIds[1] !== 1) throw new Error('vertex atom id');
  if (angle.points.length !== 3) throw new Error('points');
  // angle label: 2 decimals + degree sign
  if (angle.label !== '90.00\u00B0') throw new Error('label ' + angle.label);
});

test('measure: DisplayModel input resolves display-space atoms (supercell aware)', function () {
  var s = naclFixture();
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  var found = null;
  for (var i = 0; i < m.atoms.length && !found; i++) {
    for (var j = 0; j < m.atoms.length; j++) {
      if (i === j) continue;
      var a = m.atoms[i], b = m.atoms[j];
      var dx = a.pos[0] - b.pos[0], dy = a.pos[1] - b.pos[1], dz = a.pos[2] - b.pos[2];
      var direct = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (direct < 7) continue;
      var result = CL.crystal.measureDistance(m, i, j);
      if (result && Math.abs(result.value - 2.8201) < 1e-3) {
        found = { i: i, j: j, result: result, direct: direct };
        break;
      }
    }
  }
  if (!found) throw new Error('no far pair with a 2.82 A minimum image found');
  if (!(found.direct > 7)) throw new Error('pair was not far in display space');
  var p = found.result;
  if (p.atomIds[0] !== found.i || p.atomIds[1] !== found.j) throw new Error('display ids not preserved');
  var off = p.offsets[1];
  if (Math.abs(off[0]) + Math.abs(off[1]) + Math.abs(off[2]) < 1e-6) throw new Error('expected a periodic offset');
  var p0 = p.points[0], p1 = p.points[1];
  var pdx = p1[0] - p0[0], pdy = p1[1] - p0[1], pdz = p1[2] - p0[2];
  approx(Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz), p.value, 1e-9, 'offset points length');
});

test('measure: DisplayModel supercell interior keeps 2.8201 A for all Na-Cl pairs', function () {
  var s = naclFixture();
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: false });
  var count = 0;
  for (var i = 0; i < m.atoms.length; i++) {
    for (var j = 0; j < m.atoms.length; j++) {
      if (i === j) continue;
      if (m.atoms[i].z === m.atoms[j].z) continue;
      var d = CL.crystal.measureDistance(m, i, j);
      if (!(d.value < 2.83)) continue;
      approx(d.value, 2.8201, 1e-3, 'Na-Cl minimum image');
      count++;
    }
  }
  if (!(count >= 24)) throw new Error('too few Na-Cl pairs: ' + count);
});

test('measure: invalid inputs return null', function () {
  var s = naclFixture();
  if (CL.crystal.measureDistance(s, -1, 0) !== null) throw new Error('negative id');
  if (CL.crystal.measureDistance(s, 0, 999) !== null) throw new Error('out of range');
  if (CL.crystal.measureDistance(s, 0, 0) !== null) throw new Error('same atom distance');
  if (CL.crystal.measureAngle(s, 0, 1, 999) !== null) throw new Error('angle out of range');
  if (CL.crystal.measureAngle(s, 0, 0, 1) !== null) throw new Error('angle degenerate vertex');
  if (CL.crystal.measureDistance(null, 0, 1) !== null) throw new Error('null source');
  var water = fixtureStructure(null, [fixtureSite('O1', 'O', 8, null, [0, 0, 0])]);
  if (CL.crystal.measureDistance(water, 0, 0) !== null) throw new Error('single atom distance');
});

test('measure: measurement value text helpers', function () {
  if (CL.crystal.formatLength(1.23456) !== '1.235 \u00C5') throw new Error('formatLength ' + CL.crystal.formatLength(1.23456));
  if (CL.crystal.formatAngle(90) !== '90.00\u00B0') throw new Error('formatAngle ' + CL.crystal.formatAngle(90));
  if (CL.crystal.formatLength(Infinity) !== '\u2014') throw new Error('non-finite length');
  if (CL.crystal.formatAngle(NaN) !== '\u2014') throw new Error('non-finite angle');
});
