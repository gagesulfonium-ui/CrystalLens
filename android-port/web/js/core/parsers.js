/**
 * CrystalLens Android - parser facade.
 *
 * Loads after cif.js / xyz.js / vesta.js and re-exports them plus the format
 * detection / dispatch functions from CONTRACT 6.3:
 *   detectFormat(text, fileName) -> 'cif' | 'xyz' | 'vesta' | null
 *   parse(text, fileName)        -> StructureData (throws CL.ParseError)
 *   parseCif / parseXyz / parseVesta
 *
 * Notes:
 *  - CL.ParseError is normally created by cif.js (first parser in load order);
 *    the guard below only matters for unusual load orders.
 *  - CL.crystal.expand() consumes the returned StructureData; the parsers never
 *    expand symmetry, build bonds or produce display data.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var parsers = CL.parsers = CL.parsers || {};

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

  function trimText(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/^\s+/, '').replace(/\s+$/, '');
  }

  function baseName(fileName) {
    if (!fileName) return '';
    var s = String(fileName).replace(/\\/g, '/');
    var idx = s.lastIndexOf('/');
    return idx >= 0 ? s.substring(idx + 1) : s;
  }

  // Port of C++ LooksLikeXyz (used only when the extension is not enough).
  function looksLikeXyz(text) {
    var pos = 0;
    while (pos < text.length && /\s/.test(text.charAt(pos))) pos++;
    var start = pos;
    while (pos < text.length && text.charAt(pos) >= '0' && text.charAt(pos) <= '9') pos++;
    if (pos === start) return false;
    while (pos < text.length && text.charAt(pos) !== '\n') pos++;
    if (pos >= text.length) return false;
    pos++;
    var secondStart = pos;
    while (pos < text.length && text.charAt(pos) !== '\n') pos++;
    var second = trimText(text.substring(secondStart, pos));
    if (!second) return true;
    return second.indexOf('data_') !== 0;
  }

  // Port of C++ DetectFormat (extension first, then content sniffing).
  function detectFormat(text, fileName) {
    if (text === null || text === undefined) return null;
    var s = String(text);
    var ext = '';
    if (fileName) {
      var match = /\.([A-Za-z0-9]+)$/.exec(String(fileName));
      if (match) ext = match[1].toLowerCase();
    }
    if (ext === 'cif' || ext === 'mcif') return 'cif';
    if (ext === 'xyz') return 'xyz';
    if (ext === 'vesta') return 'vesta';

    var pos = 0;
    if (s.length && s.charCodeAt(0) === 0xFEFF) pos = 1;
    while (pos < s.length && /\s/.test(s.charAt(pos))) pos++;
    var head = s.substring(pos, pos + 64);
    if (head.indexOf('#VESTA_FORMAT_VERSION') === 0 || head.indexOf('VESTA_FORMAT_VERSION') === 0) return 'vesta';
    if (head.indexOf('data_') === 0 || head.indexOf('_cell_') === 0 || head.indexOf('_atom_site') === 0) return 'cif';

    if (!trimText(s)) return null;
    if (looksLikeXyz(s)) return 'xyz';
    return 'cif';
  }

  function parse(text, fileName) {
    if (text === null || text === undefined || !trimText(text)) {
      throw new CL.ParseError('文件为空', 0);
    }
    var source = String(text);
    var format = detectFormat(source, fileName);
    if (!format) throw new CL.ParseError('无法识别或解析文件', 0);
    var result = null;
    if (format === 'cif' && typeof parsers.parseCif === 'function') {
      result = parsers.parseCif(source, fileName);
    } else if (format === 'xyz' && typeof parsers.parseXyz === 'function') {
      result = parsers.parseXyz(source, fileName);
    } else if (format === 'vesta' && typeof parsers.parseVesta === 'function') {
      result = parsers.parseVesta(source, fileName);
    }
    if (!result) throw new CL.ParseError('无法识别或解析文件', 0);
    if (!result.sourceName) result.sourceName = baseName(fileName);
    return result;
  }

  parsers.detectFormat = detectFormat;
  parsers.parse = parse;
  if (typeof parsers.parseCif !== 'function') parsers.parseCif = null;
  if (typeof parsers.parseXyz !== 'function') parsers.parseXyz = null;
  if (typeof parsers.parseVesta !== 'function') parsers.parseVesta = null;
  parsers._looksLikeXyz = looksLikeXyz;
})(typeof globalThis !== 'undefined' ? globalThis : this);
