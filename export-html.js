/**
 * Pure HTML report builder for offline export.
 * Browser: global BasvuruExportHtml. Node: module.exports.
 * Markup mirrors extension/results.html (offline title, empty state, footer).
 * Job links and logos are filtered here, before anything is written into the file.
 */
(function (root) {
  'use strict';

  if (typeof module !== 'undefined' && module.exports && !root.BasvuruUrlAllow) {
    require('./url-allow.js');
  }

  function escapeJsonForScript(snapshot) {
    return JSON.stringify(snapshot == null ? null : snapshot).replace(/</g, '\\u003c');
  }

  function todayYmd(d) {
    var x = d || new Date();
    var y = x.getFullYear();
    var m = String(x.getMonth() + 1).padStart(2, '0');
    var day = String(x.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function filenameForDate(d) {
    return 'basvuru-raporu-' + todayYmd(d) + '.html';
  }

  var SHELL = "\n<div id=\"boot-empty\" class=\"empty-boot\">\n  <p class=\"empty-title\">Bu raporda başvuru kaydı yok</p>\n  <p>Rapor, tarama sırasında kaydedilen başvuruları gösterir.</p>\n</div>\n<div class=\"wrap panel-hidden\" id=\"app\">\n  <header class=\"hero\">\n    <div class=\"hero-grid\">\n      <div>\n        <p class=\"kicker\">LinkedIn başvuru kaydı <span class=\"dot\" aria-hidden=\"true\"></span> <span id=\"kicker-range\">—</span> <span class=\"dot\" aria-hidden=\"true\"></span> <span id=\"kicker-scraped\">—</span></p>\n        <h1><span class=\"hero-num\" id=\"hero-total\">0</span> başvuru yaptın<br><em><span id=\"hero-unseen\">0</span> başvuru hiç görüntülenmedi.</em></h1>\n        <p class=\"lede\"><strong id=\"hero-companies\">0</strong> şirkete <strong id=\"hero-apps\">0</strong> başvuru. <strong id=\"hero-viewed\">0</strong> başvuru görüntülendi (CV indirilenler dahil) ve <strong id=\"hero-cv\">0</strong> tanesinde CV indirildi.</p>\n      </div>\n      <aside class=\"seal\" aria-label=\"Görüntülenme oranı, CV indirilenler dahil\">\n        <div class=\"lbl\">Görüntülenme oranı</div>\n        <div class=\"num\" id=\"seal-rate\">%0</div>\n        <div class=\"sub\" id=\"seal-sub\">CV indirilenler dahil</div>\n      </aside>\n    </div>\n    <div class=\"hero-meter\">\n      <div class=\"meter-top\"><span>Hiç görüntülenmeyen başvurular</span><strong id=\"meter-label\">%0</strong></div>\n      <div class=\"meter-track\" id=\"meter-track\" role=\"meter\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"0\" aria-label=\"Hiç görüntülenmeyen başvuruların oranı\"><div class=\"meter-fill\" id=\"meter-fill\"></div></div>\n    </div>\n  </header>\n\n  <section class=\"panel\" aria-labelledby=\"ozet-title\">\n    <div class=\"panel-head\">\n      <h2 id=\"ozet-title\">Özet</h2>\n      <p>Başvuru, görüntülenme ve CV indirme sayıları.</p>\n    </div>\n    <div class=\"funnel\">\n      <article class=\"step\">\n        <div class=\"k\">Toplam başvuru</div>\n        <div class=\"n\" id=\"fn-total\">0</div>\n        <div class=\"track\"><div class=\"fill\" data-bar=\"total\"></div></div>\n        <div class=\"s\">tamamı</div>\n      </article>\n      <article class=\"step viewed\">\n        <div class=\"k\">Görüntülenen başvuru</div>\n        <div class=\"n\" id=\"fn-viewed\">0</div>\n        <div class=\"track\"><div class=\"fill\" data-bar=\"viewed\"></div></div>\n        <div class=\"s\" id=\"fn-viewed-p\">%0</div>\n        <p class=\"step-note\">CV indirilenler dahil</p>\n      </article>\n      <article class=\"step cv\">\n        <div class=\"k\">CV indirilen</div>\n        <div class=\"n\" id=\"fn-cv\">0</div>\n        <div class=\"track\"><div class=\"fill\" data-bar=\"cv\"></div></div>\n        <div class=\"s\" id=\"fn-cv-p\">%0</div>\n        <p class=\"step-note\">Görüntülenenlerin içinden</p>\n      </article>\n    </div>\n    <div class=\"mix-block\">\n      <h3 class=\"mix-title\" id=\"mix-title\">Çalışma şekli</h3>\n      <div class=\"mix\" id=\"mix\"></div>\n    </div>\n  </section>\n\n  <section class=\"panel\" aria-labelledby=\"okuma-title\">\n    <div class=\"panel-head\">\n      <h2 id=\"okuma-title\">Sayılar ne söylüyor?</h2>\n      <p>Sayılar LinkedIn’in kendi sayfasından alındı.</p>\n    </div>\n    <div class=\"insights\">\n      <article class=\"insight\"><h3>Görüntülenmeyenler</h3><p><strong id=\"n-total\">0</strong> başvurundan <strong id=\"n-unseen\">0</strong> tanesi hiç görüntülenmemiş. Bu oran, tüm başvurularının <strong id=\"p-unseen\">%0</strong> kadarı.</p></article>\n      <article class=\"insight\"><h3>Görüntülenenler</h3><p><strong id=\"n-viewed\">0</strong> başvurun görüntülenmiş. Bu sayıya CV’si indirilenler de dahil. Bunların <strong id=\"n-cv\">0</strong> tanesinde CV’n indirilmiş.</p></article>\n      <article class=\"insight\"><h3>Görüntülenmeden yeniden yayın</h3><p><strong id=\"n-repost-nv\">0</strong> başvuru, görüntülenmeden yeniden yayınlanmış.</p></article>\n    </div>\n  </section>\n\n  <section class=\"panel\" aria-labelledby=\"top-title\">\n    <div class=\"panel-head\">\n      <h2 id=\"top-title\">En çok başvurduğun şirketler</h2>\n      <p>Karta tıklayınca o şirket arşivde açılır.</p>\n    </div>\n    <div class=\"tops\" id=\"tops\"></div>\n  </section>\n\n  <section class=\"panel\" id=\"arsiv\" aria-labelledby=\"arsiv-title\">\n    <div class=\"panel-head\">\n      <h2 id=\"arsiv-title\">Arşiv</h2>\n      <p>Şirket adına göre gruplandı.</p>\n    </div>\n    <div class=\"tabs\" id=\"main-tabs\" role=\"tablist\" aria-label=\"Arşiv görünümleri\">\n      <button class=\"tab active\" id=\"tab-companies\" role=\"tab\" aria-selected=\"true\" aria-controls=\"view-companies\" data-view=\"companies\" type=\"button\" tabindex=\"0\">Şirketler</button>\n      <button class=\"tab\" id=\"tab-viewed\" role=\"tab\" aria-selected=\"false\" aria-controls=\"view-viewed\" data-view=\"viewed\" type=\"button\" tabindex=\"-1\">Görüntülenenler</button>\n      <button class=\"tab\" id=\"tab-cv\" role=\"tab\" aria-selected=\"false\" aria-controls=\"view-cv\" data-view=\"cv\" type=\"button\" tabindex=\"-1\">CV indirilenler</button>\n      <button class=\"tab\" id=\"tab-repost-nv\" role=\"tab\" aria-selected=\"false\" aria-controls=\"view-repost-nv\" data-view=\"repost-nv\" type=\"button\" tabindex=\"-1\">Görüntülenmeden yeniden yayınlananlar</button>\n      <button class=\"tab\" id=\"tab-gallery\" role=\"tab\" aria-selected=\"false\" aria-controls=\"view-gallery\" data-view=\"gallery\" type=\"button\" tabindex=\"-1\">Logo görünümü</button>\n    </div>\n    <div class=\"toolbar\" id=\"toolbar\">\n      <label class=\"visually-hidden\" for=\"q\">Şirket veya pozisyon ara</label>\n      <input type=\"search\" id=\"q\" placeholder=\"Şirket veya pozisyon ara…\" autocomplete=\"off\" aria-label=\"Şirket veya pozisyon ara\" />\n      <select id=\"sort\" aria-label=\"Sıralama\">\n        <option value=\"count-desc\">Başvuru sayısı</option>\n        <option value=\"newest\">En yeni önce</option>\n        <option value=\"oldest\">En eski önce</option>\n        <option value=\"name-asc\">Şirket A→Z</option>\n        <option value=\"viewed-first\">Önce görüntülenenler</option>\n      </select>\n      <div class=\"chip-filters\">\n        <button type=\"button\" class=\"chip\" data-filter=\"viewed\" aria-pressed=\"false\">Görüntülendi</button>\n        <button type=\"button\" class=\"chip\" data-filter=\"cv\" aria-pressed=\"false\">CV indirildi</button>\n        <button type=\"button\" class=\"chip\" data-filter=\"repost\" aria-pressed=\"false\">Yeniden yayınlanan</button>\n        <button type=\"button\" class=\"chip\" data-filter=\"repost-nv\" aria-pressed=\"false\">Görüntülenmeden yeniden yayınlandı</button>\n      </div>\n      <div class=\"meta-line\" id=\"result-meta\" aria-live=\"polite\">—</div>\n      <div class=\"toolbar-actions\">\n        <button type=\"button\" class=\"btn-json\" id=\"btn-json\">JSON indir</button>\n        <button type=\"button\" class=\"btn-json\" id=\"btn-html\">HTML indir</button>\n        <button type=\"button\" class=\"btn-json\" id=\"btn-pdf\">Özeti PDF olarak indir</button>\n      </div>\n    </div>\n    <div id=\"view-companies\" class=\"company-list\" role=\"tabpanel\" aria-labelledby=\"tab-companies\"></div>\n    <div id=\"view-viewed\" class=\"highlight-list panel-hidden\" role=\"tabpanel\" aria-labelledby=\"tab-viewed\"></div>\n    <div id=\"view-cv\" class=\"highlight-list panel-hidden\" role=\"tabpanel\" aria-labelledby=\"tab-cv\"></div>\n    <div id=\"view-repost-nv\" class=\"highlight-list panel-hidden\" role=\"tabpanel\" aria-labelledby=\"tab-repost-nv\"></div>\n    <div id=\"view-gallery\" class=\"gallery panel-hidden\" role=\"tabpanel\" aria-labelledby=\"tab-gallery\"></div>\n  </section>\n\n  <footer class=\"colophon\">\n    <div>Tarama tarihi: <span id=\"ft-scraped\">—</span></div>\n    <div><span id=\"ft-count\">0</span> başvuru · çevrimdışı rapor</div>\n    <div class=\"credit-block\">\n      <div class=\"credit-name\">Geliştiren: Bora Ata Türkoğlu</div>\n      <div class=\"credit-links\">\n        __CREDIT_LINKS__\n      </div>\n    </div>\n  </footer>\n</div>\n<div id=\"print-root\" class=\"print-root\" hidden></div>\n";

  function blankAnchorHtml(href, label) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function creditLinksHtml() {
    return (
      blankAnchorHtml('https://boraturkoglu.com', 'boraturkoglu.com') +
      '\n        <span class="credit-sep">·</span>\n        ' +
      blankAnchorHtml('https://www.linkedin.com/in/boracomet/', 'LinkedIn') +
      '\n        <span class="credit-sep">·</span>\n        ' +
      blankAnchorHtml('https://github.com/boracomet', 'GitHub')
    );
  }

  SHELL = SHELL.replace('__CREDIT_LINKS__', creditLinksHtml());

  function allowApi() {
    return root.BasvuruUrlAllow || null;
  }

  function safeJobUrl(url) {
    var A = allowApi();
    var raw = typeof url === 'string' ? url.trim() : '';
    if (!raw || !A) return '';
    if (typeof A.safeJobUrl === 'function') {
      var out = A.safeJobUrl(raw);
      return typeof out === 'string' ? out.trim() : '';
    }
    if (typeof A.isAllowedJobUrl === 'function' && A.isAllowedJobUrl(raw)) return raw;
    return '';
  }

  function safeLogoUrl(url) {
    var A = allowApi();
    var raw = typeof url === 'string' ? url.trim() : '';
    if (!raw || !A) return '';
    if (typeof A.safeLogoUrl === 'function') {
      var out = A.safeLogoUrl(raw);
      return typeof out === 'string' ? out.trim() : '';
    }
    if (typeof A.isAllowedLogoUrl === 'function' && A.isAllowedLogoUrl(raw)) return raw;
    return '';
  }

  var JOB_URL_KEYS = { jobUrl: true };
  var LOGO_URL_KEYS = { companyLogoUrl: true };

  function scrubSnapshot(value, key) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return scrubSnapshot(item, '');
      });
    }
    if (value && typeof value === 'object') {
      var out = {};
      for (var k in value) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
        var next = scrubSnapshot(value[k], k);
        if (typeof next === 'undefined') continue;
        out[k] = next;
      }
      return out;
    }
    if (typeof value !== 'string') return value;
    if (JOB_URL_KEYS[key]) return safeJobUrl(value) || undefined;
    if (LOGO_URL_KEYS[key]) return safeLogoUrl(value) || undefined;
    return value;
  }

  // The saved report renders titles and logos itself. It must not ship the allowlist.
  function reportResultsJs(src) {
    var s = String(src || '');
    var from = s.indexOf('function allowedJobHref(');
    var to = s.indexOf('function logoEl(');
    if (from < 0 || to < from) return s;
    return (
      s.slice(0, from) +
      'function allowedJobHref(url) {\n' +
      "  return String(url || '').trim();\n" +
      '}\n' +
      'function allowedLogoSrc(url) {\n' +
      "  return String(url || '').trim();\n" +
      '}\n' +
      s.slice(to)
    );
  }

  function scriptBody(src) {
    return String(src || '').replace(/<\/(script)/gi, '<\\/$1');
  }

  function buildStandaloneHtml(opts) {
    opts = opts || {};
    var snapshot = scrubSnapshot(opts.snapshot || { applications: [] });
    var css = String(opts.css || '');
    var statusJs = String(opts.statusJs || '');
    var resultsJs = reportResultsJs(opts.resultsJs || '');
    var dataJson = escapeJsonForScript(snapshot);
    var assetsJson = escapeJsonForScript({
      css: css,
      statusJs: statusJs,
      resultsJs: resultsJs,
    });

    return (
      '<!DOCTYPE html>\n' +
      '<html lang="tr">\n' +
      '<head>\n' +
      '<meta charset="UTF-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<meta name="color-scheme" content="light" />\n' +
      '<title>Başvuru İstatistikleri (çevrimdışı rapor)</title>\n' +
      '<style>\n' +
      css +
      '\n</style>\n' +
      '</head>\n' +
      '<body data-embedded="1">\n' +
      SHELL +
      '<script>\n' +
      'window.__BASVURU_SNAPSHOT__ = ' +
      dataJson +
      ';\n' +
      'window.__BASVURU_ASSETS__ = ' +
      assetsJson +
      ';\n' +
      '</script>\n' +
      '<script>\n' +
      scriptBody(statusJs) +
      '\n</script>\n' +
      '<script>\n' +
      scriptBody(resultsJs) +
      '\n</script>\n' +
      '</body>\n' +
      '</html>\n'
    );
  }

  var api = {
    buildStandaloneHtml: buildStandaloneHtml,
    escapeJsonForScript: escapeJsonForScript,
    filenameForDate: filenameForDate,
    todayYmd: todayYmd,
  };

  root.BasvuruExportHtml = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
