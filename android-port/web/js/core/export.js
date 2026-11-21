/**
 * CrystalLens Android - CIF / XYZ export.
 *
 * Port of cl::ExportStructureToCif / ExportStructureToXyz
 * (reference/CrystalLens/src/core/Crystal.cpp, docs/spec/core.md §12).
 *
 * CIF writes the asymmetric unit + symmetry operations (needs a valid cell).
 * XYZ writes Cartesian coordinates: StructureData -> expanded unit-cell atoms;
 * DisplayModel -> the displayed interior atoms (kind !== 'boundary').
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var crystal = CL.crystal = CL.crystal || {};

  var ERR_NO_CELL = 'toast.no-cell-for-cif';
  var ERR_NO_ATOMS = '\u7ED3\u6784\u4E2D\u6CA1\u6709\u539F\u5B50'; // 结构中没有原子

  function trim(v) { return v == null ? '' : String(v).replace(/^\s+|\s+$/g, ''); }
  function isSpace(ch) { return /\s/.test(ch); }
  function fmt8(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '0.00000000';
    return v.toFixed(8);
  }
  function symbolOf(z) {
    if (crystal.symbolOf) return crystal.symbolOf(z);
    return 'X';
  }

  /** Port of CifQuote: single/double quote when safe, else semicolon block. */
  function cifQuote(text) {
    var value = String(text == null ? '' : text).replace(/[\r\n\t]/g, ' ');
    var quotes = ["'", '"'];
    for (var q = 0; q < quotes.length; q++) {
      var quote = quotes[q];
      var safe = true;
      for (var i = 0; i + 1 < value.length; i++) {
        if (value.charAt(i) === quote && isSpace(value.charAt(i + 1))) {
          safe = false;
          break;
        }
      }
      if (safe) return quote + value + quote;
    }
    return ';\n' + value + '\n;\n';
  }

  function uniqueCifLabel(site, index, used, symbol) {
    var label = site.baseLabel || site.label || '';
    if (!label) label = symbol + (index + 1);
    var unique = label;
    for (var n = 2; used[unique]; n++) unique = label + '_' + n;
    used[unique] = true;
    return cifQuote(unique);
  }

  /**
   * CL.crystal.exportCif(structure) -> string | null
   * Serialises the asymmetric unit and the existing symmetry operations.
   */
  function exportCif(structure) {
    var result = exportCifResult(structure);
    return result.ok ? result.text : null;
  }

  /** CL.crystal.exportCifResult(structure) -> {ok, text?, error?} */
  function exportCifResult(structure) {
    if (!structure) return { ok: false, error: ERR_NO_ATOMS };
    var cell = structure.cell;
    var sites = structure.sites || [];
    if (!cell) return { ok: false, error: ERR_NO_CELL };
    if (!sites.length) return { ok: false, error: ERR_NO_ATOMS };

    var out = [];
    out.push('data_crystallens_export');
    var title = trim(structure.title);
    if (title) out.push('_chemical_name_common      ' + cifQuote(title));
    var formula = trim(structure.formula);
    if (formula) out.push('_chemical_formula_sum      ' + cifQuote(formula));
    out.push('_cell_length_a             ' + fmt8(cell.a));
    out.push('_cell_length_b             ' + fmt8(cell.b));
    out.push('_cell_length_c             ' + fmt8(cell.c));
    out.push('_cell_angle_alpha          ' + fmt8(cell.alpha));
    out.push('_cell_angle_beta           ' + fmt8(cell.beta));
    out.push('_cell_angle_gamma          ' + fmt8(cell.gamma));
    out.push('_cell_volume               ' + fmt8(cell.volume));

    var spaceGroup = trim(structure.spaceGroup);
    if (spaceGroup) {
      if (spaceGroup.charAt(0) === '#' && /^#[0-9]+$/.test(spaceGroup)) {
        out.push('_space_group_IT_number ' + spaceGroup.substring(1));
      } else {
        out.push('_symmetry_space_group_name_H-M ' + cifQuote(spaceGroup));
      }
    }

    var symops = structure.symops || [];
    if (symops.length) {
      out.push('');
      out.push('loop_');
      out.push('_symmetry_equiv_pos_site_id');
      out.push('_symmetry_equiv_pos_as_xyz');
      for (var oi = 0; oi < symops.length; oi++) {
        var text = trim(symops[oi].text);
        out.push((oi + 1) + ' ' + cifQuote(text || 'x,y,z'));
      }
    }

    var anyDisorder = false;
    var anyUiso = false;
    var si;
    for (si = 0; si < sites.length; si++) {
      if (sites[si].disorderGroup || sites[si].disorderAssembly) anyDisorder = true;
      if (sites[si].hasUiso) anyUiso = true;
    }
    out.push('');
    out.push('loop_');
    out.push('_atom_site_label');
    out.push('_atom_site_type_symbol');
    out.push('_atom_site_fract_x');
    out.push('_atom_site_fract_y');
    out.push('_atom_site_fract_z');
    out.push('_atom_site_occupancy');
    if (anyDisorder) {
      out.push('_atom_site_disorder_assembly');
      out.push('_atom_site_disorder_group');
    }
    if (anyUiso) out.push('_atom_site_U_iso_or_equiv');

    var used = {};
    for (si = 0; si < sites.length; si++) {
      var site = sites[si];
      var symbol = symbolOf(site.z);
      var frac = site.frac || [0, 0, 0];
      var line = uniqueCifLabel(site, si, used, symbol) + ' ' + symbol + ' ' +
        fmt8(frac[0]) + ' ' + fmt8(frac[1]) + ' ' + fmt8(frac[2]) + ' ' +
        fmt8(typeof site.occupancy === 'number' ? site.occupancy : 1);
      if (anyDisorder) {
        line += ' ' + (trim(site.disorderAssembly) ? cifQuote(trim(site.disorderAssembly)) : '.');
        line += ' ' + (trim(site.disorderGroup) ? cifQuote(trim(site.disorderGroup)) : '.');
      }
      if (anyUiso) {
        line += site.hasUiso ? (' ' + fmt8(site.uiso)) : ' ?';
      }
      out.push(line);
    }
    return { ok: true, text: out.join('\n') + '\n' };
  }

  function xyzComment(title) {
    var comment = trim(title).replace(/[\r\n]+/g, ' ');
    return comment || 'CrystalLens export';
  }

  function isDisplayModel(obj) {
    return !!(obj && obj.atoms && obj.atoms.length && obj.atoms[0] &&
      Array.isArray(obj.atoms[0].pos) && Array.isArray(obj.origin));
  }

  /**
   * CL.crystal.exportXyz(source) -> string | null
   * source = DisplayModel (interior displayed atoms) or StructureData (cell atoms).
   */
  function exportXyz(source) {
    var result = exportXyzResult(source);
    return result.ok ? result.text : null;
  }

  /** CL.crystal.exportXyzResult(source) -> {ok, text?, error?} */
  function exportXyzResult(source) {
    if (!source) return { ok: false, error: ERR_NO_ATOMS };
    var atoms;
    var lines = [];
    var title;
    if (isDisplayModel(source)) {
      var origin = source.origin || [0, 0, 0];
      title = source.title;
      var all = source.atoms;
      for (var i = 0; i < all.length; i++) {
        var atom = all[i];
        // Periodic structures export the displayed cell contents, not boundary images.
        if (source.hasCell && atom.kind === 'boundary') continue;
        lines.push(symbolOf(atom.z) + ' ' +
          fmt8(atom.pos[0] + origin[0]) + ' ' + fmt8(atom.pos[1] + origin[1]) + ' ' +
          fmt8(atom.pos[2] + origin[2]));
      }
      if (!lines.length) return { ok: false, error: ERR_NO_ATOMS };
    } else {
      atoms = source.atoms || [];
      title = source.title;
      if (!atoms.length) return { ok: false, error: ERR_NO_ATOMS };
      for (var a = 0; a < atoms.length; a++) {
        var cart = atoms[a].cart || [0, 0, 0];
        lines.push(symbolOf(atoms[a].z) + ' ' + fmt8(cart[0]) + ' ' + fmt8(cart[1]) + ' ' + fmt8(cart[2]));
      }
    }
    var header = String(lines.length) + '\n' + xyzComment(title) + '\n';
    return { ok: true, text: header + lines.join('\n') + '\n' };
  }

  crystal.cifQuote = cifQuote;
  crystal.exportCif = exportCif;
  crystal.exportCifResult = exportCifResult;
  crystal.exportXyz = exportXyz;
  crystal.exportXyzResult = exportXyzResult;

  CL.export = {
    cif: exportCif,
    cifResult: exportCifResult,
    xyz: exportXyz,
    xyzResult: exportXyzResult
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
