/**
 * Yüzen firma uyarısı (v1.4.2, sağlamlaştırma v1.4.3).
 *
 * LinkedIn iş sayfalarında (arama sonuçları, /jobs/view/, koleksiyonlar) o an açık
 * ilanın firmasına daha önce başvurulduysa sağ altta sabit, sarı bir uyarı gösterir:
 * "Daha önce bu firmanın N ilanına başvurdunuz". Tıklanınca o firmaya yapılmış tüm
 * başvuruları listeleyen bir pencere açılır.
 *
 * Neden ayrı dosya: eski satır içi rozet (badges.js) LinkedIn'in sınıf adlarına ve
 * h1 başlığına bağlıydı; yeni /jobs/search-results/ düzeninde bunlar yok. Bu
 * dosya rozeti LinkedIn DOM'unun içine değil <html> köküne, Shadow DOM içinde koyar;
 * LinkedIn yeniden çizse de rozet silinmez. Silinirse hemen geri takılır.
 *
 * Firma tespiti (öncelik sırası; URL'de iş kimliği yoksa hiç tahmin yapılmaz):
 *   1. URL'deki iş kimliği (currentJobId / /jobs/view/ID) kayıtlı başvurulardan biriyse
 *   2. JSON-LD JobPosting, yalnızca bu iş kimliğini içeriyorsa
 *   3. Ayrıntı kapsamındaki İLK /company/<slug> bağlantısı (slug, sonra birebir ad).
 *      Kapsam: iş kimliğine bağlı üst kart > badges.js findDetailHost > sağ sütunun üst
 *      bölgesi. aside, "Benzer ilanlar" vb. bölümler ve başka ilana ait bloklar hariç.
 *      Bağlantı okunduysa firma odur; kart/metin ile ikinci tahmin yapılmaz.
 *   4. Aynı bloktaki şirket logosunun görsel kimliği
 *   5. Soldaki seçili ilan kartı (currentJobId) içindeki firma satırı
 *   6. Eski düzen: badges.js companyFrom
 *   7. Üst bölgede firma adıyla birebir eşleşen kısa metin / sekme başlığı
 *      (yalnızca ayırt edici adlar; "Remote", "Gizli" gibi genel adlar hariç)
 * Ad eşleşmesi yalnızca normalize edilmiş birebir eşitliktir (önek/alt dize yok).
 *
 * İlan değişince: uyarı hemen gizlenir; yeni sonuç ancak ayrıntı panelinin yeni ilana
 * ait olduğu anlaşılınca (iş kimliği bağlantısı, seçili kartla uyum, farklı firma/metin
 * ya da süre aşımı) gösterilir. Eski panel önceki iş kimliğini gösteriyorsa beklenir.
 *
 * Hata ayıklama: localStorage.btDebug = '1'
 */
(function basvuruFloatBadge() {
  'use strict';

  var URL_ALLOW = typeof window !== 'undefined' ? window.BasvuruUrlAllow : null;
  var STORAGE_SNAPSHOT = 'basvuruSnapshot';
  var HOST_ATTR = 'data-bt-float';
  var MODAL_ATTR = 'data-bt-float-modal';
  var URL_POLL_MS = 400; // no Navigation API
  var URL_POLL_NAV_MS = 1000; // Navigation API present: poll is only a fallback
  var RECHECK_MS = 3000;
  var MUTATION_GAP_MS = 250;
  var CONFIRM_MAX_MS = 2500; // unconfirmed pane with the same company/text: accept after this
  var STALE_REF_MAX_MS = 8000; // pane still references the previous job id / card disagrees

  var FLOAT_CSS = [
    ':host { all: initial; }',
    '.bt-wrap { position: fixed; right: 20px; bottom: 72px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end;',
    '  font-family: -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }',
    '.bt-card { position: relative; box-sizing: border-box; display: flex; align-items: flex-start; gap: 10px; max-width: 360px; min-width: 240px;',
    '  margin: 0; padding: 12px 36px 12px 12px; border: 1px solid #E0B100; border-left: 6px solid #F5B700; border-radius: 10px;',
    '  background: #FFF7CC; color: #4A3700; box-shadow: 0 6px 24px rgba(0,0,0,.22); cursor: pointer; text-align: left;',
    '  font: inherit; font-size: 14px; line-height: 19px; }',
    '.bt-card:hover { background: #FFF1A8; }',
    '.bt-card:focus-visible, .bt-min:focus-visible, .bt-pill:focus-visible, .bt-x:focus-visible { outline: 2px solid #0A66C2; outline-offset: 2px; }',
    '.bt-ico { flex: 0 0 auto; width: 22px; height: 22px; color: #B07D00; margin-top: 1px; }',
    '.bt-txt { min-width: 0; }',
    '.bt-title { display: block; font-weight: 700; font-size: 14px; }',
    '.bt-co { display: block; margin-top: 2px; font-weight: 600; font-size: 13px; color: #5C4500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 290px; }',
    '.bt-extra { display: block; margin-top: 2px; font-size: 12px; color: #6B5300; }',
    '.bt-hint { display: block; margin-top: 4px; font-size: 12px; color: #7A5E00; text-decoration: underline; }',
    '.bt-min { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; padding: 0; margin: 0; border: 0; border-radius: 6px;',
    '  background: transparent; color: #6B5300; font: inherit; font-size: 18px; line-height: 24px; cursor: pointer; }',
    '.bt-min:hover { background: rgba(0,0,0,.08); }',
    '.bt-pill { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 36px; padding: 0 12px; margin: 0;',
    '  border: 1px solid #E0B100; border-radius: 18px; background: #FFD84D; color: #3D2E00; box-shadow: 0 4px 16px rgba(0,0,0,.25);',
    '  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }',
    '.bt-pill .bt-ico { width: 18px; height: 18px; margin: 0; color: #6B4E00; }',
    '[hidden] { display: none !important; }',
    /* modal */
    '.bt-modal { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: flex-start; justify-content: center; padding: 16px; box-sizing: border-box;',
    '  font-family: -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #191919; }',
    '.bt-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.5); }',
    '.bt-dialog { position: relative; box-sizing: border-box; display: flex; flex-direction: column; width: min(620px, calc(100vw - 32px));',
    '  max-height: min(82vh, 720px); margin-top: 7vh; padding: 20px 24px; border-radius: 12px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.3); overflow: hidden; }',
    '.bt-head { display: flex; align-items: flex-start; gap: 8px; }',
    '.bt-h { flex: 1 1 auto; margin: 0; font-size: 18px; line-height: 24px; font-weight: 700; }',
    '.bt-x { flex: 0 0 auto; width: 32px; height: 32px; padding: 0; margin: 0; border: 0; border-radius: 8px; background: transparent; color: inherit; font-size: 22px; line-height: 32px; cursor: pointer; }',
    '.bt-x:hover { background: #F1F3F5; }',
    '.bt-sub { margin: 4px 0 0; font-size: 13px; color: #555; }',
    '.bt-warn { margin: 12px 0 0; padding: 8px 10px; border-radius: 8px; background: #FFF7CC; border: 1px solid #F0D060; color: #4A3700; font-size: 13px; }',
    '.bt-list { list-style: none; margin: 12px 0 0; padding: 0; overflow: auto; min-height: 0; flex: 1 1 auto; }',
    '.bt-list li { display: flex; align-items: flex-start; gap: 12px; margin: 0; padding: 12px 0; border-bottom: 1px solid #E6E6E6; }',
    '.bt-list li[data-current] { border-left: 3px solid #F5B700; padding-left: 8px; }',
    '.bt-main { flex: 1 1 auto; min-width: 0; }',
    '.bt-job { font-weight: 600; font-size: 15px; line-height: 20px; color: #0A66C2; text-decoration: none; }',
    'a.bt-job:hover { text-decoration: underline; }',
    'span.bt-job { color: #191919; }',
    '.bt-cur { margin-left: 6px; font-size: 12px; font-weight: 700; color: #7A4B00; }',
    '.bt-date { margin: 2px 0 0; font-size: 13px; color: #666; }',
    '.bt-chip { flex: 0 1 auto; max-width: 220px; height: auto; min-height: 22px; padding: 3px 8px; border-radius: 11px; font-size: 12px; line-height: 16px; font-weight: 600; white-space: normal; text-align: center; background: #F1F3F5; color: #4B5563; }',
    '.bt-chip-viewed { background: #EAF2FB; color: #0A4D8C; }',
    '.bt-chip-cv { background: #E6F4EA; color: #1D6B35; }',
    '.bt-foot { margin: 12px 0 0; font-size: 12px; color: #666; }',
  ].join('\n');

  function core() {
    return globalThis.BasvuruBadgesCore;
  }

  function log() {
    var on = false;
    try {
      on = globalThis.localStorage && globalThis.localStorage.getItem('btDebug') === '1';
    } catch (e) {}
    if (!on) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[BasvuruFloat]');
    console.log.apply(console, args);
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function firstSegment(s) {
    return clean(s).split(/\s*[\u00b7\u2022|]\s*/)[0].trim();
  }

  function isJobsPage(loc) {
    var path = String((loc && loc.pathname) || '').replace(/\/+$/, '') || '/';
    if (/(^|\/)jobs-tracker(\/|$)/.test(path) || /^\/jobs\/tracker(\/|$)/.test(path)) return false;
    if (path !== '/jobs' && path.indexOf('/jobs/') !== 0) return false;
    if (/[?&]stage=applied(?:&|$)/.test(String((loc && loc.search) || ''))) return false;
    return true;
  }

  function jobIdFromLocation(loc) {
    try {
      var m = String(loc.search || '').match(/[?&]currentJobId=(\d{5,})/);
      if (m) return m[1];
      var p = String(loc.pathname || '').match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{5,})/);
      return p ? p[1] : '';
    } catch (e) {
      return '';
    }
  }

  var CHROME_SEL = 'header, nav, footer, [role="banner"], [role="navigation"], [role="search"], [role="combobox"], [role="dialog"], [aria-modal="true"]';
  /** Page areas that are never the open job's top card when we have no job-id anchor. */
  var SIDE_SEL = 'aside, [role="complementary"]';
  var LIST_CARD_SEL = [
    'li',
    '[role="listitem"]',
    '[role="option"]',
    'div[role="button"]',
    '[data-occludable-job-id]',
    '.job-card-container',
    '.jobs-search-results__list-item',
    '.scaffold-layout__list',
    '.jobs-search-results-list',
    '.jobs-search__results-list',
  ].join(', ');
  var CARD_ROOT_SEL = 'li, [role="listitem"], div[role="button"], [data-occludable-job-id], .job-card-container';
  var COMPANY_LINK_SEL = 'a[href*="/company/"], a[href*="/showcase/"]';
  var JOB_REF_SEL = 'a[href*="/jobs/view/"], a[href*="currentJobId="], [data-job-id], [data-occludable-job-id], [data-entity-urn*="obPosting:"]';
  /** Section headings of recommendation blocks ("Benzer ilanlar", "People also viewed", …). */
  var OTHER_SECTION_RE =
    /benzer|similar|also viewed|g\u00f6r\u00fcnt\u00fcleyen|goruntuleyen|\u00f6nerilen|onerilen|recommended|more jobs|di\u011fer (?:i\u015f|ilan)|people also|ilginizi|you may|you might|jobs for you|sizin i\u00e7in/i;

  function ours(el) {
    return !!(el && el.closest && el.closest('[' + HOST_ATTR + '], [' + MODAL_ATTR + ']'));
  }

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isListPage(loc) {
    return !/^\/jobs\/view\//.test(String(loc.pathname || ''));
  }

  /** On the two-column search page, the detail pane is right of this x. */
  function detailMinX(win, loc) {
    if (!isListPage(loc)) return -Infinity;
    var w = win.innerWidth || 0;
    if (w < 900) return -Infinity;
    return w * 0.3;
  }

  function topRegionMaxY(win) {
    return Math.max(420, Math.min(700, (win.innerHeight || 800) * 0.6));
  }

  function cssEscapeId(id) {
    return String(id || '').replace(/[^0-9]/g, '');
  }

  /** Numeric job ids referenced by an element (href / data attributes / urn). */
  function jobIdsOfNode(n) {
    var C = core();
    var out = [];
    var href = n.getAttribute && n.getAttribute('href');
    if (href) {
      var h = C.jobIdFromHref(href);
      if (/^\d{5,}$/.test(h)) out.push(h);
    }
    ['data-job-id', 'data-occludable-job-id', 'data-entity-urn'].forEach(function (a) {
      var v = n.getAttribute && n.getAttribute(a);
      var m = v && String(v).match(/(\d{5,})/);
      if (m) out.push(m[1]);
    });
    return out;
  }

  /** True when `el` (or its descendants) references job `id`. */
  function refsJob(el, id) {
    if (!el || !id || !el.querySelector) return false;
    var i = cssEscapeId(id);
    if (!i) return false;
    var sel =
      'a[href*="/jobs/view/"][href*="' + i + '"], a[href*="currentJobId=' + i + '"], [data-job-id="' + i + '"], [data-entity-urn*="' + i + '"]';
    return !!((el.matches && el.matches(sel)) || el.querySelector(sel));
  }

  /** True when `el` references some job other than `id` (another job's card / similar job). */
  function refsOtherJob(el, id) {
    if (!el || !el.querySelectorAll) return false;
    var nodes = el.querySelectorAll(JOB_REF_SEL);
    for (var i = 0; i < nodes.length && i < 40; i++) {
      var ids = jobIdsOfNode(nodes[i]);
      for (var k = 0; k < ids.length; k++) if (ids[k] !== id) return true;
    }
    return false;
  }

  /** Inside a recommendation section (heading / aria-label says similar / also viewed / …). */
  function inOtherSection(el, stop) {
    var cur = el.parentElement;
    for (var d = 0; cur && d < 12; d++, cur = cur.parentElement) {
      if (cur === stop || cur.tagName === 'BODY' || cur.tagName === 'MAIN') break;
      var label = cur.getAttribute && cur.getAttribute('aria-label');
      if (label && OTHER_SECTION_RE.test(label)) return true;
      var hd = cur.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > header h2, :scope > header h3, :scope > div > h2, :scope > div > h3, :scope > [role="heading"]');
      if (hd && !hd.contains(el) && OTHER_SECTION_RE.test(clean(hd.textContent).slice(0, 120))) return true;
    }
    return false;
  }

  function distinctCompanySlugs(el) {
    var C = core();
    var seen = {};
    var n = 0;
    var links = el.querySelectorAll(COMPANY_LINK_SEL);
    for (var i = 0; i < links.length && i < 40; i++) {
      var s = C.companySlugFromHref(links[i].getAttribute('href'));
      if (s && !seen[s]) {
        seen[s] = true;
        n++;
      }
    }
    return n;
  }

  /**
   * A link that sits in a small single-company block describing another job (similar-jobs
   * card with its own job link). Climbing stops at the first ancestor that is too big to
   * be one card (long text or several companies): the top card + description + similar
   * jobs wrapper must not make the top card's own link look like "another job".
   */
  function belongsToOtherJob(el, jobId, stop) {
    var cur = el.parentElement;
    for (var d = 0; cur && d < 5; d++, cur = cur.parentElement) {
      if (cur === stop || cur.tagName === 'BODY' || cur.tagName === 'MAIN') break;
      if (clean(cur.textContent).length > 600 || distinctCompanySlugs(cur) > 1) break;
      if (refsOtherJob(cur, jobId)) return true;
    }
    return false;
  }

  /**
   * Where to look for the open job's company, most trusted first:
   *  1. jobId-anchored: an element in the detail area that references the current job id
   *     (title link /jobs/view/ID, data-job-id, urn); climb to the smallest ancestor with
   *     a company signal that does not also hold another job (top card).
   *  2. badges.js findDetailHost (old layout class names), if it sits in the detail column.
   *  3. Fallback: main / body, restricted to the detail column and the top region, with
   *     aside / recommendation sections / other-job blocks excluded.
   * scope: { root, anchored, fallback }
   */
  function findDetailScope(doc, win, loc, jobId) {
    var minX = detailMinX(win, loc);
    var i = cssEscapeId(jobId);
    var freshPane = false;
    if (i) {
      var sel = 'a[href*="/jobs/view/"][href*="' + i + '"], [data-job-id="' + i + '"], [data-entity-urn*="' + i + '"]';
      var anchors = doc.querySelectorAll(sel);
      for (var a = 0; a < anchors.length && a < 12; a++) {
        var n = anchors[a];
        if (ours(n) || n.closest(CHROME_SEL) || n.closest(LIST_CARD_SEL)) continue;
        if (!isVisible(n)) continue;
        if (n.getBoundingClientRect().left < minX) continue;
        var cur = n;
        var clean0 = null;
        for (var d = 0; d < 10; d++) {
          cur = cur.parentElement;
          if (!cur || cur === doc.body || cur === doc.documentElement) break;
          if (cur.matches(LIST_CARD_SEL)) break;
          if (refsOtherJob(cur, i)) break;
          clean0 = cur;
          if (cur.querySelector(COMPANY_LINK_SEL + ', img[src*="licdn.com"]')) return { root: cur, anchored: true, fallback: false };
        }
        // The pane does show this job, but the top card could not be isolated: search the
        // wider area with the fallback exclusions, remembering that the pane is fresh.
        freshPane = freshPane || !!clean0;
      }
    }
    var B = globalThis.BasvuruJobBadges;
    if (B && B.findDetailHost) {
      try {
        var host = B.findDetailHost(doc);
        if (host && !ours(host) && !host.closest(CHROME_SEL) && isVisible(host) && host.getBoundingClientRect().left >= minX - 1) {
          return { root: host, anchored: freshPane || refsJob(host, i), fallback: false, legacy: true };
        }
      } catch (e) {}
    }
    return { root: doc.querySelector('main, [role="main"]') || doc.body, anchored: false, fallback: true, fresh: freshPane };
  }

  function nameFromCompanyLink(a) {
    var C = core();
    var text = C.stripLogoSuffix(firstSegment(a.textContent || ''));
    if (text && text.length <= 120 && C.usableCompany(text) && !C.isNoiseLine(text)) return text;
    var aria = clean(a.getAttribute('aria-label') || a.getAttribute('title') || '');
    aria = aria.replace(/^(?:şirket|firma|company)\s*[:\-]\s*/i, '');
    aria = C.stripLogoSuffix(firstSegment(aria));
    if (aria && aria.length <= 120 && C.usableCompany(aria)) return aria;
    var img = a.querySelector('img[alt]');
    if (img) {
      var alt = C.stripLogoSuffix(firstSegment(img.getAttribute('alt') || ''));
      if (alt && alt.length <= 120 && C.usableCompany(alt)) return alt;
    }
    return '';
  }

  function usableInScope(el, scope, win, loc, jobId) {
    if (ours(el) || el.closest(CHROME_SEL) || el.closest(LIST_CARD_SEL)) return false;
    if (scope.fallback && el.closest(SIDE_SEL)) return false;
    if (!isVisible(el)) return false;
    var r = el.getBoundingClientRect();
    if (scope.fallback && r.left + r.width < detailMinX(win, loc)) return false;
    if (scope.fallback && r.top > topRegionMaxY(win)) return false;
    if (inOtherSection(el, scope.root)) return false;
    if (belongsToOtherJob(el, jobId, scope.root)) return false;
    return true;
  }

  /**
   * The open job's company link: the FIRST usable company link in the scope (the top
   * card comes first in document order). Further links are only used to fill in the
   * name when they point to the same company (logo link + name link pairs).
   */
  function primaryCompanyLink(doc, win, loc, scope, jobId) {
    var C = core();
    var nodes = scope.root.querySelectorAll(COMPANY_LINK_SEL);
    var primary = null;
    for (var i = 0; i < nodes.length && i < 60; i++) {
      var a = nodes[i];
      var slug = C.companySlugFromHref(a.getAttribute('href'));
      if (primary && slug !== primary.slug) continue;
      var name = nameFromCompanyLink(a);
      if (!slug && !name) continue;
      if (!usableInScope(a, scope, win, loc, jobId)) continue;
      if (!primary) {
        var img = a.querySelector('img');
        primary = { el: a, slug: slug, name: name, logo: img ? img.currentSrc || img.src || '' : '' };
        if (primary.name || !slug) break;
        continue;
      }
      if (slug && slug === primary.slug && name) {
        primary.name = name;
        break;
      }
    }
    return primary;
  }

  /** Logo next to the primary link (same small block), or inside an anchored scope. */
  function scopedLogos(scope, primary) {
    var out = [];
    if (primary && primary.logo) out.push(primary.logo);
    var box = null;
    if (scope.anchored) box = scope.root;
    else if (primary) {
      box = primary.el.parentElement;
      if (box && box.parentElement && box.querySelectorAll(COMPANY_LINK_SEL).length <= 2) box = box.parentElement;
      if (box && box.querySelectorAll(COMPANY_LINK_SEL).length > 3) box = primary.el.parentElement;
    }
    if (!box) return out;
    var imgs = box.querySelectorAll('img[src*="licdn.com"]');
    for (var i = 0; i < imgs.length && out.length < 3; i++) {
      if (ours(imgs[i]) || imgs[i].closest(LIST_CARD_SEL) || inOtherSection(imgs[i], box)) continue;
      var src = imgs[i].currentSrc || imgs[i].src || '';
      if (/company-logo|logo/i.test(src)) out.push(src);
    }
    return out;
  }

  var ACTIVE_SEL = [
    '[aria-current="page"]',
    '[aria-current="true"]',
    '[aria-selected="true"]',
    '.jobs-search-results-list__list-item--active',
    '.job-card-container--active',
    '[class*="list-item--active"]',
    '[class*="card--active"]',
  ].join(', ');

  function linesOf(el) {
    var raw = String(el.innerText || el.textContent || '');
    return raw
      .split(/\n+/)
      .map(clean)
      .filter(Boolean);
  }

  /**
   * Company line of the selected list card. { name, anchored } — anchored when the card
   * was found through the current job id, not just an "active" marker.
   */
  function activeCardCompany(doc, win, loc, jobId) {
    var C = core();
    var cards = [];
    var i = cssEscapeId(jobId);
    if (i) {
      var sel =
        '[data-occludable-job-id="' + i + '"], [data-job-id="' + i + '"], a[href*="currentJobId=' + i + '"], a[href*="/jobs/view/' + i + '"]';
      var hits = doc.querySelectorAll(sel);
      for (var h = 0; h < hits.length && h < 10; h++) {
        var card = hits[h].closest(CARD_ROOT_SEL);
        if (card && !ours(card) && !card.closest(CHROME_SEL) && !refsOtherJob(card, i)) cards.push({ el: card, anchored: true });
      }
    }
    var minX = detailMinX(win, loc);
    var act = doc.querySelectorAll(ACTIVE_SEL);
    for (var j = 0; j < act.length && j < 20; j++) {
      var el = act[j];
      if (ours(el) || el.closest(CHROME_SEL)) continue;
      var c = el.closest(CARD_ROOT_SEL) || el;
      var t = clean(c.textContent);
      if (t.length < 10 || t.length > 600) continue;
      // An "active" marker in the detail pane (tabs etc.) is not the selected job card.
      if (isFinite(minX) && isVisible(c) && c.getBoundingClientRect().left >= minX) continue;
      if (i && refsOtherJob(c, i)) continue;
      cards.push({ el: c, anchored: false });
    }
    for (var k = 0; k < cards.length; k++) {
      var lines = linesOf(cards[k].el);
      if (lines.length < 2) continue;
      var name = C.pickCompanyFromLines(lines, lines[0]);
      if (name && C.usableCompany(name)) return { name: name, anchored: cards[k].anchored };
    }
    return null;
  }

  function legacyDetailCompany(scope) {
    var B = globalThis.BasvuruJobBadges;
    if (!scope.legacy || !B || !B.companyFrom) return '';
    try {
      var hit = B.companyFrom(scope.root);
      return (hit && hit.name) || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Short visible text at the top of the detail scope that exactly equals a stored company.
   * Generic / very short names ("Remote", "Gizli", "AB") never match through free text.
   */
  function topTextExactGroup(doc, win, loc, index, scope, jobId) {
    var C = core();
    var minX = detailMinX(win, loc);
    var maxY = topRegionMaxY(win);
    var nodes = scope.root.querySelectorAll('a, span, p, div, h1, h2, h3, strong');
    var scanned = 0;
    for (var i = 0; i < nodes.length && scanned < 1500; i++) {
      var el = nodes[i];
      if (el.childElementCount > 1) continue;
      var t = clean(el.textContent);
      if (!t || t.length > 120 || t.length < 2) continue;
      scanned++;
      var key = C.canonicalCompanyKey(C.stripLogoSuffix(firstSegment(t)));
      if (!key || !index.byKey.has(key) || !C.isDistinctiveCompanyKey(key)) continue;
      if (ours(el) || el.closest(CHROME_SEL) || el.closest(LIST_CARD_SEL)) continue;
      if (scope.fallback && el.closest(SIDE_SEL)) continue;
      if (!isVisible(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.left < minX || r.top > maxY || r.bottom < 0) continue;
      if (inOtherSection(el, scope.root) || belongsToOtherJob(el, jobId, scope.root)) continue;
      return { group: index.byKey.get(key), el: el };
    }
    return null;
  }

  function titleGroup(doc, index) {
    var C = core();
    var parts = String(doc.title || '').split(/\s+[|\u2013\u2014-]\s+/);
    for (var i = 1; i < parts.length; i++) {
      var p = clean(parts[i]);
      if (!p || /^linkedin$/i.test(p)) continue;
      var key = C.canonicalCompanyKey(p);
      if (key && index.byKey.has(key) && C.isDistinctiveCompanyKey(key)) return index.byKey.get(key);
    }
    return null;
  }

  /**
   * JSON-LD JobPosting (present on some /jobs/view/ loads). Only trusted when the blob
   * mentions the current job id: after an SPA switch the blob still describes the job
   * the page was loaded with.
   */
  function jsonLdCompany(doc, jobId) {
    if (!jobId) return null;
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length && i < 5; i++) {
      var txt = scripts[i].textContent || '';
      if (txt.length > 400000 || txt.indexOf(jobId) === -1) continue;
      var data;
      try {
        data = JSON.parse(txt);
      } catch (e) {
        continue;
      }
      var list = Array.isArray(data) ? data : data && data['@graph'] ? data['@graph'] : [data];
      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        if (!o || o['@type'] !== 'JobPosting' || !o.hiringOrganization) continue;
        var org = o.hiringOrganization;
        return {
          name: clean(typeof org === 'string' ? org : org.name || ''),
          slug: core().companySlugFromHref(org.sameAs || org.url || ''),
        };
      }
    }
    return null;
  }

  function groupByKey(index, key) {
    return key && index.byKey.has(key) ? index.byKey.get(key) : null;
  }

  /** Detail region around the detected company (for the stale-pane guard). */
  function regionBox(scope, el, win, loc) {
    if (!scope.fallback) return scope.root;
    if (!el) return null;
    var minX = detailMinX(win, loc);
    var cur = el;
    for (var d = 0; d < 8; d++) {
      var p = cur.parentElement;
      if (!p || p === scope.root || p.tagName === 'BODY' || p.tagName === 'MAIN') break;
      if (p.matches(LIST_CARD_SEL) || p.closest(CHROME_SEL) || p.closest(SIDE_SEL)) break;
      if (isVisible(p) && p.getBoundingClientRect().left < minX - 1) break;
      cur = p;
    }
    return cur;
  }

  /** First job id referenced in the region, skipping list cards and recommendation blocks. */
  function firstJobRef(box) {
    if (!box || !box.querySelectorAll) return '';
    var nodes = box.querySelectorAll(JOB_REF_SEL);
    for (var i = 0; i < nodes.length && i < 30; i++) {
      var n = nodes[i];
      if (ours(n) || n.closest(LIST_CARD_SEL) || n.closest(SIDE_SEL) || inOtherSection(n, box)) continue;
      var ids = jobIdsOfNode(n);
      if (ids.length) return ids[0];
    }
    return '';
  }

  /**
   * Decide which past-application group (if any) the open job belongs to.
   * status: 'match' | 'nomatch' (company known, no history) | 'unknown'
   * Extra fields for the runtime's stale-pane guard:
   *   anchored    – evidence is tied to the current job id
   *   staleRef    – the region still references the previous job id (and not the current)
   *   identity    – 'g:<group key>' or 'n:<normalized name>' of the detected company
   *   fingerprint – start of the detail region's text
   */
  function detectCurrent(doc, win, index, opts) {
    var C = core();
    var loc = win.location;
    var jobId = jobIdFromLocation(loc);
    var prevJobIds = (opts && opts.prevJobIds) || [];
    var res = { status: 'unknown', group: null, source: '', name: '', jobId: jobId, anchored: false, staleRef: false, identity: '', fingerprint: '', cardAgrees: null };
    if (!index || !index.byKey || !index.byKey.size) return res;
    // No open job (jobs home, collections without selection): never guess from the page.
    if (!jobId) return res;
    var scope = null;
    var regionEl = null;
    function finish() {
      if (res.group) res.identity = 'g:' + res.group.key;
      else if (res.name) res.identity = 'n:' + C.canonicalCompanyKey(res.name);
      if (scope) {
        var box = regionBox(scope, regionEl, win, loc);
        if (box) {
          res.fingerprint = clean(box.textContent).slice(0, 400);
          var ref = firstJobRef(box);
          if (ref && ref === jobId) res.anchored = true;
          else if (ref && prevJobIds.indexOf(ref) !== -1) res.staleRef = true;
        }
      }
      // Cross-check with the selected list card (updated by LinkedIn on click, before the
      // detail pane). Only needed while the runtime still doubts the pane is fresh.
      if (opts && opts.checkCard && !res.anchored && res.status !== 'unknown') {
        if (res.source === 'card') res.cardAgrees = true;
        else {
          var card = activeCardCompany(doc, win, loc, jobId);
          if (card) {
            var ck = C.canonicalCompanyKey(card.name);
            var cg = C.lookupCompany(card.name, index);
            res.cardAgrees = ck === C.canonicalCompanyKey(res.name) || !!(res.group && ((cg && cg.key === res.group.key) || ck === res.group.key));
          }
        }
      }
      return res;
    }
    function hit(group, source, name, anchored) {
      res.status = 'match';
      res.group = group;
      res.source = source;
      res.name = name || group.company;
      if (anchored) res.anchored = true;
      return finish();
    }
    if (index.byJobId && index.byJobId.has(jobId)) {
      var g0 = groupByKey(index, index.byJobId.get(jobId));
      if (g0) return hit(g0, 'jobId', '', true);
    }
    var ld = jsonLdCompany(doc, jobId);
    if (ld) {
      if (ld.slug && index.bySlug && index.bySlug.has(ld.slug)) {
        var gj = groupByKey(index, index.bySlug.get(ld.slug));
        if (gj) return hit(gj, 'jsonld', ld.name, true);
      }
      var gjn = ld.name ? C.lookupCompany(ld.name, index) : null;
      if (gjn) return hit(gjn, 'jsonld', ld.name, true);
    }
    scope = findDetailScope(doc, win, loc, jobId);
    res.anchored = !!(scope.anchored || scope.fresh);
    var knownName = ld && ld.name ? ld.name : '';
    var L = primaryCompanyLink(doc, win, loc, scope, jobId);
    if (L) {
      regionEl = L.el;
      if (L.slug && index.bySlug && index.bySlug.has(L.slug)) {
        var gs = groupByKey(index, index.bySlug.get(L.slug));
        if (gs) return hit(gs, 'slug', L.name);
      }
      if (L.name) {
        var gn = C.lookupCompany(L.name, index);
        if (gn) return hit(gn, 'link', L.name);
        if (!knownName) knownName = L.name;
      }
    }
    if (index.byLogo && index.byLogo.size) {
      var logos = scopedLogos(scope, L);
      for (var i = 0; i < logos.length && i < 3; i++) {
        var asset = C.logoAssetId(logos[i]);
        if (asset && index.byLogo.has(asset)) {
          var gl = groupByKey(index, index.byLogo.get(asset));
          if (gl) return hit(gl, 'logo');
        }
      }
    }
    // Detail pane had a readable company link: that is the company. Do not second-guess
    // it with list cards or free text (those are how other companies leak in).
    if (L && L.name) {
      res.status = 'nomatch';
      res.name = L.name;
      return finish();
    }
    var card = activeCardCompany(doc, win, loc, jobId);
    if (card) {
      var gc = C.lookupCompany(card.name, index);
      if (gc) return hit(gc, 'card', card.name, card.anchored);
      if (!knownName) knownName = card.name;
    }
    var legacy = legacyDetailCompany(scope);
    if (legacy) {
      var gg = C.lookupCompany(legacy, index);
      if (gg) return hit(gg, 'legacy', legacy);
      if (!knownName) knownName = legacy;
    }
    if (!knownName) {
      var gt = topTextExactGroup(doc, win, loc, index, scope, jobId);
      if (gt) {
        regionEl = gt.el;
        return hit(gt.group, 'text');
      }
      var gti = titleGroup(doc, index);
      if (gti) return hit(gti, 'title');
    }
    if (knownName) {
      res.status = 'nomatch';
      res.name = knownName;
    }
    return finish();
  }

  function indexFromSnapshot(snapshot) {
    var C = core();
    if (!C || !snapshot) return null;
    var apps = C.applicationsFromSnapshot(snapshot);
    if (!apps.length) return null;
    return C.indexApplications(apps, { scannedAt: C.scannedAtFromSnapshot(snapshot) });
  }

  /* ---------------- UI ---------------- */

  function warnIcon(doc, cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls || 'bt-ico');
    svg.setAttribute('aria-hidden', 'true');
    var path = doc.createElementNS(NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M12 2 1 21h22L12 2zm0 4.2L19.5 19h-15L12 6.2zM11 10v5h2v-5h-2zm0 6v2h2v-2h-2z');
    svg.appendChild(path);
    return svg;
  }

  var CHIP = { cv: 'cv', viewed: 'viewed', unseen: 'unseen', closed: 'closed', repostUnseen: 'repost' };

  function createUi(doc, win) {
    var host = null;
    var shadow = null;
    var els = {};
    var modalHost = null;
    var current = null; // { key, warning, group }
    var minimized = false;
    var lastFocus = null;
    var lockedOverflow = null;

    function build() {
      host = doc.createElement('div');
      host.setAttribute(HOST_ATTR, '');
      host.setAttribute('lang', 'tr');
      host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; top: 0; left: 0; width: 0; height: 0;';
      shadow = host.attachShadow({ mode: 'open' });
      var style = doc.createElement('style');
      style.textContent = FLOAT_CSS;
      shadow.appendChild(style);
      var wrap = doc.createElement('div');
      wrap.className = 'bt-wrap';
      wrap.hidden = true;

      var card = doc.createElement('div');
      card.className = 'bt-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-haspopup', 'dialog');
      card.appendChild(warnIcon(doc));
      var txt = doc.createElement('span');
      txt.className = 'bt-txt';
      var title = doc.createElement('span');
      title.className = 'bt-title';
      var co = doc.createElement('span');
      co.className = 'bt-co';
      var extra = doc.createElement('span');
      extra.className = 'bt-extra';
      var hint = doc.createElement('span');
      hint.className = 'bt-hint';
      hint.textContent = 'T\u00fcm ba\u015fvurular\u0131 g\u00f6rmek i\u00e7in t\u0131klay\u0131n';
      txt.appendChild(title);
      txt.appendChild(co);
      txt.appendChild(extra);
      txt.appendChild(hint);
      card.appendChild(txt);
      var min = doc.createElement('button');
      min.type = 'button';
      min.className = 'bt-min';
      min.setAttribute('aria-label', 'K\u00fc\u00e7\u00fclt');
      min.title = 'K\u00fc\u00e7\u00fclt (uyar\u0131 kaybolmaz)';
      min.textContent = '\u2013';
      card.appendChild(min);

      var pill = doc.createElement('button');
      pill.type = 'button';
      pill.className = 'bt-pill';
      pill.hidden = true;
      pill.appendChild(warnIcon(doc));
      var pillText = doc.createElement('span');
      pill.appendChild(pillText);

      wrap.appendChild(card);
      wrap.appendChild(pill);
      shadow.appendChild(wrap);
      els = { wrap: wrap, card: card, title: title, co: co, extra: extra, min: min, pill: pill, pillText: pillText };

      function stop(ev) {
        ev.stopPropagation();
      }
      ['pointerdown', 'mousedown', 'mouseup', 'keydown'].forEach(function (t) {
        wrap.addEventListener(t, stop);
      });
      card.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openModal();
      });
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openModal();
        }
      });
      min.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        minimized = true;
        paint();
      });
      pill.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        minimized = false;
        paint();
      });
    }

    function root() {
      return doc.documentElement || doc.body;
    }

    function ensureAttached() {
      if (!host) build();
      var r = root();
      if (r && (!host.isConnected || host.parentNode !== r)) {
        r.appendChild(host);
        return true;
      }
      return false;
    }

    function paint() {
      if (!host) return;
      if (!current) {
        els.wrap.hidden = true;
        return;
      }
      var w = current.warning;
      var n = w.modalCount;
      els.title.textContent = 'Daha \u00f6nce bu firman\u0131n ' + n + ' ilan\u0131na ba\u015fvurdunuz';
      els.co.textContent = w.companyName;
      els.co.title = w.companyName;
      var extra = '';
      if (w.thisJob) extra = w.otherCount > 0 ? 'Bu ilana da ba\u015fvurdunuz.' : 'Bu ilana zaten ba\u015fvurdunuz.';
      els.extra.textContent = extra;
      els.extra.hidden = !extra;
      var aria = els.title.textContent + ': ' + w.companyName + '. T\u00fcm ba\u015fvurular\u0131 g\u00f6ster.';
      els.card.setAttribute('aria-label', aria);
      els.pillText.textContent = n + ' ba\u015fvuru \u00b7 ' + w.companyName;
      els.pill.setAttribute('aria-label', 'Uyar\u0131y\u0131 b\u00fcy\u00fct: ' + aria);
      els.pill.title = aria;
      els.card.hidden = minimized;
      els.pill.hidden = !minimized;
      els.wrap.hidden = false;
    }

    function show(group, jobId, scannedAt) {
      var C = core();
      var warning = C.buildCompanyWarning(group.applications, {
        currentJobId: jobId,
        companyName: group.company,
        scannedAt: scannedAt,
      });
      var changedCompany = !current || current.key !== group.key;
      if (changedCompany) minimized = false; // new company: show the full warning again
      current = { key: group.key, warning: warning, group: group, jobId: jobId };
      ensureAttached();
      paint();
      if (modalHost && changedCompany) closeModal();
    }

    function hide() {
      current = null;
      if (host) paint();
      closeModal();
    }

    function closeModal() {
      if (!modalHost) return;
      var m = modalHost;
      modalHost = null;
      doc.removeEventListener('keydown', onDocKey, true);
      if (m.remove) m.remove();
      if (doc.body && lockedOverflow !== null) {
        doc.body.style.overflow = lockedOverflow;
        lockedOverflow = null;
      }
      if (lastFocus && lastFocus.focus) {
        try {
          lastFocus.focus();
        } catch (e) {}
      }
      lastFocus = null;
    }

    function onDocKey(ev) {
      if (ev.key === 'Escape' && modalHost) {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal();
      }
    }

    function openModal() {
      if (!current) return;
      closeModal();
      var w = current.warning;
      var mh = doc.createElement('div');
      mh.setAttribute(MODAL_ATTR, '');
      mh.setAttribute('lang', 'tr');
      mh.style.cssText = 'all: initial; position: fixed; z-index: 2147483600; top: 0; left: 0; width: 0; height: 0;';
      var sr = mh.attachShadow({ mode: 'open' });
      var style = doc.createElement('style');
      style.textContent = FLOAT_CSS;
      sr.appendChild(style);
      var modal = doc.createElement('div');
      modal.className = 'bt-modal';
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
      dialog.setAttribute('aria-labelledby', 'bt-h');
      var head = doc.createElement('div');
      head.className = 'bt-head';
      var h = doc.createElement('h2');
      h.className = 'bt-h';
      h.id = 'bt-h';
      h.textContent = w.companyName + ' \u00b7 Ge\u00e7mi\u015f ba\u015fvurular\u0131n\u0131z';
      var x = doc.createElement('button');
      x.type = 'button';
      x.className = 'bt-x';
      x.setAttribute('aria-label', 'Kapat');
      x.textContent = '\u00d7';
      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal();
      });
      head.appendChild(h);
      head.appendChild(x);
      dialog.appendChild(head);
      var sub = doc.createElement('p');
      sub.className = 'bt-sub';
      sub.textContent = w.modalSubtitle || w.modalCount + ' ba\u015fvuru';
      dialog.appendChild(sub);
      var warn = doc.createElement('p');
      warn.className = 'bt-warn';
      warn.textContent = 'Daha \u00f6nce bu firman\u0131n ' + w.modalCount + ' ilan\u0131na ba\u015fvurdunuz.' + (w.thisJob ? ' Bu ilan da listede.' : '');
      dialog.appendChild(warn);
      var list = doc.createElement('ul');
      list.className = 'bt-list';
      for (var i = 0; i < w.items.length; i++) list.appendChild(row(w.items[i]));
      dialog.appendChild(list);
      var foot = doc.createElement('p');
      foot.className = 'bt-foot';
      foot.textContent = w.footer || '';
      dialog.appendChild(foot);
      modal.appendChild(backdrop);
      modal.appendChild(dialog);
      sr.appendChild(modal);
      ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown', 'wheel'].forEach(function (t) {
        mh.addEventListener(t, function (ev) {
          ev.stopPropagation();
        });
      });
      (doc.documentElement || doc.body).appendChild(mh);
      modalHost = mh;
      doc.addEventListener('keydown', onDocKey, true);
      if (doc.body) {
        lockedOverflow = doc.body.style.overflow || '';
        doc.body.style.overflow = 'hidden';
      }
      lastFocus = els.card;
      try {
        x.focus();
      } catch (e) {}
    }

    function row(it) {
      var li = doc.createElement('li');
      if (it.isCurrent) li.setAttribute('data-current', '');
      var main = doc.createElement('div');
      main.className = 'bt-main';
      var href = URL_ALLOW && URL_ALLOW.safeJobUrl ? URL_ALLOW.safeJobUrl(it.jobUrl) : null;
      var t;
      if (href) {
        t = doc.createElement('a');
        t.href = href;
        t.target = '_blank';
        t.rel = 'noopener noreferrer';
      } else {
        t = doc.createElement('span');
      }
      t.className = 'bt-job';
      t.textContent = it.title;
      main.appendChild(t);
      if (it.isCurrent) {
        var cur = doc.createElement('span');
        cur.className = 'bt-cur';
        cur.textContent = 'Bu ilan';
        main.appendChild(cur);
      }
      var when = it.dateLine || it.dateLabel || it.when;
      var d = doc.createElement('p');
      d.className = 'bt-date';
      d.textContent = when ? 'Ba\u015fvuru: ' + when : 'Ba\u015fvuru tarihi bilinmiyor';
      main.appendChild(d);
      li.appendChild(main);
      if (it.status) {
        var chip = doc.createElement('span');
        chip.className = 'bt-chip bt-chip-' + (CHIP[it.statusId] || 'unseen');
        chip.textContent = it.status;
        li.appendChild(chip);
      }
      return li;
    }

    return {
      show: show,
      hide: hide,
      ensureAttached: function () {
        if (current) return ensureAttached();
        return false;
      },
      openModal: openModal,
      closeModal: closeModal,
      state: function () {
        return { current: current, minimized: minimized, host: host, modalHost: modalHost };
      },
    };
  }

  /* ---------------- runtime ---------------- */

  function startFloatRuntime(deps) {
    var win = deps.window;
    var doc = deps.document;
    var storageApi = deps.storage;
    var ui = createUi(doc, win);
    var index = null;
    var lastHref = '';
    var lastShown = null; // { key, jobId }
    var timer = null;
    var lastRun = 0;
    var observer = null;
    var observing = false;
    var rootObserver = null;
    var followUps = [];
    var confirmTimer = null;
    var navTarget = null; // { jobId, at } between Navigation API 'navigate' and URL commit
    var hasNavApi = false;
    // Per open job: evidence of the previous (confirmed) job, to reject a stale detail pane.
    var job = newJob(null, null);
    var stats = { evals: 0, detectMs: 0, mutationBatches: 0, polls: 0, navEvents: 0, navigateEvents: 0, urlChanges: 0, urlChangeBy: {}, shows: 0, hides: 0, rejectedStale: 0 };

    function now() {
      return Date.now();
    }

    function hideBadge() {
      if (lastShown || ui.state().current) stats.hides++;
      lastShown = null;
      ui.hide();
    }

    function newJob(jobId, prev) {
      // seen: identities / fingerprints detected while this job was open (stale or not)
      return { jobId: jobId, since: now(), confirmed: false, seenIds: {}, seenPrints: {}, prev: prev };
    }

    /**
     * New job id in the URL: hide at once and remember everything the old pane(s) showed.
     * During rapid switching (A -> B -> C before B was confirmed) A's and B's evidence
     * both count as "stale" for C.
     */
    function beginJob(jobId) {
      var prev = { jobIds: [], ids: {}, prints: {} };
      if (job.jobId) {
        if (!job.confirmed && job.prev) {
          prev.jobIds = job.prev.jobIds.slice(-4);
          prev.ids = Object.assign({}, job.prev.ids);
          prev.prints = Object.assign({}, job.prev.prints);
        }
        prev.jobIds.push(job.jobId);
        Object.assign(prev.ids, job.seenIds);
        Object.assign(prev.prints, job.seenPrints);
      }
      job = newJob(jobId, job.jobId ? prev : null);
      // Only exception: the new job itself is a past application of the company already shown.
      if (lastShown && index && index.byJobId && index.byJobId.get(jobId) === lastShown.key) return;
      hideBadge();
    }

    /** May a detection made while the job is still unconfirmed be shown? */
    function freshEnough(res) {
      if (res.status === 'unknown') return false;
      if (res.anchored) return true; // tied to the current job id
      var age = now() - job.since;
      if (res.staleRef) return age >= STALE_REF_MAX_MS; // pane still references the previous job
      if (res.cardAgrees === false) return age >= STALE_REF_MAX_MS; // selected card says another company
      if (res.cardAgrees === true) return true;
      var p = job.prev;
      if (!p) return true; // first job after load: nothing stale to show
      if (res.identity && !p.ids[res.identity]) return true; // a company the old pane never showed
      if (res.fingerprint && !p.prints[res.fingerprint]) return true; // pane re-rendered
      return age >= CONFIRM_MAX_MS; // same company + same text: same-company job, or very slow render
    }

    function evaluate() {
      lastRun = now();
      timer = null;
      stats.evals++;
      var loc = win.location;
      var onJobs = isJobsPage(loc);
      setObserving(onJobs && !!index);
      if (!onJobs || !index) {
        hideBadge();
        return;
      }
      var jobId = jobIdFromLocation(loc);
      if (navTarget) {
        if (navTarget.jobId !== jobId && now() - navTarget.at < 3000) return; // URL not committed yet
        navTarget = null;
      }
      if (jobId !== job.jobId) beginJob(jobId);
      var res;
      var t0 = win.performance && win.performance.now ? win.performance.now() : 0;
      try {
        res = detectCurrent(doc, win, index, { prevJobIds: job.prev ? job.prev.jobIds : [], checkCard: !job.confirmed });
      } catch (err) {
        log('detect error', err);
        return;
      } finally {
        if (t0) stats.detectMs += win.performance.now() - t0;
      }
      if (res.identity) job.seenIds[res.identity] = true;
      if (res.fingerprint) job.seenPrints[res.fingerprint] = true;
      if (!job.confirmed) {
        if (!freshEnough(res)) {
          if (res.status !== 'unknown') stats.rejectedStale++;
          if (!confirmTimer) {
            var limit = res.staleRef || res.cardAgrees === false ? STALE_REF_MAX_MS : CONFIRM_MAX_MS;
            var wait = Math.max(50, limit - (now() - job.since) + 30);
            confirmTimer = win.setTimeout(function () {
              confirmTimer = null;
              schedule(0);
            }, wait);
          }
          return;
        }
        job.confirmed = true;
        log('job confirmed', jobId, res.status, res.source, res.anchored ? 'anchored' : '', now() - job.since + 'ms');
      }
      if (res.status === 'match') {
        var same = lastShown && lastShown.key === res.group.key && lastShown.jobId === res.jobId;
        if (!same) log('match', res.source, res.name, '->', res.group.company, res.jobId);
        if (!same || !ui.state().current) {
          ui.show(res.group, res.jobId, index.scannedAt);
          stats.shows++;
        }
        lastShown = { key: res.group.key, jobId: res.jobId };
        ui.ensureAttached();
        return;
      }
      if (res.status === 'nomatch') {
        if (lastShown) log('no history for', res.name);
        hideBadge();
        return;
      }
      // unknown for the confirmed job (transient re-render): keep what is shown.
      if (lastShown && lastShown.jobId === res.jobId) ui.ensureAttached();
    }

    function schedule(delay) {
      if (timer) return;
      var wait = delay != null ? delay : Math.max(MUTATION_GAP_MS - (now() - lastRun), 30);
      timer = win.setTimeout(evaluate, wait);
    }

    function onUrlMaybeChanged(by) {
      var href = String(win.location.href);
      if (href === lastHref) return;
      lastHref = href;
      stats.urlChanges++;
      var k = typeof by === 'string' ? by : (by && by.type) || 'event';
      stats.urlChangeBy[k] = (stats.urlChangeBy[k] || 0) + 1;
      if (timer) {
        win.clearTimeout(timer);
        timer = null;
      }
      // Hide right away when the job id changed (do not wait for the evaluation).
      if (isJobsPage(win.location) && index && jobIdFromLocation(win.location) !== job.jobId) beginJob(jobIdFromLocation(win.location));
      schedule(30);
      // detail pane renders a bit later; re-check a few times (previous batch cancelled)
      followUps.forEach(function (t) {
        win.clearTimeout(t);
      });
      followUps = [300, 800, 1600, 3000].map(function (ms) {
        return win.setTimeout(function () {
          schedule(0);
        }, ms);
      });
    }

    // Mutations in page chrome (nav badges, messaging overlay, right rail) never change
    // the open job's company: ignore them so LinkedIn's background churn costs nothing.
    var IGNORE_MUT_SEL = '[' + HOST_ATTR + '], [' + MODAL_ATTR + '], ' + CHROME_SEL + ', ' + SIDE_SEL;
    function onMutations(muts) {
      stats.mutationBatches++;
      if (timer) return; // an evaluation is already queued
      if (muts.length > 40) {
        schedule();
        return;
      }
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (t && t.nodeType !== 1) t = t.parentElement;
        if (t && t.closest && t.closest(IGNORE_MUT_SEL)) continue;
        schedule();
        return;
      }
      stats.ignoredBatches = (stats.ignoredBatches || 0) + 1;
    }

    var target = null;
    /** Body-wide observer only while on a jobs page with an index; off elsewhere (feed etc.). */
    function setObserving(on) {
      if (!observer) return;
      var want = doc.body || doc.documentElement;
      if (on && (!observing || target !== want)) {
        observer.disconnect();
        target = want;
        observer.observe(target, { childList: true, subtree: true, characterData: true });
        observing = true;
      } else if (!on && observing) {
        observer.disconnect();
        observing = false;
      }
    }

    function startObservers() {
      var Obs = win.MutationObserver;
      if (!Obs) return;
      observer = new Obs(onMutations);
      // Our host lives on <html>; re-attach at once if someone removes it or swaps <body>.
      rootObserver = new Obs(function () {
        if (ui.ensureAttached()) log('re-attached');
        if (observing && doc.body && target !== doc.body) setObserving(true);
      });
      rootObserver.observe(doc.documentElement, { childList: true });
    }

    function load(snapshot) {
      index = indexFromSnapshot(snapshot);
      lastShown = null;
      log('index', index ? index.groups.length + ' firma' : 'yok');
      schedule(0);
    }

    function readStorage() {
      if (!storageApi || !storageApi.local) return;
      try {
        storageApi.local.get(STORAGE_SNAPSHOT, function (data) {
          load(data && data[STORAGE_SNAPSHOT]);
        });
      } catch (err) {
        log('storage read failed', err);
      }
    }

    if (storageApi && storageApi.onChanged) {
      try {
        storageApi.onChanged.addListener(function (changes, area) {
          if (area !== 'local' || !changes || !changes[STORAGE_SNAPSHOT]) return;
          load(changes[STORAGE_SNAPSHOT].newValue);
        });
      } catch (err) {}
    }

    lastHref = String(win.location.href);
    win.addEventListener('popstate', onUrlMaybeChanged);
    win.addEventListener('hashchange', onUrlMaybeChanged);
    win.addEventListener('pageshow', onUrlMaybeChanged);
    try {
      // Navigation API events are dispatched to isolated-world listeners too, so SPA
      // pushState/replaceState calls made by LinkedIn are seen without a main-world patch.
      var nav = win.navigation;
      if (nav && nav.addEventListener) {
        hasNavApi = true;
        nav.addEventListener('navigate', function (e) {
          stats.navigateEvents++;
          var dest = e && e.destination && e.destination.url;
          if (!dest) return;
          try {
            var u = new URL(dest, String(win.location.href));
            var nextId = isJobsPage(u) ? jobIdFromLocation(u) : '';
            if (nextId !== job.jobId && (lastShown || ui.state().current)) {
              navTarget = { jobId: nextId, at: now() };
              hideBadge();
            }
          } catch (err) {}
        });
        nav.addEventListener('currententrychange', function () {
          stats.navEvents++;
          onUrlMaybeChanged('navigation');
        });
      }
    } catch (e) {}
    // Fallback URL poll (a string compare). Slower when the Navigation API covers SPA
    // navigations; skipped while the tab is hidden.
    win.setInterval(function () {
      if (doc.hidden) return;
      stats.polls++;
      onUrlMaybeChanged('poll');
    }, hasNavApi ? URL_POLL_NAV_MS : URL_POLL_MS);
    // Safety net (re-attach / missed attribute-only changes): jobs pages only, visible tab only.
    win.setInterval(function () {
      if (doc.hidden || !index || !isJobsPage(win.location)) return;
      schedule(0);
    }, RECHECK_MS);
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) onUrlMaybeChanged('visible') || schedule(0);
    });
    startObservers();
    readStorage();

    return {
      evaluate: evaluate,
      load: load,
      ui: ui,
      detect: function () {
        return detectCurrent(doc, win, index, { prevJobIds: job.prev ? job.prev.jobIds : [], checkCard: true });
      },
      stats: function () {
        return JSON.parse(JSON.stringify(Object.assign({ observing: observing, hasNavApi: hasNavApi, jobConfirmed: job.confirmed }, stats)));
      },
    };
  }

  function boot() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.top !== window) return;
    if (window.__basvuruFloatBooted) return;
    if (!core()) return;
    window.__basvuruFloatBooted = true;
    window.__basvuruFloat = startFloatRuntime({
      window: window,
      document: document,
      storage: typeof chrome !== 'undefined' ? chrome.storage : null,
    });
  }

  var api = {
    isJobsPage: isJobsPage,
    jobIdFromLocation: jobIdFromLocation,
    detectCurrent: detectCurrent,
    indexFromSnapshot: indexFromSnapshot,
    startFloatRuntime: startFloatRuntime,
    FLOAT_CSS: FLOAT_CSS,
  };
  globalThis.BasvuruFloatBadge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    !(typeof module !== 'undefined' && module.exports)
  ) {
    boot();
  }
})();
