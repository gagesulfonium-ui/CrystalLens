/**
 * Tests for CL.parsers / CL.ParseError (web/js/core/{cif,xyz,vesta,parsers}.js).
 *
 * Data sources:
 *  - web/data/library/*.cif   (12 COD structures)
 *  - web/data/examples/*      (quartz/diamond/SrTiO3/nacl.vesta/water/benzene)
 *  - inline fixtures ported from the upstream C++ tests/test_core.cpp
 * Expected values (atom counts, space groups, symmetry operator counts, cell
 * parameters) are taken from the C++ core tests / COD entries.
 *
 * The symmetry-expansion helper below is test-only: parsers must NOT expand
 * symmetry (asymmetricAtomCount / symmetryExpanded=false). It is used to verify
 * that the parsed symmetry operators + asymmetric sites reproduce the exact
 * element counts asserted by reference tests (e.g. halite Na4 Cl4).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- helpers ----
  function ok(condition, message) { if (!condition) throw new Error(message || 'assertion failed'); }
  function eq(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || 'eq') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  }
  function near(actual, expected, eps, message) {
    var tolerance = eps === undefined ? 1e-9 : eps;
    if (!(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance)) {
      throw new Error((message || 'near') + ': expected ' + expected + ', got ' + actual + ' (eps ' + tolerance + ')');
    }
  }
  function vecNear(actual, expected, eps, message) {
    ok(actual && actual.length === expected.length, (message || 'vec') + ': bad shape');
    for (var i = 0; i < expected.length; i++) near(actual[i], expected[i], eps, (message || 'vec') + '[' + i + ']');
  }
  function expectParseError(fn, messagePart, expectedLine, label) {
    var caught = null;
    try { fn(); } catch (e) { caught = e; }
    ok(caught, (label || 'expected ParseError') + ': nothing was thrown');
    eq(caught.name, 'ParseError', (label || 'ParseError') + ': wrong name');
    ok(String(caught.message).indexOf(messagePart) !== -1,
      (label || 'ParseError') + ': message "' + caught.message + '" does not contain "' + messagePart + '"');
    if (expectedLine !== undefined) eq(caught.line, expectedLine, (label || 'ParseError') + ': line');
    return caught;
  }
  function parseFile(CL, relPath) { return CL.parsers.parse(readText(relPath), relPath); }

  function wrap01(value) {
    var r = value % 1;
    if (r < 0) r += 1;
    if (r >= 1 - 1e-12) r = 0;
    return r;
  }

  // Test-only symmetry expansion (same rules as cl::ExpandAsymmetricUnit).
  function expandCounts(CL, structure) {
    var counts = {};
    function add(element) { counts[element] = (counts[element] || 0) + 1; }
    if (!structure.cell) {
      for (var i = 0; i < structure.sites.length; i++) add(structure.sites[i].element);
      return counts;
    }
    var identity = { m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0], text: 'x,y,z' };
    var ops = structure.symops.length ? structure.symops : [identity];
    for (var s = 0; s < structure.sites.length; s++) {
      var site = structure.sites[s];
      var unique = [];
      for (var o = 0; o < ops.length; o++) {
        var op = ops[o];
        var frac = [
          wrap01(op.m[0][0] * site.frac[0] + op.m[0][1] * site.frac[1] + op.m[0][2] * site.frac[2] + op.t[0]),
          wrap01(op.m[1][0] * site.frac[0] + op.m[1][1] * site.frac[1] + op.m[1][2] * site.frac[2] + op.t[1]),
          wrap01(op.m[2][0] * site.frac[0] + op.m[2][1] * site.frac[1] + op.m[2][2] * site.frac[2] + op.t[2])
        ];
        var duplicate = false;
        for (var u = 0; u < unique.length; u++) {
          var delta = CL.Math.minimumFractionalDelta(structure.cell,
            [frac[0] - unique[u][0], frac[1] - unique[u][1], frac[2] - unique[u][2]]);
          if (CL.Math.vec3.length(CL.Math.fracToCart(structure.cell, delta)) < 1e-3) {
            duplicate = true;
            break;
          }
        }
        if (!duplicate) unique.push(frac);
      }
      for (var c = 0; c < unique.length; c++) add(site.element);
    }
    return counts;
  }
  function countsEqual(actual, expected, label) {
    var a = Object.keys(actual).sort();
    var b = Object.keys(expected).sort();
    eq(a.join(','), b.join(','), (label || 'counts') + ': element sets differ');
    for (var i = 0; i < b.length; i++) eq(actual[b[i]], expected[b[i]], (label || 'counts') + ': ' + b[i]);
  }

  // ------------------------------------------------------- shared fixtures --
  // Ported from tests/test_core.cpp (CIF lexical boundaries / Cartesian fallback).
  var LEXICAL_CIF = [
    'data_parse',
    "_chemical_name_common 'O'Brien crystal'",
    '_cell.length_a 1.000(2)e1',
    '_cell.length_b 10',
    '_cell.length_c 10',
    'loop_',
    '_space_group_symop.id',
    '_space_group_symop.operation_xyz',
    '1 x, y, z',
    'loop_',
    '_atom_site.label',
    '_atom_site.type_symbol',
    '_atom_site.fract_x',
    '_atom_site.fract_y',
    '_atom_site.fract_z',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
    '_atom_site.disorder_assembly',
    '_atom_site.disorder_group',
    'C#1 C ? ? ? 1 2 3 A 1',
    'C2 C .2 .2 .3 ? ? ? A 2',
    'C3 C .3 .2 .3 ? ? ? B 1'
  ].join('\n');

  var NUMBERS_CIF = [
    'data_numbers',
    '_cell_length_a 1.000(2)e1',
    '_cell_length_b 10.000(4)',
    '_cell_length_c 5',
    '_cell_angle_alpha 90',
    '_cell_angle_beta 90',
    '_cell_angle_gamma 90',
    'loop_',
    '_atom_site_label',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    '_atom_site_occupancy',
    '_atom_site_U_iso_or_equiv',
    'Si1 1/3 0.25 0.5 0.75 0.010(2)',
    'O1 0 0 0 ? .'
  ].join('\n');

  var UNQUOTED_SYMMETRY_CIF = [
    'data_unquoted_symops',
    '_cell_length_a 5',
    '_cell_length_b 6',
    '_cell_length_c 7',
    '_cell_angle_alpha 90',
    '_cell_angle_beta 90',
    '_cell_angle_gamma 90',
    "_symmetry_space_group_name_H-M 'P -1'",
    '_symmetry_equiv_pos_as_xyz',
    'x, y, z',
    '-x, -y, -z',
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'C1 C 0.1 0.2 0.3'
  ].join('\n');

  var SPECIAL_POSITIONS_CIF = [
    'data_special',
    '_cell_length_a 5',
    '_cell_length_b 5',
    '_cell_length_c 5',
    'loop_',
    '_symmetry_equiv_pos_as_xyz',
    "'x,y,z'",
    "'-x,-y,-z'",
    "'x+1/2,y+1/2,z'",
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'Na1 Na 0 0 0'
  ].join('\n');

  var SEMICOLON_CIF = [
    'data_text_test',
    '_chemical_name_common',
    ';',
    'A title',
    'on two lines',
    ';',
    '_cell_length_a 4',
    '_cell_length_b 4',
    '_cell_length_c 4',
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'Si1 Si 0 0 0'
  ].join('\n');

  var MULTI_BLOCK_CIF = [
    'data_small',
    '_cell_length_a 4',
    '_cell_length_b 4',
    '_cell_length_c 4',
    'loop_',
    '_atom_site_label',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'C1 0 0 0',
    'data_big',
    '_cell_length_a 5',
    '_cell_length_b 5',
    '_cell_length_c 5',
    'loop_',
    '_atom_site_label',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'Na1 0 0 0',
    'Cl1 .5 0 0'
  ].join('\n');

  var BLOCK_SCORE_CIF = [
    'data_with_cell',
    '_cell_length_a 4',
    '_cell_length_b 4',
    '_cell_length_c 4',
    'loop_',
    '_atom_site_label',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'C1 0 0 0',
    'data_without_cell',
    'loop_',
    '_atom_site_label',
    '_atom_site_Cartn_x',
    '_atom_site_Cartn_y',
    '_atom_site_Cartn_z',
    'O1 0 0 0',
    'O2 1 0 0',
    'O3 0 1 0'
  ].join('\n');

  var TYPE_INFERENCE_CIF = [
    'data_typed',
    '_cell_length_a 5',
    '_cell_length_b 5',
    '_cell_length_c 5',
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    'CA1 Ca 0 0 0',
    'XX1 Ca .1 .1 .1',
    'Qq2 ? .2 .2 .2'
  ].join('\n');

  var MULTI_MODEL_CIF = [
    'data_multi_model',
    '_cell_length_a 5',
    '_cell_length_b 5',
    '_cell_length_c 5',
    'loop_',
    '_atom_site_label',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    '_atom_site_pdbx_pdb_model_num',
    'C1 0 0 0 1',
    'C2 .1 .1 .1 1',
    'C3 .2 .2 .2 2'
  ].join('\n');

  var SINGLE_ITEM_CIF = [
    'data_one',
    '_atom_site.label O1',
    '_atom_site.Cartn_x 1',
    '_atom_site.Cartn_y 2',
    '_atom_site.Cartn_z 3'
  ].join('\n');

  var WATER_XYZ = '3\nwater molecule\nO 0.000000 0.000000 0.000000\n' +
    'H 0.757000 0.586000 0.000000\nH -0.757000 0.586000 0.000000\n';

  var NACL_VESTA = [
    '#VESTA_FORMAT_VERSION 3.5.4',
    '',
    'CRYSTAL',
    '',
    'TITLE',
    'Rock salt from VESTA',
    '',
    'CELLP',
    ' 5.6402 5.6402 5.6402 90.0 90.0 90.0',
    ' 0 0 0 0 0 0',
    '',
    'GROUP',
    ' 225 1 F m -3 m',
    '',
    'SYMOP',
    ' 0.0 0.0 0.0 1 0 0 0 1 0 0 0 1 1',
    ' 0.0 0.5 0.5 1 0 0 0 1 0 0 0 1 1',
    ' 0.5 0.0 0.5 1 0 0 0 1 0 0 0 1 1',
    ' 0.5 0.5 0.0 1 0 0 0 1 0 0 0 1 1',
    ' -1.0 -1.0 -1.0 0 0 0 0 0 0 0 0 0',
    '',
    'STRUC',
    ' 1 Na Na1 1.0000 0.0000 0.0000 0.0000 4a 1',
    ' 0.0000 0.0000 0.0000 0.00',
    ' 2 Cl Cl1 1.0000 0.5000 0.0000 0.0000 4b 1',
    ' 0.0000 0.0000 0.0000 0.00',
    ' 0 0 0 0 0 0 0',
    '',
    'THERI 1',
    ' 1 Na 0.01'
  ].join('\n');

  // ================================================================= CIF ====
  test('CIF: rock-salt inline (cell/space group/symmetry/occupancy)', function (CL) {
    var s = CL.parsers.parseCif([
      'data_rock_salt',
      "_chemical_name_common 'Rock salt'",
      "_chemical_formula_sum 'Na Cl'",
      '_cell_length_a 5.6402',
      '_cell_length_b 5.6402',
      '_cell_length_c 5.6402',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      "_symmetry_space_group_name_H-M 'F m -3 m'",
      'loop_',
      '_symmetry_equiv_pos_site_id',
      '_symmetry_equiv_pos_as_xyz',
      "1 'x,y,z'",
      "2 'x,y+1/2,z+1/2'",
      "3 'x+1/2,y,z+1/2'",
      "4 'x+1/2,y+1/2,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      '_atom_site_occupancy',
      'Na1 Na 0.0 0.0 0.0 1.0',
      'Cl1 Cl 0.5 0.0 0.0 1.0'
    ].join('\n'), 'rock_salt.cif');
    eq(s.format, 'cif', 'format');
    eq(s.sourceName, 'rock_salt.cif', 'sourceName');
    eq(s.blockName, 'rock_salt', 'blockName');
    eq(s.title, 'Rock salt', 'title');
    eq(s.spaceGroup, 'F m -3 m', 'spaceGroup');
    eq(s.periodic, true, 'periodic');
    eq(s.symmetryExpanded, false, 'symmetryExpanded');
    near(s.cell.a, 5.6402, 1e-9, 'cell.a');
    near(s.cell.b, 5.6402, 1e-9, 'cell.b');
    near(s.cell.c, 5.6402, 1e-9, 'cell.c');
    near(s.cell.volume, 5.6402 * 5.6402 * 5.6402, 1e-6, 'cell.volume');
    eq(s.symops.length, 4, 'symops');
    eq(s.symmetryOperatorCount, 4, 'symmetryOperatorCount');
    eq(s.sites.length, 2, 'sites');
    eq(s.asymmetricAtomCount, 2, 'asymmetricAtomCount');
    eq(s.sites[0].label, 'Na1', 'site0 label');
    eq(s.sites[0].baseLabel, 'Na1', 'site0 baseLabel');
    eq(s.sites[0].element, 'Na', 'site0 element');
    eq(s.sites[0].z, 11, 'site0 z');
    vecNear(s.sites[0].frac, [0, 0, 0], 1e-12, 'site0 frac');
    vecNear(s.sites[0].cart, [0, 0, 0], 1e-12, 'site0 cart');
    eq(s.sites[1].element, 'Cl', 'site1 element');
    vecNear(s.sites[1].frac, [0.5, 0, 0], 1e-12, 'site1 frac');
    eq(s.sites[0].siteIndex, 0, 'site0 index');
    eq(s.sites[1].siteIndex, 1, 'site1 index');
    eq(s.sites[0].occupancy, 1, 'site0 occupancy');
    eq(s.sites[0].hasUiso, false, 'site0 hasUiso');
    eq(s.formula, 'Na Cl', 'formula');
    countsEqual(expandCounts(CL, s), { Na: 4, Cl: 4 }, 'NaCl expansion');
  });

  test('CIF: quoted / semicolon text fields', function (CL) {
    var s = CL.parsers.parseCif(SEMICOLON_CIF, 'semicolon.cif');
    eq(s.title, 'A title on two lines', 'multiline title');
    eq(s.sites.length, 1, 'sites');
    eq(s.sites[0].element, 'Si', 'element');
    near(s.cell.a, 4, 1e-12, 'cell.a');
  });

  test('CIF: lexical boundaries, numbers, Cartesian fallback and disorder', function (CL) {
    var s = CL.parsers.parseCif(LEXICAL_CIF, 'parse.cif');
    eq(s.title, "O'Brien crystal", 'apostrophe inside single quotes');
    near(s.cell.a, 10.0, 1e-12, '1.000(2)e1');
    near(s.cell.b, 10.0, 1e-12, 'cell.b');
    near(s.cell.c, 10.0, 1e-12, 'cell.c');
    near(s.cell.alpha, 90, 1e-12, 'default alpha');
    eq(s.symops.length, 1, 'symops');
    eq(s.symops[0].text, 'x, y, z', 'symop text');
    eq(s.sites.length, 3, 'sites');
    eq(s.sites[0].label, 'C#1', 'C#1 label keeps hash');
    eq(s.sites[0].element, 'C', 'C#1 element');
    vecNear(s.sites[0].cart, [1, 2, 3], 1e-12, 'Cartesian fallback');
    vecNear(s.sites[0].frac, [0.1, 0.2, 0.3], 1e-12, 'cart -> frac');
    vecNear(s.sites[1].frac, [0.2, 0.2, 0.3], 1e-12, 'C2 frac');
    vecNear(s.sites[1].cart, [2, 2, 3], 1e-12, 'C2 cart');
    eq(s.sites[0].disorderAssembly, 'A', 'assembly A');
    eq(s.sites[0].disorderGroup, '1', 'group 1');
    eq(s.sites[1].disorderGroup, '2', 'group 2');
    eq(s.sites[2].disorderAssembly, 'B', 'assembly B');
  });

  test('CIF: 1/3 fractions, occupancy and Uiso values, missing values', function (CL) {
    var s = CL.parsers.parseCif(NUMBERS_CIF, 'numbers.cif');
    near(s.cell.a, 10, 1e-12, 'a from 1.000(2)e1');
    near(s.cell.b, 10, 1e-12, 'b from 10.000(4)');
    near(s.cell.c, 5, 1e-12, 'c');
    eq(s.sites.length, 2, 'sites');
    near(s.sites[0].frac[0], 1 / 3, 1e-12, '1/3 x');
    near(s.sites[0].frac[1], 0.25, 1e-12, 'y');
    near(s.sites[0].occupancy, 0.75, 1e-12, 'occupancy');
    eq(s.sites[0].hasUiso, true, 'Si hasUiso');
    near(s.sites[0].uiso, 0.010, 1e-12, 'Uiso 0.010(2)');
    eq(s.sites[1].occupancy, 1, "'?' occupancy defaults to 1");
    eq(s.sites[1].hasUiso, false, "'.' Uiso is missing");
  });

  test('CIF: unquoted symmetry operation lines', function (CL) {
    var s = CL.parsers.parseCif(UNQUOTED_SYMMETRY_CIF, 'unquoted.cif');
    eq(s.symops.length, 2, 'two unquoted operations');
    eq(s.symops[0].text, 'x, y, z', 'op0 text');
    eq(s.symops[1].text, '-x, -y, -z', 'op1 text');
    vecNear(s.symops[1].m[0], [-1, 0, 0], 1e-12, 'op1 m0');
    vecNear(s.symops[1].m[1], [0, -1, 0], 1e-12, 'op1 m1');
    vecNear(s.symops[1].m[2], [0, 0, -1], 1e-12, 'op1 m2');
    countsEqual(expandCounts(CL, s), { C: 2 }, 'P-1 expansion');
  });

  test('CIF: symmetry operation with leading number (1 x,y,z)', function (CL) {
    var s = CL.parsers.parseCif([
      'data_leading',
      '_cell_length_a 4',
      '_cell_length_b 4',
      '_cell_length_c 4',
      '_symmetry_equiv_pos_as_xyz',
      '1 x,y,z',
      'loop_',
      '_atom_site_label',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 0.1 0.2 0.3'
    ].join('\n'), 'leading.cif');
    eq(s.symops.length, 1, 'symops');
    eq(s.symops[0].text, 'x,y,z', 'leading index stripped');
    vecNear(s.symops[0].t, [0, 0, 0], 1e-12, 'translation');
    vecNear(s.symops[0].m[0], [1, 0, 0], 1e-12, 'm0');
  });

  test('CIF: ParseCifNumber uncertainty / fraction / missing values', function (CL) {
    var num = CL.parsers._cif.parseCifNumber;
    ok(typeof num === 'function', 'parseCifNumber exposed for tests');
    near(num('1.234'), 1.234, 1e-12, '1.234');
    near(num('1.234(5)'), 1.234, 1e-12, '1.234(5)');
    near(num('1.000(2)e1'), 10, 1e-12, '1.000(2)e1');
    near(num('1/3'), 1 / 3, 1e-12, '1/3');
    near(num('-2/3'), -2 / 3, 1e-12, '-2/3');
    near(num('1 / 3'), 1 / 3, 1e-12, '1 / 3');
    near(num('.5'), 0.5, 1e-12, '.5');
    near(num('+1.5e-2'), 0.015, 1e-12, '+1.5e-2');
    eq(num('?'), null, '?');
    eq(num('.'), null, '.');
    eq(num(''), null, 'empty');
    eq(num('inf/2'), null, 'inf/2 (non-finite)');
    eq(num('1.2(3)4'), null, '1.2(3)4');
    eq(num('1/2/3'), null, '1/2/3');
    eq(num('(5)'), null, '(5)');
    eq(num('1/0'), null, 'division by zero');
    eq(num('abc'), null, 'non numeric');
  });

  test('CIF: symmetry-operation grammar (reference test_symmetry cases)', function (CL) {
    var parse = CL.parsers._cif.parseSymmetryOperation;
    ok(typeof parse === 'function', 'parseSymmetryOperation exposed for tests');

    var parsed = parse('-y, x-y, z+1/6');
    ok(!parsed.error, 'parse -y, x-y, z+1/6: ' + parsed.error);
    var op = parsed.op;
    eq(op.text, '-y, x-y, z+1/6', 'text keeps original expression');
    near(op.m[0][1], -1, 1e-12, 'm01');
    near(op.m[1][0], 1, 1e-12, 'm10');
    near(op.m[1][1], -1, 1e-12, 'm11');
    near(op.m[2][2], 1, 1e-12, 'm22');
    near(op.t[2], 1 / 6, 1e-12, 'tz');
    var f = [0.1, 0.2, 0.3];
    var p = [
      op.m[0][0] * f[0] + op.m[0][1] * f[1] + op.m[0][2] * f[2] + op.t[0],
      op.m[1][0] * f[0] + op.m[1][1] * f[1] + op.m[1][2] * f[2] + op.t[1],
      op.m[2][0] * f[0] + op.m[2][1] * f[1] + op.m[2][2] * f[2] + op.t[2]
    ];
    vecNear(p, [-0.2, -0.1, 0.3 + 1 / 6], 1e-12, 'apply');

    var identity = parse('1 x,y,z').op;
    near(identity.m[0][0], 1, 1e-12, 'identity m00');
    near(identity.m[1][1], 1, 1e-12, 'identity m11');
    near(identity.m[2][2], 1, 1e-12, 'identity m22');

    var third = parse('x-y, -x, -z+2/3').op;
    near(third.m[0][0], 1, 1e-12, 'm00');
    near(third.m[0][1], -1, 1e-12, 'm01');
    near(third.m[1][0], -1, 1e-12, 'm10');
    near(third.t[2], 2 / 3, 1e-12, 'tz');

    ok(parse('x*y, z, 0').error, 'rejects non-linear product');
    ok(parse('x, y').error, 'rejects two components');
    ok(parse('x, y, z+').error, 'rejects incomplete expression');
    ok(parse('x, y, 2x').error, 'rejects implicit multiplication');
    ok(parse('x, y, (z').error, 'rejects unbalanced parenthesis');
    ok(parse('x, y, z/0').error, 'rejects division by zero');
    ok(parse('x, y, z@').error, 'rejects unknown character');
    eq(parse('x, y, z, 0').error, '对称操作必须包含 x,y,z 三个分量', 'component count message');
  });

  test('CIF: IT-number fallback and single-value symmetry item', function (CL) {
    var s = CL.parsers.parseCif([
      'data_it_number',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      '_space_group_IT_number 152',
      '_space_group_symop_operation_xyz x,y,z',
      'loop_',
      '_atom_site_label',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'Si1 0.1 0.2 0.3'
    ].join('\n'), 'it_number.cif');
    eq(s.title, 'it_number', 'title falls back to block name');
    eq(s.spaceGroup, '#152', 'IT number prefixed with #');
    eq(s.symops.length, 1, 'single symmetry item becomes one op');
    eq(s.symops[0].text, 'x,y,z', 'single op text');
    eq(s.symmetryOperatorCount, 1, 'symmetryOperatorCount');
  });

  test('CIF: special-position duplicate removal (parser keeps all ops)', function (CL) {
    var s = CL.parsers.parseCif(SPECIAL_POSITIONS_CIF, 'special.cif');
    eq(s.symops.length, 3, 'three operations kept');
    eq(s.sites.length, 1, 'one asymmetric site');
    countsEqual(expandCounts(CL, s), { Na: 2 }, 'special positions collapse to 2');
  });

  test('CIF: type_symbol-only loops and alternate label columns', function (CL) {
    var typeOnly = CL.parsers.parseCif([
      'data_type_only',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'Na 0 0 0',
      'Cl .5 0 0'
    ].join('\n'), 'type_only.cif');
    eq(typeOnly.sites.length, 2, 'sites');
    eq(typeOnly.sites[0].element, 'Na', 'element from type symbol');
    eq(typeOnly.sites[0].label, 'Na1', 'label fallback element+row+1');
    eq(typeOnly.sites[1].label, 'Cl2', 'label fallback row 2');

    var atomId = CL.parsers.parseCif([
      'data_atom_id',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_atom_site_label_atom_id',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'Si1 0.1 0.2 0.3'
    ].join('\n'), 'atom_id.cif');
    eq(atomId.sites.length, 1, 'sites');
    eq(atomId.sites[0].label, 'Si1', '_atom_site_label_atom_id');
    eq(atomId.sites[0].element, 'Si', 'element from label_atom_id');

    var siteId = CL.parsers.parseCif([
      'data_site_id',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_atom_site_id',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'O1 0.1 0.2 0.3'
    ].join('\n'), 'site_id.cif');
    eq(siteId.sites[0].label, 'O1', '_atom_site_id label column');
    eq(siteId.sites[0].element, 'O', 'element from id label');
  });

  test('CIF: multiple data blocks pick the block with most atoms', function (CL) {
    var s = CL.parsers.parseCif(MULTI_BLOCK_CIF, 'multi.cif');
    eq(s.blockName, 'big', 'blockName');
    near(s.cell.a, 5, 1e-12, 'cell from big block');
    eq(s.sites.length, 2, 'sites from big block');
    ok(s.note.indexOf('多个结构数据块') !== -1, 'note mentions multiple blocks: ' + s.note);
  });

  test('CIF: block scoring prefers a block with a complete cell', function (CL) {
    var s = CL.parsers.parseCif(BLOCK_SCORE_CIF, 'score.cif');
    eq(s.blockName, 'with_cell', 'cell wins over more atoms');
    eq(s.sites.length, 1, 'sites');
    eq(s.periodic, true, 'periodic');
  });

  test('CIF: element inference from type_symbol / label / unknown element', function (CL) {
    var s = CL.parsers.parseCif(TYPE_INFERENCE_CIF, 'typed.cif');
    eq(s.sites.length, 3, 'sites');
    eq(s.sites[0].element, 'Ca', 'type_symbol wins (CA1 -> Ca)');
    eq(s.sites[0].z, 20, 'Ca z');
    eq(s.sites[1].element, 'Ca', 'type_symbol on unknown label');
    eq(s.sites[1].label, 'XX1', 'label kept');
    eq(s.sites[2].element, 'X', 'unknown element -> X');
    eq(s.sites[2].z, 0, 'unknown z -> 0');
    eq(s.sites[2].label, 'Qq2', 'unknown label kept');
  });

  test('CIF: multi-model file loads the first model only', function (CL) {
    var s = CL.parsers.parseCif(MULTI_MODEL_CIF, 'models.cif');
    eq(s.sites.length, 2, 'only model 1 sites');
    eq(s.sites[0].label, 'C1', 'first label');
    ok(s.note.indexOf('多个模型') !== -1, 'note mentions multiple models: ' + s.note);
  });

  test('CIF: atom-site items outside a loop form a one-row table', function (CL) {
    var s = CL.parsers.parseCif(SINGLE_ITEM_CIF, 'single.cif');
    eq(s.sites.length, 1, 'sites');
    eq(s.sites[0].element, 'O', 'element O');
    eq(s.sites[0].z, 8, 'z 8');
    eq(s.cell, null, 'no cell');
    eq(s.periodic, false, 'not periodic');
    vecNear(s.sites[0].cart, [1, 2, 3], 1e-12, 'cart');
    // C++ Atom.frac defaults to {0,0,0}; molecular sites keep it as a placeholder.
    vecNear(s.sites[0].frac, [0, 0, 0], 1e-12, 'frac placeholder without a cell');
    ok(s.note.indexOf('未发现完整晶胞参数') !== -1, 'note about missing cell: ' + s.note);
  });

  test('CIF: ParseError diagnostics (quotes, loop arity, coordinates, cells)', function (CL) {
    expectParseError(function () { CL.parsers.parseCif('', 'empty.cif'); }, 'CIF 文件为空', 0, 'empty');
    expectParseError(function () { CL.parsers.parseCif('data_x\n_atom_site_label \'oops\n', 'q.cif'); },
      '引号字段缺少结束引号', 2, 'unterminated quote');
    expectParseError(function () { CL.parsers.parseCif('data_x\n_chemical_name_common\n;\nunterminated\n', 's.cif'); },
      '分号文本字段缺少结束分号', 3, 'unterminated semicolon');
    expectParseError(function () {
      CL.parsers.parseCif('data_x\nloop_\n_atom_site.label\n_atom_site.fract_x\nC1 0.1 0.2\n', 'loop.cif');
    }, 'loop_ 数据项数量与列数不匹配', 2, 'loop arity');
    expectParseError(function () {
      CL.parsers.parseCif('data_x\n_cell_length_a 5\n_cell_length_b 5\n_cell_length_c 5\n' +
        '_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n', 'noatoms.cif');
    }, 'CIF 中未找到包含坐标的原子表', 0, 'no atom table');
    expectParseError(function () {
      CL.parsers.parseCif('data_x\nloop_\n_atom_site_label\n_atom_site_fract_x\n' +
        '_atom_site_fract_y\n_atom_site_fract_z\nNa1 0 0 0\n', 'nocell.cif');
    }, '原子使用分数坐标', 0, 'fractional coordinates without a cell');
  });

  test('CIF: invalid cell parameters are rejected', function (CL) {
    expectParseError(function () {
      CL.parsers.parseCif('data_x\n_cell_length_a 4\nloop_\n_atom_site_label\n' +
        '_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC1 0 0 0\n', 'incomplete.cif');
    }, '晶胞参数不完整', 0, 'incomplete cell');
    expectParseError(function () {
      CL.parsers.parseCif('data_x\n_cell_length_a 4\n_cell_length_b 4\n' +
        '_cell_length_c 4\n_cell_angle_alpha 0\nloop_\n_atom_site_label\n' +
        '_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC1 0 0 0\n', 'badangle.cif');
    }, '无效晶胞参数', 5, 'invalid angle');
  });

  test('CIF: per-row coordinate errors report the row line', function (CL) {
    var text = [
      'data_bad',
      'loop_',
      '_atom_site.label',
      '_atom_site.Cartn_x',
      '_atom_site.Cartn_y',
      '_atom_site.Cartn_z',
      'O1 0 0 0',
      'C1 0 0 inf/2'
    ].join('\n');
    var error = expectParseError(function () { CL.parsers.parseCif(text, 'bad.cif'); },
      '缺少有效的完整坐标', 8, 'bad coordinate row');
    eq(error.name, 'ParseError', 'name');
  });

  // ------------------------------------------------------------ library ----
  var LIBRARY = [
    {
      file: 'anatase.cif', block: '9008213', sg: 'I 41/a m d :1', title: 'Anatase',
      a: 3.7842, c: 9.5146, gamma: 90, volume: 136.25, symops: 32, sites: 2,
      expand: { Ti: 4, O: 8 }
    },
    {
      file: 'brookite.cif', block: '9004137', sg: 'P b c a', title: 'Brookite',
      a: 9.174, c: 5.138, gamma: 90, volume: 256.84, symops: 8, sites: 3,
      expand: { Ti: 8, O: 16 }
    },
    {
      file: 'calcite.cif', block: '9000965', sg: 'R -3 c :H', title: 'Calcite',
      a: 4.988, c: 17.061, gamma: 120, volume: 367.61, symops: 36, sites: 3,
      expand: { Ca: 6, C: 6, O: 18 }
    },
    {
      file: 'cooperite.cif', block: '1011334', sg: 'P 42/m m c', title: 'Cooperite',
      a: 3.47, c: 6.1, gamma: 90, volume: 73.45, symops: 16, sites: 2,
      expand: { Pt: 2, S: 2 }
    },
    {
      file: 'diamond.cif', block: '9011997', sg: 'F d -3 m :1', title: 'Diamond',
      a: 3.566986, c: 3.566986, gamma: 90, volume: 45.38, symops: 192, sites: 1,
      expand: { C: 8 }
    },
    {
      file: 'fluorite.cif', block: '9007060', sg: 'F m -3 m', title: 'Fluorite',
      a: 5.4631, c: 5.4631, gamma: 90, volume: 163.05, symops: 192, sites: 2,
      expand: { Ca: 4, F: 8 }
    },
    {
      file: 'halite.cif', block: '9003308', sg: 'F m -3 m', title: 'Halite',
      a: 5.6401, c: 5.6401, gamma: 90, volume: 179.42, symops: 192, sites: 2,
      expand: { Na: 4, Cl: 4 }
    },
    {
      file: 'perovskite.cif', block: '9006172', sg: 'P b n m', title: 'Perovskite',
      a: 5.3785, b: 5.4419, c: 7.64, gamma: 90, volume: 223.62, symops: 8, sites: 4,
      expand: { Ca: 4, Ti: 4, O: 12 }
    },
    {
      file: 'quartz.cif', block: '9013321', sg: 'P 32 2 1', title: 'Quartz',
      a: 4.913437, c: 5.405118, gamma: 120, volume: 113.01, symops: 6, sites: 2,
      expand: { Si: 3, O: 6 }
    },
    {
      file: 'rutile.cif', block: '9004141', sg: 'P 42/m n m', title: 'Rutile',
      a: 4.593, c: 2.959, gamma: 90, volume: 62.42, symops: 16, sites: 2,
      expand: { Ti: 2, O: 4 }
    },
    {
      file: 'sphalerite.cif', block: '1100043', sg: 'F -4 3 m', title: 'Sphalerite',
      a: 5.4145, c: 5.4145, gamma: 90, volume: 158.74, symops: 96, sites: 2,
      expand: { Zn: 4, S: 4 }
    },
    {
      file: 'wurtzite.cif', block: '1100044', sg: 'P 63 m c', title: 'Wurtzite',
      a: 3.8227, c: 6.2607, gamma: 120, volume: 79.23, symops: 12, sites: 2,
      expand: { Zn: 2, S: 2 }
    }
  ];

  LIBRARY.forEach(function (entry) {
    test('CIF library: ' + entry.file, function (CL) {
      var rel = 'web/data/library/' + entry.file;
      var text = readText(rel);
      eq(CL.parsers.detectFormat(text, rel), 'cif', 'detectFormat');
      var s = CL.parsers.parse(text, rel);
      eq(s.format, 'cif', 'format');
      eq(s.sourceName, entry.file, 'sourceName');
      eq(s.periodic, true, 'periodic');
      eq(s.symmetryExpanded, false, 'symmetryExpanded');
      eq(s.blockName, entry.block, 'blockName (COD id)');
      eq(s.spaceGroup, entry.sg, 'spaceGroup');
      eq(s.title, entry.title, 'title');
      ok(s.note === '', 'unexpected note: ' + s.note);
      ok(s.cell, 'cell present');
      near(s.cell.a, entry.a, 1e-4, 'cell.a');
      near(s.cell.c, entry.c, 1e-4, 'cell.c');
      near(s.cell.gamma, entry.gamma, 1e-6, 'cell.gamma');
      near(s.cell.volume, entry.volume, 0.02, 'cell.volume');
      eq(s.sites.length, entry.sites, 'asymmetric atom count');
      eq(s.asymmetricAtomCount, entry.sites, 'asymmetricAtomCount');
      eq(s.symops.length, entry.symops, 'symmetry operator count');
      eq(s.symmetryOperatorCount, entry.symops, 'symmetryOperatorCount');
      for (var i = 0; i < s.sites.length; i++) {
        eq(s.sites[i].siteIndex, i, 'siteIndex ' + i);
        ok(s.sites[i].frac !== null, 'site ' + i + ' has frac');
        ok(s.sites[i].cart !== null, 'site ' + i + ' has cart');
        ok(s.sites[i].z > 0, 'site ' + i + ' known element');
      }
      countsEqual(expandCounts(CL, s), entry.expand, 'expanded cell contents');
    });
  });

  test('CIF library: all 12 structures load and expose contract fields', function (CL) {
    var loaded = 0;
    var symbols = 0;
    LIBRARY.forEach(function (entry) {
      var s = parseFile(CL, 'web/data/library/' + entry.file);
      loaded++;
      symbols += s.sites.length;
      eq(s.format, 'cif', 'format');
      ok(s.title.length > 0, 'title');
      ok(s.blockName.length > 0, 'blockName');
      ok(s.spaceGroup.length > 0, 'spaceGroup');
      eq(typeof s.note, 'string', 'note');
      eq(s.periodic, true, 'periodic');
      eq(s.cell.aVec.length, 3, 'cell.aVec');
      eq(s.cell.bVec.length, 3, 'cell.bVec');
      eq(s.cell.cVec.length, 3, 'cell.cVec');
      ok(s.cell.volume > 0, 'cell.volume');
      for (var o = 0; o < s.symops.length; o++) {
        var op = s.symops[o];
        ok(Array.isArray(op.m) && op.m.length === 3, 'symop m shape');
        ok(op.t.length === 3, 'symop t');
        eq(typeof op.text, 'string', 'symop text');
        ok(op.text.length > 0, 'symop text content');
      }
    });
    eq(loaded, 12, 'all 12 library entries loaded');
    ok(symbols >= 26, 'library asymmetric site total');
  });

  test('CIF library: JSON round-trip keeps every number finite', function (CL) {
    LIBRARY.forEach(function (entry) {
      var s = parseFile(CL, 'web/data/library/' + entry.file);
      // JSON.stringify turns NaN/Infinity into null, so an exact round-trip
      // comparison also proves there are no non-finite numbers in the output.
      var roundTrip = JSON.stringify(JSON.parse(JSON.stringify(s)));
      eq(roundTrip, JSON.stringify(s), entry.file + ' JSON round-trip');
    });
    var examples = ['web/data/examples/quartz.cif',
      'web/data/examples/diamond.cif',
      'web/data/examples/srtio3.cif',
      'web/data/examples/nacl.vesta',
      'web/data/examples/water.xyz',
      'web/data/examples/benzene.xyz'];
    examples.forEach(function (rel) {
      var s = parseFile(CL, rel);
      eq(JSON.stringify(JSON.parse(JSON.stringify(s))), JSON.stringify(s), rel + ' JSON round-trip');
    });
  });

  test('CIF library: parser cells agree with CL.Math.buildCell', function (CL) {
    // The parsers build CellData with their own C++-faithful validation (they
    // need cl::SetFromParameters error texts), so make sure the shared math
    // helper produces the identical lattice basis and volume.
    ok(CL.Math && typeof CL.Math.buildCell === 'function', 'CL.Math.buildCell available');
    LIBRARY.forEach(function (entry) {
      var s = parseFile(CL, 'web/data/library/' + entry.file);
      var rebuilt = CL.Math.buildCell(s.cell.a, s.cell.b, s.cell.c,
        s.cell.alpha, s.cell.beta, s.cell.gamma);
      ok(rebuilt, entry.file + ': CL.Math.buildCell accepted parser parameters');
      near(rebuilt.volume, s.cell.volume, 1e-9, entry.file + ': volume');
      vecNear(rebuilt.aVec, s.cell.aVec, 1e-12, entry.file + ': aVec');
      vecNear(rebuilt.bVec, s.cell.bVec, 1e-12, entry.file + ': bVec');
      vecNear(rebuilt.cVec, s.cell.cVec, 1e-12, entry.file + ': cVec');
      // fracToCart / cartToFrac round-trips through the shared math layer too.
      var frac = [0.13, 0.27, 0.41];
      var cart = CL.Math.fracToCart(s.cell, frac);
      vecNear(CL.Math.cartToFrac(s.cell, cart), frac, 1e-9, entry.file + ': frac<->cart');
    });
  });

  // ----------------------------------------------------------- examples ----
  test('examples: quartz.cif (6 symmetry operations, Si3 O6)', function (CL) {
    var s = parseFile(CL, 'web/data/examples/quartz.cif');
    eq(s.format, 'cif', 'format');
    eq(s.blockName, 'alpha_quartz', 'blockName');
    eq(s.title, 'alpha-Quartz', 'title');
    eq(s.spaceGroup, 'P 3_1 2 1', 'spaceGroup');
    near(s.cell.a, 4.9134, 1e-4, 'a');
    near(s.cell.c, 5.4052, 1e-4, 'c');
    near(s.cell.gamma, 120, 1e-9, 'gamma');
    eq(s.symops.length, 6, 'symops');
    eq(s.sites.length, 2, 'asymmetric sites');
    eq(s.sites[0].element, 'Si', 'Si site');
    eq(s.sites[1].element, 'O', 'O site');
    eq(s.sites[1].hasUiso, true, 'Uiso present');
    near(s.sites[1].uiso, 0.0075, 1e-12, 'Uiso value');
    countsEqual(expandCounts(CL, s), { Si: 3, O: 6 }, 'quartz expansion');
  });

  test('examples: diamond.cif (no explicit symmetry operations)', function (CL) {
    var s = parseFile(CL, 'web/data/examples/diamond.cif');
    eq(s.format, 'cif', 'format');
    eq(s.title, 'Diamond', 'title');
    eq(s.spaceGroup, 'F d -3 m', 'spaceGroup');
    near(s.cell.a, 3.5670, 1e-4, 'a');
    eq(s.symops.length, 0, 'no symops');
    eq(s.sites.length, 8, 'eight input sites');
    eq(s.periodic, true, 'periodic');
    ok(s.note.indexOf('未提供对称操作') !== -1, 'missing symmetry note: ' + s.note);
    countsEqual(expandCounts(CL, s), { C: 8 }, 'identity expansion');
  });

  test('examples: srtio3.cif (5 sites, no symops)', function (CL) {
    var s = parseFile(CL, 'web/data/examples/srtio3.cif');
    eq(s.title, 'Strontium titanate', 'title');
    eq(s.spaceGroup, 'P m -3 m', 'spaceGroup');
    near(s.cell.a, 3.905, 1e-12, 'a');
    eq(s.symops.length, 0, 'no symops');
    eq(s.sites.length, 5, 'sites');
    eq(s.formula, 'Sr Ti O3', 'formula');
    var expected = {};
    for (var i = 0; i < s.sites.length; i++) expected[s.sites[i].element] = (expected[s.sites[i].element] || 0) + 1;
    countsEqual(expected, { Sr: 1, Ti: 1, O: 3 }, 'asymmetric site elements');
  });

  test('examples: nacl.vesta', function (CL) {
    var s = parseFile(CL, 'web/data/examples/nacl.vesta');
    eq(s.format, 'vesta', 'format');
    eq(s.title, 'Rock salt (NaCl)', 'title');
    eq(s.spaceGroup, 'F m -3 m', 'spaceGroup');
    eq(s.periodic, true, 'periodic');
    eq(s.symmetryExpanded, false, 'symmetryExpanded');
    near(s.cell.a, 5.6402, 1e-6, 'a');
    eq(s.symops.length, 4, 'SYMOP count');
    eq(s.symmetryOperatorCount, 4, 'symmetryOperatorCount');
    eq(s.sites.length, 2, 'sites');
    eq(s.sites[0].element, 'Na', 'Na');
    eq(s.sites[0].label, 'Na1', 'Na label');
    eq(s.sites[0].z, 11, 'Na z');
    eq(s.sites[1].element, 'Cl', 'Cl');
    vecNear(s.sites[0].frac, [0, 0, 0], 1e-12, 'Na frac');
    vecNear(s.sites[1].frac, [0.5, 0, 0], 1e-12, 'Cl frac');
    vecNear(s.sites[1].cart, [2.8201, 0, 0], 1e-6, 'Cl cart');
    eq(s.note, '', 'no note');
    countsEqual(expandCounts(CL, s), { Na: 4, Cl: 4 }, 'NaCl VESTA expansion');
  });

  test('examples: water.xyz', function (CL) {
    var s = parseFile(CL, 'web/data/examples/water.xyz');
    eq(s.format, 'xyz', 'format');
    eq(s.title, 'water (H2O)', 'title');
    eq(s.periodic, false, 'periodic');
    eq(s.cell, null, 'cell');
    eq(s.symops.length, 0, 'symops');
    eq(s.sites.length, 3, 'sites');
    eq(s.sites[0].element, 'O', 'O');
    eq(s.sites[1].element, 'H', 'H');
    eq(s.sites[1].z, 1, 'H z');
    vecNear(s.sites[0].frac, [0, 0, 0], 1e-12, 'molecular frac placeholder');
    eq(s.truncated, false, 'truncated');
    vecNear(s.sites[0].cart, [0, 0, 0], 1e-12, 'O cart');
    vecNear(s.sites[1].cart, [0.757, 0.586, 0], 1e-12, 'H cart');
    var oh = CL.Math.vec3.distance(s.sites[0].cart, s.sites[1].cart);
    near(oh, Math.sqrt(0.757 * 0.757 + 0.586 * 0.586), 1e-9, 'O-H distance');
    var hh = CL.Math.vec3.distance(s.sites[1].cart, s.sites[2].cart);
    near(hh, 1.514, 1e-3, 'H-H distance');
  });

  test('examples: benzene.xyz (12 atoms, C6H6)', function (CL) {
    var s = parseFile(CL, 'web/data/examples/benzene.xyz');
    eq(s.format, 'xyz', 'format');
    ok(s.title.indexOf('benzene') === 0, 'title: ' + s.title);
    eq(s.cell, null, 'cell');
    eq(s.sites.length, 12, 'sites');
    var elements = {};
    for (var i = 0; i < s.sites.length; i++) elements[s.sites[i].element] = (elements[s.sites[i].element] || 0) + 1;
    countsEqual(elements, { C: 6, H: 6 }, 'benzene composition');
    eq(s.sites[0].label, 'C', 'label kept as symbol');
    vecNear(s.sites[0].cart, [1.39, 0, 0], 1e-12, 'C cart');
  });

  // ---------------------------------------------------------------- XYZ ----
  test('XYZ: inline water molecule', function (CL) {
    var s = CL.parsers.parseXyz(WATER_XYZ, 'water.xyz');
    eq(s.format, 'xyz', 'format');
    eq(s.title, 'water molecule', 'comment as title');
    eq(s.periodic, false, 'periodic');
    eq(s.cell, null, 'cell');
    eq(s.sites.length, 3, 'sites');
    eq(s.sites[0].element, 'O', 'element O');
    eq(s.sites[2].cart[0], -0.757, 'negative coordinate');
    eq(s.asymmetricAtomCount, 3, 'asymmetricAtomCount');
    eq(s.symmetryOperatorCount, 0, 'symmetryOperatorCount');
  });

  test('XYZ: atomic numbers and unknown element tokens', function (CL) {
    var s = CL.parsers.parseXyz('2\nnumbers\n8 0 0 0\nX 1 0 0\n', 'numbers.xyz');
    eq(s.sites.length, 2, 'sites');
    eq(s.sites[0].element, 'O', '8 -> O');
    eq(s.sites[0].z, 8, 'z 8');
    eq(s.sites[1].element, 'X', 'X stays unknown');
    eq(s.sites[1].z, 0, 'unknown z 0');
    eq(s.title, 'numbers', 'comment');
  });

  test('XYZ: trailing # comments, declared-count mismatch and extra rows', function (CL) {
    var s = CL.parsers.parseXyz('1\nwith # comment\nC 1 2 3 # trailing comment\nO 9 9 9\n', 'hash.xyz');
    eq(s.sites.length, 1, 'stops at declared count');
    eq(s.sites[0].element, 'C', 'C');
    vecNear(s.sites[0].cart, [1, 2, 3], 1e-12, 'cart');
    ok(s.title.indexOf('with # comment') === 0, 'comment title');
    var short = CL.parsers.parseXyz('3\nshort\nC 0 0 0\n', 'short.xyz');
    ok(short.note.indexOf('声明了 3 个原子') !== -1, 'count mismatch note: ' + short.note);
  });

  test('XYZ: leading blank lines are skipped', function (CL) {
    var s = CL.parsers.parseXyz('\n\n1\ncomment\nC 0 0 0\n', 'blank.xyz');
    eq(s.sites.length, 1, 'sites');
    eq(s.title, 'comment', 'title');
  });

  test('XYZ: ParseError diagnostics', function (CL) {
    expectParseError(function () { CL.parsers.parseXyz('   \n', 'empty.xyz'); }, 'XYZ 文件为空', 0, 'empty');
    expectParseError(function () { CL.parsers.parseXyz('abc\ncomment\n', 'bad.xyz'); },
      'XYZ 第一行必须是原子数', 1, 'bad count');
    expectParseError(function () { CL.parsers.parseXyz('1\ncomment\nC 1 2\n', 'short.xyz'); },
      'XYZ 原子行需要元素符号和三个坐标', 3, 'short row');
    expectParseError(function () { CL.parsers.parseXyz('1\ncomment\nC 1 2 x\n', 'nan.xyz'); },
      'XYZ 坐标不是有效数字', 3, 'bad coordinate');
    expectParseError(function () { CL.parsers.parseXyz('1\ncomment\n', 'noatoms.xyz'); },
      'XYZ 文件中没有可读取的原子', 0, 'no atoms');
  });

  test('XYZ: atom count truncates at 30000', function (CL) {
    var declared = 30001;
    var lines = [String(declared), 'large molecule'];
    for (var i = 0; i < declared; i++) {
      lines.push('C ' + (i % 10) + ' ' + (i % 7) + ' ' + (i % 5));
    }
    var s = CL.parsers.parseXyz(lines.join('\n'), 'large.xyz');
    eq(s.sites.length, 30000, 'sites truncated to kMaxDisplayAtoms');
    eq(s.truncated, true, 'truncated flag');
    eq(s.asymmetricAtomCount, 30000, 'asymmetricAtomCount');
    ok(s.note.indexOf('原子数超过限制') !== -1, 'truncation note: ' + s.note);
  });

  // -------------------------------------------------------------- VESTA ----
  test('VESTA: inline rock salt (SYMOP/STRUC/TITLE/GROUP/CELLP)', function (CL) {
    var s = CL.parsers.parseVesta(NACL_VESTA, 'nacl.vesta');
    eq(s.format, 'vesta', 'format');
    eq(s.title, 'Rock salt from VESTA', 'title');
    eq(s.spaceGroup, 'F m -3 m', 'spaceGroup');
    eq(s.symops.length, 4, 'symops (zero-rotation terminator ignored)');
    eq(s.symmetryOperatorCount, 4, 'symmetryOperatorCount');
    eq(s.sites.length, 2, 'sites');
    eq(s.sites[0].label, 'Na1', 'Na label');
    eq(s.sites[1].label, 'Cl1', 'Cl label');
    eq(s.sites[0].occupancy, 1, 'occupancy');
    eq(s.sites[0].siteIndex, 0, 'siteIndex 0');
    eq(s.sites[1].siteIndex, 1, 'siteIndex 1');
    near(s.cell.a, 5.6402, 1e-6, 'a');
    ok(Array.isArray(s.symops[0].m), 'symop matrix');
    ok(s.symops[0].text.length > 0, 'symop text');
    countsEqual(expandCounts(CL, s), { Na: 4, Cl: 4 }, 'VESTA expansion');
  });

  test('VESTA: STRUC before CELLP still gets Cartesian coordinates', function (CL) {
    var text = [
      '#VESTA_FORMAT_VERSION 3.5.4',
      'CRYSTAL',
      'TITLE',
      'Late CELLP',
      'STRUC',
      ' 1 Si Si1 1.0 0.250000 0.000000 0.000000 0 0',
      ' 0 0 0 0 0 0 0',
      'CELLP',
      ' 4.0 4.0 4.0 90.0 90.0 90.0',
      'GROUP',
      ' 1 1 P 1',
      'SYMOP',
      ' 0 0 0 1 0 0 0 1 0 0 0 1',
      'STRUC',
      ' 1 Si Si1 1.0 0.250000 0.000000 0.000000 0 0',
      ' 0 0 0 0 0 0 0'
    ].join('\n');
    var s = CL.parsers.parseVesta(text, 'late.vesta');
    near(s.cell.a, 4, 1e-12, 'cell a');
    eq(s.sites.length, 2, 'sites from both STRUC sections');
    vecNear(s.sites[0].cart, [1, 0, 0], 1e-12, 'filled cart');
    eq(s.spaceGroup, 'P 1', 'space group from GROUP name');
  });

  test('VESTA: format detection by content and ParseError diagnostics', function (CL) {
    eq(CL.parsers.detectFormat(NACL_VESTA, 'unknown.dat'), 'vesta', 'content sniffing');
    eq(CL.parsers.detectFormat('#VESTA_FORMAT_VERSION 3.5.4\n', 'noext'), 'vesta', 'header only');
    expectParseError(function () { CL.parsers.parseVesta('CRYSTAL\nTITLE\nx\nSTRUC\n1 C C1 1 0 0 0\n', 'nocell.vesta'); },
      'VESTA 文件中缺少有效的 CELLP 晶胞参数', 0, 'missing CELLP');
    expectParseError(function () {
      CL.parsers.parseVesta('CRYSTAL\nCELLP\n 4 4 4 90 90 90\nGROUP\n 1 1 P 1\n', 'noatoms.vesta');
    }, 'VESTA 文件中没有可读取的 STRUC 原子', 0, 'missing STRUC');
    expectParseError(function () {
      CL.parsers.parseVesta('CRYSTAL\nCELLP\n 4 4 4 90 90 0\n', 'badcell.vesta');
    }, 'VESTA 晶胞参数无效', 3, 'invalid cell');
  });

  test('VESTA: only the first CRYSTAL block is loaded', function (CL) {
    var text = [
      '#VESTA_FORMAT_VERSION 3.5.4',
      'CRYSTAL',
      'TITLE',
      'First',
      'CELLP',
      ' 3 3 3 90 90 90',
      'STRUC',
      ' 1 C C1 1 0 0 0 0 0',
      ' 0 0 0 0 0 0 0',
      'CRYSTAL',
      'TITLE',
      'Second',
      'CELLP',
      ' 9 9 9 90 90 90',
      'STRUC',
      ' 1 O O1 1 0 0 0 0 0',
      ' 0 0 0 0 0 0 0'
    ].join('\n');
    var s = CL.parsers.parseVesta(text, 'crystals.vesta');
    eq(s.title, 'First', 'first title');
    near(s.cell.a, 3, 1e-12, 'first cell');
    eq(s.sites.length, 1, 'first block sites only');
    eq(s.sites[0].element, 'C', 'first block element');
  });

  // ---------------------------------------------------------- facade -------
  test('parsers: detectFormat by extension, content and fallback', function (CL) {
    eq(CL.parsers.detectFormat('whatever', 'a.cif'), 'cif', '.cif');
    eq(CL.parsers.detectFormat('whatever', 'A.CIF'), 'cif', '.CIF case');
    eq(CL.parsers.detectFormat('whatever', 'a.mcif'), 'cif', '.mcif');
    eq(CL.parsers.detectFormat('whatever', 'a.xyz'), 'xyz', '.xyz');
    eq(CL.parsers.detectFormat('whatever', 'a.vesta'), 'vesta', '.vesta');
    eq(CL.parsers.detectFormat('data_x\n', 'unknown.txt'), 'cif', 'data_ header');
    eq(CL.parsers.detectFormat('_cell_length_a 5\n', 'unknown.txt'), 'cif', '_cell_ header');
    eq(CL.parsers.detectFormat('_atom_site_label\n', 'unknown.txt'), 'cif', '_atom_site header');
    eq(CL.parsers.detectFormat('#VESTA_FORMAT_VERSION 3\n', 'unknown.txt'), 'vesta', 'VESTA header');
    eq(CL.parsers.detectFormat('3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n', 'unknown.txt'), 'xyz', 'XYZ sniff');
    eq(CL.parsers.detectFormat('hello world\n', 'unknown.txt'), 'cif', 'C++ fallback is CIF');
    eq(CL.parsers.detectFormat('', 'unknown.txt'), null, 'empty text');
    eq(CL.parsers.detectFormat(null, 'a.cif'), null, 'null text');
  });

  test('parsers: parse() dispatches by format and throws CL.ParseError', function (CL) {
    eq(CL.parsers.parse(LEXICAL_CIF, 'x.cif').format, 'cif', 'cif dispatch');
    eq(CL.parsers.parse(WATER_XYZ, 'x.xyz').format, 'xyz', 'xyz dispatch');
    eq(CL.parsers.parse(NACL_VESTA, 'x.vesta').format, 'vesta', 'vesta dispatch');
    eq(CL.parsers.parse(LEXICAL_CIF, 'no_extension').format, 'cif', 'content dispatch cif');
    eq(CL.parsers.parse(WATER_XYZ, 'no.extension').format, 'xyz', 'content dispatch xyz');
    eq(CL.parsers.parse(NACL_VESTA, 'no.extension').format, 'vesta', 'content dispatch vesta');
    eq(CL.parsers.parse(WATER_XYZ, 'water.xyz').sourceName, 'water.xyz', 'sourceName');

    var error = expectParseError(function () { CL.parsers.parse('', 'empty.cif'); }, '文件为空', 0, 'empty file');
    ok(error instanceof Error, 'ParseError extends Error');
    expectParseError(function () { CL.parsers.parse('hello world\n', 'unknown.txt'); },
      'CIF 中未找到包含坐标的原子表', 0, 'garbage follows CIF fallback');
    var nameError = null;
    try { CL.parsers.parse('3\nshort\nC 0 0\n', 'bad.xyz'); } catch (e) { nameError = e; }
    ok(nameError && nameError.name === 'ParseError', 'ParseError name');
    ok(typeof nameError.line === 'number', 'ParseError line is a number');
  });

  test('StructureData: CONTRACT 5.1 shape and JSON round-trip', function (CL) {
    var structure = parseFile(CL, 'web/data/library/halite.cif');
    var required = ['format', 'sourceName', 'title', 'blockName', 'spaceGroup', 'note', 'periodic',
      'truncated', 'cell', 'symops', 'sites', 'symmetryExpanded', 'asymmetricAtomCount', 'symmetryOperatorCount'];
    required.forEach(function (key) {
      ok(Object.prototype.hasOwnProperty.call(structure, key), 'missing StructureData.' + key);
    });
    var cellKeys = ['a', 'b', 'c', 'alpha', 'beta', 'gamma', 'aVec', 'bVec', 'cVec', 'volume'];
    cellKeys.forEach(function (key) {
      ok(Object.prototype.hasOwnProperty.call(structure.cell, key), 'missing CellData.' + key);
    });
    var siteKeys = ['label', 'baseLabel', 'element', 'z', 'frac', 'cart', 'occupancy', 'uiso',
      'hasUiso', 'disorderGroup', 'disorderAssembly', 'siteIndex'];
    structure.sites.forEach(function (site) {
      siteKeys.forEach(function (key) {
        ok(Object.prototype.hasOwnProperty.call(site, key), 'missing Site.' + key);
      });
    });
    var roundTrip = JSON.parse(JSON.stringify(structure));
    eq(JSON.stringify(roundTrip), JSON.stringify(structure), 'JSON round-trip');
    // A molecular structure must stay JSON-safe too (null cell / frac).
    var water = parseFile(CL, 'web/data/examples/water.xyz');
    eq(JSON.stringify(JSON.parse(JSON.stringify(water))), JSON.stringify(water), 'XYZ JSON round-trip');
    eq(structure.periodic, true, 'halite periodic');
    eq(water.periodic, false, 'water not periodic');
    eq(water.cell, null, 'water cell null');
  });
})();
