/**
 * Tests for CL.periodic (web/js/lib/periodic_table.js).
 *
 * The most important check is data parity: the C++ source of truth
 * the upstream C++ src/core/PeriodicTable.cpp is parsed here and every
 * element entry (symbol / z / name / covalent / vdw / color) is compared.
 * Classification lists and pair cutoffs are checked against fixed expectations.
 */
(function () {
  'use strict';

  // Local dev workspace keeps the upstream tree in reference/CrystalLens; the
  // published GitHub repo keeps it at the repository root (one level up).
  var CPP_CANDIDATES = [
    'reference/CrystalLens/src/core/PeriodicTable.cpp',
    '../src/core/PeriodicTable.cpp'
  ];
  function readCpp() {
    for (var i = 0; i < CPP_CANDIDATES.length; i++) {
      try { return readText(CPP_CANDIDATES[i]); } catch (e) { /* try next */ }
    }
    throw new Error('PeriodicTable.cpp not found (looked for: ' + CPP_CANDIDATES.join(', ') + ')');
  }

  function fail(message) { throw new Error(message); }
  function ok(condition, message) { if (!condition) fail(message || 'assertion failed'); }
  function eq(actual, expected, message) {
    if (actual !== expected) {
      fail((message || 'eq') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  }
  function near(actual, expected, eps, message) {
    if (!(typeof actual === 'number' && Math.abs(actual - expected) <= (eps === undefined ? 1e-9 : eps))) {
      fail((message || 'near') + ': expected ' + expected + ', got ' + actual);
    }
  }

  // Extract the 118 { z, symbol, name, covalent, vdw, color } rows from the C++ table.
  // The source also contains kUnknown (z = 0); it is returned separately.
  function cppElements() {
    var source = readCpp();
    var re = /\{(\d+),\s*"([A-Za-z]+)",\s*"([A-Za-z]+)",\s*([0-9.]+)f,\s*([0-9.]+)f,\s*0x([0-9A-Fa-f]{6})\}/g;
    var rows = [];
    var match;
    while ((match = re.exec(source)) !== null) {
      rows.push({
        z: parseInt(match[1], 10),
        symbol: match[2],
        name: match[3],
        covalent: parseFloat(match[4]),
        vdw: parseFloat(match[5]),
        colorU32: parseInt(match[6], 16)
      });
    }
    return rows;
  }

  // Extract an int list from a C++ helper body, e.g. IsNonMetal / IsMetalloid.
  function cppIntList(functionName) {
    var source = readCpp();
    var re = new RegExp('bool ' + functionName + '\\(int z\\)[\\s\\S]*?static const int values\\[\\] = \\{([\\s\\S]*?)\\};');
    var match = re.exec(source);
    ok(match, 'cannot find ' + functionName + ' in PeriodicTable.cpp');
    var out = {};
    var nums = match[1].match(/\d+/g) || [];
    for (var i = 0; i < nums.length; i++) out[parseInt(nums[i], 10)] = true;
    return out;
  }

  test('periodic table: 118 elements with unique symbols and increasing Z', function (CL) {
    var all = CL.periodic.all();
    eq(all.length, 118, 'element count');
    var byZ = {};
    var seenSymbols = {};
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      eq(el.z, i + 1, 'z order');
      ok(!byZ[el.z], 'duplicate z ' + el.z);
      ok(!seenSymbols[el.symbol], 'duplicate symbol ' + el.symbol);
      byZ[el.z] = el;
      seenSymbols[el.symbol] = true;
      ok(typeof el.name === 'string' && el.name.length > 0, 'missing English name for ' + el.z);
      // elements.json / C++ core carry no Chinese names -> null (UI uses i18n).
      eq(el.nameZh, null, 'nameZh should be null for ' + el.z);
      ok(el.covalent > 0 && el.covalent < 3.0, 'covalent radius out of range for ' + el.symbol);
      ok(el.vdw >= el.covalent, 'vdw should be >= covalent for ' + el.symbol);
      ok(typeof el.colorU32 === 'number' && el.colorU32 >= 0 && el.colorU32 <= 0xFFFFFF, 'bad color for ' + el.symbol);
      ok(/^#[0-9a-f]{6}$/.test(el.colorHex), 'bad color hex for ' + el.symbol + ': ' + el.colorHex);
      var expectedHex = '#' + ('000000' + el.colorU32.toString(16)).slice(-6);
      eq(el.colorHex, expectedHex, 'colorHex mismatch for ' + el.symbol);
      near(el.rgb[0], ((el.colorU32 >> 16) & 0xFF) / 255, 1e-12, 'rgb.r ' + el.symbol);
      near(el.rgb[1], ((el.colorU32 >> 8) & 0xFF) / 255, 1e-12, 'rgb.g ' + el.symbol);
      near(el.rgb[2], (el.colorU32 & 0xFF) / 255, 1e-12, 'rgb.b ' + el.symbol);
    }
  });

  test('periodic table: data matches PeriodicTable.cpp exactly', function (CL) {
    var cppAll = cppElements();
    eq(cppAll.length, 119, 'C++ table rows (118 elements + unknown)');
    var unknownRow = cppAll[cppAll.length - 1];
    eq(unknownRow.z, 0, 'C++ kUnknown z');
    var cpp = cppAll.slice(0, 118);
    var all = CL.periodic.all();
    for (var i = 0; i < cpp.length; i++) {
      var expected = cpp[i];
      var actual = all[i];
      eq(actual.z, expected.z, 'row ' + i + ' z');
      eq(actual.symbol, expected.symbol, 'row ' + i + ' symbol');
      eq(actual.name, expected.name, 'row ' + i + ' name');
      eq(actual.nameZh, null, 'row ' + i + ' nameZh');
      near(actual.covalent, expected.covalent, 1e-9, 'row ' + i + ' covalent');
      near(actual.vdw, expected.vdw, 1e-9, 'row ' + i + ' vdw');
      eq(actual.colorU32, expected.colorU32, 'row ' + i + ' colorU32 (' + expected.symbol + ')');
    }
    // kUnknown defaults (covalent/vdw/color) match CL.periodic.byZ(0).
    var unknown = CL.periodic.byZ(0);
    eq(unknown.symbol, unknownRow.symbol, 'kUnknown symbol');
    near(unknown.covalent, unknownRow.covalent, 1e-9, 'kUnknown covalent');
    near(unknown.vdw, unknownRow.vdw, 1e-9, 'kUnknown vdw');
    eq(unknown.colorU32, unknownRow.colorU32, 'kUnknown color');
  });

  test('periodic table: matches docs/spec/elements.json (119 data entries)', function (CL) {
    var spec = JSON.parse(readText('docs/spec/elements.json'));
    ok(Array.isArray(spec), 'elements.json must be a JSON array');
    eq(spec.length, 119, 'elements.json entry count');
    for (var i = 0; i < spec.length; i++) {
      var expected = spec[i];
      var actual = expected.z === 0 ? CL.periodic.get('X') : CL.periodic.byZ(expected.z);
      eq(actual.symbol, expected.symbol, 'symbol row ' + i);
      eq(actual.z, expected.z, 'z row ' + i);
      eq(actual.name, expected.name, 'name row ' + i);
      eq(actual.nameZh, expected.nameZh, 'nameZh row ' + i);
      eq(actual.category, expected.category, 'category row ' + i);
      eq(actual.metal, expected.metal, 'metal row ' + i);
      eq(actual.metalloid, expected.category === 'metalloid', 'metalloid row ' + i);
      near(actual.covalent, expected.covalent, 1e-9, 'covalent row ' + i);
      near(actual.vdw, expected.vdw, 1e-9, 'vdw row ' + i);
      eq(actual.colorU32, expected.colorU32, 'colorU32 row ' + i);
      eq(actual.colorHex, expected.colorHex, 'colorHex row ' + i);
      near(actual.rgb[0], expected.rgb[0], 1e-6, 'rgb.r row ' + i);
      near(actual.rgb[1], expected.rgb[1], 1e-6, 'rgb.g row ' + i);
      near(actual.rgb[2], expected.rgb[2], 1e-6, 'rgb.b row ' + i);
    }
    // elements.json has 119 data rows; all() exposes the 118 real elements,
    // while "X" (z=0) is reachable through get('X') / byZ(0) / get(0).
    eq(CL.periodic.all().length, 118, 'all() element count');
    eq(CL.periodic.get('X').symbol, 'X', "get('X')");
    eq(CL.periodic.get('X').z, 0, "get('X').z");
    eq(CL.periodic.get(0).symbol, 'X', 'get(0)');
    eq(CL.periodic.byZ(999).symbol, 'X', 'byZ(999) unknown fallback');
    eq(CL.periodic.unknown.symbol, 'X', 'unknown entry');
  });

  test('periodic table: key element colors and radii', function (CL) {
    var expected = {
      H: [1, 0xF2F4F8, 0.31, 1.20],
      C: [6, 0x7F8A9A, 0.76, 1.70],
      N: [7, 0x5B8CFF, 0.71, 1.55],
      O: [8, 0xFF5C6C, 0.66, 1.52],
      F: [9, 0x66E0A3, 0.57, 1.47],
      Na: [11, 0xD8C34A, 1.66, 2.27],
      Al: [13, 0x4FA3FF, 1.21, 1.84],
      Si: [14, 0x5A7CFF, 1.11, 2.10],
      K: [19, 0xB26BFF, 2.03, 2.75],
      Ca: [20, 0x7FE08A, 1.76, 2.31],
      Ti: [22, 0x93A8C7, 1.60, 2.11],
      Cr: [24, 0xE040B0, 1.39, 2.06],
      Co: [27, 0x2F5BD8, 1.26, 2.00],
      Ni: [28, 0x9AA7B8, 1.24, 1.97],
      Br: [35, 0xA65A38, 1.20, 1.85],
      Te: [52, 0xD8A45A, 1.38, 2.06],
      Bi: [83, 0xD77AA8, 1.48, 2.07]
    };
    Object.keys(expected).forEach(function (symbol) {
      var row = expected[symbol];
      var el = CL.periodic.get(symbol);
      ok(el, 'missing element ' + symbol);
      eq(el.z, row[0], symbol + ' z');
      eq(el.colorU32, row[1], symbol + ' colorU32');
      near(el.covalent, row[2], 1e-9, symbol + ' covalent');
      near(el.vdw, row[3], 1e-9, symbol + ' vdw');
      eq(CL.periodic.get(row[0]).symbol, symbol, 'get(z) for ' + symbol);
    });
  });

  test('periodic table: get / bySymbol / byZ / all', function (CL) {
    eq(CL.periodic.get(11).symbol, 'Na', 'get(11)');
    eq(CL.periodic.get('Na').z, 11, "get('Na')");
    eq(CL.periodic.get('na').z, 11, "get('na') lowercase");
    eq(CL.periodic.get('14').symbol, 'Si', 'get("14")');
    eq(CL.periodic.get(6).symbol, 'C', 'get(6)');
    eq(CL.periodic.get(0).symbol, 'X', 'get(0) returns kUnknown (C++ ElementByZ)');
    eq(CL.periodic.get(119), null, 'get(119) should be null');
    eq(CL.periodic.get('Qq'), null, 'get("Qq") should be null');
    eq(CL.periodic.get(null), null, 'get(null) should be null');

    eq(CL.periodic.bySymbol('Fe').z, 26, 'bySymbol Fe');
    eq(CL.periodic.bySymbol('fe').z, 26, 'bySymbol fe');
    eq(CL.periodic.byZ(26).symbol, 'Fe', 'byZ 26');
    eq(CL.periodic.byZ(26).covalent, 1.32, 'byZ Fe covalent');
    // Unknown entries mirror cl::kUnknown.
    eq(CL.periodic.byZ(0).symbol, 'X', 'byZ(0) unknown');
    eq(CL.periodic.byZ(999).symbol, 'X', 'byZ(999) unknown');
    eq(CL.periodic.byZ(0).covalent, 0.77, 'unknown covalent');
    eq(CL.periodic.byZ(0).vdw, 1.70, 'unknown vdw');
    eq(CL.periodic.byZ(0).colorU32, 0x9AA4B2, 'unknown color');
    eq(CL.periodic.unknown.symbol, 'X', 'unknown entry');

    var copy = CL.periodic.all();
    copy.pop();
    eq(CL.periodic.all().length, 118, 'all() returns a copy');
    eq(CL.periodic.count, 118, 'count');
  });

  test('periodic table: classify matches C++ IsNonMetal / IsMetalloid lists', function (CL) {
    var nonMetals = cppIntList('IsNonMetal');
    var metalloids = cppIntList('IsMetalloid');
    eq(Object.keys(nonMetals).length, 20, 'C++ non-metal count');
    eq(Object.keys(metalloids).length, 7, 'C++ metalloid count');
    for (var z = 1; z <= 118; z++) {
      var expected = nonMetals[z] ? 'nonmetal' : (metalloids[z] ? 'metalloid' : 'metal');
      var el = CL.periodic.byZ(z);
      eq(el.category, expected, 'category z=' + z + ' ' + el.symbol);
      eq(el.metal, expected === 'metal', 'metal flag z=' + z);
      eq(el.metalloid, expected === 'metalloid', 'metalloid flag z=' + z);
      eq(CL.periodic.classify(z), expected, 'classify(z=' + z + ')');
      eq(CL.periodic.classify(el.symbol), expected, 'classify(' + el.symbol + ')');
      eq(CL.periodic.isNonMetal(z), !!nonMetals[z], 'isNonMetal ' + z);
      eq(CL.periodic.isMetalloid(z), !!metalloids[z], 'isMetalloid ' + z);
    }
    // Spot checks against the C++ lists.
    eq(CL.periodic.classify('Na'), 'metal', 'Na is a metal');
    eq(CL.periodic.classify('Fe'), 'metal', 'Fe is a metal');
    eq(CL.periodic.classify('O'), 'nonmetal', 'O is a nonmetal');
    eq(CL.periodic.classify('Cl'), 'nonmetal', 'Cl is a nonmetal');
    eq(CL.periodic.classify('Si'), 'metalloid', 'Si is a metalloid');
    eq(CL.periodic.classify('Te'), 'metalloid', 'Te is a metalloid');
    eq(CL.periodic.classify('Bi'), 'metal', 'Bi is a metal (not in the C++ metalloid list)');
    eq(CL.periodic.classify('Po'), 'metalloid', 'Po is a metalloid');
    eq(CL.periodic.classify('X'), 'unknown', 'X is unknown');
    eq(CL.periodic.classify(0), 'unknown', 'z=0 unknown');
    eq(CL.periodic.classify('Qq'), 'unknown', 'bad symbol unknown');
  });

  test('periodic table: normalizeElementSymbol / elementFromLabel (C++ cases)', function (CL) {
    var cases = [
      ['Fe3+', 'Fe'], ['O2-', 'O'], ['C1', 'C'], ['CA', 'Ca'], ['13C', 'C'],
      ['D', 'H'], ['T', 'H'], ['Na1', 'Na'], ['Ti', 'Ti'], ['si', 'Si'],
      ['O1\'', 'O'], ['Cl', 'Cl'], ['_C1', 'C'], ['  Fe  ', 'Fe'],
      ['Qq', 'Qq'], ['', 'X'], ['12', 'X'], ['C#1', 'C'], ['Zn2+', 'Zn']
    ];
    cases.forEach(function (pair) {
      eq(CL.periodic.normalizeElementSymbol(pair[0]), pair[1], 'normalize(' + JSON.stringify(pair[0]) + ')');
    });
    eq(CL.periodic.elementFromLabel('Pt2+').z, 78, 'Pt2+ label');
    eq(CL.periodic.elementFromLabel('S2-').z, 16, 'S2- label');
    eq(CL.periodic.elementFromLabel('Qq1').z, 0, 'unknown label z');
    eq(CL.periodic.elementFromLabel('Qq1').symbol, 'X', 'unknown label symbol');
  });

  test('periodic table: elementFromInput', function (CL) {
    eq(JSON.stringify(CL.periodic.elementFromInput('14')), JSON.stringify({ z: 14, symbol: 'Si' }), '"14"');
    eq(JSON.stringify(CL.periodic.elementFromInput('+14')), JSON.stringify({ z: 14, symbol: 'Si' }), '"+14"');
    eq(JSON.stringify(CL.periodic.elementFromInput('si')), JSON.stringify({ z: 14, symbol: 'Si' }), '"si"');
    eq(CL.periodic.elementFromInput('Si').z, 14);
    eq(CL.periodic.elementFromInput(' fe ').symbol, 'Fe');
    eq(CL.periodic.elementFromInput('1').symbol, 'H');
    eq(CL.periodic.elementFromInput('118').symbol, 'Og');
    eq(CL.periodic.elementFromInput('0'), null, '"0"');
    eq(CL.periodic.elementFromInput('119'), null, '"119"');
    eq(CL.periodic.elementFromInput('-3'), null, '"-3"');
    eq(CL.periodic.elementFromInput('Qq'), null, '"Qq"');
    eq(CL.periodic.elementFromInput(''), null, 'empty');
    eq(CL.periodic.elementFromInput('   '), null, 'blank');
    eq(CL.periodic.elementFromInput(null), null, 'null');
  });

  test('periodic table: PairBondCutoff parity with C++ heuristic', function (CL) {
    var P = CL.periodic;
    // metal/metal: covalent sum + 0.12, but alkali/alkaline pairs never bond.
    near(P.pairBondCutoff(26, 27), 1.32 + 1.26 + 0.12, 1e-9, 'Fe-Co');
    near(P.pairBondCutoff(26, 22), 1.32 + 1.60 + 0.12, 1e-9, 'Fe-Ti');
    eq(P.pairBondCutoff(19, 28), 0, 'K-Ni rejected (alkali)');
    eq(P.pairBondCutoff(11, 11), 0, 'Na-Na rejected (alkali)');
    eq(P.pairBondCutoff(20, 3), 0, 'Ca-Li rejected (alkaline)');
    // metal/non-metal: ionic allowance 0.35.
    near(P.pairBondCutoff(11, 17), 1.66 + 1.02 + 0.35, 1e-9, 'Na-Cl');
    near(P.pairBondCutoff(19, 9), 2.03 + 0.57 + 0.35, 1e-9, 'K-F');
    near(P.pairBondCutoff(20, 9), 1.76 + 0.57 + 0.35, 1e-9, 'Ca-F');
    near(P.pairBondCutoff(28, 9), 1.24 + 0.57 + 0.35, 1e-9, 'Ni-F');
    // non-metal / metalloid contacts: tight 0.12 allowance (Bi2Te3 contacts).
    near(P.pairBondCutoff(83, 52), 1.48 + 1.38 + 0.12, 1e-9, 'Bi-Te');
    near(P.pairBondCutoff(14, 8), 1.11 + 0.66 + 0.12, 1e-9, 'Si-O');
    near(P.pairBondCutoff(6, 6), 0.76 + 0.76 + 0.12, 1e-9, 'C-C');
    // Unknown element falls back to covalent 0.77 + 0.12.
    near(P.pairBondCutoff(0, 0), 0.77 + 0.77 + 0.12, 1e-9, 'X-X');
    ok(P.isAlkaliOrAlkaline(3) && P.isAlkaliOrAlkaline(56) && !P.isAlkaliOrAlkaline(26), 'isAlkaliOrAlkaline');
  });
})();
