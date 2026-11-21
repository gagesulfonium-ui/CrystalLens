/**
 * CrystalLens Android - boot script.
 *
 * Loaded last (docs/CONTRACT.md §4). Installs the global error log that the
 * headless QA harness reads (#cl-error-log), then starts CL.App once the DOM
 * is ready. Also provides the last-resort "never a white screen" fallback:
 * if the app fails to report a rendered frame within 6 s the boot splash is
 * removed anyway and the failure is recorded in the error log.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = root.document;
  var errors = [];

  function errorLogNode() { return D.getElementById('cl-error-log'); }

  function writeErrors() {
    var node = errorLogNode();
    if (!node) return;
    try { node.textContent = JSON.stringify(errors); } catch (e) { node.textContent = '[]'; }
  }

  function report(message) {
    var text = String(message == null ? '' : message);
    var last = errors.length ? errors[errors.length - 1] : '';
    if (text === last) { writeErrors(); return; }
    errors.push(text);
    while (errors.length > 40) errors.shift();
    writeErrors();
    try { if (root.console && root.console.error) root.console.error('[CL] ' + text); } catch (e) { /* ignore */ }
  }

  root.__clLogError = report;
  root.__clErrors = errors;

  root.onerror = function (message, source, line, column, error) {
    var detail = '[onerror] ' + (message || 'unknown error');
    if (source) detail += ' @ ' + source;
    if (line) detail += ':' + line + (column ? ':' + column : '');
    if (error && error.stack) detail += '\n' + error.stack;
    report(detail);
    return false; // keep default console output too
  };

  if (root.addEventListener) {
    root.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var detail = reason && (reason.stack || reason.message) ? (reason.stack || reason.message) : String(reason);
      report('[unhandledrejection] ' + detail);
    });
  }

  function bootStatus(text, isError) {
    var node = D.getElementById('boot-status');
    if (!node) return;
    node.textContent = text;
    node.className = 'boot-status' + (isError ? ' is-error' : '');
  }

  function start() {
    writeErrors();
    var bootScreen = D.getElementById('boot-screen');
    try {
      if (!CL.App || typeof CL.App.init !== 'function') {
        throw new Error('CL.App is unavailable (js/ui/app.js failed to load)');
      }
      CL.App.init();
    } catch (e) {
      report('[boot] ' + ((e && e.stack) ? e.stack : e));
      bootStatus('CrystalLens \u542F\u52A8\u5931\u8D25', true);
      if (bootScreen) bootScreen.classList.remove('is-done');
      return;
    }
    // Never leave the splash screen covering the app if frames never arrive.
    root.setTimeout(function () {
      var state = null;
      try { state = CL.App.getState ? CL.App.getState() : null; } catch (e) { state = null; }
      if (state && state.ready) return;
      if (!state || state.frames < 1) {
        report('[boot] no frame rendered within 6s; removing boot screen (graceful fallback)');
      }
      if (bootScreen && bootScreen.parentNode) bootScreen.classList.add('is-done');
      try { D.documentElement.setAttribute('data-cl-ready', '1'); } catch (e2) { /* ignore */ }
    }, 6000);
  }

  if (D.readyState === 'loading') {
    D.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
