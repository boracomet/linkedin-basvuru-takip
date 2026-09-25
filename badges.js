/**
 * Geçmiş başvurularla eşleşen şirketler için iş ilanı uyarısı.
 *
 * Üst çerçevede çalışır. Manifest kaydı linkedin.com/* altındadır çünkü
 * LinkedIn bölüm değiştirirken sayfayı yenilemez; /jobs dışında ise script
 * yalnızca SPA gezinmesini dinler (MutationObserver, storage okuma, DOM yok).
 * /jobs içine geçilince gözlemciler ve storage açılır, çıkınca kapanır.
 * Yalnızca sağdaki ilan ayrıntısında, başlık ile konum satırının arasında durur.
 * Sol ilan listesine rozet konmaz. Başlığın içine yazılmaz; yükseklik kilitlenmez.
 * Stiller Shadow DOM içindedir.
 * Sabit örtü yok, adres yoklaması yok.
 *
 * Hata ayıklama: localStorage.btDebug = '1' sonra sayfayı yenile.
 */
(function basvuruJobBadges() {
  'use strict';

  // Isolated-world copy. url-allow.js is listed before this file in the badge
  // content script. Capture now: MAIN-world api-hook deletes its own global,
  // and a later delete on this window must not drop the allowlist.
  var URL_ALLOW = typeof window !== 'undefined' ? window.BasvuruUrlAllow : null;

  /*
   * STILLER — tasarımcı yalnızca bu bloğu değiştirsin.
   * Light DOM'a sızmaz. Yazı tipi sayfadan miras alınır (font-family: inherit).
   * Koyu tema prefers-color-scheme ile değil, gövdenin hesaplanan arka planından
   * host üzerindeki data-theme="dark" ile seçilir. Uzak font/ikon yok; ikon satır içi SVG.
   */
  var BADGE_CSS = [
    ':host {',
    '  all: initial;',
    '  display: block;',
    '  box-sizing: border-box;',
    '  max-width: 100%;',
    '  font-family: inherit;',
    '  color: #191919;',
    '}',
    '@keyframes bt-in { from { opacity: 0; } to { opacity: 1; } }',
    '@media (prefers-reduced-motion: reduce) { :host, :host([data-bt-modal]) { animation: none; } }',
    ':host([data-bt-badge]) {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  vertical-align: middle;',
    '  flex: 0 1 auto;',
    '  box-sizing: border-box;',
    '  width: auto;',
    '  height: 20px;',
    '  max-height: 20px;',
    '  margin: 0 4px;',
    '  line-height: 16px;',
    '  min-width: 0;',
    '}',
    ':host([data-bt-badge="card"]) { max-width: min(160px, 100%); overflow: hidden; }',
    ':host([data-bt-badge="detail"]) {',
    '  flex: 0 0 auto;',
    '  width: max-content;',
    '  min-width: max-content;',
    '  max-width: none;',
    '  height: 20px;',
    '  max-height: 20px;',
    '  overflow: visible;',
    '}',
    '.bt-badge {',
    '  position: relative;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 4px;',
    '  box-sizing: border-box;',
    '  width: 100%;',
    '  max-width: 100%;',
    '  height: 20px;',
    '  min-width: 0;',
    '  margin: 0;',
    '  padding: 0 6px;',
    '  border: 0;',
    '  border-radius: 10px;',
    '  box-shadow: inset 0 0 0 1px transparent;',
    '  font-family: inherit;',
    '  font-size: 12px;',
    '  line-height: 16px;',
    '  font-weight: 600;',
    '  text-align: left;',
    '  cursor: pointer;',
    '}',
    '.bt-badge::before {',
    '  content: "";',
    '  position: absolute;',
    '  inset: -2px 0;',
    '}',
    '.bt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }',
    ':host([data-bt-badge="detail"]) .bt-badge {',
    '  width: max-content;',
    '  max-width: none;',
    '  flex-wrap: nowrap;',
    '  height: 20px;',
    '}',
    ':host([data-bt-badge="detail"]) .bt-label {',
    '  overflow: visible;',
    '  text-overflow: clip;',
    '  white-space: nowrap;',
    '  flex: 0 0 auto;',
    '  min-width: max-content;',
    '}',
    '.bt-icon, .bt-chevron { flex: 0 0 auto; display: block; width: 12px; height: 12px; }',
    ':host([data-bt-tone="amber"]) .bt-badge { background: #FFF4E0; box-shadow: inset 0 0 0 1px #F0C36D; color: #7A4B00; }',
    ':host([data-bt-tone="amber"]) .bt-badge:hover { background: #FFE9C2; }',
    ':host([data-bt-tone="info"]) .bt-badge { background: #EAF2FB; box-shadow: inset 0 0 0 1px #A8C8EC; color: #0A4D8C; }',
    ':host([data-theme="dark"][data-bt-tone="amber"]) .bt-badge { background: #3A2E14; box-shadow: inset 0 0 0 1px #8A6A2B; color: #FFD58A; }',
    ':host([data-theme="dark"][data-bt-tone="amber"]) .bt-badge:hover { background: #463717; }',
    ':host([data-theme="dark"][data-bt-tone="info"]) .bt-badge { background: #17293B; box-shadow: inset 0 0 0 1px #3C6A99; color: #A9D2FF; }',
    '.bt-badge:focus-visible, .bt-close:focus-visible { outline: 2px solid #0A66C2; outline-offset: 2px; }',
    ':host([data-theme="dark"]) .bt-badge:focus-visible,',
    ':host([data-theme="dark"]) .bt-close:focus-visible { outline-color: #71B7FB; }',
    ':host([data-bt-modal]) {',
    '  all: initial;',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 10000;',
    '  display: flex;',
    '  align-items: flex-start;',
    '  justify-content: center;',
    '  box-sizing: border-box;',
    '  padding: 16px;',
    '  font-family: inherit;',
    '  color: #191919;',
    '  animation: bt-in 120ms ease;',
    '}',
    '.bt-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }',
    ':host([data-theme="dark"]) .bt-backdrop { background: rgba(0, 0, 0, 0.6); }',
    '.bt-dialog {',
    '  position: relative;',
    '  box-sizing: border-box;',
    '  display: flex;',
    '  flex-direction: column;',
    '  width: min(560px, calc(100vw - 32px));',
    '  max-height: min(80vh, 640px);',
    '  margin-top: 8vh;',
    '  padding: 20px 24px;',
    '  border-radius: 12px;',
    '  background: #FFFFFF;',
    '  color: #191919;',
    '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);',
    '  font-family: inherit;',
    '  overflow: hidden;',
    '}',
    ':host([data-theme="dark"]) .bt-dialog { background: #1D2226; color: #E9EBED; }',
    '.bt-modal-head { display: flex; align-items: flex-start; gap: 8px; }',
    '.bt-modal-title {',
    '  flex: 1 1 auto;',
    '  margin: 0;',
    '  font-family: inherit;',
    '  font-size: 18px;',
    '  line-height: 24px;',
    '  font-weight: 600;',
    '}',
    '.bt-close {',
    '  flex: 0 0 auto;',
    '  box-sizing: border-box;',
    '  width: 32px;',
    '  height: 32px;',
    '  margin: 0;',
    '  padding: 0;',
    '  border: 0;',
    '  border-radius: 8px;',
    '  background: transparent;',
    '  color: inherit;',
    '  font-family: inherit;',
    '  font-size: 20px;',
    '  line-height: 32px;',
    '  cursor: pointer;',
    '}',
    '.bt-modal-sub { margin: 4px 0 0; font-family: inherit; font-size: 13px; line-height: 18px; color: #666666; }',
    ':host([data-theme="dark"]) .bt-modal-sub,',
    ':host([data-theme="dark"]) .bt-date,',
    ':host([data-theme="dark"]) .bt-footer { color: #B0B7BF; }',
    '.bt-apps {',
    '  list-style: none;',
    '  margin: 12px 0 0;',
    '  padding: 0;',
    '  overflow: auto;',
    '  min-height: 0;',
    '  flex: 1 1 auto;',
    '}',
    '.bt-apps li {',
    '  display: flex;',
    '  align-items: flex-start;',
    '  gap: 12px;',
    '  margin: 0;',
    '  padding: 12px 0;',
    '  border-bottom: 1px solid #E0E0E0;',
    '}',
    ':host([data-theme="dark"]) .bt-apps li { border-bottom-color: #38434F; }',
    '.bt-apps li[data-bt-current] { border-left: 3px solid #F0C36D; padding-left: 8px; }',
    ':host([data-theme="dark"]) .bt-apps li[data-bt-current] { border-left-color: #FFD58A; }',
    '.bt-row-main { flex: 1 1 auto; min-width: 0; }',
    '.bt-row-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
    '.bt-job {',
    '  font-family: inherit;',
    '  font-weight: 600;',
    '  font-size: 15px;',
    '  line-height: 20px;',
    '  display: -webkit-box;',
    '  -webkit-line-clamp: 2;',
    '  -webkit-box-orient: vertical;',
    '  overflow: hidden;',
    '}',
    '.bt-current { font-family: inherit; font-size: 12px; line-height: 16px; font-weight: 600; color: #7A4B00; }',
    ':host([data-theme="dark"]) .bt-current { color: #FFD58A; }',
    '.bt-date { margin: 2px 0 0; font-family: inherit; font-size: 13px; line-height: 18px; color: #666666; }',
    '.bt-chip {',
    '  flex: 0 1 auto;',
    '  box-sizing: border-box;',
    '  max-width: 220px;',
    '  height: auto;',
    '  min-height: 20px;',
    '  padding: 2px 8px;',
    '  border-radius: 10px;',
    '  font-family: inherit;',
    '  font-size: 12px;',
    '  line-height: 16px;',
    '  font-weight: 600;',
    '  white-space: normal;',
    '  text-align: center;',
    '}',
    '.bt-chip-viewed { background: #EAF2FB; color: #0A4D8C; }',
    '.bt-chip-cv { background: #E6F4EA; color: #1D6B35; }',
    '.bt-chip-unseen, .bt-chip-closed, .bt-chip-repost { background: #F1F3F5; color: #4B5563; }',
    ':host([data-theme="dark"]) .bt-chip-viewed { background: #17293B; color: #A9D2FF; }',
    ':host([data-theme="dark"]) .bt-chip-cv { background: #173222; color: #9BE3B0; }',
    ':host([data-theme="dark"]) .bt-chip-unseen,',
    ':host([data-theme="dark"]) .bt-chip-closed,',
    ':host([data-theme="dark"]) .bt-chip-repost { background: #2A3138; color: #C9CED4; }',
    '.bt-footer { margin: 12px 0 0; font-family: inherit; font-size: 12px; line-height: 16px; color: #666666; }',
    '@media (max-width: 480px) {',
    '  :host([data-bt-modal]) { padding: 8px; }',
    '  .bt-dialog { width: calc(100vw - 16px); max-height: 90vh; margin-top: 0; }',
    '}',
    '@media (forced-colors: active) {',
    '  .bt-badge, .bt-chip, .bt-dialog { background: Canvas; color: CanvasText; border-color: CanvasText; }',
    '}',
  ].join('\n');

  /**
   * Seçiciler tek yerde. Önce sabit kancalar (iş linki, data-job-id, ARIA);
   * sınıf adları yalnızca yedek — LinkedIn bunları değiştiriyor.
   */
  var SELECTORS = {
    jobLink: 'a[href*="/jobs/view/"], a[href*="currentJobId="]',
    jobId:
      '[data-occludable-job-id], [data-job-id], [data-entity-urn*="jobPosting"], [data-entity-urn*="jobposting"]',
    cardBoundary: [
      'li',
      '[role="listitem"]',
      '[data-occludable-job-id]',
      '[data-job-id]',
      '[data-entity-urn*="jobPosting"]',
      '[data-entity-urn*="jobposting"]',
      '.job-card-container',
      '.job-card-list',
      '.jobs-search-results__list-item',
      '.scaffold-layout__list-item',
      '.base-card',
      '.job-search-card',
    ].join(', '),
    resultsList:
      '.scaffold-layout__list, .jobs-search__results-list, .jobs-search-results-list, .jobs-search-results__list',
    company: [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '[class*="top-card__company-name"] a',
      '[class*="top-card__company-name"]',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.job-card-list__company-name',
      '.job-card-container__company-name',
      '.base-search-card__subtitle',
      'a[href*="/company/"]',
      'a[href*="/showcase/"]',
    ],
    // Üst kart (logo + şirket + başlık + meta). BEM değiştiricisi
    // (__container--two-pane) temel sınıf olmadan da eşleşsin.
    detailTop: [
      '[class*="job-details-jobs-unified-top-card__container"]',
      '[class*="jobs-unified-top-card"]',
      '[class*="jobs-details-top-card"]',
      '[class*="job-details-jobs-unified-top-card"]',
      '.job-details-jobs-unified-top-card__container',
      '.jobs-unified-top-card',
      '.jobs-details-top-card',
      '.job-details-jobs-unified-top-card',
    ],
    // Sağ ilan sütunu. Sol liste (.scaffold-layout__list) burada yok.
    detailPane:
      '#job-details, .scaffold-layout__detail, .jobs-search__job-details--container, .jobs-search__job-details, .jobs-details__main-content, .job-view-layout, .jobs-details',
    applyLabel: /^(kolay başvuru|başvur|easy apply|apply|kaydet|save|kaydedildi|saved)$/i,
  };

  var STORAGE_SNAPSHOT = 'basvuruSnapshot';
  var BADGE_POSITION = 'badgePosition';
  var SCAN_GAP_MS = 250;
  var badgePosition = 'top';
  var STATUS_LINE_RE =
    /ba\u015fvuruldu|ba\u015fvuru g\u00f6nderildi|kolay ba\u015fvuru|easy apply|\bapplied\b/i;

  function core() {
    return globalThis.BasvuruBadgesCore;
  }

  function indexFromSnapshot(snapshot) {
    var C = core();
    if (!C) return null;
    return C.indexApplications(C.applicationsFromSnapshot(snapshot), {
      scannedAt: C.scannedAtFromSnapshot(snapshot),
    });
  }

  function isJobsPath(pathname, search) {
    var path = String(pathname || '').replace(/\/+$/, '') || '/';
    if (path === '/jobs-tracker' || path.indexOf('/jobs-tracker/') === 0) return false;
    if (path === '/jobs/tracker' || path.indexOf('/jobs/tracker/') === 0) return false;
    if (path !== '/jobs' && path.indexOf('/jobs/') !== 0) return false;
    if (/[?&]stage=applied(?:&|$)/.test(String(search || ''))) return false;
    return true;
  }

  function log() {
    var debug = false;
    try {
      debug = globalThis.localStorage && globalThis.localStorage.getItem('btDebug') === '1';
    } catch (err) {
      debug = false;
    }
    if (!debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[BasvuruTakip]');
    console.log.apply(console, args);
  }

  function normalizeBadgePosition(value) {
    if (value === 'bottom') return 'top';
    return 'top';
  }

  function rememberStyle(el) {
    if (!el || el.hasAttribute('data-bt-prev-style')) return;
    el.setAttribute('data-bt-prev-style', el.getAttribute('style') || '');
  }

  function restoreStyle(el) {
    if (!el || !el.hasAttribute('data-bt-prev-style')) return;
    var prev = el.getAttribute('data-bt-prev-style');
    if (prev) el.setAttribute('style', prev);
    else el.removeAttribute('style');
    el.removeAttribute('data-bt-prev-style');
  }

  function detachBadge(node) {
    if (!node) return;
    var parent = node.parentElement;
    if (node.remove) node.remove();
    var el = parent;
    while (el && el.nodeType === 1 && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      var marked = el.hasAttribute('data-bt-prev-style') || el.hasAttribute('data-bt-locked');
      var holdsBadge = el.querySelector && el.querySelector('[data-bt-badge]');
      if (marked && !holdsBadge) {
        el.removeAttribute('data-bt-locked');
        restoreStyle(el);
      }
      el = el.parentElement;
    }
  }

  function clearBadges(doc) {
    closeModal();
    if (!doc || !doc.querySelectorAll) return;
    var nodes = doc.querySelectorAll('[data-bt-badge]');
    for (var i = 0; i < nodes.length; i++) detachBadge(nodes[i]);
  }

  /**
   * One id per job anchor. A numeric data-job-id and "/jobs/view/<id>" are the
   * same posting; the path fallback must not be counted as a second job.
   */
  function oneJobId(el, C) {
    if (!el || !el.getAttribute) return '';
    var attr = el.getAttribute('data-occludable-job-id') || el.getAttribute('data-job-id') || '';
    attr = String(attr).trim();
    if (/^\d{3,}$/.test(attr)) return attr;
    var token = C.jobIdFromToken || C.jobIdFromHref;
    var values = [el.getAttribute('data-entity-urn'), el.getAttribute('data-chameleon-result-urn'), el.getAttribute('href')];
    var i;
    for (i = 0; i < values.length; i++) {
      if (!values[i]) continue;
      var id = token(values[i]);
      if (id && /^\d{3,}$/.test(id)) return id;
    }
    return '';
  }

  function createIdCache(C) {
    var cache = new WeakMap();
    return function jobIds(el) {
      if (!el || el.nodeType !== 1) return new Set();
      if (cache.has(el)) return cache.get(el);
      var ids = new Set();
      var own = oneJobId(el, C);
      if (own) ids.add(own);
      if (el.querySelectorAll) {
        var nodes = el.querySelectorAll(SELECTORS.jobLink + ', ' + SELECTORS.jobId);
        for (var i = 0; i < nodes.length; i++) {
          var id = oneJobId(nodes[i], C);
          if (id) ids.add(id);
        }
      }
      cache.set(el, ids);
      return ids;
    };
  }

  function isPageStop(el) {
    if (!el || !el.tagName) return true;
    var tag = el.tagName;
    if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN' || tag === 'HEADER' || tag === 'NAV') return true;
    var role = el.getAttribute && el.getAttribute('role');
    return role === 'banner' || role === 'navigation';
  }

  function firstSegment(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s*[·•|]\s*/)[0]
      .trim();
  }

  function acceptCompanyName(C, name) {
    if (!name || name.length > 120) return false;
    if (!C.usableCompany(name)) return false;
    if (C.isNoiseLine(name)) return false;
    return true;
  }

  /** Badge hosts are empty in the light DOM; they must not hide the line they sit in. */
  function hasContentChild(el) {
    if (!el || !el.children || !el.children.length) return false;
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      if (child.hasAttribute && (child.hasAttribute('data-bt-badge') || child.hasAttribute('data-bt-modal'))) continue;
      return true;
    }
    return false;
  }

  function leafLines(root) {
    var lines = [];
    if (!root || !root.querySelectorAll) return lines;
    var all = root.querySelectorAll('h1, h2, h3, h4, p, span, a, li, strong, div');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest('[data-bt-badge]')) continue;
      if (el.tagName === 'BUTTON' || (el.closest && el.closest('button'))) continue;
      if (hasContentChild(el)) continue;
      var t = firstSegment(el.textContent);
      if (t) lines.push(t);
    }
    return lines;
  }

  function skipCompanyNode(el) {
    if (!el || !el.closest) return false;
    if (el.closest('[data-bt-badge], [data-bt-modal]')) return true;
    // Benzer ilanlar ve sol liste kartları ayrı bir şirket gibi okunmasın.
    if (el.closest('li, [role="listitem"]')) return true;
    return false;
  }

  /**
   * Logo satırındaki kısa ad. Bu düzende şirket başlığın üstünde,
   * logonun yanında durur; başlıktan sonraki satır konumdur.
   */
  function companyBesideLogo(container) {
    var C = core();
    if (!C || !container || !container.querySelector) return null;
    var img = logoImage(container);
    if (!img) {
      var imgs = container.querySelectorAll('img');
      img = imgs.length ? imgs[0] : null;
    }
    if (!img || skipCompanyNode(img)) return null;
    var alt = C.stripLogoSuffix(firstSegment(img.getAttribute('alt') || ''));
    var title = detailTitleLine(container);
    var altBeforeTitle = !title || !!(img.compareDocumentPosition(title) & 4);
    if (altBeforeTitle && acceptCompanyName(C, alt) && alt.length <= 60) return { name: alt, el: img };
    var row = img.parentElement;
    var depth;
    for (depth = 0; row && row !== container && depth < 5; depth++, row = row.parentElement) {
      if (title && row.contains(title)) break;
      var leaves = rowLeaves(row);
      var i;
      for (i = 0; i < leaves.length; i++) {
        if (leaves[i].tagName === 'IMG' || skipCompanyNode(leaves[i])) continue;
        var text = C.stripLogoSuffix(firstSegment(leaves[i].textContent || ''));
        if (acceptCompanyName(C, text) && text.length <= 60) return { name: text, el: leaves[i] };
      }
    }
    return null;
  }

  /** Başlıktan önce gelen ilk şirket adı (logo satırı). */
  function companyBeforeTitle(container) {
    var C = core();
    if (!C || !container || !container.querySelectorAll) return null;
    var title = detailTitleLine(container);
    if (!title || typeof title.compareDocumentPosition !== 'function') return null;
    var nodes = container.querySelectorAll('span, a, strong, p, div');
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (skipCompanyNode(el) || hasContentChild(el)) continue;
      if (title.contains(el) || el.contains(title)) continue;
      if (el.compareDocumentPosition(title) & 2) continue;
      var text = C.stripLogoSuffix(firstSegment(el.textContent || el.getAttribute('aria-label') || ''));
      if (!acceptCompanyName(C, text) || text.length > 60) continue;
      if (SELECTORS.applyLabel.test(text)) continue;
      return { name: text, el: el };
    }
    return null;
  }

  function companyFrom(container) {
    var C = core();
    if (!C || !container || !container.querySelectorAll) return { name: '', el: null };
    var imgs = container.querySelectorAll('img[alt]');
    var i;
    for (i = 0; i < imgs.length; i++) {
      if (skipCompanyNode(imgs[i])) continue;
      var fromAlt = C.companyFromLogoAlt(imgs[i].getAttribute('alt'));
      if (acceptCompanyName(C, fromAlt)) return { name: fromAlt, el: imgs[i] };
    }
    for (i = 0; i < SELECTORS.company.length; i++) {
      var nodes = container.querySelectorAll(SELECTORS.company[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (skipCompanyNode(el)) continue;
        var text = C.stripLogoSuffix(firstSegment(el.textContent));
        if (!acceptCompanyName(C, text) && el.getAttribute) {
          text = C.stripLogoSuffix(firstSegment(el.getAttribute('aria-label') || ''));
        }
        if (acceptCompanyName(C, text)) return { name: text, el: el };
      }
    }
    var beside = companyBesideLogo(container);
    if (beside && beside.name) return beside;
    var prior = companyBeforeTitle(container);
    if (prior && prior.name) return prior;
    var lines = leafLines(container);
    var titleEl = container.querySelector('h1, h2, h3');
    if (titleEl && titleEl.closest && titleEl.closest('[data-bt-badge]')) titleEl = null;
    var title = titleEl ? firstSegment(titleEl.textContent) : lines[0] || '';
    var picked = C.pickCompanyFromLines(lines, title);
    if (!acceptCompanyName(C, picked)) return { name: '', el: null };
    var leaves = container.querySelectorAll('h1, h2, h3, h4, p, span, a, li, strong, div');
    for (i = 0; i < leaves.length; i++) {
      var leaf = leaves[i];
      if (hasContentChild(leaf)) continue;
      if (leaf.closest && leaf.closest('[data-bt-badge]')) continue;
      if (firstSegment(leaf.textContent) === picked) return { name: picked, el: leaf };
    }
    return { name: picked, el: null };
  }

  function containsResultsList(el, jobIds) {
    if (!el || !el.querySelector) return false;
    if (SELECTORS.resultsList && el.querySelector(SELECTORS.resultsList)) return true;
    if (!jobIds) return false;
    var items = el.querySelectorAll('li, [role="listitem"]');
    var withJobs = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      if (jobIds(items[i]).size >= 1) withJobs++;
      if (withJobs >= 2) return true;
    }
    return false;
  }

  /** Sol sonuç sütununun içinde. Sağ ayrıntı paneli buna girmez. */
  function insideResultsList(el) {
    if (!el || !el.closest) return false;
    if (!SELECTORS.resultsList) return false;
    if (el.matches && el.matches(SELECTORS.resultsList)) return true;
    return !!el.closest(SELECTORS.resultsList);
  }

  function inDetailPane(el) {
    if (!el || !el.closest || !SELECTORS.detailPane) return false;
    if (el.matches && el.matches(SELECTORS.detailPane)) return true;
    return !!el.closest(SELECTORS.detailPane);
  }

  /** İki sütunlu iskelet: sol listeyi de saran düğüm rozet kökü olamaz. */
  function holdsResultsColumn(el) {
    if (!el || !el.querySelector || !SELECTORS.resultsList) return false;
    return !!el.querySelector(SELECTORS.resultsList);
  }

  function includesCompanySignal(el) {
    if (!el || !el.querySelector) return false;
    if (el.querySelector('a[href*="/company/"], a[href*="/showcase/"], [class*="company-name"], [class*="company-logo"]')) {
      return true;
    }
    var imgs = el.querySelectorAll('img[alt]');
    var i;
    for (i = 0; i < imgs.length; i++) {
      if (imgs[i].closest && imgs[i].closest('li, [role="listitem"]')) continue;
      var alt = firstSegment(imgs[i].getAttribute('alt') || '');
      if (alt && alt.length <= 80) return true;
    }
    return false;
  }

  function hasDetailTitle(el) {
    return !!detailJobTitle(el);
  }

  /**
   * Sağ sütunun içinde, logo + şirket + başlık + meta’yı kapsayan en geniş
   * tek-ilan kutusu. Benzer ilanlar ikinci bir iş kimliği ekliyorsa tırmanış
   * orada durur; şirket satırı başlığın kardeşi ise bir üst düğüm alınır.
   */
  function narrowToTopCard(pane, jobIds) {
    if (!pane) return null;
    var heading = detailJobTitle(pane);
    if (!heading) return null;
    var cur = heading;
    var best = null;
    var depth;
    for (depth = 0; cur && depth < 12; depth++) {
      cur = cur.parentElement;
      if (!cur || isPageStop(cur)) break;
      if (cur !== pane && !pane.contains(cur)) break;
      if (insideResultsList(cur) || holdsResultsColumn(cur)) break;
      if (cur.matches && cur.matches('li, [role="listitem"]')) break;
      if (jobIds(cur).size > 1) break;
      best = cur;
      if (cur === pane) break;
    }
    if (best && !includesCompanySignal(best)) {
      var parent = best.parentElement;
      if (
        parent &&
        (parent === pane || pane.contains(parent)) &&
        !insideResultsList(parent) &&
        !holdsResultsColumn(parent) &&
        includesCompanySignal(parent) &&
        hasDetailTitle(parent)
      ) {
        return parent;
      }
    }
    // Düz sağ sütun: şirket adı logonun yanında düz metin, başlık ise bağlantı.
    // İkinci iş linki yüzünden tırmanış panele çıkamaz; şirket eşlemesi companyFrom'da kalır.
    if (!best && hasDetailTitle(pane) && !insideResultsList(pane) && !holdsResultsColumn(pane)) {
      return pane;
    }
    return best;
  }

  function widenToCompany(el, jobIds) {
    var cur = el;
    var best = null;
    var depth;
    for (depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
      if (!cur || isPageStop(cur)) break;
      if (insideResultsList(cur) || holdsResultsColumn(cur)) break;
      if (jobIds(cur).size > 1) {
        if (includesCompanySignal(cur) && hasDetailTitle(cur)) return cur;
        break;
      }
      if (includesCompanySignal(cur) && hasDetailTitle(cur)) best = cur;
    }
    return best;
  }

  function considerDetail(el, jobIds) {
    if (!el || el.nodeType !== 1) return null;
    if (insideResultsList(el) || holdsResultsColumn(el)) return null;
    if (el.closest && el.closest('[data-bt-badge]')) return null;
    if (el.matches && el.matches('li, [role="listitem"]')) return null;
    if (jobIds(el).size > 1 || !hasDetailTitle(el)) {
      var narrowed = narrowToTopCard(el, jobIds);
      if (narrowed) return narrowed;
      if (jobIds(el).size > 1 && hasDetailTitle(el) && includesCompanySignal(el)) return el;
      return null;
    }
    if (!includesCompanySignal(el)) {
      var wider = widenToCompany(el, jobIds);
      if (wider) return wider;
    }
    return el;
  }

  function firstJobHeading(doc) {
    var headings = doc.querySelectorAll('h1');
    for (var i = 0; i < headings.length; i++) {
      var h = headings[i];
      if (h.closest('[data-bt-badge]')) continue;
      if (h.closest('header, nav, [role="banner"], [role="navigation"]')) continue;
      if (h.closest('li, [role="listitem"]')) continue;
      if (insideResultsList(h)) continue;
      return h;
    }
    return null;
  }

  function climbDetail(h1, jobIds) {
    var cur = h1.parentElement;
    var best = null;
    for (var depth = 0; cur && depth < 12; depth++, cur = cur.parentElement) {
      if (isPageStop(cur)) break;
      if (containsResultsList(cur, jobIds) || holdsResultsColumn(cur)) break;
      if (insideResultsList(cur)) break;
      var ids = jobIds(cur);
      if (ids.size > 1) break;
      best = cur;
    }
    return best;
  }

  function findDetailHost(doc) {
    var C = core();
    if (!C || !doc || !doc.querySelectorAll) return null;
    var jobIds = createIdCache(C);
    var pass;
    var i;
    var j;
    var nodes;
    var hit;
    for (pass = 0; pass < 2; pass++) {
      for (i = 0; i < SELECTORS.detailTop.length; i++) {
        nodes = doc.querySelectorAll(SELECTORS.detailTop[i]);
        for (j = 0; j < nodes.length; j++) {
          var inPane = inDetailPane(nodes[j]);
          if (pass === 0 && !inPane) continue;
          if (pass === 1 && inPane) continue;
          hit = considerDetail(nodes[j], jobIds);
          if (hit) return hit;
        }
      }
    }
    if (SELECTORS.detailPane) {
      nodes = doc.querySelectorAll(SELECTORS.detailPane);
      for (j = 0; j < nodes.length; j++) {
        if (insideResultsList(nodes[j]) || holdsResultsColumn(nodes[j])) continue;
        hit = narrowToTopCard(nodes[j], jobIds);
        if (hit) return hit;
        if (hasDetailTitle(nodes[j])) return nodes[j];
      }
    }
    var h1 = firstJobHeading(doc);
    if (!h1) return null;
    var pane = h1.closest && SELECTORS.detailPane ? h1.closest(SELECTORS.detailPane) : null;
    if (pane && !insideResultsList(pane) && !holdsResultsColumn(pane)) {
      hit = narrowToTopCard(pane, jobIds);
      if (hit) return hit;
      if (hasDetailTitle(pane) && includesCompanySignal(pane)) return pane;
    }
    return climbDetail(h1, jobIds);
  }

  function cardRootFrom(start, detailHost, jobIds) {
    if (!start || start.nodeType !== 1) return null;
    if (detailHost && (start === detailHost || detailHost.contains(start))) return null;
    var cur = start;
    var best = null;
    for (var depth = 0; cur && depth < 16; depth++, cur = cur.parentElement) {
      if (isPageStop(cur)) break;
      if (detailHost && (cur === detailHost || cur.contains(detailHost))) break;
      var ids = jobIds(cur);
      if (ids.size > 1) break;
      if (ids.size !== 1) continue;
      // A real card boundary is the card even when the list column is wider than
      // 720px. Measuring offsetHeight/width here dropped collections cards.
      if (cur.matches && cur.matches(SELECTORS.cardBoundary)) return cur;
      var rect = cur.getBoundingClientRect ? cur.getBoundingClientRect() : null;
      if (rect && rect.width > 0 && rect.height > 0) {
        var view = cur.ownerDocument && cur.ownerDocument.defaultView;
        var vh = (view && view.innerHeight) || 800;
        if (
          core().isOversizedHost({
            width: rect.width,
            height: rect.height,
            viewportHeight: vh,
            kind: 'card',
            hasListJobLink: false,
          })
        ) {
          break;
        }
      }
      best = cur;
    }
    if (best && best.tagName === 'A' && best.parentElement && !isPageStop(best.parentElement)) {
      if (jobIds(best.parentElement).size === 1) return best.parentElement;
    }
    return best;
  }

  function findCards(doc, detailHost) {
    var C = core();
    var cards = [];
    var seen = new Set();
    if (!C) return cards;
    var jobIds = createIdCache(C);
    var starts = doc.querySelectorAll(SELECTORS.jobLink + ', ' + SELECTORS.jobId + ', ' + SELECTORS.cardBoundary);
    var i;
    for (i = 0; i < starts.length; i++) {
      var node = starts[i];
      if (node.closest && node.closest('[data-bt-badge]')) continue;
      if (detailHost && (node === detailHost || detailHost.contains(node))) continue;
      var card = cardRootFrom(node, detailHost, jobIds);
      if (!card || seen.has(card)) continue;
      if (detailHost && (card === detailHost || detailHost.contains(card) || card.contains(detailHost))) continue;
      if (jobIds(card).size !== 1) continue;
      seen.add(card);
      cards.push(card);
    }
    var kept = [];
    for (i = 0; i < cards.length; i++) {
      var outer = cards[i];
      var nested = false;
      var j;
      for (j = 0; j < cards.length; j++) {
        if (i === j) continue;
        if (outer.contains(cards[j])) {
          nested = true;
          break;
        }
      }
      if (!nested) kept.push(outer);
    }
    return kept;
  }

  var HIDE_KEY = 'bt-firma-uyarisi-gizli';
  var hiddenJobs = new Set();
  var CHIP_CLASS = {
    cv: 'cv',
    viewed: 'viewed',
    unseen: 'unseen',
    closed: 'closed',
    repostUnseen: 'repost',
  };

  function luminance(color) {
    var m = String(color || '').match(
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?\s*\)/i
    );
    if (!m) return null;
    var alpha = m[4] == null ? 1 : Number(m[4]);
    if (m[5] === '%') alpha = alpha / 100;
    if (!(alpha > 0.2)) return null;
    var r = Number(m[1]);
    var g = Number(m[2]);
    var b = Number(m[3]);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /** Dark when the page background is actually dark. Transparent falls through to the root. */
  function pageIsDark(doc) {
    try {
      if (!doc || !doc.defaultView || typeof doc.defaultView.getComputedStyle !== 'function') return false;
      var view = doc.defaultView;
      var nodes = [doc.body, doc.documentElement];
      var i;
      for (i = 0; i < nodes.length; i++) {
        if (!nodes[i]) continue;
        var style = view.getComputedStyle(nodes[i]);
        var L = luminance(style && style.backgroundColor);
        if (L == null) continue;
        return L < 0.45;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function applyTheme(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var dark = pageIsDark(doc);
    var nodes = doc.querySelectorAll('[data-bt-badge], [data-bt-modal]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (dark) nodes[i].setAttribute('data-theme', 'dark');
      else nodes[i].removeAttribute('data-theme');
    }
  }

  function sessionStore(doc) {
    try {
      return doc && doc.defaultView && doc.defaultView.sessionStorage;
    } catch (e) {
      return null;
    }
  }

  function readHidden(storage) {
    try {
      var raw = storage && storage.getItem && storage.getItem(HIDE_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      var i;
      for (i = 0; i < arr.length; i++) if (arr[i]) hiddenJobs.add(String(arr[i]));
    } catch (e) {}
  }

  function persistHidden(storage) {
    try {
      if (!storage || !storage.setItem) return;
      storage.setItem(HIDE_KEY, JSON.stringify(Array.from(hiddenJobs)));
    } catch (e) {}
  }

  function numericJobId(raw) {
    var m = String(raw || '').match(/(\d{5,})/);
    return m ? m[1] : '';
  }

  function jobIdFromNode(node) {
    if (!node || !node.getAttribute) return '';
    var C = core();
    var token = C && (C.jobIdFromToken || C.jobIdFromHref);
    var values = [
      node.getAttribute('data-occludable-job-id'),
      node.getAttribute('data-job-id'),
      node.getAttribute('data-entity-urn'),
      node.getAttribute('data-chameleon-result-urn'),
      node.getAttribute('href'),
    ];
    var i;
    for (i = 0; i < values.length; i++) {
      if (!values[i]) continue;
      var id = token ? token(values[i]) : numericJobId(values[i]);
      if (id && /^\d{5,}$/.test(id)) return id;
    }
    return '';
  }

  function jobIdForCard(card) {
    var fromCard = jobIdFromNode(card);
    if (fromCard) return fromCard;
    if (!card || !card.querySelector) return '';
    var marked = card.querySelector('[data-occludable-job-id], [data-job-id]');
    if (marked) {
      var fromMarked = jobIdFromNode(marked);
      if (fromMarked) return fromMarked;
    }
    var link = card.querySelector(SELECTORS.jobLink);
    return link ? jobIdFromNode(link) : '';
  }

  function jobIdFromLocation(win) {
    try {
      var loc = win && win.location;
      if (!loc) return '';
      var search = String(loc.search || '');
      var m = search.match(/[?&]currentJobId=(\d{5,})/);
      if (m) return m[1];
      var path = String(loc.pathname || '');
      var p = path.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{5,})/);
      return p ? p[1] : '';
    } catch (e) {
      return '';
    }
  }

  function jobIdForDetail(host, win) {
    var fromHost = jobIdForCard(host);
    if (fromHost) return fromHost;
    return jobIdFromLocation(win);
  }

  function isHiddenJob(jobId) {
    return !!(jobId && hiddenJobs.has(String(jobId)));
  }

  function hideJobWarning(doc, jobId, host) {
    if (jobId) {
      hiddenJobs.add(String(jobId));
      persistHidden(sessionStore(doc));
      if (doc && doc.querySelectorAll && /^\d+$/.test(String(jobId))) {
        var nodes = doc.querySelectorAll('[data-bt-job="' + jobId + '"]');
        var i;
        for (i = 0; i < nodes.length; i++) nodes[i].remove();
      }
    }
    if (host && host.remove && host.isConnected) host.remove();
  }

  function svgEl(doc, className, pathD) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = doc.createElementNS(NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function clockIcon(doc) {
    return svgEl(
      doc,
      'bt-icon',
      'M8 1.4a6.6 6.6 0 1 0 0 13.2A6.6 6.6 0 0 0 8 1.4zm.7 2.5v3.15l2.35 1.4-.7 1.15L7.3 8.2V3.9h1.4z'
    );
  }

  function chevronIcon(doc) {
    return svgEl(doc, 'bt-chevron', 'M6.1 3.4 10.7 8 6.1 12.6 5.1 11.6 8.7 8 5.1 4.4z');
  }

  function fillShadow(doc, host, build) {
    var shadow = host.attachShadow({ mode: 'open' });
    var style = doc.createElement('style');
    style.textContent = BADGE_CSS;
    shadow.appendChild(style);
    build(shadow, doc);
    return shadow;
  }

  function stampHost(doc, host, warning, jobId, position) {
    host.setAttribute('data-bt-sig', warning.signature);
    host.setAttribute('data-bt-pos', normalizeBadgePosition(position));
    host.setAttribute('lang', 'tr');
    if (warning && warning.tone) host.setAttribute('data-bt-tone', warning.tone);
    if (jobId) host.setAttribute('data-bt-job', String(jobId));
    if (pageIsDark(doc)) host.setAttribute('data-theme', 'dark');
  }

  var modalHost = null;
  var modalTrigger = null;
  var lockedOverflow = null;

  function unlockScroll(doc) {
    if (!doc || !doc.body || lockedOverflow === null) return;
    doc.body.style.overflow = lockedOverflow;
    lockedOverflow = null;
  }

  function lockScroll(doc) {
    if (!doc || !doc.body || lockedOverflow !== null) return;
    lockedOverflow = doc.body.style.overflow || '';
    doc.body.style.overflow = 'hidden';
  }

  function closeModal() {
    var trigger = modalTrigger;
    var host = modalHost;
    if (!host) return;
    var doc = host.ownerDocument;
    modalHost = null;
    modalTrigger = null;
    unlockScroll(doc);
    if (host.remove) host.remove();
    if (trigger && typeof trigger.focus === 'function') {
      try {
        trigger.focus();
      } catch (e) {}
    }
  }

  function focusableIn(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.prototype.slice.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
  }

  function trapTab(ev, root) {
    var nodes = focusableIn(root);
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var active = root.activeElement || first;
    if (ev.shiftKey) {
      if (active === first) {
        ev.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function openCompanyModal(doc, trigger, warning) {
    if (!doc || !doc.body || !warning) return;
    if (modalHost) closeModal();
    var host = doc.createElement('div');
    host.setAttribute('data-bt-modal', '');
    if (pageIsDark(doc)) host.setAttribute('data-theme', 'dark');
    var shadow = host.attachShadow({ mode: 'open' });
    var style = doc.createElement('style');
    style.textContent = BADGE_CSS;
    shadow.appendChild(style);
    var backdrop = doc.createElement('div');
    backdrop.className = 'bt-backdrop';
    backdrop.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeModal();
    });
    var dialog = doc.createElement('div');
    dialog.className = 'bt-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'bt-modal-title');
    dialog.setAttribute('aria-describedby', 'bt-modal-sub');
    dialog.setAttribute('tabindex', '-1');
    var head = doc.createElement('div');
    head.className = 'bt-modal-head';
    var title = doc.createElement('h2');
    title.className = 'bt-modal-title';
    title.id = 'bt-modal-title';
    title.textContent = warning.modalTitle || warning.companyName || 'Ge\u00e7mi\u015f ba\u015fvurular\u0131n';
    var closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bt-close';
    closeBtn.setAttribute('aria-label', 'Kapat');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeModal();
    });
    head.appendChild(title);
    head.appendChild(closeBtn);
    dialog.appendChild(head);
    var sub = doc.createElement('p');
    sub.className = 'bt-modal-sub';
    sub.id = 'bt-modal-sub';
    sub.textContent = warning.modalSubtitle || '';
    dialog.appendChild(sub);
    var list = doc.createElement('ul');
    list.className = 'bt-apps';
    list.setAttribute('tabindex', '0');
    var items = warning.items || [];
    var i;
    for (i = 0; i < items.length; i++) appendJobRow(doc, list, items[i], false);
    dialog.appendChild(list);
    var footer = doc.createElement('p');
    footer.className = 'bt-footer';
    footer.textContent = warning.footer || '';
    dialog.appendChild(footer);
    shadow.appendChild(backdrop);
    shadow.appendChild(dialog);
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal();
        return;
      }
      if (ev.key === 'Tab') trapTab(ev, shadow);
    }
    shadow.addEventListener('keydown', onKey);
    doc.body.appendChild(host);
    modalHost = host;
    modalTrigger = trigger || null;
    lockScroll(doc);
    try {
      closeBtn.focus();
    } catch (e) {}
  }

  function bindWarningClick(host, trigger, doc, warning) {
    function openFrom(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.__btModal) return;
      ev.__btModal = true;
      openCompanyModal(doc, trigger, warning);
    }
    function swallow(ev) {
      ev.stopPropagation();
      if (ev.type === 'click') ev.preventDefault();
    }
    trigger.addEventListener('click', openFrom);
    trigger.addEventListener('pointerdown', swallow);
    trigger.addEventListener('mousedown', swallow);
    trigger.addEventListener('mouseup', swallow);
    host.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openCompanyModal(doc, trigger, warning);
    });
    host.addEventListener('pointerdown', swallow);
    host.addEventListener('mousedown', swallow);
    host.addEventListener('mouseup', swallow);
  }

  function buildBadgeHost(doc, warning, jobId, kind, position) {
    var host = doc.createElement('div');
    host.setAttribute('data-bt-badge', kind === 'detail' ? 'detail' : 'card');
    stampHost(doc, host, warning, jobId, position);
    fillShadow(doc, host, function (shadow, ownerDoc) {
      var btn = ownerDoc.createElement('button');
      btn.type = 'button';
      btn.className = 'bt-badge';
      var full = warning.ariaLabel || warning.cardText || '';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-label', full);
      btn.setAttribute('title', full);
      btn.appendChild(clockIcon(ownerDoc));
      var text = ownerDoc.createElement('span');
      text.className = 'bt-label';
      text.textContent = kind === 'detail' ? warning.detailText || warning.cardText : warning.cardText;
      btn.appendChild(text);
      if (kind === 'detail') btn.appendChild(chevronIcon(ownerDoc));
      shadow.appendChild(btn);
      bindWarningClick(host, btn, doc, warning);
    });
    return host;
  }

  function appendJobRow(ownerDoc, list, it) {
    var li = ownerDoc.createElement('li');
    if (it.isCurrent) li.setAttribute('data-bt-current', '');
    var main = ownerDoc.createElement('div');
    main.className = 'bt-row-main';
    var titleRow = ownerDoc.createElement('div');
    titleRow.className = 'bt-row-title';
    var href = URL_ALLOW && typeof URL_ALLOW.safeJobUrl === 'function' ? URL_ALLOW.safeJobUrl(it.jobUrl) : null;
    var titleEl;
    if (href) {
      titleEl = ownerDoc.createElement('a');
      titleEl.href = href;
      titleEl.rel = 'noopener noreferrer';
      titleEl.target = '_blank';
    } else {
      titleEl = ownerDoc.createElement('span');
    }
    titleEl.className = 'bt-job';
    titleEl.textContent = it.title;
    titleRow.appendChild(titleEl);
    if (it.isCurrent) {
      var mark = ownerDoc.createElement('span');
      mark.className = 'bt-current';
      mark.textContent = 'Bu ilan';
      titleRow.appendChild(mark);
    }
    main.appendChild(titleRow);
    var when = it.dateLine || it.dateLabel || it.when;
    if (when) {
      var date = ownerDoc.createElement('p');
      date.className = 'bt-date';
      date.textContent = when;
      main.appendChild(date);
    }
    li.appendChild(main);
    if (it.status) {
      var chip = ownerDoc.createElement('span');
      var chipId = CHIP_CLASS[it.statusId] || 'unseen';
      chip.className = 'bt-chip bt-chip-' + chipId;
      chip.textContent = it.status;
      li.appendChild(chip);
    }
    list.appendChild(li);
  }

  function rowLeaves(root) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    var all = root.querySelectorAll('h1, h2, h3, h4, p, span, a, li, strong, div');
    var i;
    for (i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest('[data-bt-badge], [data-bt-modal]')) continue;
      if (el.tagName === 'BUTTON' || (el.closest && el.closest('button'))) continue;
      if (el.tagName === 'IMG' || el.tagName === 'SVG') continue;
      if (hasContentChild(el)) continue;
      var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push(el);
    }
    return out;
  }

  function logoImage(card) {
    if (!card || !card.querySelectorAll) return null;
    var imgs = card.querySelectorAll('img');
    var i;
    for (i = 0; i < imgs.length; i++) {
      var alt = imgs[i].getAttribute('alt') || '';
      var inCompanyLink = imgs[i].closest && imgs[i].closest('a[href*="/company/"]');
      if (/\blogo\b/i.test(alt) || inCompanyLink) return imgs[i];
    }
    return imgs.length ? imgs[0] : null;
  }

  /**
   * Job title link that does not wrap the logo. A card-sized anchor around both
   * columns is not a title; the logo column is everything that holds the logo
   * image and not this title link.
   */
  function jobTitleLink(card) {
    if (!card || !card.querySelectorAll) return null;
    var img = logoImage(card);
    var links = card.querySelectorAll(SELECTORS.jobLink);
    var i;
    for (i = 0; i < links.length; i++) {
      if (img && links[i].contains(img)) continue;
      return links[i];
    }
    return links.length ? links[0] : null;
  }

  function inLogoColumn(el, card) {
    var img = logoImage(card);
    var title = jobTitleLink(card);
    // No separate title link means the logo and the title share one column.
    if (!img || !el || !title) return false;
    var node = el.nodeType === 1 ? el : el.parentElement;
    while (node && node !== card) {
      if (node.contains(img) && (!title || !node.contains(title))) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** Text column: ancestor of the title that does not contain the logo image. */
  function textColumn(card) {
    var img = logoImage(card);
    var title = jobTitleLink(card);
    if (!title) return null;
    var node = title;
    while (node && node.parentElement) {
      var parent = node.parentElement;
      if (img && parent.contains(img) && !node.contains(img)) return node;
      if (parent === card) return node;
      node = parent;
    }
    return null;
  }

  function cardCompanyLine(card, companyName) {
    var wanted = firstSegment(companyName || '').toLowerCase();
    var i;
    var j;
    if (card && card.querySelectorAll) {
      for (i = 0; i < SELECTORS.company.length; i++) {
        var nodes = card.querySelectorAll(SELECTORS.company[i]);
        for (j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (!el || el.tagName === 'IMG') continue;
          if (inLogoColumn(el, card)) continue;
          if (el.closest && el.closest('[data-bt-badge], button')) continue;
          var seg = firstSegment(el.textContent || '').toLowerCase();
          if (!seg) continue;
          if (!wanted || seg === wanted || seg.indexOf(wanted) === 0 || wanted.indexOf(seg) === 0) return el;
        }
      }
    }
    var leaves = rowLeaves(card);
    for (i = 0; i < leaves.length; i++) {
      if (inLogoColumn(leaves[i], card)) continue;
      if (wanted && firstSegment(leaves[i].textContent || '').toLowerCase() === wanted) return leaves[i];
    }
    return null;
  }

  function cardTitleLine(card, companyName) {
    var C = core();
    var leaves = rowLeaves(card);
    var company = firstSegment(companyName || '').toLowerCase();
    var i;
    for (i = 0; i < leaves.length; i++) {
      var raw = String(leaves[i].textContent || '').replace(/\s+/g, ' ').trim();
      var seg = firstSegment(raw);
      if (!seg) continue;
      if (company && seg.toLowerCase() === company) continue;
      if (C && C.isLocationLike(raw)) continue;
      if (STATUS_LINE_RE.test(raw)) continue;
      if (C && C.isNoiseLine(seg)) continue;
      if (/ilan\u0131n\u0131 kapat|dismiss/i.test(raw)) continue;
      return leaves[i];
    }
    return leaves.length ? leaves[0] : null;
  }

  function cardStatusLine(card, companyName) {
    var C = core();
    var leaves = rowLeaves(card);
    var i;
    if (card.querySelectorAll) {
      var footers = card.querySelectorAll('[class*="footer"]');
      for (i = footers.length - 1; i >= 0; i--) {
        if (footers[i].closest && footers[i].closest('[data-bt-badge]')) continue;
        if (inLogoColumn(footers[i], card)) continue;
        var inner = rowLeaves(footers[i]);
        if (inner.length && !inLogoColumn(inner[inner.length - 1], card)) return inner[inner.length - 1];
      }
    }
    for (i = leaves.length - 1; i >= 0; i--) {
      if (inLogoColumn(leaves[i], card)) continue;
      if (STATUS_LINE_RE.test(leaves[i].textContent || '')) return leaves[i];
    }
    for (i = leaves.length - 1; i >= 0; i--) {
      if (inLogoColumn(leaves[i], card)) continue;
      if (C && C.isLocationLike(leaves[i].textContent || '')) return leaves[i];
    }
    var title = cardTitleLine(card, companyName);
    for (i = leaves.length - 1; i >= 0; i--) {
      if (inLogoColumn(leaves[i], card)) continue;
      if (leaves[i] !== title) return leaves[i];
    }
    return title;
  }

  function isHiddenBox(el) {
    if (!el || !el.closest) return false;
    if (el.closest('.visually-hidden, .sr-only, .a11y-text, [class*="visually-hidden"], [hidden]')) return true;
    var node = el;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      if (node.hasAttribute && node.hasAttribute('hidden')) return true;
      try {
        var cs = view && view.getComputedStyle && view.getComputedStyle(node);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
      } catch (err) {}
      node = node.parentElement;
    }
    return false;
  }

  function detailTitleCandidate(el) {
    if (!el || !el.closest) return false;
    if (el.closest('[data-bt-badge], [data-bt-modal]')) return false;
    if (el.closest('li, [role="listitem"]')) return false;
    if (insideResultsList(el)) return false;
    if (isHiddenBox(el)) return false;
    var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 1 && text.length < 180;
  }

  function detailJobTitle(host) {
    if (!host || !host.querySelectorAll) return null;
    var i;
    var headings = host.querySelectorAll('h1');
    for (i = 0; i < headings.length; i++) {
      if (detailTitleCandidate(headings[i])) return headings[i];
    }
    var titled = host.querySelectorAll('[class*="job-title"], [class*="top-card__title"]');
    for (i = 0; i < titled.length; i++) {
      if (detailTitleCandidate(titled[i])) return titled[i];
    }
    var links = host.querySelectorAll('a[href*="/jobs/view/"]');
    for (i = 0; i < links.length; i++) {
      if (detailTitleCandidate(links[i])) return links[i];
    }
    var h2s = host.querySelectorAll('h2');
    for (i = 0; i < h2s.length; i++) {
      if (detailTitleCandidate(h2s[i])) return h2s[i];
    }
    return null;
  }

  function detailTitleLine(host) {
    return detailJobTitle(host) || cardTitleLine(host, '');
  }

  function detailMetaLine(host) {
    var title = detailTitleLine(host);
    if (!title) return null;
    var n = title.nextElementSibling;
    while (n) {
      if (n.hasAttribute && (n.hasAttribute('data-bt-badge') || n.hasAttribute('data-bt-modal'))) {
        n = n.nextElementSibling;
        continue;
      }
      var tag = n.tagName;
      if (tag === 'H1' || tag === 'H2' || tag === 'H3') break;
      if (tag === 'BUTTON') {
        n = n.nextElementSibling;
        continue;
      }
      var text = String(n.textContent || '').replace(/\s+/g, ' ').trim();
      var buttons = n.querySelectorAll ? n.querySelectorAll('button') : [];
      if (buttons.length) {
        var rest = text;
        var b;
        for (b = 0; b < buttons.length; b++) {
          rest = rest.replace(String(buttons[b].textContent || '').replace(/\s+/g, ' ').trim(), '');
        }
        if (!rest.replace(/\s+/g, '').trim()) {
          n = n.nextElementSibling;
          continue;
        }
      }
      if (text) {
        var leaves = rowLeaves(n);
        if (leaves.length) return leaves[0];
        return n;
      }
      n = n.nextElementSibling;
    }
    return title;
  }

  function computedDisplay(el) {
    try {
      var view = el.ownerDocument && el.ownerDocument.defaultView;
      if (!view || !view.getComputedStyle) return '';
      return String(view.getComputedStyle(el).display || '');
    } catch (err) {
      return '';
    }
  }

  function isInlineTag(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    return tag === 'SPAN' || tag === 'A' || tag === 'STRONG' || tag === 'EM' || tag === 'B';
  }

  /**
   * Freeze a box at its current border-box height. jsdom reports 0, so the
   * lock is a no-op there; a real layout keeps the measured height.
   */
  function lockHeight(el) {
    if (!el || el.nodeType !== 1) return;
    rememberStyle(el);
    var before = el.offsetHeight || 0;
    el.setAttribute('data-bt-locked', '1');
    if (before > 0) {
      el.style.boxSizing = 'border-box';
      el.style.height = before + 'px';
      el.style.maxHeight = before + 'px';
    }
  }

  function tightenLine(anchor) {
    if (!anchor || anchor.nodeType !== 1) return;
    var display = computedDisplay(anchor);
    var inline = display.indexOf('inline') === 0 || (!display && isInlineTag(anchor)) || isInlineTag(anchor);
    var parent = anchor.parentElement;
    if (inline && parent && (parent.tagName === 'A' || isInlineTag(parent))) {
      rememberStyle(parent);
      var parentHeight = parent.offsetHeight || 0;
      parent.style.display = 'flex';
      parent.style.flexWrap = 'nowrap';
      parent.style.alignItems = 'center';
      parent.style.minWidth = '0';
      parent.style.boxSizing = 'border-box';
      parent.style.gap = '6px';
      if (parentHeight > 0) {
        parent.style.height = parentHeight + 'px';
        parent.style.maxHeight = parentHeight + 'px';
      }
    }
    rememberStyle(anchor);
    var before = anchor.offsetHeight || 0;
    anchor.style.display = inline ? 'inline-flex' : 'flex';
    anchor.style.alignItems = 'center';
    anchor.style.flexWrap = 'nowrap';
    anchor.style.minWidth = '0';
    anchor.style.gap = '6px';
    anchor.style.boxSizing = 'border-box';
    anchor.style.verticalAlign = 'middle';
    if (!inline && before > 0) {
      anchor.style.height = before + 'px';
      anchor.style.maxHeight = before + 'px';
    }
  }

  function dismissButton(root) {
    if (!root || !root.querySelectorAll) return null;
    var buttons = root.querySelectorAll('button');
    var i;
    for (i = 0; i < buttons.length; i++) {
      var label = buttons[i].getAttribute('aria-label') || '';
      var text = String(buttons[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (/kapat|dismiss|close/i.test(label) || text === '\u00d7' || text === 'x') return buttons[i];
    }
    return null;
  }

  function edgeGap(a, b) {
    if (!a || !b || !a.width || !b.width) return null;
    var overlapX = a.left < b.right && b.left < a.right;
    var overlapY = a.top < b.bottom && b.top < a.bottom;
    var dx = overlapX ? 0 : a.right <= b.left ? b.left - a.right : a.left - b.right;
    var dy = overlapY ? 0 : a.bottom <= b.top ? b.top - a.bottom : a.top - b.bottom;
    if (overlapX && overlapY) {
      var ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      var oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return -Math.min(ox, oy);
    }
    if (dx === 0) return dy;
    if (dy === 0) return dx;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function hitRect(badge) {
    var btn = badge.shadowRoot && badge.shadowRoot.querySelector('.bt-badge');
    var el = btn || badge;
    if (!el.getBoundingClientRect) return null;
    var r = el.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { left: r.left, right: r.right, top: r.top - 2, bottom: r.bottom + 2, width: r.width, height: r.height + 4 };
  }

  /**
   * Push the pill sideways when its 24px hit area is closer than 24px to the
   * dismiss button on the same row. A vertical shortfall is left as-is so the
   * card height stays put; the screenshot run reports those fixtures.
   */
  function nudgeClearance(badge, root) {
    var dismiss = dismissButton(root);
    if (!dismiss || !dismiss.getBoundingClientRect) return;
    var hit = hitRect(badge);
    var other = dismiss.getBoundingClientRect();
    if (!hit || !other || !other.width) return;
    var gap = edgeGap(hit, { left: other.left, right: other.right, top: other.top, bottom: other.bottom, width: other.width, height: other.height });
    if (gap == null || gap >= 24) return;
    var sameRow = hit.top < other.bottom && other.top < hit.bottom;
    if (!sameRow) return;
    var need = Math.ceil(24 - Math.max(gap, 0));
    if (hit.left <= other.left) badge.style.marginRight = need + 'px';
    else badge.style.marginLeft = need + 'px';
  }

  function insertInlineBadge(anchor, badge) {
    if (!anchor) return;
    var link = anchor.tagName === 'A' ? anchor : anchor.closest && anchor.closest('a');
    if (link && link.parentNode && (anchor === link || link.contains(anchor))) {
      tightenLine(link.parentNode);
      if (link.nextSibling) link.parentNode.insertBefore(badge, link.nextSibling);
      else link.parentNode.appendChild(badge);
      badge.style.marginLeft = '24px';
      return;
    }
    tightenLine(anchor);
    anchor.appendChild(badge);
  }

  function insertCardBadge(card, badge, companyName, position) {
    lockHeight(card);
    var anchor = position === 'top' ? cardCompanyLine(card, companyName) : cardStatusLine(card, companyName);
    if ((!anchor || inLogoColumn(anchor, card)) && position === 'top') anchor = cardStatusLine(card, companyName);
    if (!anchor || inLogoColumn(anchor, card)) anchor = textColumn(card) || jobTitleLink(card);
    if (!anchor || inLogoColumn(anchor, card)) anchor = card;
    insertInlineBadge(anchor, badge);
    if (inLogoColumn(badge, card)) {
      var col = textColumn(card);
      if (col) col.appendChild(badge);
    }
    nudgeClearance(badge, card);
  }

  function forceDetailBadgeVisible(badge) {
    if (!badge || !badge.style) return;
    badge.style.display = 'inline-flex';
    badge.style.visibility = 'visible';
    badge.style.opacity = '1';
    badge.style.overflow = 'visible';
    badge.style.flex = '0 0 auto';
    badge.style.width = 'max-content';
    badge.style.maxWidth = 'none';
    badge.style.minWidth = 'max-content';
    badge.style.position = 'relative';
    badge.style.zIndex = '2';
    badge.style.margin = '4px 0';
  }

  function looksLikeMetaText(text) {
    var C = core();
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (C && C.isLocationLike(t)) return true;
    if (/[·•|]/.test(t) && /(türkiye|turkiye|turkey|başvuru|yayın|önce|ago|applicant)/i.test(t)) return true;
    return false;
  }

  function siblingHasMeta(node) {
    if (!node || !node.parentElement) return false;
    var sib = node.parentElement.firstElementChild;
    while (sib) {
      if (sib !== node && !(sib.hasAttribute && (sib.hasAttribute('data-bt-badge') || sib.hasAttribute('data-bt-modal')))) {
        if (looksLikeMetaText(sib.textContent)) return true;
      }
      sib = sib.nextElementSibling;
    }
    return false;
  }

  /**
   * Rozet başlık satırının hemen ardından, konum satırının öncesine konur.
   * Başlığın içine eklenmez: LinkedIn h1 overflow:hidden ile hapı keser.
   * Yükseklik kilitlenmez; aksi halde satır display:none gibi kaybolur.
   */
  function detailInsertPoint(host, title) {
    var node = title;
    var fallback = { parent: title.parentNode || host, next: title.nextSibling };
    var guard = 0;
    while (node && node.parentElement && guard < 8) {
      guard++;
      if (siblingHasMeta(node)) return { parent: node.parentElement, next: node.nextSibling };
      if (node.parentElement === host || !host.contains(node.parentElement)) break;
      node = node.parentElement;
    }
    return fallback;
  }

  function insertDetailBadge(host, badge, position) {
    normalizeBadgePosition(position);
    forceDetailBadgeVisible(badge);
    var title = detailTitleLine(host);
    if (!title || !title.parentNode) {
      if (host.firstChild) host.insertBefore(badge, host.firstChild);
      else host.appendChild(badge);
      return;
    }
    var slot = detailInsertPoint(host, title);
    var parent = slot && slot.parent;
    if (!parent) {
      host.appendChild(badge);
      return;
    }
    if (slot.next && slot.next.parentNode === parent) parent.insertBefore(badge, slot.next);
    else parent.appendChild(badge);
  }

  function badgeInside(container, kind) {
    if (!container || !container.querySelector) return null;
    var nodes = container.querySelectorAll('[data-bt-badge="' + kind + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var badge = nodes[i];
      var boundary = badge.parentElement && badge.parentElement.closest(SELECTORS.cardBoundary);
      if (kind === 'card' && boundary && boundary !== container && container.contains(boundary)) continue;
      return badge;
    }
    return null;
  }

  function badgeNeedsRebuild(existing, warning, position) {
    if (!existing) return true;
    if (existing.getAttribute('data-bt-sig') !== warning.signature) return true;
    if (existing.getAttribute('data-bt-pos') !== position) return true;
    return false;
  }

  function scan(doc, index, options) {
    var result = { cards: 0, details: 0 };
    if (!doc || !doc.querySelectorAll) return result;
    var position = normalizeBadgePosition(
      options && Object.prototype.hasOwnProperty.call(options, 'badgePosition') ? options.badgePosition : badgePosition
    );
    var C = core();
    if (!C || !index || !index.byKey || !index.byKey.size) {
      clearBadges(doc);
      return result;
    }
    readHidden(sessionStore(doc));
    var keep = new Set();
    function warningFor(group, jobId) {
      if (!group) return null;
      return C.buildCompanyWarning(group.applications, {
        currentJobId: jobId,
        companyName: group.company,
        scannedAt: index.scannedAt,
      });
    }
    var detailHost = findDetailHost(doc);
    if (
      detailHost &&
      detailHost.closest &&
      SELECTORS.resultsList &&
      detailHost.closest(SELECTORS.resultsList)
    ) {
      detailHost = null;
    }
    if (detailHost) {
      var detailJob = jobIdForDetail(detailHost, doc.defaultView);
      var detailCompany = companyFrom(detailHost);
      var detailGroup = C.lookupCompany(detailCompany.name, index);
      var detailWarning = warningFor(detailGroup, detailJob);
      if (detailWarning && detailWarning.detailText && !isHiddenJob(detailJob)) {
        var existingDetail = badgeInside(detailHost, 'detail');
        if (badgeNeedsRebuild(existingDetail, detailWarning, position)) {
          if (existingDetail) detachBadge(existingDetail);
          existingDetail = buildBadgeHost(doc, detailWarning, detailJob, 'detail', position);
          insertDetailBadge(detailHost, existingDetail, position);
        }
        keep.add(existingDetail);
        result.details += 1;
      }
    }
    var stale = doc.querySelectorAll('[data-bt-badge]');
    for (var s = 0; s < stale.length; s++) {
      if (!keep.has(stale[s])) detachBadge(stale[s]);
    }
    applyTheme(doc);
    return result;
  }

  function observeTarget(doc) {
    return doc.querySelector('main, [role="main"]') || null;
  }

  function mutationIsRelevant(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var target = m.target;
      if (target && target.nodeType === 1 && target.closest && target.closest('[data-bt-badge]')) continue;
      if (m.type === 'attributes' || m.type === 'characterData') return true;
      var added = m.addedNodes;
      if (added && added.length) {
        var onlyBadge = true;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1 || !n.hasAttribute || !n.hasAttribute('data-bt-badge')) {
            onlyBadge = false;
            break;
          }
        }
        if (onlyBadge && (!m.removedNodes || !m.removedNodes.length)) continue;
      }
      return true;
    }
    return false;
  }

  /**
   * /jobs dışında yalnızca gezinme dinleyicisi. MutationObserver, storage okuma
   * ve DOM taraması activate() ile açılır, sayfadan çıkınca deactivate() ile kapanır.
   * deps: { window, document, storage, MutationObserver?, scan?, clearBadges? }
   */
  function startBadgeRuntime(deps) {
    var win = deps.window;
    var doc = deps.document;
    var storageApi = deps.storage;
    var Observer = deps.MutationObserver || win.MutationObserver;
    var runScan = deps.scan || scan;
    var dropBadges = deps.clearBadges || clearBadges;
    var loc = win.location;
    var setTimer = win.setTimeout ? win.setTimeout.bind(win) : setTimeout;
    var clearTimer = win.clearTimeout ? win.clearTimeout.bind(win) : clearTimeout;

    var active = false;
    var index = null;
    var timer = null;
    var lastRun = 0;
    var scoped = null;
    var scopedTarget = null;
    var bodyObserver = null;
    var themeObserver = null;
    var snapshotEpoch = 0;
    var loadToken = 0;
    var onStorage = null;

    function onJobs() {
      return isJobsPath(loc.pathname, loc.search);
    }

    function disconnectScoped() {
      if (scoped) scoped.disconnect();
      scoped = null;
      scopedTarget = null;
    }

    function disconnectBody() {
      if (bodyObserver) bodyObserver.disconnect();
      bodyObserver = null;
    }

    function disconnectTheme() {
      if (themeObserver) themeObserver.disconnect();
      themeObserver = null;
    }

    function ensureThemeObserver() {
      if (!active || themeObserver || !doc.documentElement) return;
      themeObserver = new Observer(function () {
        if (!active) return;
        applyTheme(doc);
      });
      var opts = { attributes: true, attributeFilter: ['class', 'style'] };
      themeObserver.observe(doc.documentElement, opts);
      if (doc.body) themeObserver.observe(doc.body, opts);
    }

    function ensureScoped() {
      if (!active) return;
      var target = observeTarget(doc);
      if (!target) {
        disconnectScoped();
        return;
      }
      if (scoped && scopedTarget === target) return;
      disconnectScoped();
      scoped = new Observer(function (mutations) {
        if (!active || !mutationIsRelevant(mutations)) return;
        schedule();
      });
      scopedTarget = target;
      scoped.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-occludable-job-id', 'data-job-id'],
      });
    }

    function ensureBody() {
      if (!active || bodyObserver || !doc.body || !Observer) return;
      bodyObserver = new Observer(function () {
        if (!active) return;
        disconnectScoped();
        schedule();
      });
      bodyObserver.observe(doc.body, { childList: true });
    }

    function refresh() {
      lastRun = Date.now();
      if (!active || !onJobs() || !index) return;
      ensureScoped();
      if (scoped) scoped.disconnect();
      try {
        runScan(doc, index);
      } catch (err) {
        log('scan hatası', err);
      } finally {
        if (active && onJobs() && scoped && scopedTarget && scopedTarget.isConnected) {
          scoped.observe(scopedTarget, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-occludable-job-id', 'data-job-id'],
          });
        }
      }
    }

    function schedule() {
      if (!active || timer) return;
      var wait = Math.max(SCAN_GAP_MS - (Date.now() - lastRun), 40);
      timer = setTimer(function () {
        timer = null;
        refresh();
      }, wait);
    }

    function detachStorage() {
      if (onStorage && storageApi && storageApi.onChanged && storageApi.onChanged.removeListener) {
        storageApi.onChanged.removeListener(onStorage);
      }
      onStorage = null;
    }

    function attachStorage() {
      if (onStorage || !storageApi || !storageApi.onChanged) return;
      onStorage = function (changes, area) {
        if (!active) return;
        if (area !== 'local' || !changes) return;
        var moved = false;
        if (changes[BADGE_POSITION]) {
          badgePosition = normalizeBadgePosition(changes[BADGE_POSITION].newValue);
          moved = true;
        }
        if (changes[STORAGE_SNAPSHOT]) {
          snapshotEpoch++;
          index = indexFromSnapshot(changes[STORAGE_SNAPSHOT].newValue);
          moved = true;
        }
        if (!moved) return;
        dropBadges(doc);
        schedule();
      };
      storageApi.onChanged.addListener(onStorage);
    }

    function readSnapshot() {
      if (!storageApi || !storageApi.local) return;
      var token = ++loadToken;
      var epochAtGet = snapshotEpoch;
      try {
        storageApi.local.get([STORAGE_SNAPSHOT, BADGE_POSITION], function (data) {
          if (!active || token !== loadToken || snapshotEpoch !== epochAtGet) return;
          if (storageApi.runtime && storageApi.runtime.lastError) log('storage', storageApi.runtime.lastError.message);
          else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            log('storage', chrome.runtime.lastError.message);
          }
          badgePosition = normalizeBadgePosition(data && data[BADGE_POSITION]);
          index = indexFromSnapshot(data && data[STORAGE_SNAPSHOT]);
          refresh();
        });
      } catch (err) {
        log('storage okunamadı', err);
      }
    }

    function activate() {
      if (active || !onJobs()) return;
      active = true;
      ensureBody();
      ensureThemeObserver();
      attachStorage();
      readSnapshot();
      log('aktif', loc.pathname);
    }

    function deactivate() {
      if (!active) return;
      active = false;
      loadToken++;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      disconnectScoped();
      disconnectBody();
      disconnectTheme();
      detachStorage();
      index = null;
      dropBadges(doc);
      log('pasif', loc.pathname);
    }

    function onNavigate() {
      if (onJobs()) {
        if (!active) activate();
        else schedule();
      } else if (active) {
        deactivate();
      }
    }

    win.addEventListener('popstate', onNavigate);
    win.addEventListener('pageshow', onNavigate);
    win.addEventListener('hashchange', onNavigate);
    // LinkedIn moves between /jobs/search and /jobs/collections/* with pushState.
    try {
      var hist = win.history;
      if (hist && !hist.__btNavHook && typeof hist.pushState === 'function') {
        hist.__btNavHook = true;
        ['pushState', 'replaceState'].forEach(function (name) {
          var orig = hist[name];
          if (typeof orig !== 'function') return;
          hist[name] = function () {
            var result = orig.apply(hist, arguments);
            onNavigate();
            return result;
          };
        });
      }
    } catch (err) {
      log('history', err);
    }
    if (win.navigation && typeof win.navigation.addEventListener === 'function') {
      win.navigation.addEventListener('navigatesuccess', onNavigate);
    }

    if (onJobs()) activate();
    return { onNavigate: onNavigate };
  }

  /**
   * v1.4.2: the inline detail pill is replaced by float-badge.js (fixed, Shadow DOM,
   * survives LinkedIn re-renders). This file stays loaded for its helpers
   * (findDetailHost, companyFrom) which float-badge.js uses on the older layout.
   * Set to true to bring the old inline pill back next to the floating one.
   */
  var INLINE_BADGES_ENABLED = false;

  function boot() {
    if (!INLINE_BADGES_ENABLED) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.top !== window) return;
    if (window.__basvuruBadgesBooted) return;
    if (!core()) {
      log('badges-core.js yüklenmedi');
      return;
    }
    window.__basvuruBadgesBooted = true;
    startBadgeRuntime({
      window: window,
      document: document,
      storage: typeof chrome !== 'undefined' ? chrome.storage : null,
    });
  }

  var api = {
    BADGE_CSS: BADGE_CSS,
    SELECTORS: SELECTORS,
    isJobsPath: isJobsPath,
    startBadgeRuntime: startBadgeRuntime,
    scan: scan,
    pageIsDark: pageIsDark,
    clearBadges: clearBadges,
    companyFrom: companyFrom,
    findDetailHost: findDetailHost,
    findCards: findCards,
  };

  var badgeRoot = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this;
  badgeRoot.BasvuruJobBadges = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.onChanged &&
    !(typeof module !== 'undefined' && module.exports)
  ) {
    boot();
  }
})();
