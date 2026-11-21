/**
 * CrystalLens Android - editing tests (CL.crystal.setCellParameters / add / update / delete).
 *
 * Covers docs/spec/core.md §11 and CONTRACT §6.4: pure functions returning
 * {ok:true, structure} or {ok:false, error}; complete validation before rebuild;
 * symmetry expansion / bonds / summary refreshed after every edit.
 */
'use strict';

function fixtureCell(a, b, c, alpha, beta, gamma) {
  var cell = CL.Math.buildCell(a, b, c, alpha, beta, gamma);
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
    format: cell ? 'cif' : 'xyz', sourceName: 'fixture.cif', title: 'Fixture', blockName: '',
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
    fixtureSite('Cl1', 'Cl', 17, [0.5, 0, 0])
  ], [transOp([0, 0, 0]), transOp([0, 0.5, 0.5]), transOp([0.5, 0, 0.5]), transOp([0.5, 0.5, 0])]);
}
function waterStructure() {
  var sites = [
    fixtureSite('O1', 'O', 8, null, { cart: [0, 0, 0] }),
    fixtureSite('H1', 'H', 1, null, { cart: [0.757, 0.586, 0] }),
    fixtureSite('H2', 'H', 1, null, { cart: [-0.757, 0.586, 0] })
  ];
  return fixtureStructure(null, sites, [], { format: 'xyz', title: 'water' });
}

test('edit: elementFromInput accepts symbols and atomic numbers', function () {
  var e = CL.crystal.elementFromInput('14');
  if (!e || e.z !== 14 || e.symbol !== 'Si') throw new Error('14 -> ' + JSON.stringify(e));
  e = CL.crystal.elementFromInput('fe');
  if (!e || e.z !== 26 || e.symbol !== 'Fe') throw new Error('fe -> ' + JSON.stringify(e));
  e = CL.crystal.elementFromInput('Si');
  if (!e || e.z !== 14) throw new Error('Si -> ' + JSON.stringify(e));
  e = CL.crystal.elementFromInput(92);
  if (!e || e.symbol !== 'U') throw new Error('92 -> ' + JSON.stringify(e));
  if (CL.crystal.elementFromInput('Qq') !== null) throw new Error('Qq accepted');
  if (CL.crystal.elementFromInput('0') !== null) throw new Error('0 accepted');
  if (CL.crystal.elementFromInput('119') !== null) throw new Error('119 accepted');
  if (CL.crystal.elementFromInput('') !== null) throw new Error('empty accepted');
});

test('edit: setCellParameters updates the cell and keeps the sites', function () {
  var s = naclStructure();
  var before = JSON.stringify(s);
  var result = CL.crystal.setCellParameters(s, { a: 5.1, b: 5.6402, c: 5.6402, alpha: 90, beta: 90, gamma: 90 });
  if (!result.ok) throw new Error('setCellParameters failed: ' + result.error);
  approx(result.structure.cell.a, 5.1, 1e-9, 'new a');
  if (result.structure.sites.length !== 2) throw new Error('sites changed');
  if (result.structure.atoms.length !== 8) throw new Error('atoms not rebuilt: ' + result.structure.atoms.length);
  if (!result.structure.bonds.length) throw new Error('bonds not rebuilt');
  if (JSON.stringify(s) !== before) throw new Error('input structure was mutated');
});

test('edit: setCellParameters rejects invalid parameters without mutating input', function () {
  var s = naclStructure();
  var before = JSON.stringify(s);
  var bad = [
    { a: -1, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 },
    { a: 5, b: 5, c: 5, alpha: 0, beta: 90, gamma: 90 },
    { a: 5, b: 5, c: 5, alpha: 90, beta: 180, gamma: 90 },
    { a: 5, b: 5, c: 5, alpha: NaN, beta: 90, gamma: 90 }
  ];
  for (var i = 0; i < bad.length; i++) {
    var r = CL.crystal.setCellParameters(s, bad[i]);
    if (r.ok) throw new Error('invalid case ' + i + ' accepted');
    if (typeof r.error !== 'string' || !r.error) throw new Error('missing error text');
  }
  if (JSON.stringify(s) !== before) throw new Error('input mutated by failed edit');
});

test('edit: setCellParameters converts a molecule to a crystal', function () {
  var water = waterStructure();
  var result = CL.crystal.setCellParameters(water, { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 });
  if (!result.ok) throw new Error('molecule->crystal failed');
  var s = result.structure;
  if (!s.cell || !s.periodic) throw new Error('cell not set');
  if (s.atoms.length !== 3) throw new Error('atoms ' + s.atoms.length);
  for (var i = 0; i < s.sites.length; i++) {
    if (!Array.isArray(s.sites[i].frac)) throw new Error('frac not derived');
  }
  approxVec(s.sites[0].frac, [0, 0, 0], 1e-12, 'O frac');
  approx(s.sites[1].frac[0], 0.0757, 1e-12, 'H frac');
  approx(s.sites[1].frac[1], 0.0586, 1e-12, 'H frac y');
});

test('edit: addAtomSite appends a site and rebuilds symmetry copies', function () {
  var s = naclStructure();
  var before = JSON.stringify(s);
  var result = CL.crystal.addAtomSite(s, { element: 'O', frac: [0.13, 0.27, 0.41], occupancy: 1 });
  if (!result.ok) throw new Error('add failed: ' + result.error);
  var next = result.structure;
  if (next.sites.length !== 3) throw new Error('sites ' + next.sites.length);
  if (result.siteIndex !== 2) throw new Error('siteIndex ' + result.siteIndex);
  if (!(next.atoms.length > s.atoms.length)) throw new Error('symmetry copies not generated');
  var added = next.sites[2];
  if (added.element !== 'O' || added.z !== 8) throw new Error('element not resolved');
  if (added.baseLabel !== added.label) throw new Error('baseLabel');
  if (JSON.stringify(s) !== before) throw new Error('input mutated');
  // All added atoms point back at the new site.
  var copies = 0;
  for (var i = 0; i < next.atoms.length; i++) if (next.atoms[i].siteIndex === 2) copies++;
  if (!(copies >= 1)) throw new Error('no atoms reference the new site');
});

test('edit: addAtomSite auto-generates unique labels', function () {
  var s = naclStructure();
  var r1 = CL.crystal.addAtomSite(s, { element: 'C', frac: [0.1, 0.2, 0.3] });
  if (!r1.ok) throw new Error('add C failed');
  if (r1.structure.sites[2].label !== 'C1') throw new Error('first label ' + r1.structure.sites[2].label);
  var r2 = CL.crystal.addAtomSite(r1.structure, { element: 'C', frac: [0.2, 0.3, 0.4] });
  if (!r2.ok) throw new Error('add second C failed');
  if (r2.structure.sites[3].label !== 'C2') throw new Error('second label ' + r2.structure.sites[3].label);
  var r3 = CL.crystal.addAtomSite(r2.structure, { element: 'C', frac: [0.3, 0.4, 0.5], label: 'C1' });
  // Explicit labels are kept verbatim (C++ PrepareAtomForStructure); only
  // auto-generated labels are made unique and exported CIF de-duplicates them.
  if (r3.structure.sites[4].label !== 'C1') throw new Error('explicit label ' + r3.structure.sites[4].label);
  var r4 = CL.crystal.addAtomSite(r2.structure, { element: 'C', frac: [0.35, 0.4, 0.5], label: '  ' });
  if (r4.structure.sites[4].label !== 'C3' || r4.structure.sites[4].baseLabel !== 'C3') {
    throw new Error('trimmed/auto label ' + r4.structure.sites[4].label);
  }
});

test('edit: addAtomSite converts cartesian input when a cell exists', function () {
  var s = naclStructure();
  var result = CL.crystal.addAtomSite(s, { element: 'Si', cart: [2.0, 2.0, 2.0] });
  if (!result.ok) throw new Error('add failed: ' + result.error);
  var site = result.structure.sites[result.structure.sites.length - 1];
  var expected = CL.Math.cartToFrac(result.structure.cell, [2, 2, 2]);
  for (var i = 0; i < 3; i++) {
    var wrapped = expected[i] - Math.floor(expected[i]);
    approx(site.frac[i], wrapped, 1e-9, 'frac[' + i + ']');
  }
});

test('edit: addAtomSite validation errors', function () {
  var s = naclStructure();
  var cases = [
    [{ element: 'Qq', frac: [0.1, 0.1, 0.1] }, 'dialog.atom.error.invalid-element'],
    [{ element: 'O', frac: [0.1, 0.1, 0.1], occupancy: 0 }, 'dialog.atom.error.invalid-occupancy'],
    [{ element: 'O', frac: [0.1, 0.1, 0.1], occupancy: 1.5 }, 'dialog.atom.error.invalid-occupancy'],
    [{ element: 'O', frac: [NaN, 0.1, 0.1] }, 'dialog.error.invalid-number']
  ];
  for (var i = 0; i < cases.length; i++) {
    var r = CL.crystal.addAtomSite(s, cases[i][0]);
    if (r.ok) throw new Error('case ' + i + ' accepted');
    if (r.error !== cases[i][1]) throw new Error('case ' + i + ' error ' + r.error + ' != ' + cases[i][1]);
  }
  var mol = waterStructure();
  var r2 = CL.crystal.addAtomSite(mol, { element: 'O', cart: [Infinity, 0, 0] });
  if (r2.ok) throw new Error('infinite molecule coordinate accepted');
});

test('edit: updateAtomSite changes element, label, coordinates and rebuilds', function () {
  var s = naclStructure();
  var before = JSON.stringify(s);
  var result = CL.crystal.addAtomSite(s, { element: 'O', frac: [0.13, 0.27, 0.41] });
  var idx = result.siteIndex;
  var updated = CL.crystal.updateAtomSite(result.structure, idx,
    { element: 'N', label: 'N_test', frac: [0.22, 0.31, 0.44], occupancy: 0.5 });
  if (!updated.ok) throw new Error('update failed: ' + updated.error);
  var site = updated.structure.sites[idx];
  if (site.element !== 'N' || site.z !== 7) throw new Error('element not updated: ' + site.element);
  if (site.label !== 'N_test' || site.baseLabel !== 'N_test') throw new Error('label not updated');
  approx(site.occupancy, 0.5, 1e-12, 'occupancy');
  var found = false;
  for (var i = 0; i < updated.structure.atoms.length; i++) {
    if (updated.structure.atoms[i].siteIndex === idx && updated.structure.atoms[i].z === 7) found = true;
  }
  if (!found) throw new Error('updated atom copies missing');
  if (JSON.stringify(result.structure) === JSON.stringify(updated.structure)) throw new Error('structure unchanged');
  if (JSON.stringify(s) !== before) throw new Error('original input mutated');
});

test('edit: updateAtomSite keeps uiso/disorder unless supplied', function () {
  var s = naclStructure();
  s.sites[0].uiso = 0.012;
  s.sites[0].hasUiso = true;
  s.sites[0].disorderGroup = '1';
  s.sites[0].disorderAssembly = 'A';
  var result = CL.crystal.updateAtomSite(s, 0, { element: 'K', frac: [0.1, 0.1, 0.1] });
  if (!result.ok) throw new Error('update failed');
  var site = result.structure.sites[0];
  approx(site.uiso, 0.012, 1e-12, 'uiso kept');
  if (!site.hasUiso) throw new Error('hasUiso kept');
  if (site.disorderGroup !== '1' || site.disorderAssembly !== 'A') throw new Error('disorder kept');
});

test('edit: updateAtomSite validation errors', function () {
  var s = naclStructure();
  if (CL.crystal.updateAtomSite(s, 99, { element: 'O', frac: [0, 0, 0] }).ok) throw new Error('bad index accepted');
  if (CL.crystal.updateAtomSite(s, -1, { element: 'O', frac: [0, 0, 0] }).ok) throw new Error('negative index accepted');
  var r = CL.crystal.updateAtomSite(s, 0, { element: 'Qq', frac: [0.1, 0.1, 0.1] });
  if (r.ok || r.error !== 'dialog.atom.error.invalid-element') throw new Error('invalid element case');
  var r2 = CL.crystal.updateAtomSite(s, 0, { element: 'O', frac: [0, 0, 0], occupancy: 0 });
  if (r2.ok || r2.error !== 'dialog.atom.error.invalid-occupancy') throw new Error('invalid occupancy case');
});

test('edit: deleteAtomSite removes a site and refuses to empty the structure', function () {
  var s = naclStructure();
  var before = JSON.stringify(s);
  var result = CL.crystal.deleteAtomSite(s, 1);
  if (!result.ok) throw new Error('delete failed');
  if (result.structure.sites.length !== 1) throw new Error('sites ' + result.structure.sites.length);
  if (result.structure.sites[0].element !== 'Na') throw new Error('wrong site removed');
  if (result.structure.atoms.length !== 4) throw new Error('atoms not rebuilt: ' + result.structure.atoms.length);
  if (JSON.stringify(s) !== before) throw new Error('input mutated');
  var last = CL.crystal.deleteAtomSite(result.structure, 0);
  if (last.ok) throw new Error('removed last atom');
  if (!last.error) throw new Error('missing error text');
  if (CL.crystal.deleteAtomSite(s, 99).ok) throw new Error('bad index accepted');
});

test('edit: deleted site indexes are renumbered', function () {
  var s = naclStructure();
  var r = CL.crystal.deleteAtomSite(s, 0);
  if (!r.ok) throw new Error('delete failed');
  if (r.structure.sites[0].siteIndex !== 0) throw new Error('siteIndex not renumbered');
});

test('edit: JSON snapshot roundtrip of an edited structure', function () {
  var s = naclStructure();
  var r = CL.crystal.addAtomSite(s, { element: 'Si', frac: [0.3, 0.3, 0.3] });
  var snapshot = JSON.parse(JSON.stringify(r.structure));
  var restored = CL.crystal.finalize(snapshot);
  if (restored.sites.length !== 3) throw new Error('sites ' + restored.sites.length);
  if (restored.atoms.length !== r.structure.atoms.length) throw new Error('atoms differ after snapshot');
  if (restored.bonds.length !== r.structure.bonds.length) throw new Error('bonds differ after snapshot');
});

test('edit: setCellParameters keeps molecules with no finite cartesian coords rejected', function () {
  var broken = waterStructure();
  broken.sites[1].cart = [NaN, 0, 0];
  var r = CL.crystal.setCellParameters(broken, { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 });
  if (r.ok) throw new Error('invalid molecule accepted');
  if (typeof r.error !== 'string') throw new Error('missing error');
});

test('integration: edit quartz cell parameters and restore counts', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.parsers.parse(readText('web/data/examples/quartz.cif'), 'quartz.cif');
  CL.crystal.finalize(s);
  var beforeAtoms = s.atoms.length;
  var beforeSites = s.sites.length;
  var beforeBonds = s.bonds.length;
  var r = CL.crystal.setCellParameters(s, {
    a: 5.1, b: s.cell.b, c: s.cell.c, alpha: s.cell.alpha, beta: s.cell.beta, gamma: s.cell.gamma
  });
  if (!r.ok) throw new Error('quartz cell edit failed: ' + r.error);
  if (r.structure.sites.length !== beforeSites) throw new Error('sites changed');
  if (r.structure.atoms.length !== beforeAtoms) throw new Error('atoms changed');
  if (!(r.structure.bonds.length > 0)) throw new Error('no bonds after cell edit');
  if (!r.structure.cellContents) throw new Error('contents missing');
});

test('integration: add/update/delete quartz site then export CIF roundtrip', function () {
  if (!CL.parsers) throw new Error('CL.parsers missing');
  var s = CL.parsers.parse(readText('web/data/examples/quartz.cif'), 'quartz.cif');
  CL.crystal.finalize(s);
  var sitesBefore = s.sites.length;
  var add = CL.crystal.addAtomSite(s, { element: 'O', frac: [0.13, 0.27, 0.41] });
  if (!add.ok) throw new Error('add failed: ' + add.error);
  var idx = add.siteIndex;
  var upd = CL.crystal.updateAtomSite(add.structure, idx, { element: 'N', label: 'N1', frac: [0.22, 0.31, 0.44] });
  if (!upd.ok) throw new Error('update failed: ' + upd.error);
  var del = CL.crystal.deleteAtomSite(upd.structure, idx);
  if (!del.ok) throw new Error('delete failed: ' + del.error);
  if (del.structure.sites.length !== sitesBefore) throw new Error('sites not restored');
  if (del.structure.cellContents !== 'O6 Si3') throw new Error('contents ' + del.structure.cellContents);

  var cif = CL.crystal.exportCif(del.structure);
  if (!cif) throw new Error('exportCif returned null');
  var reloaded = CL.parsers.parse(cif, 'roundtrip.cif');
  CL.crystal.finalize(reloaded);
  approx(reloaded.cell.a, del.structure.cell.a, 1e-4, 'cell a roundtrip');
  if (reloaded.sites.length !== del.structure.sites.length) throw new Error('site count roundtrip');
  if (reloaded.symops.length !== del.structure.symops.length) throw new Error('symop count roundtrip');
  if (reloaded.atoms.length !== del.structure.atoms.length) throw new Error('atom count roundtrip');
});
