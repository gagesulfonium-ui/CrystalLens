/**
 * CrystalLens Android - periodic table data and helpers.
 *
 * Data source (preferred per docs/spec/core.md §1.2): docs/spec/elements.json,
 * itself extracted from reference/CrystalLens/src/core/PeriodicTable.cpp.
 * 119 entries: z = 1..118 in order plus the kUnknown "X" entry (z = 0).
 *
 * `nameZh` is null for every entry: the C++ core / elements.json carry no
 * Chinese element names (UI supplements them through i18n when needed).
 *
 * Classic script: attaches CL.periodic. No ES modules, no external deps.
 * Color conversion notes:
 *   colorU32 = 0xRRGGBB (same integer as C++)
 *   colorHex = "#rrggbb"
 *   rgb      = [r, g, b] in 0..1 sRGB (renderer-friendly)
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  // z, symbol, English name, covalent radius (A), van der Waals radius (A), color u32.
  // The last row is cl::kUnknown (z = 0): also used for unknown elements / empty sites.
  var RAW = [
    [1, 'H', 'Hydrogen', 0.31, 1.20, 0xF2F4F8],
    [2, 'He', 'Helium', 0.28, 1.40, 0xD9E7F2],
    [3, 'Li', 'Lithium', 1.28, 1.82, 0xC7A6FF],
    [4, 'Be', 'Beryllium', 0.96, 1.53, 0x9FE3B0],
    [5, 'B', 'Boron', 0.84, 1.92, 0xF0A98B],
    [6, 'C', 'Carbon', 0.76, 1.70, 0x7F8A9A],
    [7, 'N', 'Nitrogen', 0.71, 1.55, 0x5B8CFF],
    [8, 'O', 'Oxygen', 0.66, 1.52, 0xFF5C6C],
    [9, 'F', 'Fluorine', 0.57, 1.47, 0x66E0A3],
    [10, 'Ne', 'Neon', 0.58, 1.54, 0x9CD7E8],
    [11, 'Na', 'Sodium', 1.66, 2.27, 0xD8C34A],
    [12, 'Mg', 'Magnesium', 1.41, 1.73, 0x8FE58C],
    [13, 'Al', 'Aluminium', 1.21, 1.84, 0x4FA3FF],
    [14, 'Si', 'Silicon', 1.11, 2.10, 0x5A7CFF],
    [15, 'P', 'Phosphorus', 1.07, 1.80, 0xFF9F43],
    [16, 'S', 'Sulfur', 1.05, 1.80, 0xFFD54A],
    [17, 'Cl', 'Chlorine', 1.02, 1.75, 0x4ADF7A],
    [18, 'Ar', 'Argon', 1.06, 1.88, 0x88D6E8],
    [19, 'K', 'Potassium', 2.03, 2.75, 0xB26BFF],
    [20, 'Ca', 'Calcium', 1.76, 2.31, 0x7FE08A],
    [21, 'Sc', 'Scandium', 1.70, 2.15, 0xC9D18A],
    [22, 'Ti', 'Titanium', 1.60, 2.11, 0x93A8C7],
    [23, 'V', 'Vanadium', 1.53, 2.07, 0xE4B563],
    [24, 'Cr', 'Chromium', 1.39, 2.06, 0xE040B0],
    [25, 'Mn', 'Manganese', 1.39, 2.05, 0xC58BC9],
    [26, 'Fe', 'Iron', 1.32, 2.04, 0xE3753F],
    [27, 'Co', 'Cobalt', 1.26, 2.00, 0x2F5BD8],
    [28, 'Ni', 'Nickel', 1.24, 1.97, 0x9AA7B8],
    [29, 'Cu', 'Copper', 1.32, 1.96, 0xD98246],
    [30, 'Zn', 'Zinc', 1.22, 2.01, 0xA99BD8],
    [31, 'Ga', 'Gallium', 1.22, 1.87, 0xC9A16B],
    [32, 'Ge', 'Germanium', 1.20, 2.11, 0x9DBF9D],
    [33, 'As', 'Arsenic', 1.19, 1.85, 0xC99BCB],
    [34, 'Se', 'Selenium', 1.20, 1.90, 0xF2A65A],
    [35, 'Br', 'Bromine', 1.20, 1.85, 0xA65A38],
    [36, 'Kr', 'Krypton', 1.16, 2.02, 0x92D8E8],
    [37, 'Rb', 'Rubidium', 2.20, 3.03, 0xC36BFF],
    [38, 'Sr', 'Strontium', 1.95, 2.49, 0x7FE08A],
    [39, 'Y', 'Yttrium', 1.90, 2.32, 0x9BBFD1],
    [40, 'Zr', 'Zirconium', 1.75, 2.23, 0x99B873],
    [41, 'Nb', 'Niobium', 1.64, 2.14, 0x92A8C4],
    [42, 'Mo', 'Molybdenum', 1.54, 2.17, 0x7FA9DD],
    [43, 'Tc', 'Technetium', 1.47, 2.16, 0xC9A46B],
    [44, 'Ru', 'Ruthenium', 1.46, 2.13, 0x8FC0B8],
    [45, 'Rh', 'Rhodium', 1.42, 2.10, 0xA4B6D8],
    [46, 'Pd', 'Palladium', 1.39, 2.05, 0xA8B8C8],
    [47, 'Ag', 'Silver', 1.45, 2.03, 0xCFD6E2],
    [48, 'Cd', 'Cadmium', 1.44, 2.18, 0xD5C58A],
    [49, 'In', 'Indium', 1.42, 1.93, 0xC6A5D8],
    [50, 'Sn', 'Tin', 1.39, 2.17, 0xA6B8C5],
    [51, 'Sb', 'Antimony', 1.39, 2.06, 0xC89BD8],
    [52, 'Te', 'Tellurium', 1.38, 2.06, 0xD8A45A],
    [53, 'I', 'Iodine', 1.39, 1.98, 0xA97BFF],
    [54, 'Xe', 'Xenon', 1.40, 2.16, 0x8FD8E8],
    [55, 'Cs', 'Caesium', 2.44, 3.43, 0xB36BFF],
    [56, 'Ba', 'Barium', 2.15, 2.68, 0x8CE38A],
    [57, 'La', 'Lanthanum', 2.07, 2.40, 0x9BC98F],
    [58, 'Ce', 'Cerium', 2.04, 2.35, 0xB8D18A],
    [59, 'Pr', 'Praseodymium', 2.03, 2.39, 0xA6D19A],
    [60, 'Nd', 'Neodymium', 2.01, 2.29, 0x9CCB9D],
    [61, 'Pm', 'Promethium', 1.99, 2.36, 0x9EC9A8],
    [62, 'Sm', 'Samarium', 1.98, 2.29, 0x9CC7AA],
    [63, 'Eu', 'Europium', 1.98, 2.33, 0xA0C8B8],
    [64, 'Gd', 'Gadolinium', 1.96, 2.37, 0x9DC4B5],
    [65, 'Tb', 'Terbium', 1.94, 2.21, 0x99C0B8],
    [66, 'Dy', 'Dysprosium', 1.92, 2.29, 0x95BCC0],
    [67, 'Ho', 'Holmium', 1.92, 2.16, 0x91B8C8],
    [68, 'Er', 'Erbium', 1.89, 2.35, 0x8DB4CE],
    [69, 'Tm', 'Thulium', 1.90, 2.27, 0x89B0D2],
    [70, 'Yb', 'Ytterbium', 1.87, 2.42, 0x85ACD6],
    [71, 'Lu', 'Lutetium', 1.87, 2.21, 0x81A8D8],
    [72, 'Hf', 'Hafnium', 1.75, 2.12, 0x8FB1C2],
    [73, 'Ta', 'Tantalum', 1.70, 2.17, 0x8BA8C9],
    [74, 'W', 'Tungsten', 1.62, 2.10, 0x87A0D0],
    [75, 'Re', 'Rhenium', 1.51, 2.17, 0x8398D6],
    [76, 'Os', 'Osmium', 1.44, 2.16, 0x7F90D8],
    [77, 'Ir', 'Iridium', 1.41, 2.02, 0x7B88D9],
    [78, 'Pt', 'Platinum', 1.36, 2.09, 0x7780DA],
    [79, 'Au', 'Gold', 1.36, 2.14, 0xFFD34E],
    [80, 'Hg', 'Mercury', 1.32, 2.23, 0xCFC7D8],
    [81, 'Tl', 'Thallium', 1.45, 1.96, 0xA6B29C],
    [82, 'Pb', 'Lead', 1.46, 2.02, 0x8C96AE],
    [83, 'Bi', 'Bismuth', 1.48, 2.07, 0xD77AA8],
    [84, 'Po', 'Polonium', 1.40, 1.97, 0xC96B8F],
    [85, 'At', 'Astatine', 1.50, 2.02, 0xB85A7E],
    [86, 'Rn', 'Radon', 1.50, 2.20, 0x8ED0E8],
    [87, 'Fr', 'Francium', 2.60, 3.48, 0xC36BFF],
    [88, 'Ra', 'Radium', 2.21, 2.83, 0x8CE38A],
    [89, 'Ac', 'Actinium', 2.15, 2.60, 0x9CCBA4],
    [90, 'Th', 'Thorium', 2.06, 2.37, 0xB0C88A],
    [91, 'Pa', 'Protactinium', 2.00, 2.43, 0xA6C29A],
    [92, 'U', 'Uranium', 1.96, 2.40, 0xFFB84D],
    [93, 'Np', 'Neptunium', 1.90, 2.39, 0x9AB8C6],
    [94, 'Pu', 'Plutonium', 1.87, 2.43, 0x9AA8D0],
    [95, 'Am', 'Americium', 1.80, 2.44, 0x9AA0C0],
    [96, 'Cm', 'Curium', 1.69, 2.45, 0x9A98B0],
    [97, 'Bk', 'Berkelium', 1.68, 2.44, 0xB0A0B8],
    [98, 'Cf', 'Californium', 1.68, 2.45, 0xB0A8C0],
    [99, 'Es', 'Einsteinium', 1.65, 2.45, 0xB0B0C8],
    [100, 'Fm', 'Fermium', 1.67, 2.45, 0xB0B8D0],
    [101, 'Md', 'Mendelevium', 1.73, 2.46, 0xB8C0D8],
    [102, 'No', 'Nobelium', 1.76, 2.46, 0xB8C8D8],
    [103, 'Lr', 'Lawrencium', 1.61, 2.46, 0xC0D0E0],
    [104, 'Rf', 'Rutherfordium', 1.57, 2.40, 0xC8D0E0],
    [105, 'Db', 'Dubnium', 1.49, 2.38, 0xC8C8D8],
    [106, 'Sg', 'Seaborgium', 1.43, 2.32, 0xC0C0D0],
    [107, 'Bh', 'Bohrium', 1.41, 2.30, 0xB8B8C8],
    [108, 'Hs', 'Hassium', 1.34, 2.26, 0xB0B0C0],
    [109, 'Mt', 'Meitnerium', 1.29, 2.20, 0xA8A8B8],
    [110, 'Ds', 'Darmstadtium', 1.28, 2.20, 0xA0A0B0],
    [111, 'Rg', 'Roentgenium', 1.21, 2.20, 0x9898A8],
    [112, 'Cn', 'Copernicium', 1.22, 2.20, 0x9090A0],
    [113, 'Nh', 'Nihonium', 1.36, 2.40, 0x888898],
    [114, 'Fl', 'Flerovium', 1.43, 2.60, 0x808090],
    [115, 'Mc', 'Moscovium', 1.62, 2.60, 0x787888],
    [116, 'Lv', 'Livermorium', 1.75, 2.60, 0x707080],
    [117, 'Ts', 'Tennessine', 1.65, 2.40, 0x686878],
    [118, 'Og', 'Oganesson', 1.57, 2.30, 0x606070],
    [0, 'X', 'Unknown', 0.77, 1.70, 0x9AA4B2]
  ];

  // Classification lists, identical to PeriodicTable.cpp IsNonMetal/IsMetalloid.
  var NON_METAL = { 1: 1, 2: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 15: 1, 16: 1, 17: 1, 18: 1,
    34: 1, 35: 1, 36: 1, 53: 1, 54: 1, 85: 1, 86: 1, 117: 1, 118: 1 };
  var METALLOID = { 5: 1, 14: 1, 32: 1, 33: 1, 51: 1, 52: 1, 84: 1 };
  var ALKALI = { 3: 1, 4: 1, 11: 1, 12: 1, 19: 1, 20: 1, 37: 1, 38: 1, 55: 1, 56: 1, 87: 1, 88: 1 };

  var HEX = '0123456789abcdef';
  function toHex(u32) {
    var s = '';
    for (var shift = 20; shift >= 0; shift -= 4) s += HEX.charAt((u32 >>> shift) & 0xF);
    return '#' + s;
  }

  function entryFromRow(row) {
    var z = row[0];
    var category = z === 0 ? 'unknown'
      : (NON_METAL[z] ? 'nonmetal' : (METALLOID[z] ? 'metalloid' : 'metal'));
    return {
      symbol: row[1],
      z: z,
      name: row[2],
      nameZh: null, // C++ core / elements.json have no zh names; UI adds them via i18n
      category: category,
      metal: category === 'metal',
      metalloid: category === 'metalloid',
      covalent: row[3],
      vdw: row[4],
      colorU32: row[5],
      colorHex: toHex(row[5]),
      rgb: [((row[5] >> 16) & 0xFF) / 255, ((row[5] >> 8) & 0xFF) / 255, (row[5] & 0xFF) / 255]
    };
  }

  var ELEMENTS = [];   // z = 1..118 (what all() returns)
  var BY_Z = [];
  var BY_SYMBOL = {};
  var BY_LOWER_SYMBOL = {};
  var UNKNOWN = null;
  for (var ri = 0; ri < RAW.length; ri++) {
    var entry = entryFromRow(RAW[ri]);
    if (entry.z === 0) {
      UNKNOWN = entry;
      BY_Z[0] = entry;
    } else {
      ELEMENTS.push(entry);
      BY_Z[entry.z] = entry;
    }
    BY_SYMBOL[entry.symbol] = entry;
    BY_LOWER_SYMBOL[entry.symbol.toLowerCase()] = entry;
  }

  function isNonMetal(z) { return !!NON_METAL[z]; }
  function isMetalloid(z) { return !!METALLOID[z]; }
  function isAlkaliOrAlkaline(z) { return !!ALKALI[z]; }

  function byZ(z) {
    var n = typeof z === 'number' ? z : parseInt(z, 10);
    if (n >= 1 && n <= 118 && (n | 0) === n) return BY_Z[n];
    if (n === 0) return UNKNOWN;
    return UNKNOWN;
  }

  function bySymbol(symbol) {
    if (symbol === null || symbol === undefined) return UNKNOWN;
    var s = String(symbol);
    if (Object.prototype.hasOwnProperty.call(BY_SYMBOL, s)) return BY_SYMBOL[s];
    var lower = s.toLowerCase();
    return Object.prototype.hasOwnProperty.call(BY_LOWER_SYMBOL, lower) ? BY_LOWER_SYMBOL[lower] : UNKNOWN;
  }

  // Port of cl::NormalizeElementSymbol. Returns a canonical symbol or "X".
  function normalizeElementSymbol(raw) {
    var s = raw === null || raw === undefined ? '' : String(raw);
    var begin = 0;
    while (begin < s.length && (/\s/.test(s.charAt(begin)) || s.charAt(begin) === '_')) begin++;
    var end = s.length;
    while (end > begin && /\s/.test(s.charAt(end - 1))) end--;
    s = s.substring(begin, end);
    if (!s) return 'X';

    var letters = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
        if (letters.length < 2) letters += c;
      } else if (letters.length) {
        if ((c >= '0' && c <= '9') || c === '+' || c === '-' || c === '(') break;
        if (c === '_' || c === '/') break;
      }
    }
    if (!letters) return 'X';

    var upper = letters.toUpperCase();
    if (upper === 'D' || upper === 'T') return 'H';

    // Prefer the chemically correct two-letter spelling (CA -> Ca).
    if (letters.length >= 2) {
      var two = letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
      if (bySymbol(two).z !== 0) return two;
    }
    var one = letters.charAt(0).toUpperCase();
    if (bySymbol(one).z !== 0) return one;
    return letters;
  }

  function elementFromLabel(label) {
    return bySymbol(normalizeElementSymbol(label));
  }

  // Port of cl::PairBondCutoff: cutoff = covalent(a)+covalent(b)+allowance.
  // 0 means "never bond" (alkali/alkaline metal-metal contacts).
  function pairBondCutoff(za, zb) {
    var a = byZ(za);
    var b = byZ(zb);
    var aNonMetal = isNonMetal(za);
    var bNonMetal = isNonMetal(zb);
    var aMetal = !aNonMetal && !isMetalloid(za);
    var bMetal = !bNonMetal && !isMetalloid(zb);
    if (aMetal && bMetal) {
      if (isAlkaliOrAlkaline(za) || isAlkaliOrAlkaline(zb)) return 0;
      return a.covalent + b.covalent + 0.12;
    }
    if ((aMetal && bNonMetal) || (bMetal && aNonMetal)) {
      return a.covalent + b.covalent + 0.35;
    }
    return a.covalent + b.covalent + 0.12;
  }

  // Accepts a number ("14"), a symbol ("Si", "si") or a label-ish string.
  function elementFromInput(text) {
    if (text === null || text === undefined) return null;
    var s = String(text).trim();
    if (!s) return null;
    if (/^\+?\d+$/.test(s)) {
      var n = parseInt(s, 10);
      if (n >= 1 && n <= 118) return { z: n, symbol: BY_Z[n].symbol };
      return null;
    }
    var e = bySymbol(normalizeElementSymbol(s));
    return e.z > 0 ? { z: e.z, symbol: e.symbol } : null;
  }

  function get(symbolOrZ) {
    if (typeof symbolOrZ === 'number') {
      var n = symbolOrZ;
      if ((n | 0) !== n) return null;
      if (n >= 1 && n <= 118) return BY_Z[n];
      if (n === 0) return UNKNOWN;
      return null;
    }
    if (typeof symbolOrZ !== 'string') return null;
    var s = symbolOrZ.trim();
    if (!s) return null;
    if (/^\+?\d+$/.test(s)) return get(parseInt(s, 10));
    if (s.toLowerCase() === 'x') return UNKNOWN; // kUnknown placeholder entry
    var e = bySymbol(s);
    return e.z > 0 ? e : null;
  }

  function classify(element) {
    var z = 0;
    if (typeof element === 'number') z = element;
    else if (typeof element === 'string') {
      var e = get(element);
      z = e ? e.z : 0;
    } else if (element && typeof element === 'object') {
      z = typeof element.z === 'number' ? element.z : 0;
    }
    if (!(z >= 1 && z <= 118)) return 'unknown';
    if (isNonMetal(z)) return 'nonmetal';
    if (isMetalloid(z)) return 'metalloid';
    return 'metal';
  }

  function all() { return ELEMENTS.slice(); }

  CL.periodic = {
    get: get,
    all: all,
    classify: classify,
    elementFromInput: elementFromInput,
    // Extra helpers shared with the parsers / model layer (superset of CONTRACT 6.2):
    normalizeElementSymbol: normalizeElementSymbol,
    elementFromLabel: elementFromLabel,
    bySymbol: bySymbol,
    byZ: byZ,
    isNonMetal: isNonMetal,
    isMetalloid: isMetalloid,
    isAlkaliOrAlkaline: isAlkaliOrAlkaline,
    pairBondCutoff: pairBondCutoff,
    unknown: UNKNOWN,
    count: ELEMENTS.length
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
