/**
 * CrystalLens Android - native bridge (CL.Native).
 *
 * Uses the Java bridge exposed as `window.CLNative` when running inside the
 * Android WebView shell, and falls back to browser downloads / Web Share on
 * desktop or the install-free HTML preview.
 *
 * Contract (docs/CONTRACT.md 6.7):
 *   CL.Native.isAndroid
 *   CL.Native.info() -> {platform, sdkInt, appVersion, ...}
 *   CL.Native.beginExport(name, mime, mode) -> boolean
 *   CL.Native.appendExportChunk(base64)
 *   CL.Native.endExport() -> Promise<{ok, uri?}>
 *   CL.Native.toast(msg) / setKeepScreenOn(on) / vibrate(ms) / exitApp()
 *   CL.Native.onSharedFile(cb)
 * Helpers used by the UI:
 *   CL.Native.saveText(name, mime, text, mode) / saveDataUrl(name, dataUrl, mode)
 *   CL.Native.encodeText(text) / decodeBase64Utf8(base64)
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var doc = root.document || null;

  var bridge = root.CLNative || null;
  var isAndroid = !!(bridge && (bridge.isAndroid !== false)) ||
    /Android/i.test((root.navigator && root.navigator.userAgent) || '');

  var exportState = null;      // {name, mime, mode, chunks}
  var sharedFileHandler = null;
  var pendingSharedFiles = [];
  var lastInfo = null;

  // ------------------------------------------------------------ base64 ---
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_LOOKUP = null;

  function buildLookup() {
    B64_LOOKUP = {};
    for (var i = 0; i < B64.length; i++) B64_LOOKUP[B64.charAt(i)] = i;
    B64_LOOKUP['-'] = 62;
    B64_LOOKUP['_'] = 63;
  }

  function bytesToBase64(bytes) {
    var out = [];
    var i, n;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63), B64.charAt((n >> 6) & 63), B64.charAt(n & 63));
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      n = bytes[i] << 16;
      out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63), '==');
    } else if (rest === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63), B64.charAt((n >> 6) & 63), '=');
    }
    return out.join('');
  }

  function base64ToBytes(str) {
    var clean = String(str || '').replace(/^data:[^,]*,/, '').replace(/[\s\r\n]/g, '');
    if (!B64_LOOKUP) buildLookup();
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var ch = clean.charAt(i);
      if (ch === '=') break;
      var value = B64_LOOKUP[ch];
      if (value === undefined) continue;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(bytes);
  }

  function utf8Bytes(text) {
    if (root.TextEncoder) return new root.TextEncoder().encode(String(text));
    var encoded = unescape(encodeURIComponent(String(text)));
    var bytes = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
    return bytes;
  }

  function utf8Decode(bytes) {
    if (root.TextDecoder) {
      try { return new root.TextDecoder('utf-8').decode(bytes); } catch (e) { /* fall through */ }
    }
    var chunks = [];
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    try { return decodeURIComponent(escape(chunks.join(''))); } catch (e2) { return chunks.join(''); }
  }

  // ---------------------------------------------------------- time / io ---
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function timestamp(date) {
    var d = date || new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  function downloadBlob(name, mime, bytes) {
    if (!doc) return false;
    try {
      var blob = new root.Blob([bytes], { type: mime || 'application/octet-stream' });
      var url = root.URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      (doc.body || doc.documentElement).appendChild(a);
      a.click();
      root.setTimeout(function () {
        if (a.parentNode) a.parentNode.removeChild(a);
        try { root.URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }, 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function shareBlob(name, mime, bytes) {
    var nav = root.navigator;
    if (!nav || typeof nav.share !== 'function' || typeof root.File !== 'function') return null;
    try {
      var file = new root.File([bytes], name, { type: mime || 'application/octet-stream' });
      if (nav.canShare && !nav.canShare({ files: [file] })) return null;
      return Promise.resolve(nav.share({ files: [file], title: name })).then(function () {
        return { ok: true, uri: name, method: 'webshare' };
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return { ok: false, aborted: true, error: 'aborted' };
        throw err;
      });
    } catch (e) {
      return null;
    }
  }

  // --------------------------------------------------- export pipeline ---
  function beginExport(name, mime, mode) {
    exportState = {
      name: name || ('CrystalLens-' + timestamp() + '.bin'),
      mime: mime || 'application/octet-stream',
      mode: mode === 'share' ? 'share' : 'save',
      chunks: []
    };
    if (bridge && typeof bridge.beginExport === 'function') {
      try {
        return bridge.beginExport(exportState.name, exportState.mime, exportState.mode) !== false;
      } catch (e) {
        if (root.console) root.console.warn('[CL.Native] beginExport bridge failed', e);
        return false;
      }
    }
    return true;
  }

  function appendExportChunk(base64Chunk) {
    if (!exportState) return;
    var chunk = String(base64Chunk || '');
    if (!chunk) return;
    exportState.chunks.push(chunk);
    if (bridge && typeof bridge.appendExportChunk === 'function') {
      try { bridge.appendExportChunk(chunk); } catch (e) { /* collected locally as well */ }
    }
  }

  function endExport() {
    var state = exportState;
    exportState = null;
    if (!state) return Promise.resolve({ ok: false, error: 'no-export' });
    if (bridge && typeof bridge.endExport === 'function') {
      try {
        var result = bridge.endExport();
        if (result && typeof result.then === 'function') {
          return result.then(function (value) {
            return normalizeExportResult(value);
          }, function (err) {
            return { ok: false, error: String(err) };
          });
        }
        return Promise.resolve(normalizeExportResult(result));
      } catch (e) {
        return Promise.resolve({ ok: false, error: String(e) });
      }
    }
    var bytes = base64ToBytes(state.chunks.join(''));
    if (state.mode === 'share') {
      var shared = shareBlob(state.name, state.mime, bytes);
      if (shared) return shared.then(function (r) { return r; }).catch(function (e) { return { ok: false, error: String(e) }; });
    }
    var ok = downloadBlob(state.name, state.mime, bytes);
    return Promise.resolve(ok ? { ok: true, uri: state.name, method: 'download' } : { ok: false, error: 'download-unavailable' });
  }

  function normalizeExportResult(value) {
    if (value === true || value === undefined || value === null) return { ok: true };
    if (value === false) return { ok: false, error: 'export-failed' };
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return { ok: true };
      if (trimmed.charAt(0) === '{') {
        try {
          var parsed = JSON.parse(trimmed);
          return { ok: parsed.ok !== false, uri: parsed.uri || parsed.path || null, error: parsed.error || null };
        } catch (e) { /* plain uri string */ }
      }
      if (trimmed === 'true' || trimmed === 'false') return { ok: trimmed === 'true' };
      return { ok: true, uri: trimmed };
    }
    if (typeof value === 'object') {
      return { ok: value.ok !== false, uri: value.uri || value.path || null, error: value.error || null };
    }
    return { ok: true };
  }

  // --------------------------------------------------------- public API ---
  function info() {
    if (lastInfo) return lastInfo;
    var result = {
      platform: isAndroid ? 'android' : 'web',
      sdkInt: 0,
      appVersion: '',
      bridge: !!bridge
    };
    try {
      if (bridge && typeof bridge.getInfo === 'function') {
        var raw = bridge.getInfo();
        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) result[k] = parsed[k];
        }
      }
    } catch (e) { /* keep defaults */ }
    if (root.CL && root.CL.data && root.CL.data.app) {
      if (!result.appVersion) result.appVersion = root.CL.data.app.version || '';
    }
    lastInfo = result;
    return result;
  }

  function toast(message) {
    if (bridge && typeof bridge.toast === 'function') {
      try { bridge.toast(String(message == null ? '' : message)); return; } catch (e) { /* fall through */ }
    }
    if (CL.ui && typeof CL.ui.toast === 'function') {
      CL.ui.toast('', message, 'info');
    } else if (root.console) {
      root.console.log('[CL.Native.toast]', message);
    }
  }

  function setKeepScreenOn(on) {
    if (bridge && typeof bridge.setKeepScreenOn === 'function') {
      try { bridge.setKeepScreenOn(!!on); } catch (e) { /* ignore */ }
    }
  }

  function vibrate(ms) {
    try {
      if (bridge && typeof bridge.vibrate === 'function') { bridge.vibrate(ms || 12); return; }
      if (root.navigator && typeof root.navigator.vibrate === 'function') root.navigator.vibrate(ms || 12);
    } catch (e) { /* ignore */ }
  }

  function exitApp() {
    if (bridge && typeof bridge.exitApp === 'function') {
      try { bridge.exitApp(); return true; } catch (e) { return false; }
    }
    return false;
  }

  function onSharedFile(cb) {
    if (typeof cb !== 'function') return;
    sharedFileHandler = cb;
    while (pendingSharedFiles.length) {
      var item = pendingSharedFiles.shift();
      dispatchSharedFile(item.name, item.base64);
    }
  }

  function dispatchSharedFile(name, base64) {
    var payload = { name: name || 'shared.dat', base64: base64 || '' };
    if (sharedFileHandler) {
      try { sharedFileHandler(payload); } catch (e) {
        if (root.console) root.console.error('[CL.Native] shared file handler failed', e);
      }
    } else {
      pendingSharedFiles.push(payload);
    }
  }

  // Called by Java (via window.__clOpenSharedFile) or by the UI when a file
  // arrives before CL.Native.onSharedFile() has been wired up.
  function handleSharedFile(name, base64) {
    dispatchSharedFile(name, base64);
    return true;
  }

  function pollInitialSharedFile() {
    if (!bridge) return;
    var names = ['consumeSharedFile', 'getSharedFile', 'takeSharedFile'];
    for (var i = 0; i < names.length; i++) {
      if (typeof bridge[names[i]] !== 'function') continue;
      try {
        var raw = bridge[names[i]]();
        if (!raw) continue;
        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && parsed.base64) {
          if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        }
        if (parsed && parsed.name && parsed.base64) handleSharedFile(parsed.name, parsed.base64);
        else if (parsed && parsed.base64) handleSharedFile(parsed.fileName || 'shared.cif', parsed.base64);
      } catch (e) {
        if (root.console) root.console.warn('[CL.Native] polling shared file failed', e);
      }
      return;
    }
  }

  function saveBytes(name, mime, bytes, mode) {
    if (!beginExport(name, mime, mode)) return Promise.resolve({ ok: false, error: 'export-denied' });
    var CHUNK = 24576; // 24 KiB per chunk -> 32 KiB base64
    for (var i = 0; i < bytes.length; i += CHUNK) {
      appendExportChunk(bytesToBase64(bytes.subarray(i, i + CHUNK)));
    }
    if (bytes.length === 0) appendExportChunk('');
    return endExport();
  }

  function saveText(name, mime, text, mode) {
    return saveBytes(name, mime, utf8Bytes(text), mode);
  }

  function saveDataUrl(name, dataUrl, mode) {
    var mime = 'image/png';
    var match = /^data:([^;,]+)[;,]/.exec(String(dataUrl || ''));
    if (match) mime = match[1];
    var bytes = base64ToBytes(dataUrl);
    return saveBytes(name, mime, bytes, mode);
  }

  // Try to hand the export off to the Java side; returns true when the bridge
  // accepted the job, false when the caller should use saveText/saveDataUrl.
  function hasNativeExport() {
    return !!(bridge && typeof bridge.beginExport === 'function' && typeof bridge.endExport === 'function');
  }

  CL.Native = {
    isAndroid: isAndroid,
    hasBridge: !!bridge,
    hasNativeExport: hasNativeExport,
    info: info,
    beginExport: beginExport,
    appendExportChunk: appendExportChunk,
    endExport: endExport,
    saveBytes: saveBytes,
    saveText: saveText,
    saveDataUrl: saveDataUrl,
    toast: toast,
    setKeepScreenOn: setKeepScreenOn,
    vibrate: vibrate,
    exitApp: exitApp,
    onSharedFile: onSharedFile,
    handleSharedFile: handleSharedFile,
    pollInitialSharedFile: pollInitialSharedFile,
    encodeText: function (text) { return bytesToBase64(utf8Bytes(text)); },
    decodeBase64Utf8: function (base64) { return utf8Decode(base64ToBytes(base64)); },
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    utf8Bytes: utf8Bytes,
    utf8Decode: utf8Decode,
    timestamp: timestamp
  };

  // Let Java call back into the web app directly.
  if (!root.__clNativeDispatchSharedFile) {
    root.__clNativeDispatchSharedFile = function (name, base64) {
      return CL.Native.handleSharedFile(name, base64);
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
