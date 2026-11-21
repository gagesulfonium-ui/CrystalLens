/**
 * CrystalLens Android - side panels, HUD and viewport overlay (CL.ui.panels).
 *
 * Renders the structure panel (left drawer), the selection/measurement panel
 * (right drawer), the viewport HUD (title / measurement banner / element
 * legend / hint / gizmo / labels) and the status bar. All content is rebuilt
 * from CL.App state; dynamic values come from the current DisplayModel.
 *
 * Classic script, no dependencies besides CL.App / CL.i18n / CL.periodic.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = root.document;
  var ui = CL.ui = CL.ui || {};
  var TAU = Math.PI * 2;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var dom = {};
  var panels = {};
  var _flashTimer = 0;
  var _gizmoCtx = null;
  var _measureLayer = null;
  var _atomLayer = null;

  function t(key) {
    if (CL.i18n && CL.i18n.t) {
      var args = Array.prototype.slice.call(arguments, 1);
      return CL.i18n.t.apply(CL.i18n, [key].concat(args));
    }
    return key;
  }
  function app() { return CL.App; }
  function esc(text) { return ui.escapeHtml ? ui.escapeHtml(text) : String(text == null ? '' : text); }
  function icon(name, size) { return ui.icon ? ui.icon(name, size) : ''; }
  function settings() { return CL.App ? CL.App.getSettings() : {}; }
  function doc() { return CL.App ? CL.App.getDoc() : null; }
  function mode() { return CL.App ? CL.App.getMode() : 'none'; }
  function lang() { return CL.App ? CL.App.getLanguage() : 'zh'; }
  function fmtn(v, d) { return ui.fmt ? ui.fmt(v, d) : String(v); }
  function langLabel(key) { return t(key); }
  function cellFmt(v, d) { return fmtn(v, d == null ? 4 : d); }

  // ------------------------------------------------------------- helpers ----
  function badge(text, cls) {
    return '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  }
  function switchHtml(on, disabled) {
    return '<span class="switch' + (on ? ' is-on' : '') + (disabled ? ' is-disabled' : '') + '">' +
      '<span class="switch-track"></span></span>';
  }
  function toggleHtml(action, label, on, disabled) {
    return '<button type="button" class="toggle' + (disabled ? ' is-disabled' : '') + '" data-action="' + action + '"' +
      ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '">' +
      '<span class="toggle-label">' + esc(label) + '</span>' + switchHtml(on, disabled) + '</button>';
  }
  function infoRow(label, value) {
    return '<div class="info-row"><span class="info-row-label">' + esc(label) + '</span>' +
      '<span class="info-row-value" title="' + esc(value) + '">' + esc(value) + '</span></div>';
  }

  function atomById(docRef, id) {
    if (!docRef || !docRef.model || !docRef.model.atoms || id < 0) return null;
    var atoms = docRef.model.atoms;
    if (atoms[id] && atoms[id].id === id) return atoms[id];
    for (var i = 0; i < atoms.length; i++) if (atoms[i].id === id) return atoms[i];
    return null;
  }
  function siteOf(docRef, atom) {
    if (!docRef || !docRef.structure || !docRef.structure.sites || !atom) return null;
    return docRef.structure.sites[atom.siteId] || null;
  }
  function modelStats(docRef) {
    return (docRef && docRef.model && docRef.model.stats) || {};
  }
  function elementEntries(docRef) {
    var atoms = (docRef && docRef.model && docRef.model.atoms) || [];
    var counts = {};
    var order = [];
    for (var i = 0; i < atoms.length; i++) {
      if (atoms[i].kind !== 'cell') continue;
      var element = atoms[i].element || 'X';
      if (!counts[element]) { counts[element] = { element: element, count: 0, z: atoms[i].z || 0 }; order.push(element); }
      counts[element].count++;
    }
    var entries = order.map(function (e) { return counts[e]; });
    entries.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return (a.z || 0) - (b.z || 0);
    });
    return entries;
  }
  function colorOfElement(element) {
    if (CL.periodic && CL.periodic.get) {
      try {
        var entry = CL.periodic.get(element);
        if (entry && entry.colorHex) return entry.colorHex;
      } catch (e) { /* ignore */ }
    }
    return '#9aa4b2';
  }
  function formulaText(docRef) {
    if (!docRef) return '—';
    if (docRef.meta && docRef.meta.formula) return docRef.meta.formula;
    var modelRef = docRef.model || {};
    var formula = modelRef.formula || (docRef.structure && docRef.structure.formula) || modelRef.cellContents ||
      (docRef.structure && docRef.structure.cellContents) || '';
    return formula || '—';
  }

  // ------------------------------------------------------------- left panel -
  function buildLeftEmpty() {
    var logo = (CL.assets && (CL.assets.icon192 || CL.assets.logo)) || 'assets/icons/icon-192.png';
    return '<div class="section-label">' + esc(t('panel.section.structure')) + '</div>' +
      '<div class="empty-card">' +
      '<img class="empty-card-logo" src="' + esc(logo) + '" alt="">' +
      '<div class="empty-card-text">' + esc(t('panel.empty.hint')) + '</div>' +
      '<button type="button" class="empty-card-btn" data-action="open">' +
      '<span class="ico">' + icon('open', 15) + '</span><span>' + esc(t('viewport.empty.open')) + '</span></button>' +
      '</div>' +
      '<div class="section-label">' + esc(t('panel.section.display')) + '</div>' +
      '<div class="panel-card" style="padding:12px">' +
      '<div class="selection-none">' + esc(t('toast.no-structure')) + '</div>' +
      '<div class="selection-hint" style="margin-top:6px">' + esc(t('viewport.empty.subtitle')) + '</div>' +
      '</div>';
  }
  function buildStructureSection(docRef) {
    var modelRef = docRef.model || {};
    var html = '<div class="section-label">' + esc(t('panel.section.structure')) + '</div>';
    html += '<div class="structure-head">';
    html += '<div class="structure-title" title="' + esc(docRef.title) + '">' + esc(docRef.title || 'CrystalLens') + '</div>';
    html += '<div class="structure-formula">' + esc(formulaText(docRef)) + '</div>';
    html += '<div class="badge-row">';
    html += badge(String(docRef.format || modelRef.format || 'CIF').toUpperCase(), '');
    if (modelRef.hasCell) html += badge(langLabel('panel.badge.periodic'), 'badge-periodic');
    else html += badge(langLabel('panel.badge.molecule'), 'badge-molecule');
    if (docRef.demo) html += badge(langLabel('ui.demo.badge'), 'badge-demo');
    html += '</div></div>';
    if (docRef.demo) {
      html += '<div class="form-note" style="margin-top:8px">' + esc(t('ui.demo.note')) + '</div>';
    }
    // quick add-atom entry (mobile has no menu shortcut)
    html += '<button type="button" class="panel-foot-action" data-action="add-atom" style="min-height:36px;margin-top:8px">' +
      '<span class="ico">' + icon('add-atom', 14) + '</span><span>' + esc(t('ui.add.atom')) + '</span></button>';
    return html;
  }
  function buildCellSection(docRef) {
    var modelRef = docRef.model || {};
    var cell = modelRef.cell || (docRef.structure && docRef.structure.cell) || null;
    var hasCell = !!(modelRef.hasCell && cell);
    var supercell = (CL.App.getSettings().supercell || [1, 1, 1]).join('\u00D7');
    var html = '<div class="section-label">' + esc(t('panel.section.cell')) +
      '<span class="section-tools">' +
      '<button type="button" class="section-extra" data-action="supercell" title="' + esc(t('view.supercell')) + '">' +
      esc(t('panel.cell.supercell-link')) + ' <b>' + esc(supercell) + '</b></button>' +
      (hasCell ? '<button type="button" class="section-link" data-action="edit-cell">' + esc(t('panel.cell.edit')) + '</button>' : '') +
      '</span></div>';
    if (hasCell) {
      html += '<div class="panel-card cell-card">';
      html += '<div class="cell-row">';
      html += '<div class="cell-item"><div class="cell-item-name">a</div><div class="cell-item-value">' + cellFmt(cell.a, 4) + ' \u00C5</div></div>';
      html += '<div class="cell-item"><div class="cell-item-name">b</div><div class="cell-item-value">' + cellFmt(cell.b, 4) + ' \u00C5</div></div>';
      html += '<div class="cell-item"><div class="cell-item-name">c</div><div class="cell-item-value">' + cellFmt(cell.c, 4) + ' \u00C5</div></div>';
      html += '</div>';
      html += '<div class="cell-angles">';
      html += '<span>\u03B1 ' + cellFmt(cell.alpha, 2) + '\u00B0</span>';
      html += '<span>\u03B2 ' + cellFmt(cell.beta, 2) + '\u00B0</span>';
      html += '<span>\u03B3 ' + cellFmt(cell.gamma, 2) + '\u00B0</span>';
      html += '</div>';
      html += '<div class="cell-volume">' + esc(t('common.volume')) + '&nbsp;&nbsp;' + cellFmt(cell.volume, 2) + ' \u00C5\u00B3</div>';
      html += '</div>';
      var stats = modelStats(docRef);
      if (stats.supercellLimited) html += '<div class="form-note" style="margin-top:6px">' + esc(t('viewport.hud.supercell-limited')) + '</div>';
      if (stats.boundaryLimited) html += '<div class="form-note">' + esc(t('viewport.hud.boundary-limited')) + '</div>';
    } else {
      html += '<div class="panel-card cell-none"><span>' + esc(t('panel.badge.molecule')) + '</span>' +
        '<span class="mono">' + esc(t('common.volume')) + ' —</span></div>';
    }
    return html;
  }
  function buildInfoSection(docRef) {
    var modelRef = docRef.model || {};
    var stats = modelStats(docRef);
    var structure = docRef.structure || {};
    var html = '<div class="section-label">' + esc(t('ui.structure.info')) + '</div>';
    html += '<div class="info-rows">';
    html += infoRow(t('common.space-group'), modelRef.spaceGroup || structure.spaceGroup || '—');
    html += infoRow(t('common.symmetry-ops'), String(stats.symmetryOperatorCount || structure.symmetryOperatorCount || (structure.symops ? structure.symops.length : 0) || 1));
    html += infoRow(t('common.asymmetric-unit'), String(stats.asymmetricAtomCount || structure.asymmetricAtomCount || (structure.sites ? structure.sites.length : 0)));
    html += infoRow(t('common.cell-contents'), modelRef.cellContents || structure.cellContents || formulaText(docRef));
    var atomsText = String(stats.visibleAtomCount != null ? stats.visibleAtomCount : (stats.cellAtomCount || 0));
    if (stats.boundaryAtomCount) atomsText += ' (+' + stats.boundaryAtomCount + ')';
    html += infoRow(t('common.atoms'), atomsText);
    html += infoRow(t('common.bonds'), String(stats.visibleBondCount != null ? stats.visibleBondCount : (stats.cellBondCount || 0)));

    if (settings().style === 'polyhedral') {
      var centerCount = stats.polyhedronCenterCount != null ? stats.polyhedronCenterCount : (stats.polyhedronCount || 0);
      html += infoRow(t('panel.style.polyhedral'), (stats.polyhedronCount || 0) + ' / ' + centerCount);
    }
    html += '</div>';
    var note = modelRef.note || structure.note || '';
    if (note) {
      html += '<div class="section-label" style="margin-top:12px">' + esc(t('ui.note')) + '</div>';
      html += '<div class="info-note" title="' + esc(note) + '">' + esc(note) + '</div>';
    }
    return html;
  }
  function buildDisplaySection(docRef) {
    var s = settings();
    var modelRef = docRef.model || {};
    var hasCell = !!modelRef.hasCell;
    return '<div class="section-label">' + esc(t('panel.section.display')) + '</div>' +
      '<div class="toggle-grid">' +
      toggleHtml('toggle-cell', t('panel.display.cell'), !!s.showCell, !hasCell) +
      toggleHtml('toggle-bonds', t('panel.display.bonds'), !!s.showBonds, false) +
      toggleHtml('toggle-labels', t('panel.display.labels'), !!s.showLabels, false) +
      toggleHtml('toggle-boundary', t('panel.display.boundary'), !!s.showBoundary, !hasCell) +
      toggleHtml('toggle-axes', t('panel.display.axes'), !!s.showAxes, false) +
      '</div>';
  }
  function buildAppearanceSection(docRef) {
    var s = settings();
    var styles = [
      { id: 'ball-stick', label: t('panel.style.ball-and-stick') },
      { id: 'space-fill', label: t('panel.style.space-fill') },
      { id: 'polyhedral', label: t('panel.style.polyhedral') }
    ];
    var html = '<div class="section-label">' + esc(t('panel.section.appearance')) +
      '<span class="section-tools"><button type="button" class="section-link" data-action="appearance">' +
      esc(t('panel.appearance.settings')) + '</button></span></div>';
    html += '<div class="seg" role="tablist">';
    for (var i = 0; i < styles.length; i++) {
      html += '<button type="button" class="seg-btn' + (s.style === styles[i].id ? ' is-active' : '') + '" data-action="style-' + styles[i].id + '">' +
        esc(styles[i].label) + '</button>';
    }
    html += '</div>';
    var scalePercent = Math.round((s.atomScale || 0.3) * 100);
    var fill = Math.round(((s.atomScale || 0.3) - 0.15) / (0.85 - 0.15) * 100);
    html += '<div class="slider-row' + (s.style === 'space-fill' ? ' is-disabled' : '') + '">';
    html += '<div class="slider-head"><span class="slider-name">' + esc(t('panel.appearance.atom-size')) + '</span>' +
      '<span class="slider-value" data-role="atom-scale-value">' + scalePercent + '%</span></div>';
    html += '<input type="range" min="0.15" max="0.85" step="0.01" value="' + (s.atomScale || 0.3) + '" ' +
      'data-slider="atomScale" style="--fill:' + fill + '%" aria-label="' + esc(t('panel.appearance.atom-size')) + '">';
    html += '</div>';
    return html;
  }
  function buildElementsSection(docRef) {
    var entries = elementEntries(docRef);
    if (!entries.length) return '';
    var max = 14;
    var html = '<div class="section-label">' + esc(t('panel.section.elements')) + '</div><div class="element-chips">';
    for (var i = 0; i < entries.length && i < max; i++) {
      html += '<span class="element-chip"><span class="chip-dot" style="background:' + esc(colorOfElement(entries[i].element)) + '"></span>' +
        esc(entries[i].element) + ' ' + entries[i].count + '</span>';
    }
    if (entries.length > max) {
      html += '<span class="chip-more">' + esc(t('panel.elements.more', entries.length - max)) + '</span>';
    }
    html += '</div>';
    return html;
  }

  function renderLeft() {
    if (!dom.leftContent) return;
    var scrollTop = dom.leftContent.scrollTop;
    var docRef = doc();
    var html = '';
    if (!docRef) {
      html = buildLeftEmpty();
    } else {
      html += buildStructureSection(docRef);
      html += buildCellSection(docRef);
      html += buildInfoSection(docRef);
      html += buildDisplaySection(docRef);
      html += buildAppearanceSection(docRef);
      html += buildElementsSection(docRef);
      if (docRef.modelNote) html += '<div class="form-note" style="margin-top:10px">' + esc(docRef.modelNote) + '</div>';
    }
    dom.leftContent.innerHTML = html;
    dom.leftContent.scrollTop = scrollTop;
  }

  // ------------------------------------------------------------ right panel -
  function buildSelectionSection(docRef) {
    var html = '<div class="section-label">' + esc(t('panel.section.selection'));
    if (docRef && docRef.selected >= 0) {
      html += '<span class="section-tools"><button type="button" class="section-link" data-action="clear-selection">' +
        esc(t('ui.clear.selection')) + '</button></span>';
    }
    html += '</div>';
    if (!docRef) {
      html += '<div class="panel-card selection-card selection-card-empty">' +
        '<div class="selection-hint">' + esc(t('panel.selection.hint')) + '</div></div>';
      return html;
    }
    var atom = atomById(docRef, docRef.selected);
    if (!atom) {
      html += '<div class="panel-card selection-card selection-card-empty">' +
        '<div class="selection-none">' + esc(t('panel.selection.none')) + '</div>' +
        '<div class="selection-hint">' + esc(t('panel.selection.hint')) + '</div></div>';
      return html;
    }
    var site = siteOf(docRef, atom);
    var structure = docRef.structure || {};
    var frac = atom.frac || (site && site.frac) || null;
    var cart = (site && site.cart) || null;
    if (!cart && frac) {
      // StructureData sites may omit the cartesian coordinates; compute them
      // from the fractional coordinates + cell (never reuse the render-space
      // pos here: that has the model origin subtracted and the supercell shift).
      var cellForCart = docRef.model && docRef.model.cell;
      if (cellForCart && CL.Math && CL.Math.fracToCart) {
        try { cart = CL.Math.fracToCart(cellForCart, frac); } catch (e) { cart = null; }
      }
    }
    var occupancy = atom.occupancy != null ? atom.occupancy : (site && site.occupancy);
    var uiso = atom.hasUiso ? atom.uiso : (site && site.hasUiso ? site.uiso : null);
    var color = colorOfElement(atom.element);
    html += '<div class="panel-card selection-card has-atom">';
    html += '<div class="atom-head">';
    html += '<span class="atom-badge" style="background:' + esc(color) + '">' + esc(atom.element || 'X') + '</span>';
    html += '<span class="atom-head-text"><span class="atom-name">' + esc(atom.label || (atom.element || 'X') + (atom.id + 1)) + '</span>' +
      '<span class="atom-sub">' + esc((atom.element || 'X') + '  \u00B7  Z=' + (atom.z || 0) + '  \u00B7  ' + t('panel.selection.site') + ' ' + (atom.siteId + 1)) + '</span></span>';
    html += '</div>';
    if (frac) {
      html += '<div class="coord-block"><div class="coord-label">' + esc(t('panel.selection.fractional')) + '</div>' +
        '<div class="coord-value">' + esc(ui.fmtVec(frac, 4)) + '</div></div>';
    }
    if (cart) {
      html += '<div class="coord-block"><div class="coord-label">' + esc(t('panel.selection.cartesian')) + '</div>' +
        '<div class="coord-value">' + esc(ui.fmtVec(cart, 3)) + '</div></div>';
    }
    html += '<div class="atom-meta">';
    if (occupancy != null) html += '<span>' + esc(t('dialog.atom.occupancy')) + ' ' + esc(fmtn(occupancy, 2)) + '</span>';
    if (uiso != null) html += '<span>' + esc(t('panel.selection.uiso')) + ' ' + esc(fmtn(uiso, 4)) + '</span>';
    if (atom.symmetryGenerated || atom.symmetryIndex > 0) {
      html += '<span>' + esc(t('panel.selection.symmetry-image')) + ' #' + ((atom.symmetryIndex || 0) + 1) + '</span>';
    }
    html += '</div>';
    html += '<div class="atom-actions">';
    html += '<button type="button" class="atom-action edit" data-action="edit-atom">' + esc(t('panel.selection.edit-atom')) + '</button>';
    html += '<button type="button" class="atom-action delete" data-action="delete-atom">' + esc(t('panel.selection.delete')) + '</button>';
    html += '</div></div>';
    return html;
  }
  function buildMeasurementsSection(docRef) {
    var html = '<div class="section-label">' + esc(t('panel.section.measurements'));
    if (docRef && docRef.measurements.length) {
      html += '<span class="section-tools"><button type="button" class="section-link" data-action="measure-clear" style="color:var(--text-3)">' +
        esc(t('panel.measurements.clear-all')) + '</button></span>';
    }
    html += '</div>';
    var hasDoc = !!docRef;
    var currentMode = CL.App ? CL.App.getMode() : 'none';
    html += '<div class="measure-modes">';
    html += '<button type="button" class="mode-btn distance' + (currentMode === 'distance' ? ' is-active' : '') + (hasDoc ? '' : ' is-disabled') + '" data-action="measure-distance">' +
      '<span class="ico">' + icon('ruler', 15) + '</span><span>' + esc(t('measurement.type.distance')) + '</span></button>';
    html += '<button type="button" class="mode-btn angle' + (currentMode === 'angle' ? ' is-active' : '') + (hasDoc ? '' : ' is-disabled') + '" data-action="measure-angle">' +
      '<span class="ico">' + icon('angle', 15) + '</span><span>' + esc(t('measurement.type.angle')) + '</span></button>';
    html += '</div>';
    if (hasDoc && currentMode !== 'none') {
      var need = currentMode === 'distance' ? 2 : 3;
      var picked = CL.App.getState().pending.length;
      var hint = picked > 0
        ? t('measurement.selected-count', picked, need)
        : t(currentMode === 'distance' ? 'measurement.pick.distance' : 'measurement.pick.angle');
      html += '<div class="measure-hint ' + (currentMode === 'angle' ? 'angle' : 'distance') + '">' + esc(hint) + '</div>';
      html += '<div class="measure-hint" style="color:var(--text-3);margin-top:2px">' + esc(t('ui.measure.exit.hint')) + '</div>';
    }
    if (!docRef || !docRef.measurements.length) {
      html += '<div class="measure-empty-card">' +
        '<div class="measure-empty-title">' + esc(t('panel.measurements.empty')) + '</div>' +
        '<div class="measure-empty-hint">' + esc(t('panel.measurements.empty-hint')) + '</div></div>';
      return html;
    }
    html += '<div class="measure-list">';
    for (var i = 0; i < docRef.measurements.length; i++) {
      var m = docRef.measurements[i];
      html += '<div class="measure-card ' + (m.kind === 'angle' ? 'angle' : 'distance') + '">';
      html += '<span class="measure-strip"></span>';
      html += '<div class="measure-body"><div class="measure-top">' +
        '<span class="measure-type">' + esc(t(m.kind === 'angle' ? 'measurement.type.angle' : 'measurement.type.distance')) + '</span>' +
        '<span class="measure-value">' + esc(m.label) + '</span></div>' +
        '<div class="measure-expr" title="' + esc(m.expression) + '">' + esc(m.expression) + '</div></div>';
      html += '<button type="button" class="measure-remove" data-action="measure-remove" data-index="' + i + '" title="' + esc(t('measurement.remove')) + '">' +
        '<span class="ico">' + icon('close', 11) + '</span></button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderRight() {
    if (!dom.rightContent) return;
    var scrollTop = dom.rightContent.scrollTop;
    var docRef = doc();
    var html = buildSelectionSection(docRef);
    html += buildMeasurementsSection(docRef);
    dom.rightContent.innerHTML = html;
    dom.rightContent.scrollTop = scrollTop;
  }

  // ------------------------------------------------------------------ HUD ---
  function renderHud() {
    var docRef = doc();
    var width = (dom.viewport && dom.viewport.clientWidth) || (CL.App ? CL.App.getViewportSize().width : 0);
    if (dom.hudTitle) {
      if (!docRef) {
        dom.hudTitle.hidden = true;
      } else {
        dom.hudTitle.hidden = false;
        if (dom.hudTitleText) dom.hudTitleText.textContent = docRef.title || 'CrystalLens';
        if (dom.hudTitleSuffix) {
          var stats = modelStats(docRef);
          var suffix = '    \u00B7   ' + String(docRef.format || 'CIF');
          if (width >= 520) {
            if (settings().style === 'polyhedral') {
              var centers = stats.polyhedronCenterCount != null ? stats.polyhedronCenterCount : (stats.polyhedronCount || 0);
              suffix += '   \u00B7   ' + t('panel.style.polyhedral') + ' ' + (stats.polyhedronCount || 0) +
                '   \u00B7   ' + t('common.atoms') + ' ' + centers;
            } else {
              var atoms = stats.visibleAtomCount != null ? stats.visibleAtomCount : (stats.cellAtomCount || 0);
              suffix += '   \u00B7   ' + atoms + ' ' + t('common.atoms');
              // Space-fill hides bonds, so the HUD omits the bond count (matches v1.1).
              if (settings().style !== 'space-fill') {
                var bonds = stats.visibleBondCount != null ? stats.visibleBondCount : (stats.cellBondCount || 0);
                suffix += '   \u00B7   ' + bonds + ' ' + t('common.bonds');
              }
            }
          }
          if (stats.supercellLimited) suffix += '   \u00B7   ' + t('viewport.hud.supercell-limited');
          else if (stats.boundaryLimited) suffix += '   \u00B7   ' + t('viewport.hud.boundary-limited');
          dom.hudTitleSuffix.textContent = suffix;
        }
      }
    }
    // measurement banner
    if (dom.hudBanner) {
      var modeNow = mode();
      if (!docRef || modeNow === 'none') {
        dom.hudBanner.hidden = true;
        dom.hudBanner.classList.remove('angle');
      } else {
        dom.hudBanner.hidden = false;
        dom.hudBanner.classList.toggle('angle', modeNow === 'angle');
        var need = modeNow === 'distance' ? 2 : 3;
        var picked = CL.App.getState().pending.length;
        var typeName = t(modeNow === 'distance' ? 'measure.distance' : 'measure.angle');
        var statusText = picked > 0 ? t('measurement.selected-count', picked, need) :
          t(modeNow === 'distance' ? 'measurement.pick.distance' : 'measurement.pick.angle');
        if (dom.hudBannerText) dom.hudBannerText.textContent = typeName + '   \u00B7   ' + statusText;
      }
    }
    // element legend
    if (dom.hudLegend) {
      var showLegend = !!docRef && width >= 560;
      if (!showLegend) {
        dom.hudLegend.hidden = true;
      } else {
        var entries = elementEntries(docRef).slice(0, 8).sort(function (a, b) {
          return String(a.element).localeCompare(String(b.element));
        });
        if (!entries.length) {
          dom.hudLegend.hidden = true;
        } else {
          dom.hudLegend.hidden = false;
          var html = '';
          for (var i = 0; i < entries.length; i++) {
            html += '<div class="hud-legend-row"><span class="hud-legend-dot" style="background:' +
              esc(colorOfElement(entries[i].element)) + ';color:' + esc(colorOfElement(entries[i].element)) + '"></span>' +
              '<span>' + esc(entries[i].element) + '</span></div>';
          }
          dom.hudLegend.innerHTML = html;
        }
      }
    }
    // bottom hint
    if (dom.hudHint) {
      if (!docRef) {
        dom.hudHint.hidden = true;
      } else {
        dom.hudHint.hidden = false;
        var modeHint = mode();
        if (modeHint === 'distance') dom.hudHint.textContent = t('viewport.hint.measure-distance');
        else if (modeHint === 'angle') dom.hudHint.textContent = t('viewport.hint.measure-angle');
        else {
          var isTouch = (root.navigator && /Android|iPhone|iPad|Mobile/i.test(root.navigator.userAgent || '')) ||
            (root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
          dom.hudHint.textContent = isTouch ? t('ui.help.touch.hint') : t('viewport.hint.navigate');
        }
      }
    }
  }

  // --------------------------------------------------------------- status ----
  function renderStatus() {
    if (!dom.statusText) return;
    var state = CL.App ? CL.App.getState() : {};
    var text = state.hoverText || '';
    if (!text) {
      var status = state.status;
      if (status && status.key) {
        var args = status.args || [];
        text = t.apply(null, [status.key].concat(args));
      }
    }
    dom.statusText.textContent = text || t('status.ready');
    if (dom.statusInfo) {
      var kind = CL.App.getRendererKind ? CL.App.getRendererKind() : 'canvas2d';
      var info = kind === 'webgl2' ? 'WebGL2' : 'Canvas2D';
      if (CL.Native && CL.Native.isAndroid) info += ' \u00B7 Android';
      else info += ' \u00B7 Web';
      if (kind !== 'webgl2') info += ' \u00B7 fallback';
      dom.statusInfo.textContent = info;
    }
    if (dom.statusDot) {
      dom.statusDot.classList.toggle('is-error', !!state.rendererError);
    }
  }

  // -------------------------------------------------------------- overlay ----
  function projectPoint(cam, point, width, height) {
    try { return cam.worldToScreen(point, width, height); } catch (e) { return { x: 0, y: 0, depth: 0, visible: false }; }
  }
  function labelLayer(kind) {
    if (kind === 'measure' && _measureLayer) return _measureLayer;
    if (kind === 'atom' && _atomLayer) return _atomLayer;
    if (!dom.hudLabels) return null;
    var layer = D.createElement('div');
    layer.className = 'hud-label-layer';
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    dom.hudLabels.appendChild(layer);
    if (kind === 'measure') _measureLayer = layer; else _atomLayer = layer;
    return layer;
  }
  function updateMeasureLabels(cam, docRef, width, height) {
    var layer = labelLayer('measure');
    if (!layer) return;
    if (!docRef) {
      if (layer.childNodes.length) layer.innerHTML = '';
      return;
    }
    var measurements = docRef.measurements || [];
    var html = '';
    var placed = [];
    var margin = 20;
    for (var i = 0; i < measurements.length && i < 24; i++) {
      var m = measurements[i];
      var points = m.points || [];
      if (!points.length) continue;
      var world;
      if (m.kind === 'angle' && points.length >= 3) {
        // place the label between the vertex and the midpoint of A/C
        world = [
          (points[0][0] + points[2][0]) / 2 + (points[1][0] - (points[0][0] + points[2][0]) / 2) * 0.35,
          (points[0][1] + points[2][1]) / 2 + (points[1][1] - (points[0][1] + points[2][1]) / 2) * 0.35,
          (points[0][2] + points[2][2]) / 2 + (points[1][2] - (points[0][2] + points[2][2]) / 2) * 0.35
        ];
      } else {
        world = [
          (points[0][0] + points[1][0]) / 2,
          (points[0][1] + points[1][1]) / 2,
          (points[0][2] + points[1][2]) / 2
        ];
      }
      var sp = projectPoint(cam, world, width, height);
      if (!sp.visible) continue;
      var x = sp.x, y = sp.y - 14;
      if (x < margin || y < margin || x > width - margin || y > height - margin) continue;
      var label = m.label || '';
      var boxWidth = String(label).length * 7 + 14;
      var boxHeight = 18;
      var tries = 0;
      while (tries < 5) {
        var collides = false;
        for (var p = 0; p < placed.length; p++) {
          var other = placed[p];
          if (Math.abs(x - other.x) < (boxWidth + other.w) / 2 + 3 &&
            Math.abs(y - other.y) < (boxHeight + other.h) / 2 + 3) {
            collides = true;
            break;
          }
        }
        if (!collides) break;
        y -= boxHeight + 3;
        tries++;
      }
      if (tries >= 5) continue;
      placed.push({ x: x, y: y, w: boxWidth, h: boxHeight });
      html += '<div class="hud-measure-label' + (m.kind === 'angle' ? ' angle' : '') + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px">' +
        esc(label) + '</div>';
    }
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }
  function updateAtomLabels(cam, docRef, width, height) {
    var layer = labelLayer('atom');
    if (!layer) return;
    var show = settings().showLabels && docRef && docRef.model;
    var atoms = (docRef && docRef.model && docRef.model.atoms) || [];
    var limit = width < 600 ? 40 : 90;
    if (!show || atoms.length > 400) {
      if (layer.innerHTML) layer.innerHTML = '';
      return;
    }
    var list = [];
    for (var i = 0; i < atoms.length; i++) {
      var atom = atoms[i];
      if (!atom.pos || atom.kind !== 'cell') continue;
      var sp = projectPoint(cam, atom.pos, width, height);
      if (!sp.visible) continue;
      list.push({ atom: atom, x: sp.x, y: sp.y, depth: sp.depth });
    }
    list.sort(function (a, b) { return b.depth - a.depth; });
    var placed = [];
    var html = '';
    for (var j = 0; j < list.length && placed.length < limit; j++) {
      var item = list[j];
      var text = item.atom.label || item.atom.element || 'X';
      if (text.length > 12) text = text.slice(0, 12) + '\u2026';
      var w = text.length * 5.2 + 6, h = 13;
      var x = item.x + w / 2 + 2, y = item.y - 3;
      if (x - w / 2 < 2 || y < 4 || x + w / 2 > width - 4 || y > height - 4) continue;
      var collides = false;
      for (var p = 0; p < placed.length; p++) {
        if (Math.abs(x - placed[p].x) < (w + placed[p].w) / 2 - 2 &&
          Math.abs(y - placed[p].y) < (h + placed[p].h) / 2 - 2) { collides = true; break; }
      }
      if (collides) continue;
      placed.push({ x: x, y: y, w: w, h: h });
      html += '<div class="hud-atom-label" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px">' + esc(text) + '</div>';
    }
    if (layer.innerHTML !== html) layer.innerHTML = html;
  }
  function drawGizmo(cam, docRef) {
    if (!dom.gizmo) return;
    var canvas = dom.gizmo;
    if (!_gizmoCtx) {
      _gizmoCtx = canvas.getContext('2d');
      if (!_gizmoCtx) return;
    }
    var ctx = _gizmoCtx;
    var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    var size = 88;
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    var cx = size / 2, cy = size * 0.53;
    var axisLength = size * 0.27;
    var axes = [];
    var cell = docRef && docRef.model && docRef.model.cell;
    if (cell && cell.aVec) {
      axes.push({ dir: cell.aVec, color: '#FF6B7A', label: 'a' });
      axes.push({ dir: cell.bVec, color: '#35D3AF', label: 'b' });
      axes.push({ dir: cell.cVec, color: '#5BCCFF', label: 'c' });
    } else {
      axes.push({ dir: [1, 0, 0], color: '#FF6B7A', label: 'a' });
      axes.push({ dir: [0, 1, 0], color: '#35D3AF', label: 'b' });
      axes.push({ dir: [0, 0, 1], color: '#5BCCFF', label: 'c' });
    }
    var right = [1, 0, 0], up = [0, 1, 0], forward = [0, 0, -1];
    if (cam && typeof cam.right === 'function') {
      try {
        right = cam.right();
        up = cam.up();
        forward = cam.forward();
      } catch (e) { /* keep defaults */ }
    }
    var projections = [];
    for (var i = 0; i < axes.length; i++) {
      var dir = axes[i].dir;
      var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
      var nx = dir[0] / len, ny = dir[1] / len, nz = dir[2] / len;
      var sx = (nx * right[0] + ny * right[1] + nz * right[2]) * axisLength;
      var sy = -((nx * up[0] + ny * up[1] + nz * up[2]) * axisLength);
      var depth = nx * forward[0] + ny * forward[1] + nz * forward[2];
      projections.push({ sx: sx, sy: sy, depth: depth, color: axes[i].color, label: axes[i].label });
    }
    projections.sort(function (a, b) { return b.depth - a.depth; });
    for (var j = 0; j < projections.length; j++) {
      var p = projections[j];
      ctx.globalAlpha = p.depth < -0.35 ? 0.55 : 1;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + p.sx, cy + p.sy);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx + p.sx, cy + p.sy, 2.2, 0, TAU);
      ctx.fill();
      ctx.font = '700 9px "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, cx + p.sx * 1.22, cy + p.sy * 1.22);
    }
    ctx.globalAlpha = 1;
  }
  function updateOverlay(cam, docRef, size) {
    if (!cam) return;
    var width = size ? size.width : 1;
    var height = size ? size.height : 1;
    // CONTRACT 5.4: WebGL2 renderer draws measurement lines + value boxes
    // (overlay.measurements = true); the Canvas2D fallback relies on these DOM
    // labels. Gizmo / legend / atom labels stay DOM in both modes.
    var kind = (CL.App && CL.App.getRendererKind) ? CL.App.getRendererKind() : 'canvas2d';
    if (kind === 'canvas2d') {
      updateMeasureLabels(cam, docRef, width, height);
    } else {
      var measureLayer = labelLayer('measure');
      if (measureLayer && measureLayer.innerHTML) measureLayer.innerHTML = '';
    }
    updateAtomLabels(cam, docRef, width, height);
    drawGizmo(cam, docRef);
  }

  // ---------------------------------------------------------------- flash ----
  function showFlash(text) {
    if (!dom.hudFlash) return;
    dom.hudFlash.hidden = false;
    dom.hudFlash.textContent = text || '';
    if (_flashTimer) root.clearTimeout(_flashTimer);
    _flashTimer = root.setTimeout(function () {
      _flashTimer = 0;
      if (dom.hudFlash) dom.hudFlash.hidden = true;
    }, 2400);
  }

  function updateAtomScaleLabel(scale) {
    if (!dom.leftContent) return;
    var valueNode = dom.leftContent.querySelector('[data-role="atom-scale-value"]');
    if (valueNode) valueNode.textContent = Math.round(scale * 100) + '%';
    var slider = dom.leftContent.querySelector('[data-slider="atomScale"]');
    if (slider) {
      var percent = Math.round((scale - 0.15) / (0.85 - 0.15) * 100);
      slider.style.setProperty('--fill', percent + '%');
    }
  }

  function renderAll() {
    renderLeft();
    renderRight();
    renderHud();
    renderStatus();
  }

  function init() {
    var ids = {
      left: 'left-content', right: 'right-content', hudTitle: 'hud-title', hudTitleText: 'hud-title-text',
      hudTitleSuffix: 'hud-title-suffix', hudBanner: 'hud-banner', hudBannerText: 'hud-banner-text',
      hudLegend: 'hud-legend', hudHint: 'hud-hint', hudFlash: 'hud-flash', hudLabels: 'hud-labels',
      gizmo: 'gizmo', statusText: 'status-text', statusInfo: 'status-info', statusDot: 'status-dot',
      viewport: 'viewport'
    };
    for (var key in ids) {
      if (Object.prototype.hasOwnProperty.call(ids, key)) dom[key] = D.getElementById(ids[key]);
    }
    dom.leftContent = D.getElementById('left-content');
    dom.rightContent = D.getElementById('right-content');
  }

  CL.ui.panels = {
    init: init,
    renderAll: renderAll,
    renderLeft: renderLeft,
    renderRight: renderRight,
    renderHud: renderHud,
    renderStatus: renderStatus,
    updateOverlay: updateOverlay,
    showFlash: showFlash,
    updateAtomScaleLabel: updateAtomScaleLabel
  };
  panels = CL.ui.panels;
})(typeof globalThis !== 'undefined' ? globalThis : this);
