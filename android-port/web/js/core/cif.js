/**
 * CrystalLens Android - CIF parser (pure JavaScript, Node-testable).
 *
 * Faithful port of reference/CrystalLens/src/core/CifParser.cpp:
 *   - tokenizer: data_ blocks, loop_ tables, quoted fields (single quotes may
 *     contain apostrophes), semicolon text fields, '#' comments, BOM;
 *   - block selection: block with coordinates wins, quality = cell + atom rows +
 *     symmetry (see docs); within a block the atom loop with most rows is used;
 *   - numbers: 1.234(5), 1.000(2)e1, 1/3, '.'/'?' as missing;
 *   - cell / space group / title / formula items (legacy and modern CIF1 names);
 *   - atom-site loop: fractional coordinates take precedence over Cartesian ones,
 *     occupancy / Uiso / disorder group + assembly, multi-model files use the
 *     first model, element inferred from _atom_site_type_symbol or the label;
 *   - symmetry operations: loop column (symop_operation_xyz / equiv_pos_as_xyz /
 *     operation_xyz), standalone item with unquoted operation lines.
 *
 * Returns CONTRACT §5.1 StructureData with symmetryExpanded=false; symmetry
 * expansion / bonds / display model belong to CL.crystal.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var parsers = CL.parsers = CL.parsers || {};

  // ---- CL.ParseError (defined here, first parser module in load order) ----
  if (!CL.ParseError) {
    var ParseError = function (message, line) {
      this.name = 'ParseError';
      this.message = message || '解析失败';
      this.line = line || 0;
      if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, ParseError);
    };
    ParseError.prototype = Object.create(Error.prototype);
    ParseError.prototype.constructor = ParseError;
    ParseError.prototype.toString = function () { return 'ParseError: ' + this.message; };
    CL.ParseError = ParseError;
  }

  function raise(message, line) { throw new CL.ParseError(message, line || 0); }

  // ---------------------------------------------------------------- utils ----
  function isSpaceChar(c) { return /\s/.test(c); }
  function isDigitChar(c) { return c >= '0' && c <= '9'; }

  function trimText(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/^\s+/, '').replace(/\s+$/, '');
  }

  // Port of CleanText: collapse whitespace runs, trim both ends.
  function cleanText(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/\s+/g, ' ').trim();
  }

  function lowerAscii(text) { return String(text).toLowerCase(); }

  // Port of NormKey: lower case, then '.' and ':' become '_'.
  function normKey(text) { return lowerAscii(text).replace(/[.:]/g, '_'); }

  function startsWith(text, prefix) { return text.length >= prefix.length && text.substring(0, prefix.length) === prefix; }

  function baseName(fileName) {
    if (!fileName) return '';
    var s = String(fileName).replace(/\\/g, '/');
    var idx = s.lastIndexOf('/');
    return idx >= 0 ? s.substring(idx + 1) : s;
  }

  // Split on '\n' only (C++ behaviour), strip a trailing '\r', drop trailing
  // empty line when the file ends with a newline. Leading UTF-8 BOM removed.
  function splitLines(text) {
    var s = String(text === null || text === undefined ? '' : text);
    var i = 0;
    if (s.length && s.charCodeAt(0) === 0xFEFF) i = 1;
    var lines = [];
    var start = i;
    for (; i < s.length; i++) {
      if (s.charAt(i) === '\n') {
        var line = s.substring(start, i);
        if (line.length && line.charAt(line.length - 1) === '\r') line = line.substring(0, line.length - 1);
        lines.push(line);
        start = i + 1;
      }
    }
    if (start < s.length) {
      var last = s.substring(start);
      if (last.length && last.charAt(last.length - 1) === '\r') last = last.substring(0, last.length - 1);
      lines.push(last);
    }
    return lines;
  }

  var NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  // Strict strtod-like parse used by XYZ / VESTA numeric token readers.
  function parseDoubleToken(token) {
    var s = trimText(token);
    if (!s || !NUMBER_RE.test(s)) return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  var D2R = Math.PI / 180;

  // Build a CONTRACT CellData from parameters, rejecting degenerate cells the
  // same way cl::Cell::SetFromParameters does. Returns {cell} or {error}.
  function makeCell(a, b, c, alpha, beta, gamma) {
    if (!(a > 0) || !(b > 0) || !(c > 0) ||
        !isFinite(a) || !isFinite(b) || !isFinite(c) ||
        !isFinite(alpha) || !isFinite(beta) || !isFinite(gamma)) {
      return { error: '晶胞参数必须是正数' };
    }
    if (alpha <= 0 || alpha >= 180 || beta <= 0 || beta >= 180 || gamma <= 0 || gamma >= 180) {
      return { error: '晶胞角必须在 0° 与 180° 之间' };
    }
    var ca = Math.cos(alpha * D2R), cb = Math.cos(beta * D2R), cg = Math.cos(gamma * D2R);
    var sg = Math.sin(gamma * D2R);
    if (Math.abs(sg) < 1e-10) return { error: '晶胞角组合退化' };
    var cx = c * cb;
    var cy = c * (ca - cb * cg) / sg;
    var cz2 = c * c - cx * cx - cy * cy;
    if (cz2 <= 1e-12) return { error: '晶胞参数不能构成有效晶胞' };
    var aVec = [a, 0, 0];
    var bVec = [b * cg, b * sg, 0];
    var cVec = [cx, cy, Math.sqrt(cz2)];
    var volume = Math.abs(
      aVec[0] * (bVec[1] * cVec[2] - bVec[2] * cVec[1]) -
      aVec[1] * (bVec[0] * cVec[2] - bVec[2] * cVec[0]) +
      aVec[2] * (bVec[0] * cVec[1] - bVec[1] * cVec[0])
    );
    if (!isFinite(volume) || volume <= 1e-9) return { error: '晶胞体积为零' };
    return {
      cell: {
        a: a, b: b, c: c, alpha: alpha, beta: beta, gamma: gamma,
        aVec: aVec, bVec: bVec, cVec: cVec, volume: volume
      }
    };
  }

  function fracToCart(cell, frac) {
    if (CL.Math && CL.Math.fracToCart) return CL.Math.fracToCart(cell, frac);
    return [
      frac[0] * cell.aVec[0] + frac[1] * cell.bVec[0] + frac[2] * cell.cVec[0],
      frac[0] * cell.aVec[1] + frac[1] * cell.bVec[1] + frac[2] * cell.cVec[1],
      frac[0] * cell.aVec[2] + frac[1] * cell.bVec[2] + frac[2] * cell.cVec[2]
    ];
  }

  function cartToFrac(cell, cart) {
    if (CL.Math && CL.Math.cartToFrac) return CL.Math.cartToFrac(cell, cart);
    var av = cell.aVec, bv = cell.bVec, cv = cell.cVec;
    var det = av[0] * (bv[1] * cv[2] - bv[2] * cv[1]) -
      av[1] * (bv[0] * cv[2] - bv[2] * cv[0]) +
      av[2] * (bv[0] * cv[1] - bv[1] * cv[0]);
    if (Math.abs(det) < 1e-15) return [0, 0, 0];
    return [
      (cart[0] * (bv[1] * cv[2] - bv[2] * cv[1]) - cart[1] * (bv[0] * cv[2] - bv[2] * cv[0]) +
        cart[2] * (bv[0] * cv[1] - bv[1] * cv[0])) / det,
      (av[0] * (cart[1] * cv[2] - cart[2] * cv[1]) - av[1] * (cart[0] * cv[2] - cart[2] * cv[0]) +
        av[2] * (cart[0] * cv[1] - cart[1] * cv[0])) / det,
      (av[0] * (bv[1] * cart[2] - bv[2] * cart[1]) - av[1] * (bv[0] * cart[2] - bv[2] * cart[0]) +
        av[2] * (bv[0] * cart[1] - bv[1] * cart[0])) / det
    ];
  }

  // ------------------------------------------------------------ tokenizer ---
  // Port of CifParser.cpp Tokenize(); throws CL.ParseError on unterminated
  // quoted / semicolon fields.
  function tokenize(text) {
    var tokens = [];
    var n = text.length;
    var i = 0;
    var line = 1;
    var atLineStart = true;
    if (n > 0 && text.charCodeAt(0) === 0xFEFF) i = 1;
    while (i < n) {
      var c = text.charAt(i);
      if (c === '\r') { i++; continue; }
      if (c === '\n') { line++; i++; atLineStart = true; continue; }
      if (isSpaceChar(c)) { i++; atLineStart = false; continue; }
      if (c === '#') { while (i < n && text.charAt(i) !== '\n') i++; continue; }
      if (c === ';' && atLineStart) {
        var startLine = line;
        i++;
        if (i < n && text.charAt(i) === '\r') i++;
        if (i < n && text.charAt(i) === '\n') { line++; i++; }
        var fieldStart = i;
        var end = -1;
        while (i < n) {
          if (text.charAt(i) === ';' && (i === fieldStart || text.charAt(i - 1) === '\n')) { end = i; break; }
          if (text.charAt(i) === '\n') line++;
          i++;
        }
        if (end < 0) raise('分号文本字段缺少结束分号', startLine);
        tokens.push({ text: cleanText(text.substring(fieldStart, end)), line: startLine, quoted: true });
        i = end + 1;
        while (i < n && text.charAt(i) !== '\n') i++;
        if (i < n) { line++; i++; }
        atLineStart = true;
        continue;
      }
      if (c === "'" || c === '"') {
        var quote = c;
        var qLine = line;
        i++;
        var qStart = i;
        var closed = false;
        while (i < n) {
          if (text.charAt(i) === quote && (i + 1 === n || isSpaceChar(text.charAt(i + 1)))) { closed = true; break; }
          if (text.charAt(i) === '\n' || text.charAt(i) === '\r') break;
          i++;
        }
        if (!closed) raise('引号字段缺少结束引号', qLine);
        tokens.push({ text: text.substring(qStart, i), line: qLine, quoted: true });
        i++;
        atLineStart = false;
        continue;
      }
      var tokLine = line;
      var tokStart = i;
      while (i < n && !isSpaceChar(text.charAt(i))) i++;
      tokens.push({ text: text.substring(tokStart, i), line: tokLine, quoted: false });
      atLineStart = false;
    }
    return tokens;
  }

  // ------------------------------------------------------- CIF number parse --
  // Port of ParseCifNumber: supports '?' / '.', '1/3' and '1.234(5)' / '1.000(2)e1'.
  // Returns a number or null (note: 0 is a valid result, compare against null).
  function parseCifNumber(input) {
    var s = cleanText(input);
    if (!s || s === '?' || s === '.') return null;

    var slash = s.indexOf('/');
    if (slash !== -1) {
      if (s.indexOf('/', slash + 1) !== -1) return null;
      var na = parseCifNumber(s.substring(0, slash));
      if (na === null) return null;
      var nb = parseCifNumber(s.substring(slash + 1));
      if (nb === null || nb === 0) return null;
      var quotient = na / nb;
      return isFinite(quotient) ? quotient : null;
    }

    var open = s.indexOf('(');
    if (open !== -1) {
      var close = s.indexOf(')', open + 1);
      if (open === 0 || !isDigitChar(s.charAt(open - 1)) || close === -1 || close === open + 1) return null;
      var between = s.substring(open + 1, close);
      if (!/^\d+$/.test(between)) return null;
      if (close + 1 !== s.length && s.charAt(close + 1) !== 'e' && s.charAt(close + 1) !== 'E') return null;
      s = s.substring(0, open) + s.substring(close + 1);
    }

    if (!NUMBER_RE.test(s)) return null;
    var value = Number(s);
    return isFinite(value) ? value : null;
  }

  // --------------------------------------------------- symmetry operations ---
  function isSymmetryOperationKey(key) {
    if (key.indexOf('equiv_pos_as_xyz') !== -1) return true;
    if (key.indexOf('symop') !== -1 && key.indexOf('xyz') !== -1) return true;
    return key.indexOf('operation_xyz') !== -1;
  }

  function looksLikeSymmetryExpression(text) {
    var commas = 0;
    var hasVariable = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === ',') { commas++; continue; }
      if (c === 'x' || c === 'X' || c === 'y' || c === 'Y' || c === 'z' || c === 'Z') { hasVariable = true; continue; }
      if (isDigitChar(c) || c === '+' || c === '-' || c === '*' || c === '/' || c === '.' ||
          c === '(' || c === ')' || isSpaceChar(c)) continue;
      return false;
    }
    return commas === 2 && hasVariable;
  }

  // Accept spaced unquoted operators only in symmetry fields; returns
  // {text, next}. Port of ReadOperation().
  function readOperation(tokens, startIndex) {
    var start = tokens[startIndex];
    var next = startIndex + 1;
    var op = start.text;
    if (start.quoted || (looksLikeSymmetryExpression(op) && op.charAt(op.length - 1) !== ',')) {
      return { text: op, next: next };
    }
    var end = next;
    while (end < tokens.length && tokens[end].line === start.line && !tokens[end].quoted) {
      var part = tokens[end].text;
      if (/[^xXyYzZ0123456789+\-*/.(),]/.test(part)) break;
      op += ' ' + part;
      end++;
      if (looksLikeSymmetryExpression(op) && op.charAt(op.length - 1) !== ',') {
        if (end < tokens.length && tokens[end].line === start.line &&
            (tokens[end].text === '+' || tokens[end].text === '-')) continue;
        if (op.charAt(op.length - 1) === '+' || op.charAt(op.length - 1) === '-') continue;
        return { text: op, next: end };
      }
    }
    return { text: start.text, next: next };
  }

  function stripLeadingOperationNumber(text) {
    var i = 0;
    while (i < text.length && isSpaceChar(text.charAt(i))) i++;
    var j = i;
    while (j < text.length && isDigitChar(text.charAt(j))) j++;
    if (j > i && j < text.length && isSpaceChar(text.charAt(j))) {
      while (j < text.length && isSpaceChar(text.charAt(j))) j++;
      if (j < text.length) {
        var c = text.charAt(j);
        if (c === 'x' || c === 'y' || c === 'z' || c === '-' || c === '+' || c === '(' || isDigitChar(c)) {
          return text.substring(j);
        }
      }
    }
    return text;
  }

  function linZero() { return { c: [0, 0, 0], k: 0 }; }
  function linAdd(a, b) { return { c: [a.c[0] + b.c[0], a.c[1] + b.c[1], a.c[2] + b.c[2]], k: a.k + b.k }; }
  function linSub(a, b) { return { c: [a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]], k: a.k - b.k }; }
  function linScale(a, s) { return { c: [a.c[0] * s, a.c[1] * s, a.c[2] * s], k: a.k * s }; }
  function linIsConstant(a) { return Math.abs(a.c[0]) + Math.abs(a.c[1]) + Math.abs(a.c[2]) < 1e-12; }
  function linMul(a, b) {
    if (linIsConstant(a)) return linScale(b, a.k);
    if (linIsConstant(b)) return linScale(a, b.k);
    return linZero();
  }

  // Recursive-descent parser for one symmetry component (port of ExpressionParser).
  function makeExpressionParser(source) {
    var s = source;
    var pos = 0;
    var failed = false;
    var errorText = '';

    function fail(message) {
      if (!failed) errorText = message;
      failed = true;
    }
    function skip() { while (pos < s.length && isSpaceChar(s.charAt(pos))) pos++; }
    function eat(c) {
      skip();
      if (pos < s.length && s.charAt(pos) === c) { pos++; return true; }
      return false;
    }
    function parseExpr() {
      var value = parseTerm();
      for (;;) {
        skip();
        if (pos >= s.length) break;
        var ch = s.charAt(pos);
        if (ch === '+') { pos++; value = linAdd(value, parseTerm()); }
        else if (ch === '-') { pos++; value = linSub(value, parseTerm()); }
        else break;
      }
      return value;
    }
    function parseTerm() {
      var value = parseFactor();
      for (;;) {
        skip();
        if (pos >= s.length) break;
        var ch = s.charAt(pos);
        if (ch === '*') {
          pos++;
          var rhs = parseFactor();
          if (!linIsConstant(value) && !linIsConstant(rhs)) {
            fail('对称操作中出现非线性乘积');
            return linZero();
          }
          value = linMul(value, rhs);
        } else if (ch === '/') {
          pos++;
          var divisor = parseFactor();
          if (!linIsConstant(divisor) || Math.abs(divisor.k) < 1e-12) {
            fail('对称操作中出现非法除法');
            return linZero();
          }
          value = linScale(value, 1 / divisor.k);
        } else {
          break;
        }
      }
      return value;
    }
    function parseFactor() {
      skip();
      if (pos >= s.length) { fail('对称操作表达式不完整'); return linZero(); }
      var ch = s.charAt(pos);
      if (ch === '+') { pos++; return parseFactor(); }
      if (ch === '-') { pos++; return linScale(parseFactor(), -1); }
      if (ch === '(') {
        pos++;
        var inner = parseExpr();
        if (!eat(')')) fail('对称操作中括号不匹配');
        return inner;
      }
      var c = ch.toLowerCase();
      if (c === 'x' || c === 'y' || c === 'z') {
        pos++;
        var out = linZero();
        out.c[c === 'x' ? 0 : (c === 'y' ? 1 : 2)] = 1;
        return out;
      }
      if (isDigitChar(ch) || ch === '.') {
        var start = pos;
        var dot = false;
        while (pos < s.length) {
          var d = s.charAt(pos);
          if (isDigitChar(d)) pos++;
          else if (d === '.' && !dot) { dot = true; pos++; }
          else break;
        }
        var number = s.substring(start, pos);
        if (!number || number === '.') { fail('对称操作中的数字无效'); return linZero(); }
        var num = Number(number);
        if (!isFinite(num)) { fail('对称操作中的数字无效'); return linZero(); }
        return { c: [0, 0, 0], k: num };
      }
      fail('对称操作中出现未知字符');
      return linZero();
    }

    return {
      parse: function () {
        skip();
        var out = parseExpr();
        skip();
        if (failed || pos !== s.length) {
          fail('对称操作表达式无法解析');
          return null;
        }
        return out;
      },
      error: function () { return errorText; }
    };
  }

  // Returns {op:{m,t,text}} or {error}.
  function parseSymmetryOperation(text) {
    var body = stripLeadingOperationNumber(String(text === null || text === undefined ? '' : text));
    body = body.replace(/\s+$/, '');
    if (!body) return { error: '空的对称操作' };

    var components = [];
    var currentPart = '';
    var depth = 0;
    for (var i = 0; i < body.length; i++) {
      var c = body.charAt(i);
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) {
        components.push(currentPart);
        currentPart = '';
      } else {
        currentPart += c;
      }
    }
    components.push(currentPart);
    if (components.length !== 3) return { error: '对称操作必须包含 x,y,z 三个分量' };

    var m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var t = [0, 0, 0];
    for (var r = 0; r < 3; r++) {
      var parser = makeExpressionParser(components[r]);
      var linear = parser.parse();
      if (!linear) return { error: parser.error() || '对称操作表达式无法解析' };
      for (var col = 0; col < 3; col++) m[r][col] = linear.c[col];
      t[r] = linear.k;
    }
    return { op: { m: m, t: t, text: body } };
  }

  // ------------------------------------------------------------ CIF data ----
  function isControlWord(lower) {
    return lower === 'loop_' || lower === 'stop_' || lower === 'global_' ||
      startsWith(lower, 'data_') || startsWith(lower, 'save_');
  }

  function readLoop(tokens, start, block) {
    var loopLine = tokens[start].line;
    var i = start + 1;
    var headers = [];
    while (i < tokens.length && !tokens[i].quoted && tokens[i].text.length > 1 &&
           tokens[i].text.charAt(0) === '_') {
      headers.push(tokens[i].text);
      i++;
    }
    if (!headers.length) raise('loop_ 之后缺少数据列名', loopLine);

    var ncols = headers.length;
    var operationColumn = [];
    for (var h = 0; h < ncols; h++) operationColumn.push(isSymmetryOperationKey(normKey(headers[h])));

    var values = [];
    var rowLines = [];
    while (i < tokens.length) {
      var value = tokens[i];
      if (!value.quoted) {
        var valueLower = value.text.toLowerCase();
        if (valueLower === 'loop_' || valueLower === 'stop_' || valueLower === 'global_' ||
            startsWith(valueLower, 'data_') || startsWith(valueLower, 'save_')) break;
        if (value.text.length > 0 && value.text.charAt(0) === '_') break;
      }
      var column = values.length % ncols;
      if (column === 0) rowLines.push(value.line);
      if (operationColumn[column]) {
        var op = readOperation(tokens, i);
        values.push(op.text);
        i = op.next;
      } else {
        values.push(value.text);
        i++;
      }
    }
    if (values.length && values.length % ncols !== 0) {
      raise('loop_ 数据项数量与列数不匹配（第 ' + loopLine + ' 行）', loopLine);
    }
    block.loops.push({ headers: headers, values: values, rowLines: rowLines, line: loopLine });
    return i;
  }

  function readItem(tokens, start, block) {
    var token = tokens[start];
    var key = normKey(token.text);
    var i = start + 1;
    if (i >= tokens.length ||
        (!tokens[i].quoted && (isControlWord(tokens[i].text.toLowerCase()) ||
          tokens[i].text.charAt(0) === '_'))) {
      raise('数据项 ' + token.text + ' 缺少值', token.line);
    }
    if (isSymmetryOperationKey(key)) {
      var loop = { headers: [token.text], values: [], rowLines: [], line: tokens[i].line };
      do {
        loop.rowLines.push(tokens[i].line);
        var op = readOperation(tokens, i);
        loop.values.push(op.text);
        i = op.next;
      } while (i < tokens.length &&
               (looksLikeSymmetryExpression(tokens[i].text) || tokens[i].text.indexOf(',') !== -1));
      block.loops.push(loop);
      return i;
    }
    block.items[key] = { value: tokens[i].text, line: tokens[i].line };
    return i + 1;
  }

  function loopRowCount(loop) {
    return loop.headers.length ? Math.floor(loop.values.length / loop.headers.length) : 0;
  }
  function loopGet(loop, row, column) {
    var index = row * loop.headers.length + column;
    return index < loop.values.length ? loop.values[index] : '';
  }

  function findItem(block, keys) {
    for (var k = 0; k < keys.length; k++) {
      var key = normKey(keys[k]);
      if (Object.prototype.hasOwnProperty.call(block.items, key)) return block.items[key];
    }
    return null;
  }

  function findColumn(loop, keys) {
    for (var k = 0; k < keys.length; k++) {
      var wanted = normKey(keys[k]);
      for (var c = 0; c < loop.headers.length; c++) {
        if (normKey(loop.headers[c]) === wanted) return c;
      }
    }
    return -1;
  }

  function getNumberItem(block, keys) {
    var item = findItem(block, keys);
    if (!item) return null;
    var value = parseCifNumber(item.value);
    if (value === null) return null;
    return { value: value, line: item.line };
  }

  function getTextItem(block, keys) {
    var item = findItem(block, keys);
    return item ? cleanText(item.value) : '';
  }

  function findAtomLoop(block) {
    var best = null;
    var bestRows = 0;
    for (var l = 0; l < block.loops.length; l++) {
      var loop = block.loops[l];
      var hasFrac = findColumn(loop, ['_atom_site_fract_x']) >= 0 &&
        findColumn(loop, ['_atom_site_fract_y']) >= 0 &&
        findColumn(loop, ['_atom_site_fract_z']) >= 0;
      var hasCart = findColumn(loop, ['_atom_site_cartn_x']) >= 0 &&
        findColumn(loop, ['_atom_site_cartn_y']) >= 0 &&
        findColumn(loop, ['_atom_site_cartn_z']) >= 0;
      if (!hasFrac && !hasCart) continue;
      var hasLabel = findColumn(loop, ['_atom_site_label', '_atom_site_label_atom_id', '_atom_site_id']) >= 0;
      if (!hasLabel && findColumn(loop, ['_atom_site_type_symbol']) < 0) continue;
      var rows = loopRowCount(loop);
      if (rows > bestRows) { bestRows = rows; best = loop; }
    }
    return best;
  }

  function findSymmetryLoop(block) {
    var l, c;
    for (l = 0; l < block.loops.length; l++) {
      var loop = block.loops[l];
      for (c = 0; c < loop.headers.length; c++) {
        var key = normKey(loop.headers[c]);
        if (key.indexOf('symop') !== -1 && key.indexOf('xyz') !== -1) return { loop: loop, column: c };
        if (key.indexOf('equiv_pos_as_xyz') !== -1) return { loop: loop, column: c };
      }
    }
    for (l = 0; l < block.loops.length; l++) {
      var loop2 = block.loops[l];
      for (c = 0; c < loop2.headers.length; c++) {
        if (normKey(loop2.headers[c]).indexOf('operation_xyz') !== -1) return { loop: loop2, column: c };
      }
    }
    return null;
  }

  function scoreBlock(block) {
    var score = { atoms: 0, hasCell: false, hasSymmetry: false, hasCoordinates: false };
    score.hasCell = !!getNumberItem(block, ['_cell_length_a']) &&
      !!getNumberItem(block, ['_cell_length_b']) &&
      !!getNumberItem(block, ['_cell_length_c']);
    var atoms = findAtomLoop(block);
    if (atoms) {
      score.atoms = loopRowCount(atoms);
      score.hasCoordinates = score.atoms > 0;
    }
    score.hasSymmetry = !!findSymmetryLoop(block);
    return score;
  }

  function blockQuality(score) {
    return (score.hasCell ? 1000 : 0) + Math.min(score.atoms, 1000) * 2 + (score.hasSymmetry ? 20 : 0);
  }

  // -------------------------------------------------------------- parse -----
  function parseCifText(text, fileName) {
    var source = String(text === null || text === undefined ? '' : text);
    if (source.length > 0 && source.charCodeAt(0) === 0xFEFF) source = source.substring(1);
    var tokens = tokenize(source);
    if (!tokens.length) raise('CIF 文件为空', 0);

    var blocks = [];
    var current = null;
    var i = 0;
    while (i < tokens.length) {
      var token = tokens[i];
      var lower = token.quoted ? '' : token.text.toLowerCase();
      if (!token.quoted && startsWith(lower, 'data_')) {
        current = { name: token.text.substring(5), items: {}, loops: [] };
        blocks.push(current);
        i++;
        continue;
      }
      if (!current) {
        current = { name: 'CIF', items: {}, loops: [] };
        blocks.push(current);
      }
      if (!token.quoted && lower === 'loop_') {
        i = readLoop(tokens, i, current);
        continue;
      }
      if (!token.quoted && token.text.length > 1 && token.text.charAt(0) === '_') {
        i = readItem(tokens, i, current);
        continue;
      }
      i++;
    }

    // Atom-site items written outside a loop form a one-row synthetic loop.
    for (var bi = 0; bi < blocks.length; bi++) {
      var block0 = blocks[bi];
      var siteHeaders = [];
      var siteValues = [];
      var siteLine = 0;
      for (var key in block0.items) {
        if (!Object.prototype.hasOwnProperty.call(block0.items, key)) continue;
        if (!startsWith(key, '_atom_site_')) continue;
        siteHeaders.push(key);
        siteValues.push(block0.items[key].value);
        if (siteLine === 0 || block0.items[key].line < siteLine) siteLine = block0.items[key].line;
      }
      if (siteHeaders.length) {
        block0.loops.push({ headers: siteHeaders, values: siteValues, rowLines: [siteLine], line: siteLine });
      }
    }

    if (!blocks.length) raise('CIF 中没有 data_ 数据块', 0);

    // ---------------------------------------------------- choose block -----
    var bestIndex = -1;
    var bestQuality = 0;
    for (var bj = 0; bj < blocks.length; bj++) {
      var score = scoreBlock(blocks[bj]);
      if (!score.hasCoordinates) continue;
      var quality = blockQuality(score);
      if (bestIndex < 0 || quality > bestQuality) {
        bestIndex = bj;
        bestQuality = quality;
      }
    }
    if (bestIndex < 0) raise('CIF 中未找到包含坐标的原子表', 0);

    var block = blocks[bestIndex];
    var out = {
      format: 'cif',
      sourceName: baseName(fileName),
      title: '',
      blockName: block.name,
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

    out.title = getTextItem(block, ['_chemical_name_common', '_chemical_name_mineral',
      '_chemical_name_systematic', '_struct_title']);
    if (!out.title) out.title = block.name ? block.name : 'CIF structure';
    out.formula = getTextItem(block, ['_chemical_formula_sum', '_chemical_formula_moiety']);
    out.spaceGroup = getTextItem(block, ['_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m',
      '_space_group_name_h-m', '_symmetry_space_group_name_h-m_alt',
      '_space_group_name_hall', '_symmetry_space_group_name_hall']);
    if (!out.spaceGroup) {
      var it = findItem(block, ['_space_group_it_number', '_symmetry_int_tables_number']);
      if (it) out.spaceGroup = '#' + cleanText(it.value);
    }

    // ------------------------------------------------------------ cell -----
    var a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
    var itemA = getNumberItem(block, ['_cell_length_a']);
    var itemB = getNumberItem(block, ['_cell_length_b']);
    var itemC = getNumberItem(block, ['_cell_length_c']);
    var anyCell = findItem(block, ['_cell_length_a', '_cell_length_b', '_cell_length_c']) ||
      findItem(block, ['_cell_angle_alpha']) || findItem(block, ['_cell_angle_beta']) ||
      findItem(block, ['_cell_angle_gamma']);
    if (itemA && itemB && itemC) {
      a = itemA.value; b = itemB.value; c = itemC.value;
      var cellErrorLine = 0;
      var readAngle = function (key, fallback) {
        var item = findItem(block, [key]);
        if (!item) return fallback;
        cellErrorLine = item.line;
        var value = parseCifNumber(item.value);
        if (value === null) raise(key + ' 晶胞角无效', item.line);
        return value;
      };
      alpha = readAngle('_cell_angle_alpha', alpha);
      beta = readAngle('_cell_angle_beta', beta);
      gamma = readAngle('_cell_angle_gamma', gamma);
      var made = makeCell(a, b, c, alpha, beta, gamma);
      if (made.error) raise('无效晶胞参数：' + made.error, cellErrorLine);
      out.cell = made.cell;
    } else if (anyCell) {
      raise('晶胞参数不完整（需要 a、b、c）', 0);
    }

    // ----------------------------------------------------- atom loop -------
    var atomLoop = findAtomLoop(block);
    if (!atomLoop) raise('CIF 中没有可读取的 _atom_site 坐标循环', 0);
    var labelCol = findColumn(atomLoop, ['_atom_site_label', '_atom_site_label_atom_id', '_atom_site_id']);
    var typeCol = findColumn(atomLoop, ['_atom_site_type_symbol']);
    var fxCol = findColumn(atomLoop, ['_atom_site_fract_x']);
    var fyCol = findColumn(atomLoop, ['_atom_site_fract_y']);
    var fzCol = findColumn(atomLoop, ['_atom_site_fract_z']);
    var cxCol = findColumn(atomLoop, ['_atom_site_cartn_x']);
    var cyCol = findColumn(atomLoop, ['_atom_site_cartn_y']);
    var czCol = findColumn(atomLoop, ['_atom_site_cartn_z']);
    var occCol = findColumn(atomLoop, ['_atom_site_occupancy']);
    var uisoCol = findColumn(atomLoop, ['_atom_site_u_iso_or_equiv']);
    var groupCol = findColumn(atomLoop, ['_atom_site_disorder_group']);
    var assemblyCol = findColumn(atomLoop, ['_atom_site_disorder_assembly']);
    var useFrac = fxCol >= 0 && fyCol >= 0 && fzCol >= 0;
    var useCart = cxCol >= 0 && cyCol >= 0 && czCol >= 0;
    if (!useFrac && !useCart) raise('原子表缺少完整的分数坐标或笛卡尔坐标列', 0);
    if (useFrac && !useCart && !out.cell) raise('原子使用分数坐标，但 CIF 缺少晶胞参数', 0);

    var modelCol = findColumn(atomLoop, ['_atom_site_pdbx_pdb_model_num']);
    var model = modelCol >= 0 ? loopGet(atomLoop, 0, modelCol) : '';
    var multipleModels = false;
    var rows = loopRowCount(atomLoop);
    var periodic = CL.periodic;

    for (var row = 0; row < rows; row++) {
      if (modelCol >= 0 && loopGet(atomLoop, row, modelCol) !== model) {
        multipleModels = true;
        continue;
      }
      var label = labelCol >= 0 ? cleanText(loopGet(atomLoop, row, labelCol)) : '';
      var typeText = typeCol >= 0 ? loopGet(atomLoop, row, typeCol) : '';
      var hasType = !!typeText && typeText !== '.' && typeText !== '?';
      var symbol = periodic.normalizeElementSymbol(hasType ? typeText : label);
      var z = periodic.bySymbol(symbol).z;
      symbol = periodic.byZ(z).symbol;
      if (!label) label = symbol + (row + 1);

      var site = {
        label: label,
        baseLabel: label,
        element: symbol,
        z: z,
        // C++ Atom.frac defaults to {0,0,0}; used as a placeholder for
        // Cartesian-only sites that have no cell (non-periodic molecule).
        frac: [0, 0, 0],
        cart: [0, 0, 0],
        occupancy: 1,
        uiso: 0,
        hasUiso: false,
        disorderGroup: groupCol >= 0 ? loopGet(atomLoop, row, groupCol) : '',
        disorderAssembly: assemblyCol >= 0 ? loopGet(atomLoop, row, assemblyCol) : '',
        siteIndex: out.sites.length
      };

      var fx = useFrac ? parseCifNumber(loopGet(atomLoop, row, fxCol)) : null;
      var fy = useFrac ? parseCifNumber(loopGet(atomLoop, row, fyCol)) : null;
      var fz = useFrac ? parseCifNumber(loopGet(atomLoop, row, fzCol)) : null;
      var cx = useCart ? parseCifNumber(loopGet(atomLoop, row, cxCol)) : null;
      var cy = useCart ? parseCifNumber(loopGet(atomLoop, row, cyCol)) : null;
      var cz = useCart ? parseCifNumber(loopGet(atomLoop, row, czCol)) : null;

      if (useFrac && out.cell && fx !== null && fy !== null && fz !== null) {
        site.frac = [fx, fy, fz];
        site.cart = fracToCart(out.cell, site.frac);
      } else if (useCart && cx !== null && cy !== null && cz !== null) {
        site.cart = [cx, cy, cz];
        if (out.cell) site.frac = cartToFrac(out.cell, site.cart);
      } else {
        var failLine = (atomLoop.rowLines && atomLoop.rowLines[row]) || atomLoop.line;
        raise('原子 ' + site.label + ' 缺少有效的完整坐标', failLine);
      }

      if (occCol >= 0) {
        var occ = parseCifNumber(loopGet(atomLoop, row, occCol));
        if (occ !== null) site.occupancy = occ;
      }
      if (uisoCol >= 0) {
        var u = parseCifNumber(loopGet(atomLoop, row, uisoCol));
        if (u !== null) { site.uiso = u; site.hasUiso = true; }
      }
      out.sites.push(site);
    }

    if (multipleModels) out.note += ' 文件包含多个模型，已载入首个模型 ' + model + '。';
    if (!out.sites.length) raise('CIF 原子表为空', 0);
    if (!out.cell) out.note += '未发现完整晶胞参数，按非周期性分子结构显示。';

    // ------------------------------------------------------- symmetry ------
    var symLoop = findSymmetryLoop(block);
    if (symLoop) {
      var seen = Object.create(null);
      var symRows = loopRowCount(symLoop.loop);
      for (var sr = 0; sr < symRows; sr++) {
        var opText = trimText(loopGet(symLoop.loop, sr, symLoop.column));
        if (!opText || opText === '.' || opText === '?') continue;
        var parsed = parseSymmetryOperation(opText);
        if (parsed.error) {
          out.note += ' 有一个对称操作无法解析，已跳过：' + parsed.error + '。';
          continue;
        }
        var canonical = parsed.op.text.toLowerCase();
        if (!seen[canonical]) {
          seen[canonical] = true;
          out.symops.push(parsed.op);
        }
      }
    } else {
      var opItem = findItem(block, ['_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz']);
      if (opItem) {
        var parsedItem = parseSymmetryOperation(opItem.value);
        if (!parsedItem.error) out.symops.push(parsedItem.op);
        else out.note += ' 对称操作无法解析，已忽略：' + parsedItem.error + '。';
      }
    }
    out.symmetryOperatorCount = out.symops.length;
    out.periodic = !!out.cell;
    if (out.cell && !out.symops.length) out.note += ' CIF 未提供对称操作，仅显示不对称单元。';

    var coordinateBlocks = 0;
    for (var bk = 0; bk < blocks.length; bk++) {
      if (scoreBlock(blocks[bk]).hasCoordinates) coordinateBlocks++;
    }
    if (coordinateBlocks > 1) out.note += ' CIF 包含多个结构数据块，已载入原子数最多的块。';

    out.asymmetricAtomCount = out.sites.length;
    return out;
  }

  function parseCif(text, fileName) {
    return parseCifText(text, fileName);
  }

  // Shared helpers for xyz.js / vesta.js (loaded after this file).
  parsers._util = {
    trimText: trimText,
    cleanText: cleanText,
    normKey: normKey,
    splitLines: splitLines,
    parseDoubleToken: parseDoubleToken,
    makeCell: makeCell,
    fracToCart: fracToCart,
    cartToFrac: cartToFrac,
    baseName: baseName,
    raise: raise
  };
  parsers.parseCif = parseCif;
  // Exposed for tests / model layer that need the raw pieces.
  parsers._cif = {
    tokenize: tokenize,
    parseCifNumber: parseCifNumber,
    parseSymmetryOperation: parseSymmetryOperation,
    normKey: normKey,
    cleanText: cleanText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
