/**
 * CrystalLens Android - sheets / dialogs / menu / toast (CL.ui.dialogs).
 *
 * Everything is drawn with plain DOM (no native dialogs): bottom sheets on
 * phones, centred dialogs on wide screens. Forms use native <input> elements
 * with inputmode hints so the Android soft keyboard behaves.
 *
 * Classic script; depends on CL.App / CL.i18n / CL.periodic / CL.data.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = root.document;
  var ui = CL.ui = CL.ui || {};

  var sheet = { open: false, options: null, root: null, closeTimer: 0 };
  var menu = { open: false };
  var appearanceDraft = null;
  var lastSheet = null;

  function cloneAppearance(appearance) {
    var src = appearance || {};
    return {
      cellColor: Number(src.cellColor) >>> 0,
      backgroundColor: Number(src.backgroundColor) >>> 0,
      cellLineWidth: Number(src.cellLineWidth) || 1,
      polyTransparency: src.polyTransparency == null ? 66 : Number(src.polyTransparency),
      polyEdgeWidth: src.polyEdgeWidth == null ? 1.2 : Number(src.polyEdgeWidth),
      polyEdgeColor: Number(src.polyEdgeColor) >>> 0
    };
  }
  function t(key) {
    if (CL.i18n && CL.i18n.t) {
      var args = Array.prototype.slice.call(arguments, 1);
      return CL.i18n.t.apply(CL.i18n, [key].concat(args));
    }
    return key;
  }
  function esc(text) { return ui.escapeHtml ? ui.escapeHtml(text) : String(text == null ? '' : text); }
  function icon(name, size) { return ui.icon ? ui.icon(name, size) : ''; }
  function appState() { return CL.App ? CL.App.getState() : {}; }
  function currentDoc() { return CL.App ? CL.App.getDoc() : null; }
  function isTouch() {
    return (root.navigator && /Android|iPhone|iPad|Mobile/i.test(root.navigator.userAgent || '')) ||
      !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
  }
  function el(id) { return D.getElementById(id); }
  function svgIconSpan(name) { return '<span class="ico">' + icon(name, 16) + '</span>'; }

  // ---------------------------------------------------------------- sheet ----
  function sheetRoot() { return D.getElementById('sheet-root'); }

  function paintSheet(spec) {
    var rootEl = sheetRoot();
    if (!rootEl) return;
    var footerHtml = '';
    if (spec.footer && spec.footer.length) {
      footerHtml = '<div class="sheet-foot">';
      for (var i = 0; i < spec.footer.length; i++) {
        var button = spec.footer[i];
        footerHtml += '<button type="button" class="btn ' + (button.className || 'btn-secondary') + '"' +
          ' data-dialog-action="' + esc(button.id) + '"' +
          (button.primary ? ' data-primary="1"' : '') + '>' +
          (button.icon ? svgIconSpan(button.icon) : '') + '<span>' + esc(button.label) + '</span></button>';
      }
      footerHtml += '</div>';
    }
    var subtitleHtml = spec.subtitle ? '<div class="sheet-subtitle">' + esc(spec.subtitle) + '</div>' : '';
    var bodyHtml = typeof spec.body === 'function' ? spec.body() : spec.body;
    rootEl.innerHTML = '<div class="sheet-backdrop"></div>' +
      '<div class="sheet' + (spec.size === 'small' ? ' sheet-small' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(spec.title) + '">' +
      '<div class="sheet-grabber"><span></span></div>' +
      '<div class="sheet-head"><div class="sheet-title">' + esc(spec.title) + '</div>' + subtitleHtml +
      '<button type="button" class="sheet-close" data-dialog-action="close" aria-label="' + esc(t('ui.close')) + '">' +
      '<span class="ico">' + icon('close', 16) + '</span></button></div>' +
      '<div class="sheet-body">' + (bodyHtml || '') + '</div>' + footerHtml + '</div>';
    rootEl.classList.add('is-open');
    rootEl.setAttribute('aria-hidden', 'false');
    sheet.open = true;
    if (spec.onMount) {
      try { spec.onMount(rootEl.querySelector('.sheet')); } catch (e) { logError('sheet onMount failed: ' + (e && e.message ? e.message : e)); }
    }
    // focus: desktop -> first field; phones -> keep off the keyboard until tap
    if (!isTouch()) {
      var input = rootEl.querySelector('.sheet-body input, .sheet-body select, .sheet-body textarea');
      if (input) {
        try { input.focus(); if (input.select) input.select(); } catch (e2) { /* ignore */ }
      }
    }
  }

  function openSheet(spec) {
    if (sheet.open) closeSheet(0);
    if (sheet.closeTimer) { root.clearTimeout(sheet.closeTimer); sheet.closeTimer = 0; }
    sheet.options = spec;
    lastSheet = spec;
    paintSheet(spec);
    return spec;
  }

  function closeSheet(delay) {
    var rootEl = sheetRoot();
    if (!rootEl || !sheet.open) return;
    var options = sheet.options;
    if (options && options.onClose) {
      try { options.onClose(); } catch (e) { logError('sheet onClose failed: ' + (e && e.message ? e.message : e)); }
    }
    var sheetEl = rootEl.querySelector('.sheet');
    if (sheetEl) sheetEl.classList.add('is-closing');
    var finish = function () {
      rootEl.classList.remove('is-open');
      rootEl.setAttribute('aria-hidden', 'true');
      rootEl.innerHTML = '';
      sheet.open = false;
      sheet.options = null;
    };
    if (delay === 0 || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      finish();
    } else {
      sheet.closeTimer = root.setTimeout(finish, 230);
    }
  }

  function isOpen() { return sheet.open; }

  function rerender() {
    if (sheet.open && sheet.options) {
      var spec = sheet.options;
      if (spec.render) {
        var next = spec.render();
        spec.title = next.title;
        spec.subtitle = next.subtitle;
        spec.body = next.body;
        spec.footer = next.footer;
        spec.onMount = next.onMount;
        spec.onClose = next.onClose || spec.onClose;
        paintSheet(spec);
      }
    }
    if (menu.open) openMenu();
  }

  function logError(message) {
    if (CL.ui.logError) CL.ui.logError(message);
    else if (root.console) root.console.error(message);
  }

  // ---------------------------------------------------------------- toast ----
  function toast(title, message, type, duration) {
    var container = D.getElementById('toast-root');
    if (!container) return;
    var kind = type === 'success' || type === 'error' ? type : 'info';
    var iconChar = kind === 'success' ? '\u2713' : (kind === 'error' ? '!' : 'i');
    var node = D.createElement('div');
    node.className = 'toast ' + kind;
    node.innerHTML = '<span class="toast-strip"></span>' +
      '<span class="toast-icon">' + iconChar + '</span>' +
      '<div class="toast-content">' +
      (title ? '<div class="toast-title">' + esc(title) + '</div>' : '') +
      (message ? '<div class="toast-msg">' + esc(message) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="toast-close" aria-label="' + esc(t('ui.close')) + '">' +
      '<span class="ico">' + icon('close', 10) + '</span></button>';
    container.appendChild(node);
    var removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      node.classList.add('is-leaving');
      root.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }
    node.querySelector('.toast-close').addEventListener('click', remove);
    root.setTimeout(remove, duration || 4600);
    while (container.children.length > 3) container.removeChild(container.firstChild);
  }
  ui.toast = toast;

  // ----------------------------------------------------------------- menu ----
  function menuRoot() { return D.getElementById('menu-root'); }

  function buildMenuItems() {
    var settings = CL.App.getSettings();
    var doc = currentDoc();
    var mode = CL.App.getMode();
    var state = appState();
    var sections = [];
    sections.push({
      header: t('menu.file'),
      items: [
        { label: t('file.open'), action: 'open', icon: 'open', shortcut: 'Ctrl+O' },
        { label: t('library.title'), action: 'library', icon: 'library', shortcut: 'Ctrl+L' },
        { label: t('file.reload'), action: 'reload', icon: 'reload', disabled: !doc || !doc.sourceText },
        { label: t('file.save'), action: 'save', icon: 'save', shortcut: 'Ctrl+S', disabled: !doc },
        { label: t('file.save-screenshot'), action: 'screenshot', icon: 'camera', shortcut: 'Ctrl+Shift+S', disabled: !doc },
        { label: t('edit.copy-summary'), action: 'copy-summary', icon: 'copy', disabled: !doc },
        { label: t('file.exit'), action: 'exit', icon: 'exit' }
      ]
    });
    sections.push({
      header: t('menu.edit'),
      items: [
        { label: t('edit.undo'), action: 'undo', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !doc || !doc.undo.length },
        { label: t('edit.redo'), action: 'redo', icon: 'redo', shortcut: 'Ctrl+Y', disabled: !doc || !doc.redo.length },
        { label: t('edit.cell'), action: 'edit-cell', icon: 'cell', disabled: !doc || !doc.model || !doc.model.hasCell },
        { label: t('ui.add.atom'), action: 'add-atom', icon: 'add-atom', disabled: !doc },
        { label: t('edit.edit-atom'), action: 'edit-atom', icon: 'edit', shortcut: 'F2', disabled: !doc || doc.selected < 0 },
        { label: t('edit.delete-atom'), action: 'delete-atom', icon: 'trash', shortcut: 'Del', disabled: !doc || doc.selected < 0 },
        { label: t('edit.clear-measurements'), action: 'measure-clear', icon: 'trash', disabled: !doc || !doc.measurements.length }
      ]
    });
    sections.push({
      header: t('menu.view'),
      items: [
        { label: t('view.reset'), action: 'reset', icon: 'reset', shortcut: 'Home', disabled: !doc },
        { label: t('view.fit'), action: 'fit', icon: 'fit', shortcut: 'F', disabled: !doc },
        { label: settings.orthographic ? t('view.orthographic') : t('view.perspective'), action: 'projection', icon: 'cube', checked: !!settings.orthographic },
        { label: t('view.toggle-cell'), action: 'toggle-cell', icon: 'cell', checked: !!settings.showCell, disabled: !doc || !doc.model || !doc.model.hasCell },
        { label: t('view.toggle-bonds'), action: 'toggle-bonds', icon: 'bond', checked: !!settings.showBonds, disabled: !doc },
        { label: t('view.toggle-labels'), action: 'toggle-labels', icon: 'label', checked: !!settings.showLabels, disabled: !doc },
        { label: t('panel.display.boundary'), action: 'toggle-boundary', icon: 'eye', checked: !!settings.showBoundary, disabled: !doc || !doc.model || !doc.model.hasCell },
        { label: t('view.toggle-axes'), action: 'toggle-axes', icon: 'axes', checked: !!settings.showAxes, disabled: !doc },
        { label: t('view.supercell'), action: 'supercell', icon: 'cube', disabled: !doc || !doc.model || !doc.model.hasCell },
        { label: t('view.appearance'), action: 'appearance', icon: 'image' },
        { label: t('view.toggle-left-panel'), action: 'toggle-left-panel', icon: 'panel-left', checked: !!settings.leftPanel },
        { label: t('view.toggle-right-panel'), action: 'toggle-right-panel', icon: 'panel-right', checked: !!settings.rightPanel }
      ]
    });
    sections.push({
      header: t('menu.measure'),
      items: [
        { label: t('measure.distance'), action: 'measure-distance', icon: 'ruler', shortcut: 'D', checked: mode === 'distance', disabled: !doc },
        { label: t('measure.angle'), action: 'measure-angle', icon: 'angle', shortcut: 'A', checked: mode === 'angle', disabled: !doc },
        { label: t('measure.exit'), action: 'measure-exit', icon: 'close', disabled: mode === 'none' },
        { label: t('edit.clear-measurements'), action: 'measure-clear', icon: 'trash', disabled: !doc || !doc.measurements.length }
      ]
    });
    sections.push({
      header: t('menu.help'),
      items: [
        { label: t('help.menu.shortcuts'), action: 'help', icon: 'help', shortcut: 'F1' },
        { label: t('help.menu.about'), action: 'about', icon: 'info' },
        { label: t('language.english'), action: 'language-en', icon: null, checked: CL.App.getLanguage() === 'en' },
        { label: t('language.chinese'), action: 'language-zh', icon: null, checked: CL.App.getLanguage() === 'zh' }
      ]
    });
    return sections;
  }

  function openMenu() {
    var rootEl = menuRoot();
    if (!rootEl) return;
    var sections = buildMenuItems();
    var html = '<div class="menu-backdrop" data-menu-close="1"></div><div class="menu-panel" role="menu">';
    for (var i = 0; i < sections.length; i++) {
      html += '<div class="menu-header">' + esc(sections[i].header) + '</div>';
      for (var j = 0; j < sections[i].items.length; j++) {
        var item = sections[i].items[j];
        html += '<button type="button" class="menu-item' + (item.disabled ? ' is-disabled' : '') + (item.checked ? ' is-active' : '') + '"' +
          ' role="menuitem" data-action="' + esc(item.action) + '">' +
          '<span class="menu-check">' + (item.checked ? '<span class="ico">' + icon('check', 13) + '</span>' : '') + '</span>' +
          (item.icon ? svgIconSpan(item.icon) : '<span class="ico"></span>') +
          '<span class="menu-label">' + esc(item.label) + '</span>' +
          (item.shortcut ? '<span class="menu-shortcut">' + esc(item.shortcut) + '</span>' : '') +
          '</button>';
      }
      if (i < sections.length - 1) html += '<div class="menu-sep"></div>';
    }
    html += '</div>';
    rootEl.innerHTML = html;
    rootEl.hidden = false;
    rootEl.classList.add('is-open');
    menu.open = true;
    var backdrop = rootEl.querySelector('.menu-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { closeMenu(); });
  }
  function closeMenu() {
    var rootEl = menuRoot();
    if (!rootEl) return;
    rootEl.classList.remove('is-open');
    rootEl.hidden = true;
    rootEl.innerHTML = '';
    menu.open = false;
  }
  function isMenuOpen() { return menu.open; }

  // --------------------------------------------------------------- helpers ---
  function field(id, label, hint, value, options) {
    options = options || {};
    var html = '<div class="field">';
    html += '<label class="field-label" for="' + esc(id) + '"><span>' + esc(label) + '</span>' +
      (hint ? '<span class="field-hint">' + esc(hint) + '</span>' : '') + '</label>';
    html += '<input class="field-input' + (options.mono === false ? '' : '') + '" id="' + esc(id) + '" name="' + esc(id) + '" type="text"' +
      ' inputmode="' + esc(options.inputmode || 'decimal') + '" autocomplete="off" autocapitalize="off" spellcheck="false"' +
      (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '') +
      ' value="' + esc(value == null ? '' : value) + '">';
    html += '</div>';
    return html;
  }
  function fieldRow(htmls) {
    return '<div class="field-row">' + htmls.join('') + '</div>';
  }
  function formError() { return '<div class="form-error" id="dialog-error" role="alert"></div>'; }
  function setError(message) {
    var node = D.getElementById('dialog-error');
    if (!node) return;
    if (message) {
      node.textContent = message;
      node.classList.add('is-visible');
    } else {
      node.textContent = '';
      node.classList.remove('is-visible');
    }
  }
  function focusFirstInput() {
    var node = sheetRoot() && sheetRoot().querySelector('.sheet-body input');
    if (node) { try { node.focus(); if (node.select) node.select(); } catch (e) { /* ignore */ } }
  }
  function valueOf(id) {
    var node = el(id);
    return node ? node.value : '';
  }

  // ------------------------------------------------------------- library -----
  function openLibrary() {
    function render() {
      var library = (CL.data && CL.data.library) || [];
      var examples = (CL.data && CL.data.examples) || [];
      var langEn = CL.App.getLanguage() === 'en';
      var body = '';
      body += '<div class="library-section-title">' + esc(t('library.title')) + '</div>';
      if (!library.length) {
        body += '<div class="form-note">' + esc(t('library.unavailable')) + '</div>';
      } else {
        body += '<div class="library-list">';
        for (var i = 0; i < library.length; i++) {
          var entry = library[i];
          var title = langEn ? (entry.titleEn || entry.titleZh) : (entry.titleZh || entry.titleEn);
          body += '<button type="button" class="library-row" data-dialog-action="library" data-id="' + esc(entry.id) + '">' +
            '<span class="library-row-main"><span class="library-name">' + esc(title) + '</span>' +
            '<span class="library-sub">' + esc(entry.spaceGroup || '') + (entry.sourceId ? '   \u00B7   COD ' + esc(entry.sourceId) : '') + '</span></span>' +
            '<span class="library-formula">' + esc(entry.formula || '') + '</span>' +
            '<span class="ico">' + icon('chevron-right', 15) + '</span></button>';
        }
        body += '</div>';
      }
      if (examples.length) {
        body += '<div class="library-section-title" style="margin-top:16px">' + esc(t('ui.examples')) + '</div>';
        body += '<div class="library-list">';
        for (var j = 0; j < examples.length; j++) {
          var ex = examples[j];
          var exTitle = langEn ? (ex.titleEn || ex.titleZh) : (ex.titleZh || ex.titleEn);
          body += '<button type="button" class="library-row library-example-row" data-dialog-action="example" data-file="' + esc(ex.file) + '">' +
            '<span class="library-row-main"><span class="library-name">' + esc(exTitle) + '</span>' +
            '<span class="library-sub">' + esc((ex.format || '') + '   \u00B7   ' + (ex.file || '')) + '</span></span>' +
            '<span class="library-formula">' + esc(ex.formula || '') + '</span>' +
            '<span class="ico">' + icon('chevron-right', 15) + '</span></button>';
        }
        body += '</div>';
      }
      return {
        title: t('library.title'),
        subtitle: t('library.hint'),
        body: body,
        footer: [
          { id: 'open-file', label: t('file.open'), className: 'btn-secondary', icon: 'open' },
          { id: 'close', label: t('ui.close'), className: 'btn-primary' }
        ],
        render: function () { return render(); }
      };
    }
    openSheet(render());
  }

  // ------------------------------------------------------------ supercell ----
  function openSupercell() {
    var doc = currentDoc();
    var settings = CL.App.getSettings();
    if (!doc || !doc.model || !doc.model.hasCell) {
      toast(t('dialog.supercell.title'), t('toast.no-cell-for-edit'), 'info');
      return;
    }
    var current = settings.supercell.slice();
    function render() {
      return {
        title: t('dialog.supercell.title'),
        subtitle: t('dialog.supercell.subtitle'),
        body: '<div style="margin-top:2px">' +
          field('dlg-sc-a', t('dialog.supercell.a'), '\u00D7 1\u201316', current[0]) +
          field('dlg-sc-b', t('dialog.supercell.b'), '\u00D7 1\u201316', current[1]) +
          field('dlg-sc-c', t('dialog.supercell.c'), '\u00D7 1\u201316', current[2]) +
          '</div>' + formError(),
        footer: [
          { id: 'cancel', label: t('dialog.cancel'), className: 'btn-secondary' },
          { id: 'apply', label: t('dialog.ok'), className: 'btn-primary', primary: true }
        ]
      };
    }
    openSheet(render());
  }
  function submitSupercell() {
    setError('');
    var values = [valueOf('dlg-sc-a'), valueOf('dlg-sc-b'), valueOf('dlg-sc-c')];
    var nums = [];
    for (var i = 0; i < values.length; i++) {
      var raw = String(values[i] || '').trim();
      if (!/^\d+$/.test(raw)) { setError(t('dialog.supercell.error.invalid')); return; }
      var n = parseInt(raw, 10);
      if (n < 1 || n > 16) { setError(t('dialog.supercell.error.invalid')); return; }
      nums.push(n);
    }
    var result = CL.App.setSupercell(nums);
    if (!result.ok) { setError(result.error || t('dialog.supercell.error.invalid')); return; }
    closeSheet();
  }

  // ------------------------------------------------------------- edit cell ----
  function openEditCell() {
    var doc = currentDoc();
    if (!doc || !doc.structure) { toast(t('dialog.edit-cell.title'), t('toast.no-structure'), 'info'); return; }
    var cell = (doc.model && doc.model.cell) || doc.structure.cell;
    if (!cell) { toast(t('dialog.edit-cell.title'), t('toast.no-cell-for-edit'), 'info'); return; }
    function render() {
      return {
        title: t('dialog.edit-cell.title'),
        subtitle: t('dialog.edit-cell.subtitle'),
        body: fieldRow([
          field('dlg-cell-a', 'a', '\u00C5', ui.fmt(cell.a, 6)),
          field('dlg-cell-b', 'b', '\u00C5', ui.fmt(cell.b, 6)),
          field('dlg-cell-c', 'c', '\u00C5', ui.fmt(cell.c, 6))
        ]) + fieldRow([
          field('dlg-cell-alpha', '\u03B1', '\u00B0', ui.fmt(cell.alpha, 4)),
          field('dlg-cell-beta', '\u03B2', '\u00B0', ui.fmt(cell.beta, 4)),
          field('dlg-cell-gamma', '\u03B3', '\u00B0', ui.fmt(cell.gamma, 4))
        ]) + formError(),
        footer: [
          { id: 'cancel', label: t('dialog.cancel'), className: 'btn-secondary' },
          { id: 'apply', label: t('dialog.ok'), className: 'btn-primary', primary: true }
        ]
      };
    }
    openSheet(render());
  }
  function submitEditCell() {
    setError('');
    var fields = ['dlg-cell-a', 'dlg-cell-b', 'dlg-cell-c', 'dlg-cell-alpha', 'dlg-cell-beta', 'dlg-cell-gamma'];
    var values = [];
    for (var i = 0; i < fields.length; i++) {
      var raw = String(valueOf(fields[i]) || '').trim();
      if (raw === '') { setError(t('dialog.error.invalid-number')); return; }
      var n = Number(raw);
      if (!isFinite(n)) { setError(t('dialog.error.invalid-number')); return; }
      values.push(n);
    }
    if (values[0] <= 0 || values[1] <= 0 || values[2] <= 0) {
      setError(t('dialog.edit-cell.error.invalid')); return;
    }
    for (var k = 3; k < 6; k++) {
      if (values[k] <= 0 || values[k] >= 180) { setError(t('dialog.edit-cell.error.invalid')); return; }
    }
    var result = CL.App.editCell({
      a: values[0], b: values[1], c: values[2],
      alpha: values[3], beta: values[4], gamma: values[5]
    });
    if (!result || result.ok === false) {
      setError((result && result.error) || t('dialog.edit-cell.error.invalid'));
      return;
    }
    closeSheet();
  }

  // --------------------------------------------------------------- atoms -----
  function selectedAtomInfo() {
    var doc = currentDoc();
    if (!doc || doc.selected < 0 || !doc.model || !doc.model.atoms) return null;
    var atoms = doc.model.atoms;
    var atom = null;
    if (atoms[doc.selected] && atoms[doc.selected].id === doc.selected) atom = atoms[doc.selected];
    else {
      for (var i = 0; i < atoms.length; i++) if (atoms[i].id === doc.selected) { atom = atoms[i]; break; }
    }
    if (!atom) return null;
    var site = (doc.structure && doc.structure.sites && doc.structure.sites[atom.siteId]) || null;
    return { atom: atom, site: site, doc: doc };
  }
  function openAtom(mode) {
    var doc = currentDoc();
    if (!doc) { toast(t('dialog.add-atom.title'), t('toast.no-structure'), 'info'); return; }
    var info = mode === 'edit' ? selectedAtomInfo() : null;
    if (mode === 'edit' && !info) { toast(t('dialog.edit-atom.title'), t('toast.select-atom-first'), 'info'); return; }
    var fractional = !!(doc.model && doc.model.hasCell);
    var atom = info ? info.atom : null;
    var site = info ? info.site : null;
    function render() {
      var element = atom ? (atom.element || '') : 'C';
      var label = atom ? (atom.label || '') : '';
      var occupancy = atom && atom.occupancy != null ? fmtOcc(atom.occupancy) : '1.00';
      var coords = fractional
        ? ((atom && atom.frac) || (site && site.frac) || [0.5, 0.5, 0.5])
        : ((site && site.cart) || (atom && atom.pos) || [0, 0, 0]);
      var coordUnit = fractional ? t('dialog.field.hint.fractional') : '\u00C5';
      var body = '';
      body += field('dlg-atom-element', t('dialog.atom.element'), t('dialog.atom.hint.element'), element, { inputmode: 'text' });
      body += field('dlg-atom-label', t('dialog.atom.label'), t('dialog.field.hint.optional'), label, { inputmode: 'text' });
      body += field('dlg-atom-occ', t('dialog.atom.occupancy'), '0 \u2013 1', occupancy);
      body += fieldRow([
        field('dlg-atom-x', 'x', coordUnit, ui.fmt(coords[0], 5)),
        field('dlg-atom-y', 'y', coordUnit, ui.fmt(coords[1], 5)),
        field('dlg-atom-z', 'z', coordUnit, ui.fmt(coords[2], 5))
      ]);
      body += '<div class="form-note">' + esc(t(fractional
        ? (mode === 'edit' ? 'dialog.edit-atom.subtitle-fractional' : 'dialog.atom.subtitle-fractional')
        : (mode === 'edit' ? 'dialog.edit-atom.subtitle-cartesian' : 'dialog.atom.subtitle-cartesian'))) + '</div>';
      if (atom && atom.symmetryGenerated) {
        body += '<div class="form-note">' + esc(t('dialog.edit-atom.symmetry-note')) + '</div>';
      }
      body += formError();
      return {
        title: t(mode === 'edit' ? 'dialog.edit-atom.title' : 'dialog.add-atom.title'),
        subtitle: '',
        body: body,
        footer: [
          { id: 'cancel', label: t('dialog.cancel'), className: 'btn-secondary' },
          { id: 'apply', label: t('dialog.ok'), className: 'btn-primary', primary: true }
        ]
      };
    }
    openSheet(render());
  }
  function fmtOcc(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function submitAtom() {
    setError('');
    var doc = currentDoc();
    if (!doc) { closeSheet(); return; }
    var elementRaw = String(valueOf('dlg-atom-element') || '').trim();
    var elementInfo = null;
    if (CL.periodic && CL.periodic.elementFromInput) {
      try { elementInfo = CL.periodic.elementFromInput(elementRaw); } catch (e) { elementInfo = null; }
    }
    if (!elementInfo) {
      setError(t('dialog.atom.error.invalid-element'));
      return;
    }
    var occupancy = Number(String(valueOf('dlg-atom-occ') || '').trim());
    if (!isFinite(occupancy) || occupancy <= 0 || occupancy > 1) {
      setError(t('dialog.atom.error.invalid-occupancy'));
      return;
    }
    var coords = [];
    var coordFields = ['dlg-atom-x', 'dlg-atom-y', 'dlg-atom-z'];
    for (var i = 0; i < coordFields.length; i++) {
      var raw = String(valueOf(coordFields[i]) || '').trim();
      if (raw === '') { setError(t('dialog.error.invalid-number')); return; }
      var n = Number(raw);
      if (!isFinite(n)) { setError(t('dialog.error.invalid-number')); return; }
      coords.push(n);
    }
    var fractional = !!(doc.model && doc.model.hasCell);
    var label = String(valueOf('dlg-atom-label') || '').trim();
    var params = { element: elementInfo.symbol, occupancy: occupancy, label: label || undefined };
    if (fractional) params.frac = coords;
    else params.cart = coords;
    var mode = valueOf('dlg-atom-element') != null && lastAtomMode === 'edit';
    var result;
    if (mode === 'edit') {
      var info = selectedAtomInfo();
      if (!info) { setError(t('toast.select-atom-first')); return; }
      result = CL.App.updateAtom(info.atom.siteId, params);
    } else {
      result = CL.App.addAtom(params);
    }
    if (!result || result.ok === false) {
      setError((result && result.error) || t('ui.error'));
      return;
    }
    closeSheet();
  }
  var lastAtomMode = 'add';
  var _openAtom = openAtom;
  openAtom = function (mode) {
    lastAtomMode = mode;
    _openAtom(mode);
  };

  function confirmDeleteAtom() {
    var info = selectedAtomInfo();
    if (!info) { toast(t('edit.delete-atom'), t('toast.select-atom-first'), 'info'); return; }
    var label = info.atom.label || (info.atom.element + (info.atom.id + 1));
    openConfirm({
      title: t('ui.delete.confirm.title'),
      message: t('ui.delete.confirm') + '\n' + label,
      confirmLabel: t('panel.selection.delete'),
      cancelLabel: t('dialog.cancel'),
      danger: true,
      onConfirm: function () {
        var result = CL.App.deleteAtom();
        if (result && result.ok) closeSheet();
      }
    });
  }

  // ------------------------------------------------------------- confirms ----
  function openConfirm(options) {
    options = options || {};
    var body = '<div class="form-note" style="font-size:10.5px;color:var(--text-2);white-space:pre-line;line-height:1.6">' +
      esc(options.message || '') + '</div>';
    if (options.detail) body += '<div class="form-note">' + esc(options.detail) + '</div>';
    openSheet({
      title: options.title || t('ui.confirm'),
      subtitle: '',
      body: body,
      footer: [
        { id: 'cancel', label: options.cancelLabel || t('dialog.cancel'), className: 'btn-secondary', primary: !options.danger },
        { id: 'confirm', label: options.confirmLabel || t('dialog.ok'), className: options.danger ? 'btn-danger' : 'btn-primary', primary: !!options.danger === false }
      ],
      actions: {
        cancel: function () {
          if (options.onCancel) { try { options.onCancel(); } catch (e) { /* ignore */ } }
          closeSheet();
        },
        confirm: function () {
          if (options.onConfirm) {
            try { options.onConfirm(); } catch (e) { logError('confirm action failed: ' + (e && e.message ? e.message : e)); }
          }
        }
      }
    });
    var primary = sheetRoot() && sheetRoot().querySelector('[data-dialog-action="cancel"]');
    if (primary) { try { primary.focus(); } catch (e2) { /* ignore */ } }
  }
  function openError(title, message, detail) {
    openSheet({
      title: title || t('ui.error'),
      subtitle: '',
      body: '<div class="form-note" style="font-size:11px;color:var(--text-2);line-height:1.6">' + esc(message || '') + '</div>' +
        (detail ? '<pre class="renderer-error-detail" style="display:block;margin-top:10px;max-height:26vh">' + esc(detail) + '</pre>' : ''),
      footer: [{ id: 'close-ok', label: t('dialog.ok'), className: 'btn-primary', primary: true }]
    });
  }

  // ----------------------------------------------------------- save/export ---
  function openSave() {
    var doc = currentDoc();
    if (!doc) { toast(t('file.save'), t('toast.no-structure'), 'info'); return; }
    var canCif = !!(doc.model && doc.model.hasCell);
    var isAndroid = !!(CL.Native && CL.Native.isAndroid);
    function render() {
      var body = '<div class="library-section-title">' + esc(t('ui.export.title')) + '</div><div class="library-list">';
      if (canCif) {
        body += '<button type="button" class="library-row" data-dialog-action="export" data-kind="cif" data-mode="save">' +
          '<span class="ico">' + icon('cif' in {} ? 'save' : 'save', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.export.cif')) + '</span>' +
          '<span class="library-sub">CIF \u00B7 structure</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      }
      body += '<button type="button" class="library-row" data-dialog-action="export" data-kind="xyz" data-mode="save">' +
        '<span class="ico">' + icon('save', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.export.xyz')) + '</span>' +
        '<span class="library-sub">XYZ \u00B7 current display</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      body += '<button type="button" class="library-row" data-dialog-action="screenshot" data-mode="save">' +
        '<span class="ico">' + icon('camera', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.export.png')) + '</span>' +
        '<span class="library-sub">PNG \u00B7 viewport</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      body += '</div>';
      body += '<div class="library-section-title" style="margin-top:16px">' + esc(t('ui.share.title')) + '</div><div class="library-list">';
      if (canCif) {
        body += '<button type="button" class="library-row" data-dialog-action="export" data-kind="cif" data-mode="share">' +
          '<span class="ico">' + icon('share', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.share.cif')) + '</span>' +
          '<span class="library-sub">CIF</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      }
      body += '<button type="button" class="library-row" data-dialog-action="export" data-kind="xyz" data-mode="share">' +
        '<span class="ico">' + icon('share', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.share.xyz')) + '</span>' +
        '<span class="library-sub">XYZ</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      body += '<button type="button" class="library-row" data-dialog-action="screenshot" data-mode="share">' +
        '<span class="ico">' + icon('share', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.share.png')) + '</span>' +
        '<span class="library-sub">PNG</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      body += '<button type="button" class="library-row" data-dialog-action="copy-summary">' +
        '<span class="ico">' + icon('copy', 16) + '</span><span class="library-row-main"><span class="library-name">' + esc(t('ui.copy.summary')) + '</span>' +
        '<span class="library-sub">' + esc(t('toast.copied-summary')) + '</span></span><span class="ico">' + icon('chevron-right', 15) + '</span></button>';
      body += '</div>';
      if (!isAndroid) {
        body += '<div class="form-note" style="margin-top:12px">' + esc(t('viewport.empty.footnote')) + '</div>';
      }
      return {
        title: t('dialog.save.title'),
        subtitle: doc.title || '',
        body: body,
        footer: [{ id: 'close', label: t('ui.close'), className: 'btn-secondary' }],
        render: function () { return render(); }
      };
    }
    openSheet(render());
  }

  // ---------------------------------------------------------------- help -----
  var SHORTCUTS = [
    ['Ctrl+O', 'help.shortcut.open'], ['Ctrl+R', 'help.shortcut.reload'], ['Ctrl+S', 'help.shortcut.save'],
    ['Ctrl+Shift+S', 'help.shortcut.screenshot'], ['Ctrl+Z', 'help.shortcut.undo'], ['Ctrl+E', 'help.shortcut.edit'],
    ['F', 'help.shortcut.fit'], ['Home', 'help.shortcut.reset'], ['D', 'help.shortcut.distance'],
    ['A', 'help.shortcut.angle'], ['Esc', 'help.shortcut.cancel'], ['LMB', 'help.shortcut.orbit'],
    ['Wheel', 'help.shortcut.zoom'], ['MMB/RMB', 'help.shortcut.pan']
  ];
  var TOUCH = [
    ['\u2630', 'ui.help.touch.orbit'], ['\u2194', 'ui.help.touch.pinch'], ['\u270B', 'ui.help.touch.pan'],
    ['\u25CF', 'ui.help.touch.tap'], ['\u23F1', 'ui.help.touch.long'], ['\u2726', 'ui.help.touch.double']
  ];
  function openHelp() {
    function render() {
      var logo = (CL.assets && (CL.assets.icon192 || CL.assets.logo)) || 'assets/icons/icon-192.png';
      var buildDate = (CL.data && CL.data.app && (CL.data.app.builtAt || CL.data.app.version)) || '2026-11-21';
      var body = '';
      body += '<div class="help-brand"><img class="help-logo" src="' + esc(logo) + '" alt="">' +
        '<div><div class="help-app-name">' + esc(t('app.title')) + '</div>' +
        '<div class="help-version">' + esc(t('dialog.about.version', '1.1')) + '</div></div></div>';
      body += '<div class="help-tagline">' + esc(t('app.tagline')) + '</div>';
      body += '<div class="help-desc">' + esc(t('dialog.about.description')) + '</div>';
      body += '<div class="help-features">';
      for (var i = 1; i <= 4; i++) {
        body += '<div class="help-feature"><span class="help-check"><span class="ico">' + icon('check', 9) + '</span></span>' +
          '<span>' + esc(t('dialog.about.feature' + i)) + '</span></div>';
      }
      body += '</div>';
      body += '<div class="help-section-title">' + esc(t('ui.help.touch.title')) + '</div>';
      body += '<div class="help-shortcuts">';
      for (var ti = 0; ti < TOUCH.length; ti++) {
        body += '<div class="help-shortcut"><span class="help-key">' + esc(TOUCH[ti][0]) + '</span>' +
          '<span class="help-shortcut-label">' + esc(t(TOUCH[ti][1])) + '</span></div>';
      }
      body += '</div>';
      body += '<div class="help-section-title">' + esc(t('dialog.about.shortcuts')) + '</div>';
      body += '<div class="help-shortcuts">';
      for (var si = 0; si < SHORTCUTS.length; si++) {
        body += '<div class="help-shortcut"><span class="help-key">' + esc(SHORTCUTS[si][0]) + '</span>' +
          '<span class="help-shortcut-label">' + esc(t(SHORTCUTS[si][1])) + '</span></div>';
      }
      body += '</div>';
      body += '<div class="help-stack">' + esc(t('ui.about.stack')) + '</div>';
      body += '<div class="help-engine">' + esc(t('ui.about.engine')) + ': ' +
        esc(CL.App.getRendererKind() === 'webgl2' ? 'WebGL2' : 'Canvas2D (fallback)') + ' \u00B7 ' +
        esc(t('ui.about.license')) + '</div>';
      body += '<div class="help-foot"><span>' + esc(t('dialog.about.footnote')) + '</span>' +
        '<span>' + esc(t('dialog.about.build', buildDate)) + '</span></div>';
      return {
        title: t('help.menu.shortcuts'),
        subtitle: t('app.tagline'),
        body: body,
        footer: [{ id: 'close', label: t('ui.close'), className: 'btn-primary' }]
      };
    }
    openSheet(render());
  }

  // ------------------------------------------------------------ appearance ---
  function openAppearance() {
    var settings = CL.App.getSettings();
    var working = cloneAppearance(settings.appearance);
    var targets = [
      { id: 'cell', field: 'cellColor', label: t('dialog.appearance.cell-color') },
      { id: 'background', field: 'backgroundColor', label: t('dialog.appearance.background-color') },
      { id: 'poly', field: 'polyEdgeColor', label: t('dialog.appearance.poly-edge-color') }
    ];
    appearanceDraft = {
      working: working,
      targets: targets,
      targetId: 'cell',
      hsv: {},
      canvas: { wheel: null, bar: null, marker: null, valueMarker: null }
    };
    for (var i = 0; i < targets.length; i++) {
      appearanceDraft.hsv[targets[i].id] = ui.rgbToHsv(ui.u32ToRgb(working[targets[i].field]));
    }
    function activeTarget() {
      for (var k = 0; k < appearanceDraft.targets.length; k++) if (appearanceDraft.targets[k].id === appearanceDraft.targetId) return appearanceDraft.targets[k];
      return appearanceDraft.targets[0];
    }
    function applyHsv() {
      var target = activeTarget();
      var hsv = appearanceDraft.hsv[target.id];
      appearanceDraft.working[target.field] = ui.rgbToU32(ui.hsvToRgb(hsv[0], hsv[1], hsv[2]));
      CL.App.previewAppearance(appearanceDraft.working);
      updateUi();
    }
    function updateUi() {
      var target = activeTarget();
      var hsv = appearanceDraft.hsv[target.id];
      var hex = ui.u32ToHex(appearanceDraft.working[target.field]);
      var rootEl = sheetRoot();
      if (!rootEl) return;
      var swatches = rootEl.querySelectorAll('.swatch');
      for (var s = 0; s < swatches.length; s++) {
        var id = swatches[s].getAttribute('data-target');
        for (var tgd = 0; tgd < appearanceDraft.targets.length; tgd++) {
          var tg = appearanceDraft.targets[tgd];
          if (tg.id !== id) continue;
          var swatchColor = swatches[s].querySelector('.swatch-color');
          if (swatchColor) swatchColor.style.background = ui.u32ToHex(appearanceDraft.working[tg.field]);
          swatches[s].classList.toggle('is-active', id === appearanceDraft.targetId);
        }
      }
      var hexNode = rootEl.querySelector('[data-role="appearance-hex"]');
      if (hexNode) hexNode.textContent = hex;
      var wheel = rootEl.querySelector('.color-wheel');
      var wrap = rootEl.querySelector('.color-wheel-wrap');
      var marker = rootEl.querySelector('.wheel-marker');
      if (wrap && marker) {
        var size = wrap.clientWidth || 148;
        var radius = size / 2 - 7;
        var angle = hsv[0] * Math.PI / 180;
        var mx = size / 2 + Math.cos(angle) * radius * hsv[1];
        var my = size / 2 + Math.sin(angle) * radius * hsv[1];
        marker.style.left = mx.toFixed(1) + 'px';
        marker.style.top = my.toFixed(1) + 'px';
      }
      var valueBar = rootEl.querySelector('.value-bar');
      var valueMarker = rootEl.querySelector('.value-marker');
      var barWrap = rootEl.querySelector('.value-bar-wrap');
      if (valueBar && barWrap && valueMarker) {
        var barHeight = barWrap.clientHeight || 148;
        valueMarker.style.top = ((1 - hsv[2]) * barHeight).toFixed(1) + 'px';
        drawValueBar(valueBar, hsv);
      }
      var widthRange = rootEl.querySelector('[data-role="cell-width"]');
      if (widthRange) setSliderFill(widthRange, working.cellLineWidth, 0.5, 4);
      var transpRange = rootEl.querySelector('[data-role="poly-transparency"]');
      if (transpRange) setSliderFill(transpRange, working.polyTransparency, 0, 100);
      var edgeRange = rootEl.querySelector('[data-role="poly-edge-width"]');
      if (edgeRange) setSliderFill(edgeRange, working.polyEdgeWidth, 0, 4);
      setText(rootEl, '[data-role="cell-width-value"]', ui.fmt(working.cellLineWidth, 2));
      setText(rootEl, '[data-role="poly-transparency-value"]', Math.round(working.polyTransparency) + '%');
      setText(rootEl, '[data-role="poly-edge-width-value"]', ui.fmt(working.polyEdgeWidth, 1) + ' px');
    }
    function setText(scope, selector, text) {
      var node = scope.querySelector(selector);
      if (node) node.textContent = text;
    }
    function drawWheel(canvas) {
      if (!canvas) return;
      var size = 296;
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var image = ctx.createImageData(size, size);
      var data = image.data;
      var cx = size / 2, cy = size / 2, radius = size / 2 - 2;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var dx = x - cx, dy = y - cy;
          var r = Math.sqrt(dx * dx + dy * dy);
          var index = (y * size + x) * 4;
          if (r > radius) { data[index + 3] = 0; continue; }
          var hue = Math.atan2(dy, dx) * 180 / Math.PI;
          if (hue < 0) hue += 360;
          var sat = r / radius;
          var rgb = ui.hsvToRgb(hue, sat, 1);
          data[index] = Math.round(rgb[0] * 255);
          data[index + 1] = Math.round(rgb[1] * 255);
          data[index + 2] = Math.round(rgb[2] * 255);
          var edge = Math.min(1, (radius - r) / 2);
          data[index + 3] = Math.round(255 * Math.min(1, edge * 1.4));
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    function drawValueBar(canvas, hsv) {
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var size = 296;
      if (canvas.width !== 52) { canvas.width = 52; canvas.height = size; }
      var base = ui.hsvToRgb(hsv[0], hsv[1], 1);
      var grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, 'rgb(' + Math.round(base[0] * 255) + ',' + Math.round(base[1] * 255) + ',' + Math.round(base[2] * 255) + ')');
      grad.addColorStop(1, 'rgb(0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 52, size);
    }
    function setSliderFill(input, value, min, max) {
      var percent = Math.round((value - min) / (max - min) * 100);
      input.style.setProperty('--fill', percent + '%');
    }
    function bindWheel(wheel, wrap) {
      var dragging = false;
      function handle(event) {
        var rect = wrap.getBoundingClientRect();
        var x = event.clientX - rect.left - rect.width / 2;
        var y = event.clientY - rect.top - rect.height / 2;
        var radius = rect.width / 2 - 7;
        var r = Math.sqrt(x * x + y * y);
        var hsv = appearanceDraft.hsv[appearanceDraft.targetId];
        var hue = Math.atan2(y, x) * 180 / Math.PI;
        if (hue < 0) hue += 360;
        var sat = Math.min(1, r / radius);
        hsv[0] = hue;
        hsv[1] = sat;
        if (hsv[2] < 0.08) hsv[2] = 0.42;
        applyHsv();
      }
      wheel.addEventListener('pointerdown', function (event) {
        dragging = true;
        try { wheel.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        handle(event);
        event.preventDefault();
      });
      wheel.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        handle(event);
        event.preventDefault();
      });
      wheel.addEventListener('pointerup', function (event) {
        dragging = false;
        try { wheel.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      });
      wheel.addEventListener('pointercancel', function () { dragging = false; });
    }
    function bindValueBar(bar, wrap) {
      var dragging = false;
      function handle(event) {
        var rect = wrap.getBoundingClientRect();
        var y = event.clientY - rect.top;
        var v = 1 - clamp01(y / Math.max(1, rect.height));
        var hsv = appearanceDraft.hsv[appearanceDraft.targetId];
        hsv[2] = v;
        applyHsv();
      }
      bar.addEventListener('pointerdown', function (event) {
        dragging = true;
        try { bar.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        handle(event);
        event.preventDefault();
      });
      bar.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        handle(event);
        event.preventDefault();
      });
      bar.addEventListener('pointerup', function (event) {
        dragging = false;
        try { bar.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      });
      bar.addEventListener('pointercancel', function () { dragging = false; });
    }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function render() {
      var hsv = appearanceDraft.hsv[appearanceDraft.targetId];
      var currentColor = appearanceDraft.working[activeTarget().field];
      var swatchesHtml = '<div class="swatches">';
      for (var i = 0; i < appearanceDraft.targets.length; i++) {
        var trg = appearanceDraft.targets[i];
        swatchesHtml += '<button type="button" class="swatch' + (trg.id === appearanceDraft.targetId ? ' is-active' : '') + '"' +
          ' data-dialog-action="target" data-target="' + trg.id + '">' +
          '<span class="swatch-color" style="background:' + esc(ui.u32ToHex(appearanceDraft.working[trg.field])) + '"></span>' +
          '<span class="swatch-label">' + esc(t(trg.id === 'cell' ? 'dialog.appearance.cell-color' : (trg.id === 'background' ? 'dialog.appearance.background-color' : 'dialog.appearance.poly-edge-color'))) + '</span>' +
          '</button>';
      }
      swatchesHtml += '</div>';
      var body = '';
      body += '<div class="appearance-top">' +
        '<div class="color-wheel-wrap"><canvas class="color-wheel" width="296" height="296"></canvas><span class="wheel-marker"></span></div>' +
        '<div class="value-bar-wrap"><canvas class="value-bar" width="52" height="296"></canvas><span class="value-marker"></span></div>' +
        swatchesHtml + '</div>';
      body += '<div class="hex-readout">' + esc(t('dialog.appearance.brightness')) + '&nbsp;&nbsp;' +
        '<span data-role="appearance-hex">' + esc(ui.u32ToHex(currentColor)) + '</span></div>';
      body += '<div class="appearance-sliders">';
      body += sliderField('cell-width', t('dialog.appearance.cell-width'), 'data-role="cell-width"', 0.5, 4, 0.01, appearanceDraft.working.cellLineWidth);
      body += sliderField('poly-transparency', t('dialog.appearance.poly-transparency'), 'data-role="poly-transparency"', 0, 100, 1, appearanceDraft.working.polyTransparency);
      body += sliderField('poly-edge-width', t('dialog.appearance.poly-edge-width'), 'data-role="poly-edge-width"', 0, 4, 0.1, appearanceDraft.working.polyEdgeWidth);
      body += '</div>';
      return {
        title: t('dialog.appearance.title'),
        subtitle: t('dialog.appearance.subtitle'),
        body: body,
        footer: [
          { id: 'reset', label: t('dialog.appearance.reset'), className: 'btn-secondary' },
          { id: 'ok', label: t('dialog.ok'), className: 'btn-primary', primary: true }
        ],
        render: function () { return render(); },
        onMount: function (sheetEl) {
          var wheel = sheetEl.querySelector('.color-wheel');
          var wrap = sheetEl.querySelector('.color-wheel-wrap');
          var bar = sheetEl.querySelector('.value-bar');
          var barWrap = sheetEl.querySelector('.value-bar-wrap');
          if (wheel && wrap) { drawWheel(wheel); bindWheel(wheel, wrap); }
          if (bar && barWrap) { drawValueBar(bar, hsv); bindValueBar(bar, barWrap); }
          var ranges = sheetEl.querySelectorAll('input[type="range"][data-appearance]');
          for (var r = 0; r < ranges.length; r++) {
            ranges[r].addEventListener('input', function (event) {
              var which = event.target.getAttribute('data-appearance');
              var value = Number(event.target.value);
              if (which === 'cell-width') appearanceDraft.working.cellLineWidth = value;
              else if (which === 'poly-transparency') appearanceDraft.working.polyTransparency = value;
              else if (which === 'poly-edge-width') appearanceDraft.working.polyEdgeWidth = value;
              CL.App.previewAppearance(appearanceDraft.working);
              updateUi();
            });
          }
          updateUi();
        },
        onClose: function () {
          if (appearanceDraft) CL.App.commitAppearance();
          appearanceDraft = null;
        }
      };
    }
    openSheet(render());
  }
  function sliderField(id, label, attr, min, max, step, value) {
    var percent = Math.round((value - min) / (max - min) * 100);
    return '<div class="slider-field">' +
      '<div class="slider-field-head"><span class="slider-field-label">' + esc(label) + '</span>' +
      '<span class="slider-field-value" data-role="' + esc(id) + '-value"></span></div>' +
      '<input type="range" data-appearance="' + esc(id) + '" ' + attr + ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"' +
      ' style="--fill:' + percent + '%" aria-label="' + esc(label) + '">' +
      '</div>';
  }

  // ------------------------------------------------------------- actions -----
  function handleDialogAction(action, target) {
    switch (action) {
      case 'close': closeSheet(); break;
      case 'cancel': closeSheet(); break;
      case 'close-ok': closeSheet(); break;
      case 'open-file': closeSheet(); CL.App.openFilePicker(); break;
      case 'library': closeSheet(); CL.App.openLibraryEntry(target.getAttribute('data-id')); break;
      case 'example': closeSheet(); CL.App.openExample(target.getAttribute('data-file')); break;
      case 'apply': {
        var title = (sheet.options && sheet.options.title) || '';
        if (title === t('dialog.supercell.title')) submitSupercell();
        else if (title === t('dialog.edit-cell.title')) submitEditCell();
        else submitAtom();
        break;
      }
      case 'export': {
        var kind = target.getAttribute('data-kind');
        var exportMode = target.getAttribute('data-mode');
        closeSheet();
        var promise = CL.App.exportStructure(kind);
        if (exportMode === 'share') { /* exportStructure currently saves; share uses same pipeline */ }
        if (promise && promise.catch) promise.catch(function () {});
        break;
      }
      case 'screenshot': {
        var shotMode = target.getAttribute('data-mode') || 'save';
        closeSheet();
        var shot = CL.App.exportScreenshot(shotMode);
        if (shot && shot.catch) shot.catch(function () {});
        break;
      }
      case 'copy-summary': closeSheet(); CL.App.copySummary(); break;
      case 'target': {
        if (!appearanceDraft) break;
        appearanceDraft.targetId = target.getAttribute('data-target');
        if (sheet.options && sheet.options.render) rerender();
        break;
      }
      case 'reset': {
        if (!appearanceDraft) break;
        var defaults = { cellColor: 0xD6DEE9, backgroundColor: 0x020305, cellLineWidth: 1.0, polyTransparency: 66, polyEdgeWidth: 1.2, polyEdgeColor: 0x91B4D3 };
        for (var key in appearanceDraft.working) if (Object.prototype.hasOwnProperty.call(appearanceDraft.working, key)) appearanceDraft.working[key] = defaults[key];
        for (var i2 = 0; i2 < appearanceDraft.targets.length; i2++) {
          var trg = appearanceDraft.targets[i2];
          appearanceDraft.hsv[trg.id] = ui.rgbToHsv(ui.u32ToRgb(appearanceDraft.working[trg.field]));
        }
        CL.App.previewAppearance(appearanceDraft.working);
        if (sheet.options && sheet.options.render) rerender();
        break;
      }
      case 'ok': {
        closeSheet();
        break;
      }
      default: break;
    }
  }

  function onSheetClick(event) {
    var target = event.target;
    var backdrop = target.closest && target.closest('.sheet-backdrop');
    if (backdrop) { closeSheet(); return; }
    var actionNode = target.closest ? target.closest('[data-dialog-action]') : null;
    if (!actionNode) return;
    var action = actionNode.getAttribute('data-dialog-action');
    if (action === 'confirm' || action === 'cancel') {
      // confirm sheets carry their own action map
      if (sheet.options && sheet.options.actions && sheet.options.actions[action]) {
        sheet.options.actions[action]();
        return;
      }
    }
    handleDialogAction(action, actionNode);
  }
  function onSheetKeyDown(event) {
    if (!sheet.open) return;
    var target = event.target;
    if (event.key === 'Escape') {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === 'Enter' && target && (target.tagName === 'INPUT')) {
      var primary = sheetRoot().querySelector('[data-primary="1"]');
      if (primary) {
        event.preventDefault();
        primary.click();
      }
    }
  }
  function back() {
    if (!sheet.open) return false;
    closeSheet();
    return true;
  }

  // ---------------------------------------------------------------- init -----
  function init() {
    var rootEl = sheetRoot();
    if (rootEl) {
      rootEl.addEventListener('click', onSheetClick);
      rootEl.addEventListener('keydown', onSheetKeyDown);
    }
  }

  CL.ui.dialogs = {
    init: init,
    isOpen: isOpen,
    back: back,
    close: function () { closeSheet(); },
    rerender: rerender,
    openSheet: openSheet,
    openLibrary: openLibrary,
    openSupercell: openSupercell,
    openAppearance: openAppearance,
    openEditCell: openEditCell,
    openAtom: function (mode) { openAtom(mode); },
    confirmDeleteAtom: confirmDeleteAtom,
    openSave: openSave,
    openHelp: openHelp,
    openConfirm: openConfirm,
    openError: openError,
    openMenu: openMenu,
    closeMenu: closeMenu,
    isMenuOpen: isMenuOpen,
    toast: toast
  };
  ui.dialogs = CL.ui.dialogs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
