/**
 * CrystalLens Android - export tests (CL.crystal.exportCif / exportXyz).
 *
 * Covers docs/spec/core.md §12 and CONTRACT §6.4: CIF writes the asymmetric unit
 * plus symmetry operations with fixed 8-decimal formatting; XYZ writes Cartesian
 * coordinates; exports round-trip through CL.parsers.
 */
'use strict';

function fixtureCell(a, b, c, alpha, beta, gamma) {
  var cell = CL.Math.buildCell(a, b == null ? a : b, c == null ? a : c,
    alpha == null ? 90 : alpha, beta == null ? 90 : beta, gamma == null ? 90 : gamma);
  if (!cell) throw new Error('fixture cell invalid');
  return cell;
}
function fixtureSite(label, element, z, frac, extra) {
  var site = {
    label: label, baseLabel: label, element: element, z: z,
    frac: frac ? [frac[0], frac[1], frac[2]] : null, cart: null,
    occupancy: 1, uiso: 0, hasUiso: false,
    disorderGroup: '', disorderAssembly: '', siteIndex: 0
  };
  if (extra) for (var k in extra) site[k] = extra[k];
  return site;
}
function fixtureStructure(cell, sites, symops, extra) {
  var s = {
    format: 'cif', sourceName: 'fixture.cif', title: 'Fixture', blockName: '',
    spaceGroup: '', note: '', periodic: !!cell, cell: cell, symops: symops || [],
    sites: sites, symmetryExpanded: false,
    asymmetricAtomCount: sites.length, symmetryOperatorCount: (symops || []).length
  };
  for (var i = 0; i < s.sites.length; i++) s.sites[i].siteIndex = i;
  if (extra) for (var k in extra) s[k] = extra[k];
  return CL.crystal.finalize(s);
}
function transOp(t) {
  return { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: t, text: 'x,y,z' };
}
function naclStructure() {
  return fixtureStructure(fixtureCell(5.6402, 5.6402, 5.6402, 90, 90, 90), [
    fixtureSite('Na1', 'Na', 11, [0, 0, 0]),
    fixtureSite('Cl1', 'Cl', 17, [0.5, 0.5, 0.5])
  ], [transOp([0, 0, 0]), transOp([0, 0.5, 0.5]), transOp([0.5, 0, 0.5]), transOp([0.5, 0.5, 0])],
  { title: 'Rock salt', formula: 'Cl Na', spaceGroup: 'F m -3 m' });
}
function waterStructure() {
  return fixtureStructure(null, [
    fixtureSite('O1', 'O', 8, null, { cart: [0, 0, 0] }),
    fixtureSite('H1', 'H', 1, null, { cart: [0.757, 0.586, 0] }),
    fixtureSite('H2', 'H', 1, null, { cart: [-0.757, 0.586, 0] })
  ], [], { format: 'xyz', title: 'water molecule', sourceName: 'water.xyz' });
}

test('export: CIF header, cell values and symmetry loop', function () {
  var s = naclStructure();
  var cif = CL.crystal.exportCif(s);
  if (!cif) throw new Error('exportCif returned null');
  var lines = cif.split('\n');
  if (lines[0] !== 'data_crystallens_export') throw new Error('data block: ' + lines[0]);
  if (lines[1] !== "_chemical_name_common      'Rock salt'") throw new Error('title line: ' + lines[1]);
  if (lines[2] !== "_chemical_formula_sum      'Cl Na'") throw new Error('formula line: ' + lines[2]);
  if (lines[3] !== '_cell_length_a             5.64020000') throw new Error('a line: ' + lines[3]);
  if (lines[8] !== '_cell_angle_gamma          90.00000000') throw new Error('gamma line: ' + lines[8]);
  if (lines[10] !== "_symmetry_space_group_name_H-M 'F m -3 m'") throw new Error('space group line: ' + lines[10]);
  // symmetry loop right after the blank line
  if (cif.indexOf('loop_\n_symmetry_equiv_pos_site_id\n_symmetry_equiv_pos_as_xyz\n') < 0) {
    throw new Error('symmetry loop header missing');
  }
  if (cif.indexOf("1 'x,y,z'\n2 'x,y,z'\n3 'x,y,z'\n4 'x,y,z'") < 0) throw new Error('symmetry operations missing');
  // atom loop + rows
  if (cif.indexOf('loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n' +
    '_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\n') < 0) {
    throw new Error('atom loop header missing');
  }
  if (cif.indexOf("'Na1' Na 0.00000000 0.00000000 0.00000000 1.00000000") < 0) {
    throw new Error('Na row missing:\n' + cif);
  }
  if (cif.indexOf("'Cl1' Cl 0.50000000 0.50000000 0.50000000 1.00000000") < 0) {
    throw new Error('Cl row missing');
  }
  if (cif.charAt(cif.length - 1) !== '\n') throw new Error('missing trailing newline');
});

test('export: CIF quotes titles containing apostrophes and spaces', function () {
  if (CL.crystal.cifQuote('O\'Brien crystal') !== "'O'Brien crystal'") {
    throw new Error('apostrophe quote: ' + CL.crystal.cifQuote('O\'Brien crystal'));
  }
  if (CL.crystal.cifQuote('simple') !== "'simple'") throw new Error('simple quote');
  var doubleQuoted = CL.crystal.cifQuote("value with ' quote and ; semi");
  if (doubleQuoted.charAt(0) !== '"') throw new Error('double-quote fallback: ' + JSON.stringify(doubleQuoted));
  var semicolon = CL.crystal.cifQuote("a' b\" c");
  if (semicolon.charAt(0) !== ';') throw new Error('semicolon fallback: ' + JSON.stringify(semicolon));
  if (CL.crystal.cifQuote('a\tb\nc') !== "'a b c'") throw new Error('control chars replaced');
});

test('export: CIF optional disorder / uiso columns', function () {
  var s = CL.crystal.finalize(fixtureStructure(fixtureCell(10), [
    fixtureSite('C1', 'C', 6, [0.1, 0.1, 0.1], { disorderAssembly: 'A', disorderGroup: '1', hasUiso: true, uiso: 0.012 }),
    fixtureSite('C2', 'C', 6, [0.6, 0.1, 0.1], { disorderAssembly: 'A', disorderGroup: '2' })
  ], []));
  var cif = CL.crystal.exportCif(s);
  if (cif.indexOf('_atom_site_disorder_assembly\n_atom_site_disorder_group\n') < 0) throw new Error('disorder header');
  if (cif.indexOf('_atom_site_U_iso_or_equiv\n') < 0) throw new Error('uiso header');
  var rows = cif.split('\n').filter(function (line) { return line.indexOf("'C1'") === 0 || line.indexOf("'C2'") === 0; });
  if (rows.length !== 2) throw new Error('atom rows ' + rows.length);
  if (rows[0] !== "'C1' C 0.10000000 0.10000000 0.10000000 1.00000000 'A' '1' 0.01200000") {
    throw new Error('C1 row: ' + rows[0]);
  }
  if (rows[1] !== "'C2' C 0.60000000 0.10000000 0.10000000 1.00000000 'A' '2' ?") {
    throw new Error('C2 row: ' + rows[1]);
  }
});

test('export: CIF IT-number space group branch and omitted optional lines', function () {
  var s = naclStructure();
  s.title = '';
  s.formula = '';
  s.spaceGroup = '#225';
  var cif = CL.crystal.exportCif(s);
  if (cif.indexOf('_chemical_name_common') >= 0) throw new Error('empty title emitted');
  if (cif.indexOf('_chemical_formula_sum') >= 0) throw new Error('empty formula emitted');
  if (cif.indexOf('_space_group_IT_number 225\n') < 0) throw new Error('IT number branch');
  if (cif.indexOf('_symmetry_space_group_name_H-M') >= 0) throw new Error('H-M branch emitted too');
});

test('export: CIF de-duplicates repeated atom labels', function () {
  var s = CL.crystal.finalize(fixtureStructure(fixtureCell(10), [
    fixtureSite('C1', 'C', 6, [0.1, 0.1, 0.1]),
    fixtureSite('C1', 'C', 6, [0.6, 0.1, 0.1])
  ], []));
  var cif = CL.crystal.exportCif(s);
  if (cif.indexOf("'C1' C ") < 0 || cif.indexOf("'C1_2' C ") < 0) throw new Error('label dedupe missing:\n' + cif);
});

test('export: CIF failure conditions', function () {
  var water = waterStructure();
  if (CL.crystal.exportCif(water) !== null) throw new Error('molecule CIF export should fail');
  var result = CL.crystal.exportCifResult(water);
  if (result.ok || result.error !== 'toast.no-cell-for-cif') throw new Error('error ' + JSON.stringify(result));
  var empty = { format: 'cif', title: 'e', note: '', periodic: true, cell: fixtureCell(5), symops: [], sites: [], atoms: [] };
  var r2 = CL.crystal.exportCifResult(empty);
  if (r2.ok || !r2.error) throw new Error('empty CIF accepted');
});

test('export: CIF round-trip through CL.parsers', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.parsers.parse(readText('web/data/library/halite.cif'), 'halite.cif');
  CL.crystal.finalize(s);
  var cif = CL.crystal.exportCif(s);
  var reloaded = CL.parsers.parse(cif, 'roundtrip.cif');
  CL.crystal.finalize(reloaded);
  approx(reloaded.cell.a, s.cell.a, 1e-5, 'cell a');
  approx(reloaded.cell.volume, s.cell.volume, 1e-3, 'cell volume');
  if (reloaded.sites.length !== s.sites.length) throw new Error('site count');
  if (reloaded.atoms.length !== s.atoms.length) throw new Error('atom count');
  if (reloaded.symops.length !== s.symops.length) throw new Error('symop count');
  for (var i = 0; i < s.sites.length; i++) {
    approxVec(reloaded.sites[i].frac, s.sites[i].frac, 1e-6, 'site frac ' + i);
    if (reloaded.sites[i].element !== s.sites[i].element) throw new Error('element ' + i);
  }
});

test('export: CIF round-trip keeps disorder and Uiso', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.crystal.finalize(fixtureStructure(fixtureCell(10), [
    fixtureSite('C1', 'C', 6, [0.1, 0.1, 0.1], { disorderAssembly: 'A', disorderGroup: '1', hasUiso: true, uiso: 0.012 }),
    fixtureSite('C2', 'C', 6, [0.6, 0.1, 0.1], { disorderAssembly: 'B', disorderGroup: '2' })
  ], []));
  var cif = CL.crystal.exportCif(s);
  var reloaded = CL.crystal.finalize(CL.parsers.parse(cif, 'disorder.cif'));
  if (reloaded.sites.length !== 2) throw new Error('sites ' + reloaded.sites.length);
  if (reloaded.sites[0].disorderAssembly !== 'A' || reloaded.sites[0].disorderGroup !== '1') {
    throw new Error('disorder roundtrip ' + JSON.stringify(reloaded.sites[0]));
  }
  if (!reloaded.sites[0].hasUiso) throw new Error('uiso flag lost');
  approx(reloaded.sites[0].uiso, 0.012, 1e-9, 'uiso value');
});

test('export: XYZ of a StructureData writes the expanded unit cell', function () {
  var s = naclStructure();
  var xyz = CL.crystal.exportXyz(s);
  if (!xyz) throw new Error('exportXyz returned null');
  var lines = xyz.split('\n');
  if (lines[0] !== '8') throw new Error('atom count line: ' + lines[0]);
  if (lines[1] !== 'Rock salt') throw new Error('comment line: ' + lines[1]);
  if (lines.length !== 11) throw new Error('line count ' + lines.length);
  if (lines[2] !== 'Na 0.00000000 0.00000000 0.00000000') throw new Error('first atom: ' + lines[2]);
  var clRow = lines.filter(function (line) { return line.indexOf('Cl ') === 0; });
  if (clRow.length !== 4) throw new Error('Cl rows ' + clRow.length);
});

test('export: XYZ of a DisplayModel exports displayed cell atoms only', function () {
  var s = naclStructure();
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  var xyz = CL.crystal.exportXyz(m);
  var lines = xyz.split('\n');
  if (lines[0] !== '64') throw new Error('expected 64 interior atoms, got ' + lines[0]);
  if (lines[1] !== 'Rock salt') throw new Error('comment ' + lines[1]);
  // every row must be a valid symbol + three 8-decimal numbers
  for (var i = 2; i < 2 + 64; i++) {
    if (!/^[A-Z][a-z]? -?\d+\.\d{8} -?\d+\.\d{8} -?\d+\.\d{8}$/.test(lines[i])) {
      throw new Error('bad atom row ' + i + ': ' + lines[i]);
    }
  }
  // Coordinates are cartesian (pos + origin), not render-space.
  var first = lines[2].split(' ');
  var atom0 = m.atoms[0];
  approx(parseFloat(first[1]), atom0.pos[0] + m.origin[0], 1e-8, 'x');
  approx(parseFloat(first[2]), atom0.pos[1] + m.origin[1], 1e-8, 'y');
  approx(parseFloat(first[3]), atom0.pos[2] + m.origin[2], 1e-8, 'z');
});

test('export: XYZ of a molecule exports every atom', function () {
  var water = waterStructure();
  var xyz = CL.crystal.exportXyz(water);
  var lines = xyz.split('\n');
  if (lines[0] !== '3') throw new Error('atom count ' + lines[0]);
  if (lines[1] !== 'water molecule') throw new Error('comment ' + lines[1]);
  if (lines.length !== 6) throw new Error('line count ' + lines.length);
  if (lines[3] !== 'H 0.75700000 0.58600000 0.00000000') throw new Error('H row: ' + lines[3]);
});

test('export: XYZ comment fallback and failure conditions', function () {
  var s = naclStructure();
  s.title = '';
  var xyz = CL.crystal.exportXyz(s);
  if (xyz.split('\n')[1] !== 'CrystalLens export') throw new Error('comment fallback');
  var empty = { format: 'xyz', title: 'e', note: '', periodic: false, cell: null, symops: [], sites: [], atoms: [] };
  if (CL.crystal.exportXyz(empty) !== null) throw new Error('empty XYZ accepted');
  if (CL.crystal.exportXyz(null) !== null) throw new Error('null XYZ accepted');
});

test('export: XYZ round-trip through CL.parsers', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.parsers.parse(readText('web/data/examples/quartz.cif'), 'quartz.cif');
  CL.crystal.finalize(s);
  var xyz = CL.crystal.exportXyz(s);
  var reloaded = CL.crystal.finalize(CL.parsers.parseXyz(xyz, 'roundtrip.xyz'));
  if (reloaded.format !== 'xyz') throw new Error('format ' + reloaded.format);
  if (reloaded.atoms.length !== s.atoms.length) throw new Error('atom count');
  for (var i = 0; i < s.atoms.length; i++) {
    approxVec(reloaded.atoms[i].cart, s.atoms[i].cart, 1e-5, 'cart ' + i);
  }
});

test('export: QA acceptance row count = displayed cell atoms + 2', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.crystal.finalize(CL.parsers.parse(readText('web/data/library/halite.cif'), 'halite.cif'));
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  var interior = 0;
  for (var i = 0; i < m.atoms.length; i++) if (m.atoms[i].kind === 'cell') interior++;
  var xyz = CL.crystal.exportXyz(m);
  var rows = xyz.split('\n').length - 3; // count + comment + trailing empty
  if (rows !== interior) throw new Error('rows ' + rows + ' != interior ' + interior);
  if (rows !== 64) throw new Error('halite 2x2x2 interior ' + rows);
});

test('export: quartz CIF matches core-cases 15.1 (Uiso column, 6 symops,)', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var q = CL.crystal.finalize(CL.parsers.parse(readText('web/data/examples/quartz.cif'), 'quartz.cif'));
  var cif = CL.crystal.exportCif(q);
  if (cif.indexOf('_atom_site_U_iso_or_equiv\n') < 0) throw new Error('quartz Uiso header missing');
  if (cif.indexOf('_atom_site_disorder_') >= 0) throw new Error('unexpected disorder columns');
  var symopRows = 0;
  var lines = cif.split('\n');
  for (var i = 0; i < lines.length; i++) if (/^[1-6] '/.test(lines[i]) && lines[i].indexOf(',') > 0) symopRows++;
  if (symopRows !== 6) throw new Error('symop rows ' + symopRows);
  // cell values with exactly 8 decimals
  if (cif.indexOf('_cell_length_a             4.91340000') < 0) throw new Error('cell a formatting: ' + cif.split('\n')[3]);
  if (cif.indexOf('_cell_angle_gamma          120.00000000') < 0) throw new Error('gamma formatting');
  // atom rows carry the Uiso value (8 decimals) after occupancy
  if (cif.indexOf("'Si1' Si 0.46970000 0.00000000 0.33333000 1.00000000 0.00520000") < 0) {
    throw new Error('quartz Si row formatting:\n' + cif);
  }
  var xyz = CL.crystal.exportXyz(q);
  var xyzLines = xyz.split('\n');
  if (xyzLines[0] !== '9') throw new Error('quartz xyz count ' + xyzLines[0]);
  if (xyzLines[1] !== q.title) throw new Error('quartz xyz comment ' + xyzLines[1]);
  if (xyzLines.length !== 12) throw new Error('quartz xyz lines ' + xyzLines.length);
});

test('export: molecule XYZ after addAtomSite has 4 atoms (core-cases 15)', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var w = CL.crystal.finalize(CL.parsers.parse(readText('web/data/examples/water.xyz'), 'water.xyz'));
  var added = CL.crystal.addAtomSite(w, { z: 6, cart: [1, 2, 3] });
  if (!added.ok) throw new Error('add molecule failed: ' + added.error);
  var xyz = CL.crystal.exportXyz(added.structure);
  var lines = xyz.split('\n');
  if (lines[0] !== '4') throw new Error('molecule xyz count ' + lines[0]);
  if (lines[1] !== 'water (H2O)') throw new Error('molecule xyz comment ' + lines[1]);
  if (CL.crystal.exportCif(added.structure) !== null) throw new Error('molecule cif should fail');
});

test('export: fitsSupercell identity copy always fits', function () {
  var s = { cell: fixtureCell(5), atoms: new Array(30000), bonds: new Array(150000) };
  if (!CL.crystal.fitsSupercell(s, [1, 1, 1]).ok) throw new Error('1x1x1 did not fit');
  if (!CL.crystal.fitsSupercell(s, 1).ok) throw new Error('scalar copies=1 did not fit');
});

test('export: periodic display model XYZ stays parseable by the CIF/XYZ round-trip', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.crystal.finalize(CL.parsers.parse(readText('web/data/examples/srtio3.cif'), 'srtio3.cif'));
  var m = CL.crystal.buildDisplayModel(s, { supercell: [2, 2, 2], showBoundary: true });
  var xyz = CL.crystal.exportXyz(m);
  var reloaded = CL.crystal.finalize(CL.parsers.parseXyz(xyz, 'srtio3-super.xyz'));
  if (reloaded.atoms.length !== 40) throw new Error('srtio3 supercell xyz atoms ' + reloaded.atoms.length);
});
