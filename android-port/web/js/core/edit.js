/**
 * CrystalLens Android - pure-functional structure editing.
 *
 * Port of cl::SetCellParameters / AddAtomSite / UpdateAtomSite / DeleteAtomSite
 * (reference/CrystalLens/src/core/Crystal.cpp §11 of docs/spec/core.md).
 *
 * Every function validates a candidate structure first and only then rebuilds
 * symmetry copies, contents, bounds and bonds. The input object is never
 * mutated; success returns {ok:true, structure, ...}, failure {ok:false, error}
 * where error is an i18n key when one exists (CONTRACT §3).
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var crystal = CL.crystal = CL.crystal || {};
  var M = CL.Math;

  var ERR = {
    ELEMENT: 'dialog.atom.error.invalid-element',
    OCCUPANCY: 'dialog.atom.error.invalid-occupancy',
    NUMBER: 'dialog.error.invalid-number',
    CELL: 'dialog.edit-cell.error.invalid',
    NO_ATOMS: '\u7ED3\u6784\u4E2D\u6CA1\u6709\u539F\u5B50',            // 结构中没有原子
    BAD_INDEX: '\u539F\u5B50\u7D22\u5F15\u65E0\u6548',                  // 原子索引无效
    LAST_ATOM: '\u7ED3\u6784\u4E2D\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u539F\u5B50', // 结构中至少需要保留一个原子
    CART_TO_FRAC: '\u73B0\u6709\u539F\u5B50\u5750\u6807\u65E0\u6548\uFF0C\u65E0\u6CD5\u8F6C\u6362\u4E3A\u5206\u6570\u5750\u6807' // 现有原子坐标无效，无法转换为分数坐标
  };

  function fail(error) { return { ok: false, error: error }; }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function isFiniteVec(v) { return !!v && isFiniteNum(v[0]) && isFiniteNum(v[1]) && isFiniteNum(v[2]); }
  function cloneVec(v) { return v ? [v[0], v[1], v[2]] : [0, 0, 0]; }
  function trim(v) { return v == null ? '' : String(v).replace(/^\s+|\s+$/g, ''); }

  /** Deep copy of the source-of-truth fields; derived arrays are dropped. */
  function cloneStructure(s) {
    var symops = (s.symops || []).map(function (op) {
      return {
        m: [[op.m[0][0], op.m[0][1], op.m[0][2]],
            [op.m[1][0], op.m[1][1], op.m[1][2]],
            [op.m[2][0], op.m[2][1], op.m[2][2]]],
        t: [op.t[0], op.t[1], op.t[2]],
        text: op.text || 'x,y,z'
      };
    });
    var sites = (s.sites || []).map(function (site, i) {
      return {
        label: site.label || '',
        baseLabel: site.baseLabel || '',
        element: site.element || 'X',
        z: site.z | 0,
        frac: Array.isArray(site.frac) ? [site.frac[0], site.frac[1], site.frac[2]] : null,
        cart: Array.isArray(site.cart) ? [site.cart[0], site.cart[1], site.cart[2]] : null,
        occupancy: typeof site.occupancy === 'number' ? site.occupancy : 1,
        uiso: typeof site.uiso === 'number' ? site.uiso : 0,
        hasUiso: !!site.hasUiso,
        disorderGroup: site.disorderGroup || '',
        disorderAssembly: site.disorderAssembly || '',
        siteIndex: i
      };
    });
    var cell = null;
    if (s.cell) {
      cell = {
        a: s.cell.a, b: s.cell.b, c: s.cell.c,
        alpha: s.cell.alpha, beta: s.cell.beta, gamma: s.cell.gamma,
        aVec: cloneVec(s.cell.aVec), bVec: cloneVec(s.cell.bVec), cVec: cloneVec(s.cell.cVec),
        volume: s.cell.volume
      };
    }
    return {
      format: s.format || 'cif',
      sourceName: s.sourceName || '',
      title: s.title || '',
      blockName: s.blockName || '',
      spaceGroup: s.spaceGroup || '',
      note: s.note || '',
      formula: s.formula || '',
      periodic: !!s.periodic,
      cell: cell,
      symops: symops,
      sites: sites,
      symmetryExpanded: false,
      asymmetricAtomCount: sites.length,
      symmetryOperatorCount: s.symmetryOperatorCount || (symops.length || 1),
      truncated: false
    };
  }

  function elementInput(text) {
    if (text == null) return null;
    if (typeof text === 'number') {
      var direct = isFiniteNum(text) ? (text | 0) : 0;
      if (direct >= 1 && direct <= 118) return { z: direct, symbol: crystal.symbolOf(direct) };
      return null;
    }
    var str = trim(text);
    if (!str) return null;
    if (/^\+?\d+$/.test(str)) {
      var n = parseInt(str, 10);
      if (n >= 1 && n <= 118) return { z: n, symbol: crystal.symbolOf(n) };
      return null;
    }
    if (CL.periodic && CL.periodic.elementFromInput) {
      var parsed = CL.periodic.elementFromInput(str);
      if (parsed && parsed.z > 0) return { z: parsed.z, symbol: parsed.symbol };
      return null;
    }
    var sym = str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    var z = 0;
    for (var i = 1; i <= 118; i++) {
      if (crystal.symbolOf(i) === sym) { z = i; break; }
    }
    return z ? { z: z, symbol: sym } : null;
  }

  /** Resolve the edited site's atomic number from z / element / atomicNumber. */
  function resolveZ(atom) {
    if (atom.z != null && isFiniteNum(atom.z) && atom.z >= 1 && atom.z <= 118) return atom.z | 0;
    if (atom.atomicNumber != null && isFiniteNum(atom.atomicNumber) &&
        atom.atomicNumber >= 1 && atom.atomicNumber <= 118) return atom.atomicNumber | 0;
    var parsed = elementInput(atom.element);
    return parsed ? parsed.z : 0;
  }

  function uniqueSiteLabel(structure, requested, symbol) {
    var used = {};
    var sites = structure.sites || [];
    for (var i = 0; i < sites.length; i++) {
      var label = sites[i].baseLabel || sites[i].label;
      if (label) used[label] = true;
    }
    var base = trim(requested);
    var n;
    if (!base) {
      for (n = 1; n < 10000; n++) {
        var candidate = symbol + n;
        if (!used[candidate]) return candidate;
      }
      return symbol;
    }
    if (!used[base]) return base;
    for (n = 2; n < 10000; n++) {
      var suffixed = base + '_' + n;
      if (!used[suffixed]) return suffixed;
    }
    return base;
  }

  /**
   * Port of PrepareAtomForStructure: validates and normalises one site in place.
   * Returns null on success, an error key/text otherwise.
   */
  function prepareAtomForStructure(structure, atom) {
    var z = resolveZ(atom);
    if (!(z >= 1 && z <= 118)) return ERR.ELEMENT;
    var occupancy = atom.occupancy == null ? 1 : atom.occupancy;
    if (!isFiniteNum(occupancy) || occupancy <= 0 || occupancy > 1) return ERR.OCCUPANCY;
    if (structure.cell) {
      if (!isFiniteVec(atom.frac)) {
        if (isFiniteVec(atom.cart)) atom.frac = M.wrap01Vec(M.cartToFrac(structure.cell, atom.cart));
        else return ERR.NUMBER;
      }
      atom.frac = M.wrap01Vec(atom.frac);
      atom.cart = M.fracToCart(structure.cell, atom.frac);
    } else {
      if (!isFiniteVec(atom.cart)) return ERR.NUMBER;
      atom.frac = [0, 0, 0];
    }
    atom.z = z;
    atom.element = crystal.symbolOf(z);
    atom.occupancy = occupancy;
    var label = trim(atom.label);
    atom.label = label || uniqueSiteLabel(structure, '', atom.element);
    atom.baseLabel = atom.label;
    return null;
  }

  function cloneSite(site) {
    return {
      label: site.label || '',
      baseLabel: site.baseLabel || '',
      element: site.element || 'X',
      z: site.z | 0,
      frac: Array.isArray(site.frac) ? [site.frac[0], site.frac[1], site.frac[2]] : null,
      cart: Array.isArray(site.cart) ? [site.cart[0], site.cart[1], site.cart[2]] : null,
      occupancy: typeof site.occupancy === 'number' ? site.occupancy : 1,
      uiso: typeof site.uiso === 'number' ? site.uiso : 0,
      hasUiso: !!site.hasUiso,
      disorderGroup: site.disorderGroup || '',
      disorderAssembly: site.disorderAssembly || '',
      siteIndex: site.siteIndex | 0
    };
  }

  function finish(structure) {
    crystal.finalize(structure);
    return { ok: true, structure: structure };
  }

  /**
   * CL.crystal.setCellParameters(structure, {a,b,c,alpha,beta,gamma})
   * A molecule without a cell is converted to a crystal (cartesian -> fractional).
   */
  function setCellParameters(structure, params) {
    if (!structure) return fail(ERR.NO_ATOMS);
    var p = params || {};
    if (Array.isArray(p)) {
      p = { a: p[0], b: p[1], c: p[2], alpha: p[3], beta: p[4], gamma: p[5] };
    } else if (arguments.length >= 7) {
      p = { a: arguments[1], b: arguments[2], c: arguments[3], alpha: arguments[4], beta: arguments[5], gamma: arguments[6] };
    }
    if (!(structure.sites && structure.sites.length)) return fail(ERR.NO_ATOMS);
    var candidate = M.buildCell(p.a, p.b, p.c, p.alpha, p.beta, p.gamma);
    if (!candidate) return fail(ERR.CELL);
    var next = cloneStructure(structure);
    if (!structure.cell) {
      for (var i = 0; i < next.sites.length; i++) {
        var site = next.sites[i];
        if (!isFiniteVec(site.cart)) return fail(ERR.CART_TO_FRAC);
        site.frac = M.wrap01Vec(M.cartToFrac(candidate, site.cart));
      }
    }
    next.cell = candidate;
    next.periodic = true;
    return finish(next);
  }

  function siteFromInput(input) {
    input = input || {};
    var site = {
      label: input.label != null ? String(input.label) : '',
      baseLabel: '',
      element: input.element != null ? String(input.element) : 'X',
      z: 0,
      frac: Array.isArray(input.frac) ? [input.frac[0], input.frac[1], input.frac[2]] : null,
      cart: Array.isArray(input.cart) ? [input.cart[0], input.cart[1], input.cart[2]] : null,
      occupancy: input.occupancy != null ? input.occupancy : 1,
      uiso: input.uiso != null ? input.uiso : 0,
      hasUiso: !!input.hasUiso,
      disorderGroup: input.disorderGroup || '',
      disorderAssembly: input.disorderAssembly || '',
      siteIndex: 0
    };
    return site;
  }

  /**
   * CL.crystal.addAtomSite(structure, siteInput)
   * siteInput = {element:'Si'|14, frac?, cart?, occupancy?, label?, uiso?, hasUiso?}
   */
  function addAtomSite(structure, siteInput) {
    if (!structure) return fail(ERR.NO_ATOMS);
    var next = cloneStructure(structure);
    var site = siteFromInput(siteInput);
    if (siteInput && siteInput.z != null) site.z = siteInput.z;
    var error = prepareAtomForStructure(next, site);
    if (error) return fail(error);
    site.siteIndex = next.sites.length;
    next.sites.push(site);
    var result = finish(next);
    result.siteIndex = next.sites.length - 1;
    return result;
  }

  /**
   * CL.crystal.updateAtomSite(structure, siteIndex, siteInput)
   * Only element/label/occupancy/coordinates are replaced; disorder and Uiso
   * stay unless explicitly supplied.
   */
  function updateAtomSite(structure, siteIndex, siteInput) {
    if (!structure) return fail(ERR.NO_ATOMS);
    var sites = structure.sites || [];
    if (!(siteIndex >= 0 && siteIndex < sites.length)) return fail(ERR.BAD_INDEX);
    var next = cloneStructure(structure);
    var atom = cloneSite(next.sites[siteIndex]);
    next.sites[siteIndex] = atom;
    siteInput = siteInput || {};
    if (siteInput.z != null) atom.z = siteInput.z;
    else if (siteInput.element != null) { atom.element = String(siteInput.element); atom.z = 0; }
    if (siteInput.label != null) atom.label = String(siteInput.label);
    if (siteInput.occupancy != null) atom.occupancy = siteInput.occupancy;
    if (siteInput.uiso != null) { atom.uiso = siteInput.uiso; atom.hasUiso = true; }
    if (Array.isArray(siteInput.frac)) atom.frac = [siteInput.frac[0], siteInput.frac[1], siteInput.frac[2]];
    if (Array.isArray(siteInput.cart)) atom.cart = [siteInput.cart[0], siteInput.cart[1], siteInput.cart[2]];
    if (siteInput.disorderGroup != null) atom.disorderGroup = siteInput.disorderGroup;
    if (siteInput.disorderAssembly != null) atom.disorderAssembly = siteInput.disorderAssembly;
    var error = prepareAtomForStructure(next, atom);
    if (error) return fail(error);
    return finish(next);
  }

  /** CL.crystal.deleteAtomSite(structure, siteIndex) */
  function deleteAtomSite(structure, siteIndex) {
    if (!structure) return fail(ERR.NO_ATOMS);
    var sites = structure.sites || [];
    if (!(siteIndex >= 0 && siteIndex < sites.length)) return fail(ERR.BAD_INDEX);
    if (sites.length <= 1) return fail(ERR.LAST_ATOM);
    var next = cloneStructure(structure);
    next.sites.splice(siteIndex, 1);
    for (var i = 0; i < next.sites.length; i++) next.sites[i].siteIndex = i;
    return finish(next);
  }

  crystal.elementFromInput = elementInput;
  crystal.prepareAtomForStructure = prepareAtomForStructure;
  crystal.uniqueSiteLabel = uniqueSiteLabel;
  crystal.cloneStructure = cloneStructure;
  crystal.setCellParameters = setCellParameters;
  crystal.addAtomSite = addAtomSite;
  crystal.updateAtomSite = updateAtomSite;
  crystal.deleteAtomSite = deleteAtomSite;
  crystal.EDIT_ERRORS = ERR;

  CL.edit = {
    setCellParameters: setCellParameters,
    addAtomSite: addAtomSite,
    updateAtomSite: updateAtomSite,
    deleteAtomSite: deleteAtomSite,
    elementFromInput: elementInput
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
