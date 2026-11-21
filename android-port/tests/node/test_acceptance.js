/**
 * CrystalLens Android - QA acceptance tests (docs/QA-ACCEPTANCE.md §1 + §2).
 *
 * Harness: tests/node/run.js loads the DOM-free core scripts into one VM
 * context, then executes every tests/node/test_*.js. This file only uses the
 * globals provided by the harness: `test(name, fn)`, `approx`, `approxVec`,
 * `readText(relPath)`, `repoRoot`.
 *
 * Every group is gated on the presence of the required `CL.*` API: while the
 * parallel implementation agents are still landing crystal.js / measure.js /
 * edit.js / export.js, the group is skipped and recorded (printed as
 * `[SKIP] acceptance ...` at the end of the file) instead of failing. Once the
 * files exist the exact baseline from QA-ACCEPTANCE is asserted.
 *
 * Coverage map:
 *   §1 parsing : 12 library CIF, halite values, gamma=120, 6 examples,
 *                CIF lexical edges, unknown element, periodic table.
 *   §2 model   : halite/quartz/diamond/water/Bi2Te3 bonds, disorder exclusion,
 *                display sets 27/125/343/64, polyhedra 63, supercell capacity,
 *                ids/kind/stats/origin/lines, perf, measurement (minimum image
 *                + offset, water angle), editing round-trips, export CIF/XYZ,
 *                JSON round-trip.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- helpers ---
  function api(CL, path) {
    var parts = String(path).split('.');
    var cur = CL;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** First defined function among alternative dotted paths (e.g. export.js may
   *  expose CL.crystal.exportCif or CL.export.exportCif). */
  function pickFn(CL, paths) {
    for (var i = 0; i < paths.length; i++) {
      var v = api(CL, paths[i]);
      if (typeof v === 'function') return v;
    }
    return null;
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }
  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(actual));
    }
  }
  function near(actual, expected, eps, msg) {
    if (!(typeof actual === 'number' && isFinite(actual) && Math.abs(actual - expected) <= eps)) {
      throw new Error((msg || 'near') + ': expected ' + expected + ' +/- ' + eps +
        ', got ' + actual);
    }
  }
  function nearVec(actual, expected, eps, msg) {
    assert(actual && actual.length >= expected.length, (msg || 'vec') + ': bad value ' + JSON.stringify(actual));
    for (var i = 0; i < expected.length; i++) {
      near(actual[i], expected[i], eps, (msg || 'vec') + '[' + i + ']');
    }
  }

  var skips = [];
  var groupStatus = {};

  /** Register one acceptance group. `required` is a list of dotted paths whose
   *  presence gates the group (any-alternative groups are arrays). */
  function T(name, required, fn) {
    test('acceptance :: ' + name, function (CL) {
      var missing = [];
      for (var i = 0; i < required.length; i++) {
        var spec = required[i];
        var paths = typeof spec === 'string' ? [spec] : spec;
        var found = false;
        for (var j = 0; j < paths.length; j++) {
          var v = api(CL, paths[j]);
          if (v !== undefined && v !== null) { found = true; break; }
        }
        if (!found) missing.push(typeof spec === 'string' ? spec : spec[0]);
      }
      if (missing.length) {
        groupStatus[name] = 'skip';
        skips.push('[SKIP] acceptance :: ' + name + '  (not ready: ' + missing.join(', ') + ')');
        return;
      }
      groupStatus[name] = 'pass';
      try {
        fn(CL);
      } catch (e) {
        groupStatus[name] = 'fail';
        throw e;
      }
    });
  }

  // ------------------------------------------------------------ fixtures ---
  var LIBRARY_IDS = [
    'halite', 'fluorite', 'perovskite', 'cooperite', 'rutile', 'brookite',
    'anatase', 'sphalerite', 'wurtzite', 'diamond', 'quartz', 'calcite'
  ];

  function libPath(id) { return 'web/data/library/' + id + '.cif'; }
  function examplePath(name) { return 'web/data/examples/' + name; }

  function parse(CL, relPath, fileName) {
    return CL.parsers.parse(readText(relPath), fileName || relPath.split('/').pop());
  }

  /** finalize = expand + buildBonds + summary (tolerate missing entry points). */
  function finalize(CL, structure) {
    var s = structure;
    var fin = pickFn(CL, ['crystal.finalize']);
    if (fin) {
      var out = fin(s);
      if (out && out !== s) s = out;
      if (s && Array.isArray(s.atoms) && s.atoms.length > 0) return s;
    }
    var expand = pickFn(CL, ['crystal.expand']);
    if (expand) { var e = expand(s); if (e && e !== s) s = e; }
    var build = pickFn(CL, ['crystal.buildBonds']);
    if (build) { var b = build(s); if (b && b !== s) s = b; }
    var summary = pickFn(CL, ['crystal.computeSummary']);
    if (summary) summary(s);
    return s;
  }

  function parsedAndFinalized(CL, relPath, fileName) {
    return finalize(CL, parse(CL, relPath, fileName));
  }

  function halite(CL) { return parsedAndFinalized(CL, libPath('halite'), 'halite.cif'); }

  function displayModel(CL, structure, opts) {
    var fn = pickFn(CL, ['crystal.buildDisplayModel']);
    assert(fn, 'CL.crystal.buildDisplayModel is not defined');
    return fn(structure, opts || { supercell: [1, 1, 1], showBoundary: true });
  }

  function areBondsValid(CL) {
    return pickFn(CL, ['crystal.buildBonds']) !== null;
  }

  function atomElementCounts(structure) {
    var counts = {};
    var atoms = structure.atoms || [];
    for (var i = 0; i < atoms.length; i++) {
      counts[atoms[i].element] = (counts[atoms[i].element] || 0) + 1;
    }
    return counts;
  }

  function bondElementPairs(structure) {
    var out = [];
    var bonds = structure.bonds || [];
    for (var i = 0; i < bonds.length; i++) {
      var a = (structure.atoms || [])[bonds[i].a];
      var b = (structure.atoms || [])[bonds[i].b];
      if (!a || !b) continue;
      out.push([a.element, b.element, bonds[i].length]);
    }
    return out;
  }

  function applyEditResult(res, structure) {
    assert(res && typeof res === 'object', 'edit API must return {ok, structure|error}');
    if (!res.ok) return null;
    return res.structure || structure;
  }
  function expectEditFailure(res, label) {
    assert(res && typeof res === 'object', label + ': edit API must return {ok, ...}');
    assert(res.ok === false, label + ': expected {ok:false}, got ' + JSON.stringify(res && res.ok));
    assert(res.error, label + ': expected a non-empty error message');
  }

  function measureDistance(CL, structure, a, b) {
    var fn = pickFn(CL, ['crystal.measureDistance', 'measure.measureDistance', 'measure.distance']);
    if (!fn) return null;
    var out = fn(structure, a, b);
    if (typeof out === 'number') return { value: out };
    if (out && typeof out.value === 'number') return out;
    return null;
  }

  function measureAngle(CL, structure, a, b, c) {
    var fn = pickFn(CL, ['crystal.makeAngleMeasurement', 'measure.makeAngleMeasurement']);
    if (fn) {
      var m = fn(structure, a, b, c);
      if (m && typeof m.value === 'number') return { value: m.value, measurement: m };
      if (typeof m === 'boolean') return { ok: m };
      if (m === null) return null;
    }
    var plain = pickFn(CL, ['crystal.measureAngle', 'measure.measureAngle', 'measure.angle']);
    if (plain) {
      var nested = pickFn(CL, ['crystal.makeAngleMeasurement', 'measure.makeAngleMeasurement']);
      var r = plain(structure, a, b, c);
      if (typeof r === 'number') return { value: r };
      if (r && typeof r.value === 'number') return r;
      if (typeof r === 'boolean') {
        if (!r) return null;
        if (nested) {
          var mm = nested(structure, a, b, c);
          if (mm && typeof mm.value === 'number') return { value: mm.value, measurement: mm };
        }
        return { ok: true };
      }
    }
    return null;
  }

  function offsetB(measurement) {
    if (!measurement) return null;
    if (Array.isArray(measurement.offsetB)) return measurement.offsetB;
    if (Array.isArray(measurement.offsets)) {
      if (measurement.offsets.length >= 3) return measurement.offsets[1];
      if (measurement.offsets.length === 2) return measurement.offsets[1];
    }
    if (Array.isArray(measurement.offset)) return measurement.offset;
    return null;
  }

  function exportCif(CL, structure) {
    var fn = pickFn(CL, ['crystal.exportCif', 'export.exportCif']);
    assert(fn, 'CL.crystal.exportCif / CL.export.exportCif is not defined');
    var text = fn(structure);
    assert(typeof text === 'string' && text.length > 0, 'exportCif must return a non-empty string');
    return text;
  }

  function exportXyz(CL, structure) {
    var fn = pickFn(CL, ['crystal.exportXyz', 'export.exportXyz']);
    assert(fn, 'CL.crystal.exportXyz / CL.export.exportXyz is not defined');
    var text = fn(structure);
    assert(typeof text === 'string' && text.length > 0, 'exportXyz must return a non-empty string');
    return text;
  }

  function nonEmptyLines(text) {
    return text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.trim().length > 0; });
  }

  // =========================================================================
  // §1 解析层（CL.parsers）  // =========================================================================

  T('§1.1 12 library CIF parse + valid metadata', ['parsers.parse'], function (CL) {
    for (var i = 0; i < LIBRARY_IDS.length; i++) {
      var id = LIBRARY_IDS[i];
      var s;
      try {
        s = parse(CL, libPath(id));
      } catch (e) {
        throw new Error('library/' + id + ': parse threw: ' + (e && e.message || e));
      }
      eq(s.format, 'cif', id + ': format');
      eq(s.periodic, true, id + ': periodic');
      assert(s.cell, id + ': missing cell');
      assert(s.cell.a > 0 && s.cell.b > 0 && s.cell.c > 0, id + ': cell lengths must be > 0');
      assert(s.cell.alpha > 0 && s.cell.alpha < 180, id + ': alpha out of range');
      assert(s.cell.beta > 0 && s.cell.beta < 180, id + ': beta out of range');
      assert(s.cell.gamma > 0 && s.cell.gamma < 180, id + ': gamma out of range');
      assert(s.cell.volume > 0, id + ': cell volume must be > 0');
      assert(Array.isArray(s.symops) && s.symops.length > 0, id + ': symops must be non-empty');
      assert(Array.isArray(s.sites) && s.sites.length > 0, id + ': sites must be non-empty');
      for (var k = 0; k < s.sites.length; k++) {
        eq(s.sites[k].siteIndex, k, id + ': sites[' + k + '].siteIndex must be continuous');
        assert(s.sites[k].element && s.sites[k].element !== '', id + ': sites[' + k + '] missing element');
        assert(s.sites[k].occupancy > 0 && s.sites[k].occupancy <= 1,
          id + ': sites[' + k + '] occupancy must be in (0,1]');
        assert(s.sites[k].frac && s.sites[k].frac.length === 3,
          id + ': sites[' + k + '] missing frac');
      }
      eq(s.asymmetricAtomCount, s.sites.length, id + ': asymmetricAtomCount');
      eq(s.symmetryOperatorCount, s.symops.length, id + ': symmetryOperatorCount');
    }
  });

  T('§1.2 halite exact values', ['parsers.parse'], function (CL) {
    var s = parse(CL, libPath('halite'));
    near(s.cell.a, 5.6401, 1e-6, 'halite a');
    near(s.cell.b, 5.6401, 1e-6, 'halite b');
    near(s.cell.c, 5.6401, 1e-6, 'halite c');
    near(s.cell.alpha, 90, 1e-9, 'halite alpha');
    near(s.cell.beta, 90, 1e-9, 'halite beta');
    near(s.cell.gamma, 90, 1e-9, 'halite gamma');
    assert(String(s.spaceGroup).indexOf('F m -3 m') >= 0,
      'halite space group expected to contain "F m -3 m", got ' + JSON.stringify(s.spaceGroup));
    eq(s.sites.length, 2, 'halite asymmetric sites');
    var elements = s.sites.map(function (x) { return x.element; }).sort();
    eq(JSON.stringify(elements), JSON.stringify(['Cl', 'Na']), 'halite site elements');
  });

  T('§1.3 trigonal gamma=120 (wurtzite/quartz/calcite) + others sane', ['parsers.parse'], function (CL) {
    ['wurtzite', 'quartz', 'calcite'].forEach(function (id) {
      var s = parse(CL, libPath(id));
      near(s.cell.gamma, 120, 1e-6, id + ': gamma must be 120');
      near(s.cell.alpha, 90, 1e-6, id + ': alpha must be 90');
      near(s.cell.beta, 90, 1e-6, id + ': beta must be 90');
    });
    // orthorhombic / tetragonal sanity for the remaining cells
    [['perovskite', 90, 90, 90], ['cooperite', 90, 90, 90], ['rutile', 90, 90, 90],
     ['brookite', 90, 90, 90], ['anatase', 90, 90, 90]].forEach(function (row) {
      var s = parse(CL, libPath(row[0]));
      near(s.cell.alpha, row[1], 1e-6, row[0] + ': alpha');
      near(s.cell.beta, row[2], 1e-6, row[0] + ': beta');
      near(s.cell.gamma, row[3], 1e-6, row[0] + ': gamma');
    });
  });

  T('§1.4 six examples: format + periodic flags', ['parsers.parse'], function (CL) {
    var expect = [
      ['quartz.cif', 'cif', true],
      ['diamond.cif', 'cif', true],
      ['srtio3.cif', 'cif', true],
      ['nacl.vesta', 'vesta', true],
      ['water.xyz', 'xyz', false],
      ['benzene.xyz', 'xyz', false]
    ];
    for (var i = 0; i < expect.length; i++) {
      var row = expect[i];
      var s = parse(CL, examplePath(row[0]), row[0]);
      eq(s.format, row[1], row[0] + ': format');
      eq(s.periodic, row[2], row[0] + ': periodic');
      assert(s.sites.length > 0, row[0] + ': no sites');
      if (row[2]) {
        assert(s.cell && s.cell.a > 0, row[0] + ': missing cell');
      } else {
        assert(!s.cell, row[0] + ': molecular structure must not have a cell');
      }
    }
    var nacl = parse(CL, examplePath('nacl.vesta'), 'nacl.vesta');
    assert(String(nacl.spaceGroup).indexOf('F m -3 m') >= 0,
      'nacl.vesta space group expected "F m -3 m", got ' + JSON.stringify(nacl.spaceGroup));
    eq(nacl.symops.length, 4, 'nacl.vesta symops (file lists 4)');
    var water = parse(CL, examplePath('water.xyz'), 'water.xyz');
    eq(water.sites.length, 3, 'water.xyz sites');
    var benzene = parse(CL, examplePath('benzene.xyz'), 'benzene.xyz');
    eq(benzene.sites.length, 12, 'benzene.xyz sites');
  });

  T('§1.5 CIF lexical edges (unquoted symops, 1.234(5), 1/3)', ['parsers.parse'], function (CL) {
    var unquoted = [
      'data_unquoted_symops',
      '_cell_length_a 5',
      '_cell_length_b 6',
      '_cell_length_c 7',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      '_symmetry_space_group_name_H-M \'P -1\'',
      '_symmetry_equiv_pos_as_xyz',
      'x, y, z',
      '-x, -y, -z',
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0.1 0.2 0.3',
      ''
    ].join('\n');
    var su = CL.parsers.parseCif ? CL.parsers.parseCif(unquoted, 'unquoted.cif')
      : CL.parsers.parse(unquoted, 'unquoted.cif');
    eq(su.symops.length, 2, 'unquoted symops count');
    eq(su.sites.length, 1, 'unquoted sites');
    near(su.symops[1].m[0][0], -1, 1e-12, 'unquoted op2 matrix');

    var numbers = [
      'data_numbers',
      '_cell_length_a 1.234(5)',
      '_cell_length_b 1.000(2)e1',
      '_cell_length_c 10',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      '\'x+1/3,y,z\'',
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'Si1 Si 1/3 0 0',
      ''
    ].join('\n');
    var sn = CL.parsers.parseCif ? CL.parsers.parseCif(numbers, 'numbers.cif')
      : CL.parsers.parse(numbers, 'numbers.cif');
    near(sn.cell.a, 1.234, 1e-6, '1.234(5) must drop the uncertainty');
    near(sn.cell.b, 10.0, 1e-6, '1.000(2)e1 must keep the exponent');
    near(sn.cell.c, 10.0, 1e-6, 'plain integer cell length');
    near(sn.symops[0].t[0], 1 / 3, 1e-9, 'symop 1/3 translation');
    near(sn.sites[0].frac[0], 1 / 3, 1e-9, 'fractional coordinate 1/3');
  });

  T('§1.5b unquoted symops expand + isolated atom has no bonds', ['crystal', 'parsers.parse'], function (CL) {
    var unquoted = [
      'data_unquoted_symops',
      '_cell_length_a 5',
      '_cell_length_b 6',
      '_cell_length_c 7',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      '_symmetry_space_group_name_H-M \'P -1\'',
      '_symmetry_equiv_pos_as_xyz',
      'x, y, z',
      '-x, -y, -z',
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0.1 0.2 0.3',
      ''
    ].join('\n');
    var parseCif = CL.parsers.parseCif || function (t, n) { return CL.parsers.parse(t, n); };
    var su2 = finalize(CL, parseCif(unquoted, 'unquoted.cif'));
    eq(su2.atoms.length, 2, 'unquoted: expanded atoms (P-1)');
    eq(su2.bonds.length, 0, 'unquoted: single C at 0.1/0.2/0.3 in 5x6x7 must not bond');
  });

  T('§1.6 CIF edges: apostrophe title, type_symbol priority, multi block, multi model', ['parsers.parse'], function (CL) {
    var parseCif = CL.parsers.parseCif || function (t, n) { return CL.parsers.parse(t, n); };

    // apostrophe inside a quoted title (same fixture as C++ test_core)
    var apos = [
      'data_apos',
      "_chemical_name_common 'O'Brien crystal'",
      '_cell_length_a 10',
      '_cell_length_b 10',
      '_cell_length_c 10',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0.1 0.2 0.3',
      ''
    ].join('\n');
    var sp = parseCif(apos, 'apos.cif');
    assert(String(sp.title).indexOf("O'Brien") >= 0, "apostrophe title lost: " + JSON.stringify(sp.title));

    // _atom_site_type_symbol wins over label-inferred element
    var prio = [
      'data_priority',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 N 0 0 0',
      ''
    ].join('\n');
    var sq = parseCif(prio, 'priority.cif');
    eq(sq.sites[0].element, 'N', 'type_symbol must win over label "C1"');
    eq(sq.sites[0].z, 7, 'type_symbol N -> z=7');

    // label inference when type_symbol is absent (Bi2Te3 style: "Te1" -> Te)
    var infer = [
      'data_infer',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'Na1 0 0 0',
      'Cl2 0.5 0 0',
      ''
    ].join('\n');
    var si = parseCif(infer, 'infer.cif');
    eq(si.sites[0].element, 'Na', 'label Na1 -> Na');
    eq(si.sites[1].element, 'Cl', 'label Cl2 -> Cl');

    // multiple data blocks: keep the block with most atoms
    var multiBlock = [
      'data_first',
      '_cell_length_a 5',
      '_cell_length_b 5',
      '_cell_length_c 5',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0 0 0',
      'data_second',
      '_cell_length_a 6',
      '_cell_length_b 6',
      '_cell_length_c 6',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0 0 0',
      'C2 C 0.5 0.5 0.5',
      'data_third',
      '_cell_length_a 7',
      '_cell_length_b 7',
      '_cell_length_c 7',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'N1 N 0 0 0',
      'N2 N 0.5 0 0',
      'N3 N 0 0.5 0',
      ''
    ].join('\n');
    var sm = parseCif(multiBlock, 'multi_block.cif');
    eq(sm.sites.length, 3, 'multi data block: must keep the block with most atoms');
    near(sm.cell.a, 7, 1e-9, 'multi data block: cell from the kept block');

    // multiple models: only the first model is loaded
    var models = [
      'data_models',
      '_cell_length_a 10',
      '_cell_length_b 10',
      '_cell_length_c 10',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      '_atom_site_pdbx_pdb_model_num',
      'C1 C 0.1 0.1 0.1 1',
      'C2 C 0.2 0.2 0.2 1',
      'C3 C 0.3 0.3 0.3 2',
      'C4 C 0.4 0.4 0.4 2',
      ''
    ].join('\n');
    var smd = parseCif(models, 'models.cif');
    eq(smd.sites.length, 2, 'multi model: only the first model rows are sites');
    assert(String(smd.note || '').length > 0, 'multi model: a note is expected');
  });

  T('§1.7 XYZ unknown element -> "X"', ['parsers.parse'], function (CL) {
    var text = '2\nnumbers\n8 0 0 0\nX 1 0 0\n';
    var s = CL.parsers.parseXyz ? CL.parsers.parseXyz(text, 'unknown.xyz')
      : CL.parsers.parse(text, 'unknown.xyz');
    eq(s.sites.length, 2, 'unknown.xyz sites');
    eq(s.sites[0].z, 8, 'atomic number 8 -> O');
    eq(s.sites[0].element, 'O', 'atomic number 8 element');
    eq(s.sites[1].z, 0, 'unknown symbol z=0');
    eq(s.sites[1].element, 'X', 'unknown symbol element X');
  });

  T('§1.7b unknown element never bonds (needs model layer)', ['crystal', 'parsers.parse'], function (CL) {
    var text = '2\nnumbers\n8 0 0 0\nX 1 0 0\n';
    var s = CL.parsers.parseXyz ? CL.parsers.parseXyz(text, 'unknown.xyz')
      : CL.parsers.parse(text, 'unknown.xyz');
    var f = finalize(CL, s);
    eq(f.bonds.length, 0, 'unknown element must never bond');
  });

  T('§1.8 periodic table 118+X parity with elements.json', ['periodic.all'], function (CL) {
    var all = CL.periodic.all();
    assert(Array.isArray(all), 'CL.periodic.all() must return an array');
    var data = JSON.parse(readText('docs/spec/elements.json'));
    assert(Array.isArray(data) && data.length >= 118, 'elements.json must list 118 elements');
    var byZ = {}, bySymbol = {};
    for (var i = 0; i < all.length; i++) { byZ[all[i].z] = all[i]; bySymbol[all[i].symbol] = all[i]; }
    var keys = ['Na', 'Cl', 'Ti', 'Si', 'O', 'Ni', 'Bi', 'Te'];
    for (var k = 0; k < keys.length; k++) {
      var sym = keys[k];
      var expected = data.filter(function (e) { return e.symbol === sym; })[0];
      assert(expected, 'elements.json missing ' + sym);
      var got = bySymbol[sym];
      assert(got, 'CL.periodic.get(' + sym + ') is null');
      eq(got.z, expected.z, sym + ' z');
      near(got.covalent, expected.covalent, 1e-9, sym + ' covalent radius');
      near(got.vdw, expected.vdw, 1e-9, sym + ' vdw radius');
      eq(got.colorU32, expected.colorU32, sym + ' colorU32');
      // elements.json carries nameZh:null (UI localizes through i18n.js)
      eq(got.nameZh, expected.nameZh, sym + ' nameZh parity');
    }
    var xu = CL.periodic.get('X');
    assert(xu, "CL.periodic.get('X') must return the unknown entry");
    eq(xu.z, 0, 'X z must be 0');
    eq(xu.symbol, 'X', "get('X').symbol");
    eq(CL.periodic.elementFromInput('Si').symbol, 'Si', "elementFromInput('Si')");
    eq(CL.periodic.elementFromInput('14').symbol, 'Si', "elementFromInput('14')");
    eq(CL.periodic.elementFromInput('si').symbol, 'Si', "elementFromInput('si')");
    eq(CL.periodic.elementFromInput('Qq'), null, "elementFromInput('Qq') must be null");
  });

  // =========================================================================
  // §2 模型层（CL.crystal）  // =========================================================================

  T('§2.1 halite: 8 atoms, 24 Na-Cl bonds, 2.8201 A', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    eq(s.atoms.length, 8, 'halite atoms (4 Na + 4 Cl)');
    var counts = atomElementCounts(s);
    eq(counts.Na, 4, 'halite Na count');
    eq(counts.Cl, 4, 'halite Cl count');
    eq(s.bonds.length, 24, 'halite periodic bonds');
    near(s.bonds[0].length, 2.8201, 1e-3, 'halite bond length[0]');
    for (var i = 0; i < s.bonds.length; i++) {
      var a = s.atoms[s.bonds[i].a], b = s.atoms[s.bonds[i].b];
      var pair = [a.element, b.element].sort().join('-');
      eq(pair, 'Cl-Na', 'halite bond ' + i + ' must be Na-Cl');
      near(s.bonds[i].length, 2.8201, 1e-3, 'halite bond[' + i + '].length');
      assert(s.bonds[i].shift && s.bonds[i].shift.length === 3,
        'halite bond[' + i + '] missing lattice shift');
    }
    assert(String(s.cellContents || '').length > 0, 'halite cellContents must be computed');
  });

  T('§2.2 quartz example: 9 atoms, 12 Si-O bonds, 1.6046/1.6124 A', ['crystal', 'parsers.parse'], function (CL) {
    var s = parsedAndFinalized(CL, examplePath('quartz.cif'), 'quartz.cif');
    eq(s.atoms.length, 9, 'quartz atoms (Si3 O6)');
    eq(s.bonds.length, 12, 'quartz bonds');
    var lengths = [];
    for (var i = 0; i < s.bonds.length; i++) {
      var a = s.atoms[s.bonds[i].a], b = s.atoms[s.bonds[i].b];
      var pair = [a.element, b.element].sort().join('-');
      eq(pair, 'O-Si', 'quartz bond ' + i + ' must be Si-O');
      lengths.push(s.bonds[i].length);
    }
    var found1 = false, found2 = false;
    for (var j = 0; j < lengths.length; j++) {
      if (Math.abs(lengths[j] - 1.6046) <= 5e-3) found1 = true;
      if (Math.abs(lengths[j] - 1.6124) <= 5e-3) found2 = true;
      assert(lengths[j] > 1.45 && lengths[j] < 1.80, 'quartz Si-O out of range: ' + lengths[j]);
    }
    assert(found1, 'quartz: no Si-O bond near 1.6046 (got ' + lengths.join(', ') + ')');
    assert(found2, 'quartz: no Si-O bond near 1.6124 (got ' + lengths.join(', ') + ')');
    eq(s.cellContents, 'O6 Si3', 'quartz cellContents (z-ascending order)');
  });

  T('§2.3 diamond example: 16 C-C bonds (1.5445 A)', ['crystal', 'parsers.parse'], function (CL) {
    var s = parsedAndFinalized(CL, examplePath('diamond.cif'), 'diamond.cif');
    eq(s.atoms.length, 8, 'diamond atoms (C8)');
    eq(s.bonds.length, 16, 'diamond bonds');
    for (var i = 0; i < s.bonds.length; i++) {
      var a = s.atoms[s.bonds[i].a], b = s.atoms[s.bonds[i].b];
      eq(a.element, 'C', 'diamond bond a element');
      eq(b.element, 'C', 'diamond bond b element');
      near(s.bonds[i].length, 1.5445, 2e-3, 'diamond C-C bond[' + i + ']');
    }
  });

  T('§2.4 water.xyz: 2 O-H bonds (0.9573 A)', ['crystal', 'parsers.parse'], function (CL) {
    var s = parsedAndFinalized(CL, examplePath('water.xyz'), 'water.xyz');
    eq(s.atoms.length, 3, 'water atoms');
    eq(s.bonds.length, 2, 'water H-bonds (H-H must not bond)');
    for (var i = 0; i < s.bonds.length; i++) {
      var a = s.atoms[s.bonds[i].a], b = s.atoms[s.bonds[i].b];
      var pair = [a.element, b.element].sort().join('-');
      eq(pair, 'H-O', 'water bond must be O-H');
      near(s.bonds[i].length, 0.9573, 1e-3, 'water O-H length');
    }
  });

  T('§2.5 Bi2Te3: no Bi-Te bonds (metalloid cutoff)', ['crystal', 'parsers.parse'], function (CL) {
    var candidates = ['tests/fixtures/Bi2Te3.cif', 'build/Bi2Te3.cif', 'build/bi2te3.cif', 'web/data/library/bi2te3.cif'];
    var text = null, used = null;
    for (var i = 0; i < candidates.length; i++) {
      try { text = readText(candidates[i]); used = candidates[i]; break; } catch (e) { /* try next */ }
    }
    if (!text) {
      skips.push('[SKIP] acceptance :: §2.5 Bi2Te3 fixture not found (tests/fixtures/Bi2Te3.cif)');
      return;
    }
    var s = finalize(CL, parse(CL, used));
    var biTe = 0;
    for (var j = 0; j < s.bonds.length; j++) {
      var a = s.atoms[s.bonds[j].a], b = s.atoms[s.bonds[j].b];
      var pair = [a.element, b.element].sort().join('-');
      if (pair === 'Bi-Te') biTe++;
    }
    eq(biTe, 0, 'Bi2Te3 must not create Bi-Te bonds (got ' + biTe + ' of ' + s.bonds.length + ' bonds)');
    assert(s.atoms.length > 0, 'Bi2Te3: no atoms expanded');
  });

  T('§2.6 disorder: mutually exclusive groups never bond', ['crystal', 'parsers.parse'], function (CL) {
    var head = [
      '_cell_length_a 4',
      '_cell_length_b 4',
      '_cell_length_c 4',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z'
    ];
    var disorder = 'data_disorder\n' + head.concat([
      '_atom_site_disorder_assembly',
      '_atom_site_disorder_group',
      'C1 C 0.10 0.10 0.10 A 1',
      'C2 C 0.35 0.10 0.10 A 2',
      ''
    ]).join('\n');
    var control = 'data_control\n' + head.concat([
      'C1 C 0.10 0.10 0.10',
      'C2 C 0.35 0.10 0.10',
      ''
    ]).join('\n');
    var parseCif = CL.parsers.parseCif || function (t, n) { return CL.parsers.parse(t, n); };
    var sd = finalize(CL, parseCif(disorder, 'disorder.cif'));
    eq(sd.bonds.length, 0, 'disorder: sites in exclusive groups (A/1 vs A/2) must not bond');
    var sc = finalize(CL, parseCif(control, 'control.cif'));
    // a=4 A, C-C at 1.0 A is inside the 1.2*(0.76+0.76)=1.824 A cutoff and above
    // the 0.42 A minimum bond length -> the same geometry must create exactly 1 bond.
    eq(sc.bonds.length, 1, 'disorder control: identical atoms without disorder must bond (' +
      sc.bonds.length + ')');
  });

  T('§2.7 display halite 1x1x1: 27 (8 cell + 19 boundary)', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [1, 1, 1], showBoundary: true });
    eq(m.atoms.length, 27, 'halite 1x1x1 visible atoms');
    nearVec(m.displayedCells, [1, 1, 1], 1e-9, 'displayedCells');
    eq(m.showBoundary, true, 'model.showBoundary');
    eq(m.stats.cellAtomCount, 8, '1x1x1 cellAtomCount');
    eq(m.stats.visibleAtomCount, 27, '1x1x1 visibleAtomCount');
    eq(m.stats.boundaryAtomCount, 19, '1x1x1 boundaryAtomCount');
    var kindCell = 0, kindBoundary = 0;
    for (var i = 0; i < m.atoms.length; i++) {
      eq(m.atoms[i].id, i, 'atoms[' + i + '].id must equal its index');
      assert(m.atoms[i].kind === 'cell' || m.atoms[i].kind === 'boundary',
        'atoms[' + i + '].kind must be cell|boundary, got ' + m.atoms[i].kind);
      if (m.atoms[i].kind === 'cell') {
        kindCell++;
      } else {
        kindBoundary++;
        eq(m.atoms[i].pickable, false, 'boundary atom ' + i + ' must not be pickable');
      }
      assert(m.atoms[i].color && m.atoms[i].color.length === 3,
        'atoms[' + i + '] missing rgb color');
      assert(m.atoms[i].baseRadius > 0, 'atoms[' + i + '] missing baseRadius');
      assert(m.atoms[i].pos && m.atoms[i].pos.length === 3, 'atoms[' + i + '] missing pos');
    }
    eq(kindCell, 8, '1x1x1 cell instances');
    eq(kindBoundary, 19, '1x1x1 boundary instances');
  });

  T('§2.8 display halite 2x2x2: 125 (64 cell + 61 boundary), Na=63', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [2, 2, 2], showBoundary: true });
    eq(m.atoms.length, 125, 'halite 2x2x2 visible atoms');
    nearVec(m.displayedCells, [2, 2, 2], 1e-9, 'displayedCells');
    eq(m.stats.cellAtomCount, 64, '2x2x2 cellAtomCount');
    eq(m.stats.visibleAtomCount, 125, '2x2x2 visibleAtomCount');
    eq(m.stats.boundaryAtomCount, 61, '2x2x2 boundaryAtomCount');
    eq(m.stats.cellBondCount, 24, '2x2x2 cellBondCount');
    var na = 0, cl = 0;
    for (var i = 0; i < m.atoms.length; i++) {
      if (m.atoms[i].element === 'Na') na++;
      else if (m.atoms[i].element === 'Cl') cl++;
    }
    eq(na, 63, '2x2x2 Na instances (63 Na centres, README)');
    eq(cl, 62, '2x2x2 Cl instances');
    eq(m.stats.supercellLimited, false, '2x2x2 must not be supercell limited');
  });

  T('§2.9 display halite 3x3x3: 343 (216 cell + 127 boundary)', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [3, 3, 3], showBoundary: true });
    eq(m.atoms.length, 343, 'halite 3x3x3 visible atoms');
    eq(m.stats.cellAtomCount, 216, '3x3x3 cellAtomCount');
    eq(m.stats.boundaryAtomCount, 127, '3x3x3 boundaryAtomCount');
  });

  T('§2.10 display halite 2x2x2 showBoundary=false: 64', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [2, 2, 2], showBoundary: false });
    eq(m.atoms.length, 64, 'halite 2x2x2 without boundary atoms');
    eq(m.showBoundary, false, 'model.showBoundary');
    eq(m.stats.boundaryAtomCount, 0, 'boundaryAtomCount when showBoundary=false');
    eq(m.stats.cellAtomCount, 64, 'cellAtomCount when showBoundary=false');
    eq(m.stats.cellAtomCount + m.stats.boundaryAtomCount, m.stats.visibleAtomCount,
      'cellAtomCount + boundaryAtomCount must equal visibleAtomCount');
  });

  T('§2.11 polyhedra halite 2x2x2: 63 centres (Na octahedra)', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [2, 2, 2], showBoundary: true, style: 'polyhedral' });
    var poly = m.polyhedra;
    var centerCount = poly && Array.isArray(poly.centers) ? poly.centers.length : -1;
    var triangles = poly && Array.isArray(poly.triangles) ? poly.triangles.length : -1;
    if (centerCount < 0) {
      var fn = pickFn(CL, ['crystal.buildPolyhedra']);
      assert(fn, 'neither displayModel.polyhedra.centers nor CL.crystal.buildPolyhedra is available');
      var alt = fn(m, s);
      assert(alt && Array.isArray(alt.centers), 'buildPolyhedra must return {centers:[...]}');
      poly = alt;
      centerCount = poly.centers.length;
      triangles = Array.isArray(poly.triangles) ? poly.triangles.length : -1;
    }
    eq(centerCount, 63, 'halite 2x2x2 polyhedron centres (Na images)');
    if (triangles >= 0) {
      eq(triangles, 63 * 8, 'halite octahedra: 63 centres * 8 triangles');
    }
    if (m.stats && typeof m.stats.polyhedronCount === 'number') {
      eq(m.stats.polyhedronCount, 63, 'stats.polyhedronCount');
    }
  });

  T('§2.12 supercell capacity: clamp 1-16 + budget fallback', ['crystal', 'parsers.parse'], function (CL) {
    // halite 16^3: 8*4096 = 32768 sites, 24*4096 = 98304 bonds -> fits, and
    // images 8*17^3 = 39304 < 80000, so it must NOT be limited.
    var s = halite(CL);
    var t0 = Date.now();
    var m = displayModel(CL, s, { supercell: [16, 16, 16], showBoundary: true });
    var ms = Date.now() - t0;
    eq(m.stats.supercellLimited, false, 'halite 16^3 must fit the supercell budget');
    nearVec(m.displayedCells, [16, 16, 16], 1e-9, '16^3 displayedCells');
    assert(m.atoms.length <= 80000, 'halite 16^3 must respect the 80000 image cap, got ' + m.atoms.length);
    assert(ms < 20000, '16^3 display build took ' + ms + ' ms');

    // request above 16 -> clamped to 16
    var m2 = displayModel(CL, s, { supercell: [20, 20, 20], showBoundary: true });
    for (var i = 0; i < 3; i++) {
      assert(m2.displayedCells[i] <= 16 && m2.displayedCells[i] >= 1,
        'displayedCells must be clamped to 1..16, got ' + JSON.stringify(m2.displayedCells));
    }

    // perovskite 20 atoms/cell * 4096 = 81920 > 65536 -> supercellLimited,
    // fallback to a single displayed cell.
    var p = parsedAndFinalized(CL, libPath('perovskite'), 'perovskite.cif');
    var mp = displayModel(CL, p, { supercell: [16, 16, 16], showBoundary: true });
    eq(mp.stats.supercellLimited, true, 'perovskite 16^3 must exceed the 65536-site budget');
    nearVec(mp.displayedCells, [1, 1, 1], 1e-9, 'limited supercell falls back to 1x1x1');
    eq(mp.stats.cellAtomCount, p.atoms.length, 'limited fallback cellAtomCount');
    assert(mp.atoms.length > 0, 'limited fallback must still display atoms');

    // fitsSupercell helper (when present) must agree
    var fits = pickFn(CL, ['crystal.fitsSupercell']);
    if (fits) {
      var f1 = fits(s, [16, 16, 16]);
      assert(f1 && f1.ok === true, 'fitsSupercell(halite, 16^3) must be ok');
      var f2 = fits(p, [16, 16, 16]);
      assert(f2 && f2.ok === false && f2.limited === true,
        'fitsSupercell(perovskite, 16^3) must be limited');
    }
  });

  T('§2.13 lines / origin / model meta', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var m = displayModel(CL, s, { supercell: [1, 1, 1], showBoundary: true });
    eq(m.hasCell, true, 'hasCell');
    assert(Array.isArray(m.lines), 'DisplayModel.lines must be an array');
    assert(m.lines.length >= 12, 'halite 1x1x1 must draw at least the 12 cell edges, got ' + m.lines.length);
    for (var i = 0; i < m.lines.length; i++) {
      assert(m.lines[i].p0 && m.lines[i].p0.length === 3, 'lines[' + i + '].p0');
      assert(m.lines[i].p1 && m.lines[i].p1.length === 3, 'lines[' + i + '].p1');
    }
    assert(s.center && s.center.length === 3, 'structure.center must be computed');
    nearVec(m.origin, s.center, 1e-6, 'DisplayModel.origin must equal structure.center');
    assert(m.cell && typeof m.cell.a === 'number', 'DisplayModel.cell');
    assert(m.polyhedra && typeof m.polyhedra === 'object', 'DisplayModel.polyhedra object');
    var m2 = displayModel(CL, s, { supercell: [2, 2, 2], showBoundary: true });
    assert(m2.lines.length >= 27,
      'halite 2x2x2 must draw per-subcell edges (>=27), got ' + m2.lines.length);
    eq(m2.atoms.length, 125, 'sanity: 2x2x2 at the same time');
  });

  T('§2.14 perf: halite 2x2x2 build < 500 ms', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var t0 = Date.now();
    var m = displayModel(CL, s, { supercell: [2, 2, 2], showBoundary: true });
    var ms = Date.now() - t0;
    eq(m.atoms.length, 125, 'perf sanity: atom count');
    assert(ms < 500, 'halite 2x2x2 buildDisplayModel took ' + ms + ' ms (budget 500 ms)');
  });

  T('§2.15 measurement: halite nearest Na-Cl = 2.8201 A', ['crystal', 'parsers.parse', ['crystal.measureDistance', 'measure.measureDistance', 'measure.distance']], function (CL) {
    var s = halite(CL);
    // first bond gives a representative Na/Cl pair
    assert(s.bonds.length > 0, 'halite has no bonds');
    var ia = s.bonds[0].a, ib = s.bonds[0].b;
    var d = measureDistance(CL, s, ia, ib);
    assert(d, 'measureDistance API (CL.crystal.measureDistance) is unavailable');
    near(d.value, 2.8201, 1e-3, 'measureDistance(Na, Cl)');
    // C++ test_core fixture: inline NaCl with Cl at (0.5,0,0); atoms[0]=Na,
    // atoms[4] = first Cl image -> MeasureDistance(0,4) == 2.8201 in the C++ test.
    var inline = [
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
      'Cl1 Cl 0.5 0.0 0.0 1.0',
      ''
    ].join('\n');
    var parseCif = CL.parsers.parseCif || function (t, n) { return CL.parsers.parse(t, n); };
    var si = finalize(CL, parseCif(inline, 'nacl-inline.cif'));
    eq(si.atoms.length, 8, 'inline NaCl atoms');
    eq(si.bonds.length, 24, 'inline NaCl bonds');
    var d2 = measureDistance(CL, si, 0, 4);
    assert(d2, 'measureDistance(0,4) returned no value');
    near(d2.value, 2.8201, 1e-3, 'measureDistance(0,4) on the C++ test_core fixture');
  });

  T('§2.16 measurement: minimum image + offset (wrapped pair)', ['crystal', 'parsers.parse', ['crystal.measureDistance', 'measure.measureDistance', 'measure.distance']], function (CL) {
    var text = [
      'data_wrapped',
      '_cell_length_a 3.0',
      '_cell_length_b 3.0',
      '_cell_length_c 3.0',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'loop_',
      '_symmetry_equiv_pos_as_xyz',
      "'x,y,z'",
      'loop_',
      '_atom_site_label',
      '_atom_site_type_symbol',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      'C1 C 0.05 0.5 0.5',
      'C2 C 0.95 0.5 0.5',
      ''
    ].join('\n');
    var parseCif = CL.parsers.parseCif || function (t, n) { return CL.parsers.parse(t, n); };
    var s = finalize(CL, parseCif(text, 'wrapped.cif'));
    eq(s.atoms.length, 2, 'wrapped pair atoms');
    var d = measureDistance(CL, s, 0, 1);
    assert(d, 'measureDistance API unavailable');
    near(d.value, 0.3, 1e-6, 'minimum image distance must be 0.3 A (not 2.7 A)');
    var off = offsetB(d);
    if (!off) {
      var mk = pickFn(CL, ['crystal.makeDistanceMeasurement', 'measure.makeDistanceMeasurement']);
      assert(mk, 'no offset exposed by measureDistance and no makeDistanceMeasurement');
      off = offsetB(mk(s, 0, 1));
    }
    assert(off, 'measureDistance result must expose the periodic image offset (offsetB/offsets)');
    assert(Math.abs(off[0]) > 2.5, 'expected |offsetB.x| ~ 3.0, got ' + JSON.stringify(off));
    near(off[0], -3.0, 1e-6, 'offsetB.x for the wrapped image');
    assert(Math.abs(off[1]) < 1e-6 && Math.abs(off[2]) < 1e-6, 'offsetB.y/z must be 0');
  });

  T('§2.17 measurement: water H-O-H angle = 104.47 deg', ['crystal', 'parsers.parse', ['crystal.measureAngle', 'measure.measureAngle', 'measure.angle', 'crystal.makeAngleMeasurement', 'measure.makeAngleMeasurement']], function (CL) {
    var text = '3\nwater molecule\nO 0.000000 0.000000 0.000000\n' +
      'H 0.757000 0.586000 0.000000\nH -0.757000 0.586000 0.000000\n';
    var parseXyz = CL.parsers.parseXyz || function (t, n) { return CL.parsers.parse(t, n); };
    var s = finalize(CL, parseXyz(text, 'water-inline.xyz'));
    eq(s.atoms.length, 3, 'inline water atoms');
    var a = measureAngle(CL, s, 1, 0, 2);
    assert(a && typeof a.value === 'number', 'measureAngle API unavailable or returned no value');
    near(a.value, 104.47, 0.1, 'water H-O-H angle (C++ test_core)');
  });

  T('§2.18 edit: setCellParameters validation + update', ['crystal', 'parsers.parse', ['crystal.setCellParameters', 'edit.setCellParameters']], function (CL) {
    var fn = pickFn(CL, ['crystal.setCellParameters']);
    assert(fn, 'CL.crystal.setCellParameters is not defined');
    var s = parsedAndFinalized(CL, libPath('quartz'), 'quartz.cif');
    var bad1 = fn(s, { a: -1, b: s.cell.b, c: s.cell.c, alpha: s.cell.alpha, beta: s.cell.beta, gamma: s.cell.gamma });
    expectEditFailure(bad1, 'setCellParameters(negative a)');
    var bad2 = fn(s, { a: s.cell.a, b: s.cell.b, c: s.cell.c, alpha: 180, beta: s.cell.beta, gamma: s.cell.gamma });
    expectEditFailure(bad2, 'setCellParameters(alpha=180)');
    var ok = fn(s, { a: 5.1, b: s.cell.b, c: s.cell.c, alpha: s.cell.alpha, beta: s.cell.beta, gamma: s.cell.gamma });
    var s2 = applyEditResult(ok, s);
    assert(s2, 'setCellParameters(valid) failed: ' + JSON.stringify(ok && ok.error));
    near(s2.cell.a, 5.1, 1e-9, 'cell.a after edit');
    assert(s2.cell.volume > 0, 'cell.volume after edit');
    // hexagonal cell volume = a*b*c*sin(gamma)
    near(s2.cell.volume, 5.1 * s.cell.b * s.cell.c * Math.sin(s.cell.gamma * Math.PI / 180),
      1e-3, 'cell.volume after edit follows a*b*c*sin(gamma)');
    assert(Array.isArray(s2.sites) && s2.sites.length === 2, 'setCellParameters must keep the sites');
    assert(Array.isArray(s2.atoms) && s2.atoms.length === 9, 'setCellParameters must re-expand atoms (9)');
  });

  T('§2.19 edit: add / update / delete atom site + validation', ['crystal', 'parsers.parse', ['crystal.addAtomSite', 'edit.addAtomSite'], ['crystal.updateAtomSite', 'edit.updateAtomSite'], ['crystal.deleteAtomSite', 'edit.deleteAtomSite']], function (CL) {
    var add = pickFn(CL, ['crystal.addAtomSite']);
    var update = pickFn(CL, ['crystal.updateAtomSite']);
    var del = pickFn(CL, ['crystal.deleteAtomSite']);
    assert(add && update && del, 'addAtomSite / updateAtomSite / deleteAtomSite missing');
    var s = parsedAndFinalized(CL, libPath('quartz'), 'quartz.cif');
    var sitesBefore = s.sites.length, atomsBefore = s.atoms.length;

    var badElement = add(s, { element: 'Qq', frac: [0.13, 0.27, 0.41], occupancy: 1 });
    expectEditFailure(badElement, 'addAtomSite(invalid element)');
    var badOcc = add(s, { element: 'O', frac: [0.13, 0.27, 0.41], occupancy: 0 });
    expectEditFailure(badOcc, 'addAtomSite(occupancy=0)');

    var added = add(s, { element: 'O', frac: [0.13, 0.27, 0.41], occupancy: 1 });
    var s1 = applyEditResult(added, s);
    assert(s1, 'addAtomSite(O) failed: ' + JSON.stringify(added && added.error));
    eq(s1.sites.length, sitesBefore + 1, 'sites after addAtomSite');
    assert(s1.atoms.length > atomsBefore,
      'atoms must be re-expanded after addAtomSite (' + atomsBefore + ' -> ' + s1.atoms.length + ')');
    var newIndex = s1.sites.length - 1;
    eq(s1.sites[newIndex].element, 'O', 'added site element');

    var updated = update(s1, newIndex, { element: 'N', frac: [0.22, 0.31, 0.44], occupancy: 1 });
    var s2 = applyEditResult(updated, s1);
    assert(s2, 'updateAtomSite failed: ' + JSON.stringify(updated && updated.error));
    eq(s2.sites[newIndex].element, 'N', 'updated site element');
    var foundN = false;
    for (var i = 0; i < s2.atoms.length; i++) {
      if (s2.atoms[i].siteIndex === newIndex && s2.atoms[i].element === 'N') foundN = true;
    }
    assert(foundN, 'updateAtomSite: no expanded N atom with siteIndex ' + newIndex);

    var deleted = del(s2, newIndex);
    var s3 = applyEditResult(deleted, s2);
    assert(s3, 'deleteAtomSite failed: ' + JSON.stringify(deleted && deleted.error));
    eq(s3.sites.length, sitesBefore, 'sites after deleteAtomSite');
    eq(s3.atoms.length, atomsBefore, 'atoms after deleteAtomSite');
    expectEditFailure(del(s3, 999), 'deleteAtomSite(out of range)');
  });

  T('§2.20 export CIF -> parse round-trip', ['crystal', 'parsers.parse', ['crystal.exportCif', 'export.exportCif']], function (CL) {
    var s = parsedAndFinalized(CL, libPath('quartz'), 'quartz.cif');
    var text = exportCif(CL, s);
    assert(text.indexOf('data_') >= 0, 'exportCif must start a data block');
    var reloaded = CL.parsers.parse(text, 'crystallens-export.cif');
    near(reloaded.cell.a, s.cell.a, 1e-4, 'round-trip cell.a');
    near(reloaded.cell.b, s.cell.b, 1e-4, 'round-trip cell.b');
    near(reloaded.cell.c, s.cell.c, 1e-4, 'round-trip cell.c');
    near(reloaded.cell.alpha, s.cell.alpha, 1e-4, 'round-trip alpha');
    near(reloaded.cell.beta, s.cell.beta, 1e-4, 'round-trip beta');
    near(reloaded.cell.gamma, s.cell.gamma, 1e-4, 'round-trip gamma');
    eq(reloaded.sites.length, s.sites.length, 'round-trip sites count');
    eq(reloaded.symops.length, s.symops.length, 'round-trip symops count');
    var re = finalize(CL, reloaded);
    eq(re.atoms.length, s.atoms.length, 'round-trip expanded atom count');
    eq(re.bonds.length, s.bonds.length, 'round-trip bond count');
  });

  T('§2.21 export XYZ: lines = cell atoms + 2', ['crystal', 'parsers.parse', ['crystal.exportXyz', 'export.exportXyz']], function (CL) {
    var s = parsedAndFinalized(CL, examplePath('water.xyz'), 'water.xyz');
    var text = exportXyz(CL, s);
    var lines = nonEmptyLines(text);
    eq(lines.length, s.atoms.length + 2, 'XYZ export line count (N + comment + atoms)');
    eq(parseInt(lines[0], 10), s.atoms.length, 'XYZ export first line must be the atom count');
    for (var i = 2; i < lines.length; i++) {
      var parts = lines[i].trim().split(/\s+/);
      assert(parts.length >= 4, 'XYZ atom line must be "E x y z": ' + lines[i]);
      eq(parts[0], s.atoms[i - 2].element, 'XYZ atom line ' + i + ' element');
      near(parseFloat(parts[1]), s.atoms[i - 2].cart[0], 1e-5, 'XYZ atom line ' + i + ' x');
      near(parseFloat(parts[2]), s.atoms[i - 2].cart[1], 1e-5, 'XYZ atom line ' + i + ' y');
      near(parseFloat(parts[3]), s.atoms[i - 2].cart[2], 1e-5, 'XYZ atom line ' + i + ' z');
    }
  });

  T('§2.22 StructureData JSON round-trip (undo snapshots)', ['crystal', 'parsers.parse'], function (CL) {
    var s = halite(CL);
    var json1 = JSON.stringify(s);
    var parsedBack = JSON.parse(json1);
    var json2 = JSON.stringify(parsedBack);
    if (json1 !== json2) {
      // find a useful hint for the defect report
      var a = JSON.parse(json1), b = parsedBack;
      var keys = Object.keys(a);
      var bad = [];
      for (var i = 0; i < keys.length; i++) {
        if (JSON.stringify(a[keys[i]]) !== JSON.stringify(b[keys[i]])) bad.push(keys[i]);
      }
      throw new Error('StructureData must be lossless under JSON round-trip; differing fields: ' +
        (bad.join(', ') || '(nested only)'));
    }
    eq(parsedBack.atoms.length, 8, 'JSON round-trip atoms');
    eq(parsedBack.bonds.length, 24, 'JSON round-trip bonds');
    // explicit deep copy must also keep the structure usable
    var s2 = JSON.parse(JSON.stringify(s));
    var m = displayModel(CL, s2, { supercell: [1, 1, 1], showBoundary: true });
    eq(m.atoms.length, 27, 'restored JSON snapshot can rebuild the display model');
  });

  // ------------------------------------------------------------------------
  // Readiness summary (the QA report reads these lines from the run output).
  // ------------------------------------------------------------------------
  var names = Object.keys(groupStatus);
  var passed = 0, failed = 0, skipped = 0;
  for (var i = 0; i < names.length; i++) {
    if (groupStatus[names[i]] === 'pass') passed++;
    else if (groupStatus[names[i]] === 'fail') failed++;
    else skipped++;
  }
  console.log('[acceptance] groups: ' + passed + ' passed, ' + failed + ' failed, ' +
    skipped + ' skipped (of ' + names.length + ')');
  for (var j = 0; j < skips.length; j++) console.log(skips[j]);
})();
