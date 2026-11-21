/**
 * CrystalLens Android - VESTA text format parser (pure JavaScript, Node-testable).
 *
 * Faithful port of reference/CrystalLens/src/core/VestaParser.cpp:
 *   #VESTA_FORMAT_VERSION header, CRYSTAL / TITLE / CELLP / GROUP / SYMOP /
 *   STRUC records. SYMOP carries 12 numbers (t x y z then a row-major 3x3
 *   rotation); STRUC rows are "index element label occupancy fx fy fz ..."
 *   followed by optional continuation lines. Only the first CRYSTAL block is
 *   read. Returns CONTRACT §5.1 StructureData with symmetryExpanded=false.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var parsers = CL.parsers = CL.parsers || {};

  function needUtil() {
    var util = parsers._util;
    if (!util) throw new CL.ParseError('解析器初始化顺序错误：cif.js 必须先加载', 0);
    return util;
  }

  function splitTokens(line) {
    var trimmed = needUtil().trimText(line);
    return trimmed ? trimmed.split(/\s+/) : [];
  }

  function parseDouble(text) { return needUtil().parseDoubleToken(text); }

  function parseVestaInt(text) {
    var t = needUtil().trimText(text);
    if (!/^[+-]?\d+$/.test(t)) return null;
    var value = parseInt(t, 10);
    return isFinite(value) ? value : null;
  }

  function isUpperAscii(c) { return c >= 'A' && c <= 'Z'; }
  function isLowerAscii(c) { return c >= 'a' && c <= 'z'; }

  // C++ LooksLikeSection: uppercase first char and no lowercase letters at all.
  function looksLikeSection(line) {
    var trimmed = needUtil().trimText(line);
    if (!trimmed) return false;
    if (!isUpperAscii(trimmed.charAt(0))) return false;
    for (var i = 0; i < trimmed.length; i++) {
      if (isLowerAscii(trimmed.charAt(i))) return false;
    }
    return true;
  }

  function allZero(tokens) {
    if (!tokens.length) return false;
    for (var i = 0; i < tokens.length; i++) {
      var v = parseDouble(tokens[i]);
      if (v === null || Math.abs(v) > 1e-12) return false;
    }
    return true;
  }

  // std::fixed << std::setprecision(12)
  function fixed12(value) { return value.toFixed(12); }

  // Human readable operation text (only informational; matrices are authoritative).
  function symmetryText(op) {
    var axes = 'xyz';
    var parts = [];
    for (var r = 0; r < 3; r++) {
      var text = '';
      var hasTerm = false;
      for (var col = 0; col < 3; col++) {
        var k = op.m[r][col];
        if (k === 0) continue;
        if (k < 0) text += '-';
        else if (hasTerm) text += '+';
        if (Math.abs(k) !== 1) text += fixed12(Math.abs(k)) + '*';
        text += axes.charAt(col);
        hasTerm = true;
      }
      var t = op.t[r];
      if (t !== 0 || !hasTerm) {
        if (hasTerm && t > 0) text += '+';
        text += fixed12(t);
      }
      parts.push(text);
    }
    return parts.join(',');
  }

  function parseVestaText(text, fileName) {
    var util = needUtil();
    var lines = util.splitLines(text);
    if (!lines.length) throw new CL.ParseError('VESTA 文件为空', 0);

    var out = {
      format: 'vesta',
      sourceName: util.baseName(fileName),
      title: '',
      blockName: '',
      spaceGroup: '',
      formula: '',
      note: '',
      periodic: false,
      truncated: false,
      cell: null,
      symops: [],
      sites: [],
      symmetryExpanded: false,
      asymmetricAtomCount: 0,
      symmetryOperatorCount: 0
    };

    var haveCell = false;
    var crystalCount = 0;
    var groupLine = '';
    var periodic = CL.periodic;

    for (var li = 0; li < lines.length; li++) {
      var line = util.trimText(lines[li]);
      if (!line) continue;

      if (line === 'CRYSTAL') {
        crystalCount++;
        if (crystalCount > 1 && haveCell) break;
        continue;
      }
      if (line.lastIndexOf('#VESTA_FORMAT_VERSION', 0) === 0 ||
          line.lastIndexOf('VESTA_FORMAT_VERSION', 0) === 0) {
        continue;
      }

      if (line === 'TITLE') {
        for (var jt = li + 1; jt < lines.length; jt++) {
          var titleCandidate = util.trimText(lines[jt]);
          if (!titleCandidate) continue;
          out.title = titleCandidate;
          li = jt;
          break;
        }
        continue;
      }

      if (line === 'CELLP') {
        for (var jc = li + 1; jc < lines.length; jc++) {
          var cellTokens = splitTokens(lines[jc]);
          if (cellTokens.length < 6) continue;
          var ca = parseDouble(cellTokens[0]);
          var cb = parseDouble(cellTokens[1]);
          var cc = parseDouble(cellTokens[2]);
          var cal = parseDouble(cellTokens[3]);
          var cbe = parseDouble(cellTokens[4]);
          var cga = parseDouble(cellTokens[5]);
          if (ca === null || cb === null || cc === null ||
              cal === null || cbe === null || cga === null) continue;
          var made = util.makeCell(ca, cb, cc, cal, cbe, cga);
          if (made.error) throw new CL.ParseError('VESTA 晶胞参数无效：' + made.error, jc + 1);
          out.cell = made.cell;
          haveCell = true;
          li = jc;
          break;
        }
        continue;
      }

      if (line === 'GROUP') {
        for (var jg = li + 1; jg < lines.length; jg++) {
          var groupCandidate = util.trimText(lines[jg]);
          if (!groupCandidate) continue;
          groupLine = groupCandidate;
          li = jg;
          break;
        }
        continue;
      }

      if (line === 'SYMOP') {
        for (var js = li + 1; js < lines.length; js++) {
          var symCandidate = util.trimText(lines[js]);
          if (!symCandidate) continue;
          if (looksLikeSection(symCandidate)) break;
          var symTokens = splitTokens(lines[js]);
          if (symTokens.length < 12) break;
          var vals = [];
          var ok = true;
          for (var k = 0; k < 12; k++) {
            var val = parseDouble(symTokens[k]);
            if (val === null) { ok = false; break; }
            vals.push(val);
          }
          if (!ok) break;
          var op = {
            m: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
            t: [vals[0], vals[1], vals[2]],
            text: ''
          };
          for (var r = 0; r < 3; r++) {
            for (var col = 0; col < 3; col++) op.m[r][col] = vals[3 + r * 3 + col];
          }
          var zeroRotation = true;
          for (var zr = 0; zr < 3; zr++) {
            for (var zc = 0; zc < 3; zc++) {
              if (Math.abs(op.m[zr][zc]) > 1e-12) { zeroRotation = false; break; }
            }
            if (!zeroRotation) break;
          }
          if (!zeroRotation) {
            op.text = symmetryText(op);
            out.symops.push(op);
          }
          li = js;
        }
        continue;
      }

      if (line === 'STRUC') {
        for (var jr = li + 1; jr < lines.length; jr++) {
          var strucCandidate = util.trimText(lines[jr]);
          if (!strucCandidate) continue;
          if (looksLikeSection(strucCandidate)) break;
          var strucTokens = splitTokens(lines[jr]);
          if (strucTokens.length < 7) continue;
          if (allZero(strucTokens)) break;
          var index = parseVestaInt(strucTokens[0]);
          if (index === null) continue;
          var elementText = strucTokens[1];
          if (!elementText || !/[A-Za-z]/.test(elementText.charAt(0))) continue;
          var occupancy = parseDouble(strucTokens[3]);
          var sx = parseDouble(strucTokens[4]);
          var sy = parseDouble(strucTokens[5]);
          var sz = parseDouble(strucTokens[6]);
          if (occupancy === null || sx === null || sy === null || sz === null) continue;
          var symbol = periodic.normalizeElementSymbol(elementText);
          var z = periodic.bySymbol(symbol).z;
          symbol = periodic.byZ(z).symbol;
          var label = strucTokens[2] ? strucTokens[2] : symbol + index;
          var frac = [sx, sy, sz];
          out.sites.push({
            label: label,
            baseLabel: label,
            element: symbol,
            z: z,
            frac: frac,
            cart: out.cell ? util.fracToCart(out.cell, frac) : null,
            occupancy: occupancy,
            uiso: 0,
            hasUiso: false,
            disorderGroup: '',
            disorderAssembly: '',
            siteIndex: out.sites.length
          });
          li = jr;
        }
        continue;
      }
    }

    if (!haveCell || !out.cell) throw new CL.ParseError('VESTA 文件中缺少有效的 CELLP 晶胞参数', 0);
    if (!out.sites.length) throw new CL.ParseError('VESTA 文件中没有可读取的 STRUC 原子', 0);

    // A STRUC section may appear before CELLP; fill missing Cartesian positions.
    for (var si = 0; si < out.sites.length; si++) {
      if (!out.sites[si].cart) out.sites[si].cart = util.fracToCart(out.cell, out.sites[si].frac);
    }

    if (groupLine) {
      var fields = groupLine.split(/\s+/);
      var number = parseVestaInt(fields[0]);
      var setting = fields.length >= 2 ? parseVestaInt(fields[1]) : null;
      if (number !== null && setting !== null && number >= 1 && number <= 230) {
        var name = fields.slice(2).join(' ').trim();
        out.spaceGroup = name || ('#' + number);
      } else {
        out.spaceGroup = groupLine;
      }
    }

    out.periodic = true;
    out.title = out.title || 'VESTA structure';
    out.symmetryOperatorCount = out.symops.length;
    out.asymmetricAtomCount = out.sites.length;
    if (!out.symops.length) out.note += ' VESTA 文件未包含 SYMOP 对称操作，仅显示不对称单元。';
    return out;
  }

  function parseVesta(text, fileName) {
    return parseVestaText(text, fileName);
  }

  parsers.parseVesta = parseVesta;
  parsers._vesta = { parseVestaText: parseVestaText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
