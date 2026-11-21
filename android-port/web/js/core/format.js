/**
 * CrystalLens Android - structure summary and formatting.
 *
 * Port of reference/CrystalLens/src/ui/Format.cpp plus the model-layer
 * computeSummary helper required by CONTRACT §6.4.
 *
 * Exposes both CL.crystal.format (namespace) and flat CL.crystal.formatLength /
 * formatAngle / formatCoord helpers.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var crystal = CL.crystal = CL.crystal || {};

  // ------------------------------------------------------------ formatting ---
  /** FormatDouble: non-finite -> em dash, otherwise toFixed(decimals). */
  function formatDouble(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
    return value.toFixed(decimals === undefined ? 3 : decimals);
  }
  function formatNumber(value, decimals) { return formatDouble(value, decimals); }

  /** "1.234 Å" (distance measurement value); non-finite -> em dash. */
  function formatLength(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
    return value.toFixed(3) + ' \u00C5';
  }
  /** "90.00°" (angle measurement value); non-finite -> em dash. */
  function formatAngle(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '\u2014';
    return value.toFixed(2) + '\u00B0';
  }
  /** Coordinate text: 4 decimals (edit dialogs use formatNumber(v,5) directly). */
  function formatCoord(value) { return formatDouble(value, 4); }

  function formatCellLengths(structure) {
    var cell = structure && structure.cell;
    if (!cell) return '\u2014';
    return 'a ' + formatDouble(cell.a, 4) + '  b ' + formatDouble(cell.b, 4) +
      '  c ' + formatDouble(cell.c, 4) + ' \u00C5';
  }
  function formatCellAngles(structure) {
    var cell = structure && structure.cell;
    if (!cell) return '\u2014';
    return '\u03B1 ' + formatDouble(cell.alpha, 2) + '\u00B0   \u03B2 ' + formatDouble(cell.beta, 2) +
      '\u00B0   \u03B3 ' + formatDouble(cell.gamma, 2) + '\u00B0';
  }
  function formatVolume(structure) {
    var cell = structure && structure.cell;
    if (!cell) return '\u2014';
    return formatDouble(cell.volume, 2) + ' \u00C5\u00B3';
  }
  function formatFormulaText(structure) {
    var formula = structure && structure.formula ? structure.formula : '';
    if (!formula) formula = structure && structure.cellContents ? structure.cellContents : '';
    return formula || '\u2014';
  }
  function formatFileStem(path) {
    if (!path) return '';
    var s = String(path);
    var slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    var name = slash >= 0 ? s.substring(slash + 1) : s;
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
  }
  function formatDisplayName(format) {
    if (format === 'cif') return 'CIF';
    if (format === 'xyz') return 'XYZ';
    if (format === 'vesta') return 'VESTA';
    return '\u672A\u77E5'; // 未知
  }

  /** Atom display label: label, else element+index(1-based); out of range "?". */
  function atomDisplayLabel(structure, atomIndex) {
    var atoms = structure && structure.atoms ? structure.atoms : [];
    if (!(atomIndex >= 0 && atomIndex < atoms.length)) return '?';
    var atom = atoms[atomIndex];
    if (atom && atom.label) return atom.label;
    return (atom && atom.element ? atom.element : 'X') + (atomIndex + 1);
  }

  function measurementExpression(structure, measurement) {
    if (!measurement) return '';
    var ids = measurement.atomIds;
    if (!ids) {
      ids = measurement.kind === 'angle' ? [measurement.a, measurement.b, measurement.c] : [measurement.a, measurement.b];
    }
    var labels = [];
    for (var i = 0; i < ids.length; i++) labels.push(atomDisplayLabel(structure, ids[i]));
    return labels.join('\u2013'); // en dash
  }

  function measurementValueText(measurement) {
    if (!measurement) return '\u2014';
    return measurement.kind === 'angle' ? formatAngle(measurement.value) : formatLength(measurement.value);
  }
  function measurementTypeText(measurement) {
    return measurement && measurement.kind === 'angle' ? 'angle' : 'distance';
  }

  // --------------------------------------------------------- computeSummary --
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { var t = a % b; a = b; b = t; }
    return a || 1;
  }

  /**
   * Hill-system formula of the current cell contents, reduced by the GCD.
   * C first, H second, then alphabetical by element symbol; count 1 omitted.
   */
  function hillFormula(entries) {
    if (!entries || !entries.length) return '';
    var counts = {};
    var i;
    for (i = 0; i < entries.length; i++) {
      counts[entries[i].symbol] = (counts[entries[i].symbol] || 0) + entries[i].count;
    }
    var symbols = Object.keys(counts);
    if (symbols.length === 1) {
      return symbols[0] + (counts[symbols[0]] !== 1 ? String(counts[symbols[0]]) : '');
    }
    // Reduce (content counts) by the greatest common divisor.
    var divisor = 0;
    for (i = 0; i < symbols.length; i++) divisor = gcd(divisor, counts[symbols[i]]);
    if (!(divisor > 0)) divisor = 1;
    var order = function (a, b) {
      var aC = a === 'C', bC = b === 'C';
      if (aC !== bC) return aC ? -1 : 1;
      var aH = a === 'H', bH = b === 'H';
      if (aH !== bH) return aH ? -1 : 1;
      return a < b ? -1 : (a > b ? 1 : 0);
    };
    symbols.sort(order);
    var parts = [];
    for (i = 0; i < symbols.length; i++) {
      var n = counts[symbols[i]] / divisor;
      parts.push(symbols[i] + (n !== 1 ? String(n) : ''));
    }
    return parts.join('');
  }

  /**
   * CL.crystal.computeSummary(structure) -> {formula, cellContents,
   * elementCounts, elements, center, boundRadius, ...}
   */
  function computeSummary(structure) {
    if (!structure) return null;
    var atoms = structure.atoms && structure.atoms.length ? structure.atoms : (structure.sites || []);
    var symbolOf = crystal.symbolOf || function (z) { return 'X'; };
    var countsByZ = {};
    var i;
    for (i = 0; i < atoms.length; i++) {
      var z = atoms[i].z | 0;
      countsByZ[z] = (countsByZ[z] || 0) + 1;
    }
    var zs = [];
    for (var key in countsByZ) {
      if (Object.prototype.hasOwnProperty.call(countsByZ, key)) zs.push(parseInt(key, 10));
    }
    zs.sort(function (a, b) { return a - b; });
    var entries = [];
    var elementCounts = {};
    var contentParts = [];
    for (i = 0; i < zs.length; i++) {
      var symbol = symbolOf(zs[i]);
      var count = countsByZ[zs[i]];
      entries.push({ z: zs[i], symbol: symbol, count: count });
      elementCounts[String(zs[i])] = count;
      contentParts.push(symbol + (count !== 1 ? String(count) : ''));
    }
    var cellContents = structure.cellContents || contentParts.join(' ');
    var cell = structure.cell || null;
    return {
      formula: hillFormula(entries),
      cellContents: cellContents,
      elementCounts: elementCounts,
      elements: entries,
      atomCount: atoms.length,
      bondCount: structure.bonds ? structure.bonds.length : 0,
      asymmetricAtomCount: structure.asymmetricAtomCount != null
        ? structure.asymmetricAtomCount : (structure.sites ? structure.sites.length : atoms.length),
      symmetryOperatorCount: structure.symmetryOperatorCount || 1,
      center: structure.center ? [structure.center[0], structure.center[1], structure.center[2]] : [0, 0, 0],
      boundRadius: typeof structure.boundRadius === 'number' ? structure.boundRadius : 8.0,
      cell: cell,
      volume: cell ? cell.volume : null,
      title: structure.title || '',
      spaceGroup: structure.spaceGroup || '',
      format: structure.format || '',
      sourceName: structure.sourceName || '',
      note: structure.note || '',
      periodic: !!structure.periodic,
      truncated: !!structure.truncated
    };
  }

  // ------------------------------------------------------ structure summary --
  /** BuildStructureSummary (copy-summary text). */
  function buildStructureSummary(structure, measurements) {
    if (!structure) return '';
    var lines = [];
    lines.push('CrystalLens v1.1');
    lines.push(structure.title || '');
    lines.push('Format: ' + formatDisplayName(structure.format));
    lines.push('Formula: ' + formatFormulaText(structure));
    if (structure.spaceGroup) lines.push('Space group: ' + structure.spaceGroup);
    var cell = structure.cell;
    if (cell) {
      lines.push('Cell: a=' + formatDouble(cell.a, 5) + ', b=' + formatDouble(cell.b, 5) +
        ', c=' + formatDouble(cell.c, 5) + ', alpha=' + formatDouble(cell.alpha, 3) +
        ', beta=' + formatDouble(cell.beta, 3) + ', gamma=' + formatDouble(cell.gamma, 3));
      lines.push('Volume: ' + formatDouble(cell.volume, 3) + ' A^3');
    }
    var atoms = structure.atoms ? structure.atoms.length : 0;
    var bonds = structure.bonds ? structure.bonds.length : 0;
    lines.push('Atoms: ' + atoms + ', bonds: ' + bonds);
    if (measurements && measurements.length) {
      lines.push('Measurements:');
      for (var i = 0; i < measurements.length; i++) {
        lines.push('  ' + (i + 1) + '. ' + measurementExpression(structure, measurements[i]) + '  ' +
          measurementValueText(measurements[i]));
      }
    }
    if (structure.sourceName) lines.push('Source: ' + structure.sourceName);
    return lines.join('\n') + '\n';
  }

  var formatNs = {
    formatDouble: formatDouble,
    formatNumber: formatNumber,
    formatLength: formatLength,
    formatAngle: formatAngle,
    formatCoord: formatCoord,
    formatCellLengths: formatCellLengths,
    formatCellAngles: formatCellAngles,
    formatVolume: formatVolume,
    formatFormulaText: formatFormulaText,
    formatFileStem: formatFileStem,
    formatDisplayName: formatDisplayName,
    atomDisplayLabel: atomDisplayLabel,
    measurementExpression: measurementExpression,
    measurementValueText: measurementValueText,
    measurementTypeText: measurementTypeText,
    buildStructureSummary: buildStructureSummary,
    hillFormula: hillFormula
  };

  crystal.format = formatNs;
  crystal.formatDouble = formatDouble;
  crystal.formatNumber = formatNumber;
  crystal.formatLength = formatLength;
  crystal.formatAngle = formatAngle;
  crystal.formatCoord = formatCoord;
  crystal.formatCellLengths = formatCellLengths;
  crystal.formatCellAngles = formatCellAngles;
  crystal.formatVolume = formatVolume;
  crystal.formatFormulaText = formatFormulaText;
  crystal.formatFileStem = formatFileStem;
  crystal.formatDisplayName = formatDisplayName;
  crystal.atomDisplayLabel = atomDisplayLabel;
  crystal.measurementExpression = measurementExpression;
  crystal.measurementValueText = measurementValueText;
  crystal.buildStructureSummary = buildStructureSummary;
  crystal.computeSummary = computeSummary;
})(typeof globalThis !== 'undefined' ? globalThis : this);
