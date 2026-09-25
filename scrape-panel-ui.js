/**
 * Scan-panel presentation helpers. DOM wiring stays in scrape.js;
 * colors and Inter Tight mirror tokens.css. The panel lives in a shadow root,
 * so font files are loaded with chrome.runtime.getURL (see manifest
 * web_accessible_resources). The panel stays light even on a dark LinkedIn page.
 */
(function (root) {
  'use strict';

  function shouldShowGoToResults(state) {
    var s = state || {};
    if (s.scanning) return false;
    if (s.failed && !s.hasSnapshot) return false;
    return !!s.hasSnapshot;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Internal end reasons must never reach the status line.
   * Returns a Turkish phrase only for codes we explicitly translate;
   * unknown codes (including reached_total) become an empty string.
   */
  function humanEndReason(code) {
    if (code == null || code === '') return '';
    var known = {
      reached_total: '',
      done: '',
      no_next_button: '',
      no_matches: '',
      outside_range: '',
      max_pages: '',
      no_rows: '',
      no_new_rows: '',
      next_disabled: '',
      next_click_failed: '',
      list_unchanged: '',
      initial_blob: '',
      replay_error: '',
      no_capture: '',
      low_yield: '',
    };
    var key = String(code);
    if (Object.prototype.hasOwnProperty.call(known, key)) return known[key];
    if (/^[a-z0-9_]+$/i.test(key)) return '';
    return '';
  }

  function shouldCollapseOnMount(_opts) {
    // In-page launcher pill is retired. Reopen only from the toolbar popup.
    return false;
  }

  function phaseLabel(phase) {
    if (phase === 'scanning') return 'Taranıyor';
    if (phase === 'done') return 'Tamamlandı';
    if (phase === 'stopped') return 'Durduruldu';
    if (phase === 'error') return 'Sorun';
    return 'Hazır';
  }

  function channel(c) {
    c = Number(c) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function parseRgb(str) {
    var m = String(str || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  }

  function isDarkRgb(rgb) {
    if (!rgb || rgb.a === 0) return null;
    var L = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    return L < 0.45;
  }

  function readHostTheme(doc) {
    if (!doc || !doc.documentElement) return 'light';
    var cls =
      String(doc.documentElement.className || '') +
      ' ' +
      String((doc.body && doc.body.className) || '');
    var view = doc.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      var nodes = [doc.body, doc.documentElement];
      var i;
      for (i = 0; i < nodes.length; i++) {
        if (!nodes[i]) continue;
        var dark = isDarkRgb(parseRgb(view.getComputedStyle(nodes[i]).backgroundColor));
        if (dark === true) return 'dark';
        if (dark === false) return 'light';
      }
    }
    if (/theme--dark|theme-dark|\bdark-theme\b/i.test(cls)) return 'dark';
    try {
      if (view && view.matchMedia && view.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (_) {}
    return 'light';
  }

  // LinkedIn sets box model, padding and white-space on the light-DOM host.
  // Those author !important rules beat :host, so the lock has to be inline.
  function setImp(el, prop, value) {
    if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
    el.style.setProperty(prop, value, 'important');
  }

  function lockHostBox(panel) {
    if (!panel || !panel.style || typeof panel.style.setProperty !== 'function') return;
    // LinkedIn author !important rules beat :host. Inline important keeps the
    // panel fixed and above the jobs-tracker scaffold.
    setImp(panel, 'position', 'fixed');
    setImp(panel, 'z-index', '2147483646');
    setImp(panel, 'display', 'flex');
    setImp(panel, 'box-sizing', 'border-box');
    setImp(panel, 'margin', '0');
    setImp(panel, 'padding', '0');
    setImp(panel, 'min-width', '0');
    setImp(panel, 'white-space', 'normal');
  }

  function watchHostTheme(panel, doc) {
    if (!panel) return;
    lockHostBox(panel);
    function apply() {
      panel.removeAttribute('data-theme');
    }
    apply();
    installPanel(panel, doc);
    if (panel.__btThemeWatch || typeof MutationObserver === 'undefined' || !doc) return;
    panel.__btThemeWatch = true;
    var obs = new MutationObserver(apply);
    obs.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (doc.body) obs.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  }

  var MSG_SELECTORS = [
    '#msg-overlay',
    '.msg-overlay-list-bubble',
    '.msg-overlay-container',
    '[data-bt-messaging]',
  ];
  var NAV_SELECTORS = [
    'header.global-nav',
    '#global-nav',
    '.global-nav',
    'header[role="banner"]',
    '[data-bt-topnav]',
  ];

  function rectsIntersect(a, b) {
    if (!a || !b) return false;
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  /**
   * Place the panel below the top nav and above the messaging overlay.
   * messagingTop null → fallback bottom margin (72px).
   */
  function computePanelBox(opts) {
    var o = opts || {};
    var vw = Number(o.viewportWidth) || 0;
    var vh = Number(o.viewportHeight) || 0;
    var navBottom = o.navBottom == null ? 52 : Number(o.navBottom);
    var edge = 16;
    var gap = 8;
    var fallbackBottom = 72;
    var top = Math.round(navBottom + edge);
    var bottomLimit =
      o.messagingTop == null ? fallbackBottom : Math.max(edge, vh - Number(o.messagingTop) + gap);
    var maxHeight = Math.max(56, vh - top - bottomLimit);
    var width = Math.min(360, Math.max(0, vw - edge * 2));
    return {
      top: top,
      right: edge,
      width: width,
      maxHeight: maxHeight,
      bottomLimit: bottomLimit,
    };
  }

  function formatRunningLabel(text) {
    var t = String(text || '').trim();
    if (/^Çalışıyor(?:\.{2,}|…)$/.test(t)) return 'Taranıyor…';
    return t;
  }

  function formatFeedWhen(text) {
    return String(text == null ? '' : text).replace(/başvurdu(?!n)\b/g, 'başvurdun');
  }

  /** Positive finite totals are known. null, undefined, 0, NaN and "null" are not. */
  function parseKnownTotal(total) {
    if (total == null) return null;
    if (typeof total === 'string') {
      var token = total.trim().toLowerCase();
      if (!token || token === 'null' || token === 'undefined' || token === 'nan') return null;
      total = Number(token);
    }
    var n = Number(total);
    if (!isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  }

  function readTotalField(obj) {
    if (!obj || typeof obj !== 'object') return { provided: false, value: undefined };
    if ('total' in obj) return { provided: true, value: obj.total };
    if ('totalExpected' in obj) return { provided: true, value: obj.totalExpected };
    return { provided: false, value: undefined };
  }

  var MODE_PREFIX_RE = /(?:Sayfa sayfa tarama|Sayfa modu|Hızlı tarama|Hızlı mod(?:\s*\([^)]*\))?)\s*·\s*/gi;

  function cleanJoins(text) {
    return String(text || '')
      .replace(/\s*·\s*·\s*/g, ' · ')
      .replace(/^\s*·\s*/, '')
      .replace(/\s*·\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function explicitScanMode(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (obj.mode === 'api' || obj.mode === 'page') return obj.mode;
    return '';
  }

  function detectScanMode(text, meta) {
    var explicit = explicitScanMode(meta);
    if (explicit) return explicit;
    var raw = String(text || '');
    if (/^\s*(?:Hızlı tarama|Hızlı mod)\b/i.test(raw)) return 'api';
    if (/^\s*(?:Sayfa modu|Sayfa sayfa tarama)\b/i.test(raw) || /\d+\.\s*sayfa/i.test(raw)) return 'page';
    return '';
  }

  /** Explicit api|page on the message wins, then the second argument. Anything else is ignored. */
  function modeSource(raw, meta) {
    if (explicitScanMode(raw)) return raw;
    if (explicitScanMode(meta)) return meta;
    if (meta && typeof meta === 'object') return meta;
    if (raw && typeof raw === 'object') return raw;
    return null;
  }

  /**
   * Progress line keeps the scan mode in plain language.
   * API: "Hızlı tarama · 20 başvuru okundu"
   * Page: "Sayfa sayfa tarama · 2. sayfa · 20 başvuru okundu"
   * "/ N" only when the total is a finite number greater than 0.
   * raw may be a string or { text, count, total, mode }.
   * mode is used only when it is exactly 'api' or 'page'.
   * Any other value, including 'dom', falls back to the text
   * ("Hızlı tarama" / "Hızlı mod" / "Sayfa modu" / "N. sayfa").
   */
  function formatPanelStatus(raw, meta) {
    var text = '';
    var count = null;
    var totalInfo = { provided: false, value: undefined };
    if (raw && typeof raw === 'object') {
      text = String(raw.text != null ? raw.text : raw.message != null ? raw.message : raw.status != null ? raw.status : '');
      if (raw.count != null && raw.count !== '') count = Number(raw.count);
      totalInfo = readTotalField(raw);
    } else {
      text = String(raw == null ? '' : raw);
    }
    if (meta && typeof meta === 'object') {
      if (meta.count != null && meta.count !== '') count = Number(meta.count);
      var fromMeta = readTotalField(meta);
      if (fromMeta.provided) totalInfo = fromMeta;
    }
    var scanMode = detectScanMode(text, modeSource(raw, meta));
    text = text.replace(/\s+/g, ' ').trim();
    text = text.replace(MODE_PREFIX_RE, '');
    text = cleanJoins(text);

    var pageNum = '';
    if (scanMode !== 'api') {
      var pageMatch = text.match(/(\d+)\.\s*sayfa(?:\s+taranıyor)?/i);
      if (pageMatch) {
        pageNum = pageMatch[1];
        text = cleanJoins(text.replace(pageMatch[0], ''));
        if (!scanMode) scanMode = 'page';
      }
    }

    var slash = text.match(/(\d+)\s*\/\s*(null|undefined|nan|\d+)/i);
    if ((count == null || !isFinite(count)) && slash) count = parseInt(slash[1], 10);
    if (count != null && isFinite(count)) count = Math.max(0, Math.floor(count));
    else count = null;

    var known = totalInfo.provided ? parseKnownTotal(totalInfo.value) : slash ? parseKnownTotal(slash[2]) : null;
    if (known != null && count != null && known < count) known = null;

    if (known != null) {
      var shown = count != null ? count : known;
      var label = shown + ' / ' + known;
      if (slash) text = text.replace(slash[0], label);
      else if (!new RegExp('(?:^|\\s)' + shown + '\\s*/\\s*' + known + '(?:\\s|$)').test(text)) {
        text = text ? text + ' · ' + label : label;
      }
    } else {
      if (slash && count != null) text = text.replace(slash[0], count + ' başvuru okundu');
      else if (count != null && /^\d+$/.test(text)) text = count + ' başvuru okundu';
      else text = text.replace(/(\d+)\s+başvuru(?!\s+okundu)\b/gi, '$1 başvuru okundu');
      if (count != null && count > 0 && !/başvuru okundu/.test(text)) {
        text = text ? text + ' · ' + count + ' başvuru okundu' : count + ' başvuru okundu';
      }
    }
    text = cleanJoins(text);

    var parts = [];
    if (scanMode === 'api') parts.push('Hızlı tarama');
    else if (scanMode === 'page') parts.push('Sayfa sayfa tarama');
    if (scanMode === 'page' && pageNum) parts.push(pageNum + '. sayfa');
    if (text) parts.push(text);
    return {
      text: parts.join(' · '),
      knownTotal: known != null,
      scanMode: scanMode,
    };
  }

  function formatMiniStatus(text) {
    var full = String(text || '').trim();
    var short = full.replace(/^(?:Hızlı tarama|Sayfa sayfa tarama)\s*·\s*/i, '').trim();
    return short || full;
  }

  function rememberScanMode(panel, mode) {
    if (!panel) return;
    if (mode === 'api' || mode === 'page') panel.setAttribute('data-scan-mode', mode);
    else panel.removeAttribute('data-scan-mode');
  }

  function externalLinkRel() {
    return 'noopener noreferrer';
  }

  function statusFromElement(el) {
    if (!el) return formatPanelStatus('');
    if (el.hasAttribute('data-total')) {
      var raw = el.getAttribute('data-total');
      var total = raw == null || raw === '' || raw === 'null' || raw === 'undefined' ? null : raw;
      return formatPanelStatus(el.textContent, { total: total });
    }
    return formatPanelStatus(el.textContent);
  }

  function shadowQuery(panel, sel) {
    if (!panel) return null;
    var root = panel.shadowRoot || panel;
    return root.querySelector(sel);
  }

  function measureNavBottom(doc, view) {
    var vh = (view && view.innerHeight) || 800;
    var best = 0;
    var i;
    var j;
    for (i = 0; i < NAV_SELECTORS.length; i++) {
      var nodes = doc.querySelectorAll(NAV_SELECTORS[i]);
      for (j = 0; j < nodes.length; j++) {
        var r = nodes[j].getBoundingClientRect();
        if (r.height < 20 || r.bottom <= 0 || r.top > 80) continue;
        if (r.bottom > best && r.bottom < vh * 0.5) best = r.bottom;
      }
    }
    return best || 52;
  }

  function measureMessagingRect(doc, view) {
    var vw = (view && view.innerWidth) || 1280;
    var vh = (view && view.innerHeight) || 800;
    var best = null;
    var bestArea = 0;
    var i;
    var j;
    for (i = 0; i < MSG_SELECTORS.length; i++) {
      var nodes = doc.querySelectorAll(MSG_SELECTORS[i]);
      for (j = 0; j < nodes.length; j++) {
        var r = nodes[j].getBoundingClientRect();
        if (r.width < 80 || r.height < 24) continue;
        if (r.right < vw * 0.45) continue;
        if (r.bottom < vh * 0.5) continue;
        var area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          best = { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        }
      }
    }
    return best;
  }

  function layoutPanel(panel) {
    if (!panel || panel.classList.contains('bsp-dragging')) return;
    var doc = panel.ownerDocument;
    if (!doc) return;
    var view = doc.defaultView || root;
    var navBottom = measureNavBottom(doc, view);
    var msg = measureMessagingRect(doc, view);
    var box = computePanelBox({
      viewportWidth: view.innerWidth,
      viewportHeight: view.innerHeight,
      navBottom: navBottom,
      messagingTop: msg ? msg.top : null,
    });
    var collapsed = panel.classList.contains('bsp-collapsed');
    var leftVal = panel.style.getPropertyValue('left');
    var placed = !!leftVal && leftVal !== 'auto';
    if (!placed) {
      var widthPx = box.width >= 160 ? box.width : 360;
      setImp(panel, 'top', box.top + 'px');
      setImp(panel, 'right', box.right + 'px');
      setImp(panel, 'left', 'auto');
      setImp(panel, 'bottom', 'auto');
      setImp(panel, 'max-width', 'calc(100vw - 32px)');
      setImp(panel, 'width', collapsed ? 'auto' : widthPx + 'px');
    }
    if (collapsed) {
      setImp(panel, 'height', 'auto');
      setImp(panel, 'max-height', 'none');
      return;
    }
    var limitTop = msg ? msg.top - 8 : view.innerHeight - 72;
    var originTop = placed ? panel.getBoundingClientRect().top : box.top;
    if (originTop < navBottom + 8) {
      originTop = navBottom + 16;
      setImp(panel, 'top', Math.round(originTop) + 'px');
    }
    var cap = Math.max(56, Math.round(limitTop - originTop));
    setImp(panel, 'max-height', cap + 'px');
    setImp(panel, 'height', 'auto');
    if (panel.scrollHeight > cap + 1) setImp(panel, 'height', cap + 'px');
  }

  function setMinimized(panel, on) {
    if (!panel) return;
    panel.classList.toggle('bsp-min', !!on);
    var expanded = !on;
    var buttons = [];
    var a = shadowQuery(panel, '#basvuru-scrape-min');
    var b = shadowQuery(panel, '#basvuru-scrape-expand');
    if (a) buttons.push(a);
    if (b) buttons.push(b);
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-expanded', expanded ? 'true' : 'false');
      buttons[i].setAttribute('aria-label', expanded ? 'Küçült' : 'Genişlet');
    }
    layoutPanel(panel);
  }

  function bindRewriter(el, format, emphasize) {
    if (!el || typeof MutationObserver === 'undefined') {
      if (el) {
        var once = format(el.textContent);
        if (once !== el.textContent) el.textContent = once;
        if (emphasize) paintCounts(el);
      }
      return;
    }
    var lock = false;
    function paint() {
      if (lock) return;
      var next = format(el.textContent);
      lock = true;
      if (next !== el.textContent) el.textContent = next;
      if (emphasize) paintCounts(el);
      lock = false;
    }
    paint();
    var mo = new MutationObserver(paint);
    mo.observe(el, { characterData: true, subtree: true, childList: true });
  }

  function syncMini(panel) {
    var phase = shadowQuery(panel, '#basvuru-scrape-phase');
    var phaseMini = shadowQuery(panel, '#basvuru-scrape-phase-mini');
    if (phase && phaseMini && phaseMini.textContent !== phase.textContent) phaseMini.textContent = phase.textContent;
    var status = shadowQuery(panel, '#basvuru-scrape-status');
    var statusMini = shadowQuery(panel, '#basvuru-scrape-status-mini');
    if (status && statusMini) {
      var mini = formatMiniStatus(status.textContent);
      if (statusMini.textContent !== mini) statusMini.textContent = mini;
      paintCounts(statusMini);
    }
    var bar = shadowQuery(panel, '#basvuru-scrape-bar');
    var barMini = shadowQuery(panel, '#basvuru-scrape-bar-mini');
    if (bar && barMini && barMini.style.width !== bar.style.width) barMini.style.width = bar.style.width;
    var prog = shadowQuery(panel, '#basvuru-scrape-progress');
    var progMini = shadowQuery(panel, '#basvuru-scrape-progress-mini');
    if (prog && progMini) {
      progMini.classList.toggle('is-indeterminate', prog.classList.contains('is-indeterminate'));
    }
  }

  function applyProgressMode(panel) {
    var statusEl = shadowQuery(panel, '#basvuru-scrape-status');
    var prog = shadowQuery(panel, '#basvuru-scrape-progress');
    var rootEl = shadowQuery(panel, '.bsp-root');
    if (!statusEl || !prog) return;
    var formatted = statusFromElement(statusEl);
    rememberScanMode(panel, formatted.scanMode);
    var phase = rootEl ? rootEl.getAttribute('data-phase') : '';
    var scanning = phase === 'scanning' || /taranıyor/i.test(formatted.text);
    var indeterminate = scanning && !formatted.knownTotal;
    prog.classList.toggle('is-indeterminate', indeterminate);
    if (indeterminate) prog.removeAttribute('aria-valuenow');
    syncMini(panel);
  }

  function paintFeed(panel) {
    var feed = shadowQuery(panel, '#basvuru-scrape-feed');
    if (!feed) return;
    var rows = feed.querySelectorAll('.bsp-when');
    var i;
    for (i = 0; i < rows.length; i++) {
      var next = formatFeedWhen(rows[i].textContent);
      if (next !== rows[i].textContent) rows[i].textContent = next;
    }
  }

  function fixBlankLinks(panel) {
    var scope = panel.shadowRoot || panel;
    var links = scope.querySelectorAll('a[target="_blank"]');
    var i;
    for (i = 0; i < links.length; i++) links[i].setAttribute('rel', externalLinkRel());
  }

  var ARROWS_MOVE_D =
    'M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8';

  // Bootstrap Icons arrows-move. MIT License.
  // Copyright (c) 2019-2024 The Bootstrap Authors.
  // https://github.com/twbs/icons
  function mountDragGrip(panel) {
    var scope = panel && panel.shadowRoot ? panel.shadowRoot : panel;
    if (!scope || typeof scope.querySelector !== 'function') return;
    var grip = scope.querySelector('.bsp-grip');
    if (!grip || (typeof grip.querySelector === 'function' && grip.querySelector('svg'))) return;
    var doc = grip.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElementNS !== 'function') return;
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ARROWS_MOVE_D);
    svg.appendChild(path);
    grip.textContent = '';
    grip.appendChild(svg);
  }

  function installPanel(panel, doc) {
    if (!panel) return;
    mountDragGrip(panel);
    if (panel.__btPanelInstalled) return;
    panel.__btPanelInstalled = true;
    doc = doc || panel.ownerDocument;
    panel.setAttribute('lang', 'tr');
    panel.setAttribute('aria-label', 'Başvuru İstatistikleri');
    fixBlankLinks(panel);
    var minBtn = shadowQuery(panel, '#basvuru-scrape-min');
    var expBtn = shadowQuery(panel, '#basvuru-scrape-expand');
    function toggleMin() {
      setMinimized(panel, !panel.classList.contains('bsp-min'));
    }
    if (minBtn) minBtn.addEventListener('click', toggleMin);
    if (expBtn) expBtn.addEventListener('click', toggleMin);
    ensureDocumentFonts(doc);
    bindRewriter(shadowQuery(panel, '#basvuru-scrape-status'), function () {
      return statusFromElement(shadowQuery(panel, '#basvuru-scrape-status')).text;
    }, true);
    bindRewriter(shadowQuery(panel, '#basvuru-scrape-start'), formatRunningLabel);
    var statusEl = shadowQuery(panel, '#basvuru-scrape-status');
    if (statusEl && typeof MutationObserver !== 'undefined') {
      var statusMo = new MutationObserver(function () {
        applyProgressMode(panel);
        syncMini(panel);
      });
      statusMo.observe(statusEl, { characterData: true, subtree: true, childList: true });
    }
    var phaseEl = shadowQuery(panel, '#basvuru-scrape-phase');
    if (phaseEl && typeof MutationObserver !== 'undefined') {
      var phaseMo = new MutationObserver(function () {
        syncMini(panel);
        applyProgressMode(panel);
      });
      phaseMo.observe(phaseEl, { characterData: true, subtree: true, childList: true });
    }
    var bar = shadowQuery(panel, '#basvuru-scrape-bar');
    if (bar && typeof MutationObserver !== 'undefined') {
      var barMo = new MutationObserver(function () {
        syncMini(panel);
      });
      barMo.observe(bar, { attributes: true, attributeFilter: ['style'] });
    }
    var feed = shadowQuery(panel, '#basvuru-scrape-feed');
    if (feed && typeof MutationObserver !== 'undefined') {
      var feedMo = new MutationObserver(function () {
        paintFeed(panel);
        layoutPanel(panel);
      });
      feedMo.observe(feed, { childList: true, subtree: true, characterData: true });
    }
    paintFeed(panel);
    applyProgressMode(panel);
    syncMini(panel);
    if (typeof MutationObserver !== 'undefined') {
      var classMo = new MutationObserver(function () {
        if (panel.classList.contains('bsp-collapsed')) panel.__btWasCollapsed = true;
        else if (panel.__btWasCollapsed) {
          panel.__btWasCollapsed = false;
          if (panel.classList.contains('bsp-min')) panel.classList.remove('bsp-min');
          setMinimized(panel, false);
        }
        layoutPanel(panel);
      });
      classMo.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    var view = doc && doc.defaultView;
    if (view) view.addEventListener('resize', function () { layoutPanel(panel); });
    if (doc && doc.body && typeof MutationObserver !== 'undefined') {
      var pageMo = new MutationObserver(function () { layoutPanel(panel); });
      pageMo.observe(doc.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
    }
    if (view && typeof view.ResizeObserver !== 'undefined' && doc) {
      var ro = new view.ResizeObserver(function () { layoutPanel(panel); });
      var k;
      for (k = 0; k < MSG_SELECTORS.length; k++) {
        var found = doc.querySelectorAll(MSG_SELECTORS[k]);
        var n;
        for (n = 0; n < found.length; n++) ro.observe(found[n]);
      }
    }
    layoutPanel(panel);
  }

  function iconButton(id, label, expanded, glyph) {
    return (
      '<button type="button" class="bsp-icon" id="' +
      id +
      '" aria-label="' +
      label +
      '"' +
      (expanded == null ? '' : ' aria-expanded="' + (expanded ? 'true' : 'false') + '"') +
      '><span aria-hidden="true">' +
      glyph +
      '</span></button>'
    );
  }

  function panelInnerHtml(opts) {
    opts = opts || {};
    return (
      '<div class="bsp-mini">' +
      '<div class="bsp-mini-top">' +
      '<div class="bsp-title">Başvuru İstatistikleri</div>' +
      '<span class="bsp-phase" id="basvuru-scrape-phase-mini">Hazır</span>' +
      iconButton('basvuru-scrape-expand', 'Genişlet', false, '▢') +
      '</div>' +
      '<div class="bsp-mini-status" id="basvuru-scrape-status-mini"></div>' +
      '<div class="bsp-bar bsp-bar-mini" id="basvuru-scrape-progress-mini" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Tarama ilerlemesi"><div id="basvuru-scrape-bar-mini" class="bsp-bar-fill"></div></div>' +
      '<button id="basvuru-scrape-stop-mini" type="button" class="bsp-stop" hidden>Durdur</button>' +
      '</div>' +
      '<div class="bsp-body">' +
      '<div class="bsp-head">' +
      '<span class="bsp-grip" role="img" aria-label="Paneli ta\u015f\u0131"></span>' +
      '<div class="bsp-title" id="basvuru-scrape-title">Başvuru İstatistikleri</div>' +
      '<span class="bsp-phase" id="basvuru-scrape-phase">Hazır</span>' +
      iconButton('basvuru-scrape-min', 'Küçült', true, '–') +
      iconButton('basvuru-scrape-close', 'Kapat', null, '×') +
      '</div>' +
      '<div class="bsp-field">' +
      '<label class="bsp-range-label" for="basvuru-scrape-range">Zaman aralığı</label>' +
      '<select id="basvuru-scrape-range" class="bsp-range">' +
      (opts.rangeOptionsHtml || '') +
      '</select>' +
      '</div>' +
      '<div id="basvuru-scrape-status" class="bsp-status" role="status" aria-live="polite"></div>' +
      '<div class="bsp-bar" id="basvuru-scrape-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Tarama ilerlemesi"><div id="basvuru-scrape-bar" class="bsp-bar-fill"></div></div>' +
      '<div id="basvuru-scrape-keepopen" class="bsp-keepopen" hidden></div>' +
      '<div class="bsp-field bsp-feed-block">' +
      '<div class="bsp-feed-label">Son okunanlar</div>' +
      '<div id="basvuru-scrape-feed" class="bsp-feed"></div>' +
      '</div>' +
      '<div class="bsp-actions">' +
      '<button id="basvuru-scrape-stop" type="button" class="bsp-stop" hidden>Durdur</button>' +
      '<button id="basvuru-scrape-results" type="button" class="bsp-results" hidden>Sonuçlara git</button>' +
      '<button id="basvuru-scrape-start" type="button" class="bsp-start">Başlat</button>' +
      '</div>' +
      (opts.creditHtml || '') +
      '</div>'
    );
  }

  var FONT_LATIN_EXT =
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  var FONT_LATIN =
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

  function fontFileUrl(name) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL('fonts/' + name);
      }
    } catch (e) {}
    return 'fonts/' + name;
  }

  function fontFaceCss() {
    var weights = [400, 500, 600, 700];
    var css = '';
    var i;
    for (i = 0; i < weights.length; i++) {
      var w = weights[i];
      css +=
        '@font-face{font-family:"Inter Tight";font-style:normal;font-weight:' +
        w +
        ';font-display:swap;src:url("' +
        fontFileUrl('inter-tight-latin-ext-' + w + '.woff2') +
        '") format("woff2");unicode-range:' +
        FONT_LATIN_EXT +
        '}';
      css +=
        '@font-face{font-family:"Inter Tight";font-style:normal;font-weight:' +
        w +
        ';font-display:swap;src:url("' +
        fontFileUrl('inter-tight-latin-' + w + '.woff2') +
        '") format("woff2");unicode-range:' +
        FONT_LATIN +
        '}';
    }
    return css;
  }

  function ensureDocumentFonts(doc) {
    if (!doc || !doc.head || doc.getElementById('bt-inter-tight')) return;
    var style = doc.createElement('style');
    style.id = 'bt-inter-tight';
    style.textContent = fontFaceCss();
    doc.head.appendChild(style);
  }

  function countsLookPainted(el, text) {
    if (el.__btCountText !== text) return false;
    if (!/\d/.test(text)) return true;
    return !!el.querySelector('b.stat');
  }

  function paintCounts(el) {
    if (!el) return;
    var text = el.textContent;
    if (countsLookPainted(el, text)) return;
    el.__btCountText = text;
    var html = escapeHtml(text).replace(/(%?\d[\d.,]*)/g, '<b class="stat">$1</b>');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function panelCss() {
    return (
      fontFaceCss() +
      ':host{color-scheme:light;--font:\"Inter Tight\",Inter,\"Segoe UI\",sans-serif;' +
      '--paper:#ffffff;--card:#ffffff;--sand:#f3f8fc;--ink:#1d2226;--muted:#3d4c5c;--line:#d6e0e8;' +
      '--focus:#0a66c2;--accent:#0a66c2;--accent-pressed:#004182;--accent-disabled:#8eb4d8;--on-accent:#fff;' +
      '--accent-text:#0a66c2;--ok:#1f6b3a;--danger:#9f2b2b;--danger-soft:#fdecec;' +
      'position:fixed;top:68px;right:16px;z-index:1000;width:360px;max-width:calc(100vw - 32px);container-type:inline-size;' +
      'display:flex;flex-direction:column;overflow:hidden;margin:0 !important;padding:0 !important;' +
      'box-sizing:border-box !important;min-width:0 !important;white-space:normal !important;' +
      'background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:12px;' +
      'box-shadow:0 12px 32px rgba(16,42,67,.12);font:400 13px/1.45 var(--font);}' +
      ':host(.bsp-collapsed){display:none !important}' +
      ':host(.bsp-min){height:auto;}' +
      '*,*::before,*::after{box-sizing:border-box;min-width:0;max-width:100%}' +
      '.bsp-root{display:flex;flex-direction:column;min-width:0;min-height:0;max-width:100%;flex:1 1 auto;overflow:hidden;white-space:normal;overflow-wrap:anywhere}' +
      ':host(.bsp-min) .bsp-body{display:none}' +
      ':host(.bsp-min) .bsp-mini{display:flex}' +
      '.bsp-mini{display:none;flex-direction:column;gap:2px;padding:4px 16px 6px;min-width:0;max-width:100%}' +
      '.bsp-mini-top{display:flex;align-items:center;gap:8px;min-width:0;min-height:32px}' +
      '.bsp-mini-status{font:500 12px/1.2 var(--font);color:var(--ink);overflow-wrap:anywhere;min-width:0;max-width:100%}' +
      '.bsp-body{display:flex;flex-direction:column;gap:12px;padding:16px;min-width:0;min-height:0;max-width:100%;flex:1 1 auto;overflow:hidden}' +
      '.bsp-head,.bsp-field,.bsp-actions,.bsp-feed,.bsp-row,.bsp-credit{min-width:0;max-width:100%}' +
      '.bsp-head{display:flex;align-items:center;gap:2px;margin:0;cursor:grab;touch-action:none;user-select:none}' +
      ':host(.bsp-dragging) .bsp-head,:host(.bsp-dragging) .bsp-head *{cursor:grabbing}' +
      '.bsp-grip{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--ink);opacity:.6;cursor:move;line-height:0}' +
      '.bsp-grip:hover,.bsp-grip:focus-visible{opacity:1}' +
      '.bsp-grip svg{display:block;width:16px;height:16px;max-width:none}' +
      '.bsp-title{font:600 16px/1.25 var(--font);letter-spacing:-.02em;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}' +
      '.bsp-head .bsp-title{flex:1 1 auto;min-width:0;overflow-wrap:normal;word-break:normal}' +
      '@container (max-width:340px){.bsp-head{gap:0}.bsp-head .bsp-grip{margin-right:4px}.bsp-head .bsp-title{font-size:13px;letter-spacing:-.03em}}' +
      '.bsp-phase{flex:0 1 auto;max-width:46%;font:600 12px/1.2 var(--font);padding:4px 8px;border-radius:999px;border:1px solid var(--line);color:var(--ink);background:var(--sand);overflow-wrap:anywhere}' +
      '.bsp-head .bsp-phase{flex-shrink:0;max-width:none;white-space:nowrap;overflow-wrap:normal;word-break:normal}' +
      '.bsp-head .bsp-icon{width:26px;height:26px}' +
      '.bsp-root[data-phase="scanning"] .bsp-phase{border-color:var(--accent-text);color:var(--accent-text)}' +
      '.bsp-root[data-phase="done"] .bsp-phase{border-color:var(--ok);color:var(--ok)}' +
      '.bsp-root[data-phase="stopped"] .bsp-phase{border-color:var(--muted);color:var(--ink)}' +
      '.bsp-root[data-phase="error"] .bsp-phase{border-color:var(--danger);color:var(--danger);background:var(--danger-soft)}' +
      '.bsp-icon{flex:none;width:32px;height:32px;padding:0;border-radius:8px;border:1px solid transparent;background:transparent;' +
      'color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font:600 18px/1 var(--font);overflow:hidden}' +
      '.bsp-icon:hover{background:var(--sand)}' +
      '.bsp-field{display:flex;flex-direction:column;gap:4px}' +
      '.bsp-feed-block{flex:1 1 auto;min-height:0;overflow:hidden}' +
      '.bsp-range-label,.bsp-feed-label{display:block;margin:0;font:500 12px/1.45 var(--font);color:var(--muted);overflow-wrap:anywhere}' +
      '.bsp-range{display:block;width:100%;max-width:100%;min-width:0;margin:0;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);font:500 13px/1.2 var(--font);color:var(--ink)}' +
      '.bsp-status{margin:0;font:500 13.5px/1.45 var(--font);color:var(--ink);overflow-wrap:anywhere;white-space:normal;min-width:0;max-width:100%}' +
      '.bsp-root[data-phase="error"] .bsp-status{color:var(--danger)}' +
      '.bsp-bar{flex:none;height:6px;width:100%;border-radius:999px;background:var(--sand);border:1px solid var(--line);overflow:hidden;margin:0;max-width:100%}' +
      '.bsp-bar-mini{height:4px}' +
      '.bsp-bar-fill{height:100%;width:0%;max-width:100%;background:var(--accent);transition:width .35s ease}' +
      '.bsp-bar.is-indeterminate .bsp-bar-fill{width:100%;opacity:.9;background:repeating-linear-gradient(90deg,var(--accent) 0 12px,transparent 12px 20px);animation:bsp-indet 1s linear infinite}' +
      '@keyframes bsp-indet{to{transform:translateX(20px)}}' +
      '.bsp-keepopen{margin:0;font:400 12px/1.4 var(--font);color:var(--ink);background:var(--sand);border:1px solid var(--line);border-radius:8px;padding:7px 10px;overflow-wrap:anywhere}' +
      '.bsp-keepopen[hidden],.bsp-results[hidden],.bsp-stop[hidden]{display:none !important}' +
      '.bsp-feed{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;margin:0}' +
      '.bsp-feed-empty{margin:0;color:var(--muted);font-size:12px;font-weight:500;line-height:1.45;overflow-wrap:anywhere}' +
      '.bsp-row{flex:0 0 auto;min-height:auto;overflow:visible;background:var(--sand);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-wrap:anywhere}' +
      '.bsp-co{display:block;font:600 13px/1.3 var(--font);color:var(--ink);max-width:100%;overflow-wrap:anywhere;word-break:break-word;white-space:normal}' +
      '.bsp-jt{font:500 12px/1.45 var(--font);color:var(--muted);margin-top:2px;overflow-wrap:anywhere;white-space:normal}' +
      '.bsp-when{font:500 12px/1.3 var(--font);color:var(--muted);margin-top:3px;overflow-wrap:anywhere;white-space:normal}' +
      '.bsp-actions{display:flex;flex-direction:column;gap:8px;flex:none}' +
      '.bsp-stop{font:600 13px/1 var(--font);padding:11px 18px;border:1px solid var(--danger);border-radius:10px;background:var(--danger-soft);color:var(--danger);cursor:pointer;width:100%;max-width:100%;min-width:0}' +
      '.bsp-stop:hover{background:var(--danger);color:var(--on-accent)}' +
      '.bsp-stop:disabled{opacity:.7;cursor:progress}' +
      '.bsp-mini .bsp-stop{margin-top:4px;padding:8px 12px}' +
      '.bsp-results,.bsp-start{font:600 13px/1 var(--font);padding:11px 18px;border:0;border-radius:10px;color:var(--on-accent);cursor:pointer;width:100%;max-width:100%;min-width:0}' +
      '.bsp-results{background:var(--accent)}' +
      '.bsp-results:hover{background:var(--accent-pressed)}' +
      'b.stat{font-weight:700;font-variant-numeric:tabular-nums}' +
      '.bsp-start{background:var(--accent)}' +
      '.bsp-start:hover{background:var(--accent-pressed)}' +
      '.bsp-start:disabled{background:var(--accent-disabled);color:var(--on-accent);cursor:progress;box-shadow:none}' +
      '.bsp-credit{text-align:start;margin:0;padding-top:12px;border-top:1px solid var(--line);font-size:12px;line-height:1.45;overflow-wrap:anywhere}' +
      '.bsp-credit .credit-name,.bsp-credit .credit-links{font:500 12px/1.45 var(--font);color:var(--muted);overflow-wrap:anywhere;white-space:normal;max-width:100%}' +
      '.bsp-credit a{color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;max-width:100%}' +
      '.bsp-credit .credit-sep{margin:0 5px;color:var(--muted)}' +
      'button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}' +
      '@media (prefers-reduced-motion:reduce){:host,.bsp-body,.bsp-mini,.bsp-bar-fill{transition:none !important}' +
      '.bsp-bar.is-indeterminate .bsp-bar-fill{animation:none}}'
    );
  }

  var api = {
    shouldShowGoToResults: shouldShowGoToResults,
    escapeHtml: escapeHtml,
    humanEndReason: humanEndReason,
    shouldCollapseOnMount: shouldCollapseOnMount,
    phaseLabel: phaseLabel,
    readHostTheme: readHostTheme,
    watchHostTheme: watchHostTheme,
    panelInnerHtml: panelInnerHtml,
    panelCss: panelCss,
    formatPanelStatus: formatPanelStatus,
    formatMiniStatus: formatMiniStatus,
    rememberScanMode: rememberScanMode,
    externalLinkRel: externalLinkRel,
    parseKnownTotal: parseKnownTotal,
    formatRunningLabel: formatRunningLabel,
    formatFeedWhen: formatFeedWhen,
    computePanelBox: computePanelBox,
    rectsIntersect: rectsIntersect,
    layoutPanel: layoutPanel,
    installPanel: installPanel,
    mountDragGrip: mountDragGrip,
  };

  root.BasvuruScrapePanelUi = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
