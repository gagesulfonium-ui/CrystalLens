/**
 * CrystalLens Android - XYZ molecule parser (pure JavaScript, Node-testable).
 *
 * Faithful port of reference/CrystalLens/src/core/XyzParser.cpp:
 *   line 1 = declared atom count, line 2 = comment (optional), then
 *   "element x y z" rows; '#' starts a trailing comment; element may be a symbol
 *   ("Si", "si") or an atomic number ("14"); unknown tokens become element "X".
 * XYZ has no unit cell: periodic=false, cell=null, sites carry Cartesian only.
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

  function isBlankLine(line) { return /^\s*$/.test(line); }

  function parseStrictInt(text) {
    var t = needUtil().trimText(text);
    if (!/^[+-]?\d+$/.test(t)) return null;
    var value = parseInt(t, 10);
    if (!isFinite(value) || value < 0 || value > 1000000) return null;
    return value;
  }

  function parseXyzText(text, fileName) {
    var util = needUtil();
    var lines = util.splitLines(text);
    var cursor = 0;
    while (cursor < lines.length && isBlankLine(lines[cursor])) cursor++;
    if (cursor >= lines.length) throw new CL.ParseError('XYZ 文件为空', 0);

    var declared = parseStrictInt(lines[cursor]);
    if (declared === null) throw new CL.ParseError('XYZ 第一行必须是原子数', cursor + 1);
    cursor++;

    var comment = '';
    if (cursor < lines.length) {
      comment = util.trimText(lines[cursor]);
      cursor++;
    }

    var out = {
      format: 'xyz',
      sourceName: util.baseName(fileName),
      title: comment || 'XYZ molecule',
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

    var periodic = CL.periodic;
    var parsedCount = 0;
    for (; cursor < lines.length && parsedCount < declared; cursor++) {
      var line = lines[cursor];
      var hash = line.indexOf('#');
      if (hash !== -1) line = line.substring(0, hash);
      if (isBlankLine(line)) continue;
      var tokens = util.trimText(line).split(/\s+/);
      if (tokens.length < 4) {
        throw new CL.ParseError('XYZ 原子行需要元素符号和三个坐标', cursor + 1);
      }
      var x = util.parseDoubleToken(tokens[1]);
      var y = util.parseDoubleToken(tokens[2]);
      var z = util.parseDoubleToken(tokens[3]);
      if (x === null || y === null || z === null) {
        throw new CL.ParseError('XYZ 坐标不是有效数字', cursor + 1);
      }
      var rawElement = tokens[0];
      var resolved = periodic.elementFromInput(rawElement);
      out.sites.push({
        label: rawElement,
        baseLabel: rawElement,
        element: resolved ? resolved.symbol : 'X',
        z: resolved ? resolved.z : 0,
        // C++ Atom.frac defaults to {0,0,0}; molecules use it as a placeholder.
        frac: [0, 0, 0],
        cart: [x, y, z],
        occupancy: 1,
        uiso: 0,
        hasUiso: false,
        disorderGroup: '',
        disorderAssembly: '',
        siteIndex: out.sites.length
      });
      parsedCount++;
    }

    if (!out.sites.length) throw new CL.ParseError('XYZ 文件中没有可读取的原子', 0);
    if (parsedCount !== declared) {
      out.note += 'XYZ 声明了 ' + declared + ' 个原子，实际读取 ' + parsedCount + ' 个。';
    }
    if (out.sites.length > 30000) {
      out.sites.length = 30000;
      out.truncated = true;
      out.note += ' 原子数超过限制，显示已截断。';
    }
    out.asymmetricAtomCount = out.sites.length;
    out.symmetryOperatorCount = 0;
    return out;
  }

  function parseXyz(text, fileName) {
    return parseXyzText(text, fileName);
  }

  parsers.parseXyz = parseXyz;
  parsers._xyz = { parseXyzText: parseXyzText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
