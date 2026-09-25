/**
 * Pure helpers for job-search badges: company normalization, matching, card text parsing.
 * Classic script (global BasvuruBadgesCore) + CommonJS for node tests.
 */
(function (root) {
  'use strict';

  function stripLogoSuffix(s) {
    return String(s || '')
      .replace(/\s+(?:logo|logosu|şirket logosu|company logo)\s*$/i, '')
      .trim();
  }

  function normCompany(name) {
    return stripLogoSuffix(String(name || '').replace(/\s+/g, ' ').trim())
      .replace(/\u0130/g, 'I')
      .replace(/\u0131/g, 'i')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Legal-form tails, already passed through normCompany (punctuation is spaces).
   * Longer alternatives come first so "ltd sti" is one token.
   */
  var LEGAL_SUFFIX_RE =
    /(?:\s+(?:anonim sirketi|limited sirketi|sanayi ve ticaret|ticaret ve sanayi|san ve tic|tic ve san|ltd sti|limited sti|s p a|s r l|a s|s a|b v|n v|incorporated|corporation|ticaret|sanayi|limited|gmbh|corp|llc|llp|plc|inc|ltd|sti|tic|san|spa|srl|sas|sarl|oyj|oy|ab|aps|kg|se|pte|pvt|ag|sa|bv|nv|co|as))+$/;

  /** Strip trailing A.Ş. / Ltd. / Inc. / GmbH / … . Too-short remainders are kept as-is. */
  function stripLegalSuffixes(key) {
    var cur = String(key || '').replace(/\s+/g, ' ').trim();
    if (!cur) return '';
    var next = cur.replace(LEGAL_SUFFIX_RE, '').trim();
    if (!next || next.length < 2) return cur;
    return next;
  }

  /** Normalized key used to group past applications (legal suffix removed). */
  function canonicalCompanyKey(name) {
    var n = normCompany(name);
    if (!n) return '';
    return stripLegalSuffixes(n);
  }

  /**
   * Exact normalized match first, then the same comparison with legal suffixes
   * removed, then a word-boundary prefix match. The shorter side must be at
   * least 5 characters so "IBM" does not swallow "IBMX Software". When several
   * stored keys are prefixes of each other, the longest match wins so
   * "Garanti" and "Garanti BBVA" stay distinct.
   */
  function matchCompanyKey(raw, keys) {
    var key = normCompany(raw);
    if (!key || !keys) return null;
    var list = Array.isArray(keys) ? keys : Array.from(keys);
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === key) return list[i];

    var stripped = stripLegalSuffixes(key);
    if (stripped && stripped !== key) {
      for (i = 0; i < list.length; i++) if (list[i] === stripped) return list[i];
    }

    var bestStored = null;
    for (i = 0; i < list.length; i++) {
      var sk = stripLegalSuffixes(list[i]);
      if (sk && stripped && sk === stripped && sk !== list[i]) {
        if (!bestStored || list[i].length < bestStored.length) bestStored = list[i];
      }
    }
    if (bestStored) return bestStored;

    var best = null;
    var bestLen = -1;
    for (i = 0; i < list.length; i++) {
      var k = list[i];
      if (!k) continue;
      var shorter = k.length <= key.length ? k : key;
      var longer = k.length <= key.length ? key : k;
      if (shorter.length < 5) continue;
      if (longer.indexOf(shorter + ' ') === 0 && k.length > bestLen) {
        bestLen = k.length;
        best = k;
      }
    }
    return best;
  }

  var NOISE_RE = new RegExp(
    [
      't\u00fcrkiye',
      'turkey',
      '\\((?:hybrid|hibrit|uzaktan|remote|on-site|i\u015f yerinde|yerinde)\\)',
      'g\u00f6r\u00fcnt\u00fclendi',
      'kolay ba\u015fvuru',
      'easy apply',
      'ba\u011flant\u0131',
      'connection',
      'tan\u0131t\u0131ld\u0131',
      'promoted',
      '\\b\u00f6nce\\b',
      '\\bago\\b',
      'ba\u015fvuran',
      'applicant',
      'mezunu',
      '\u00e7al\u0131\u015f\u0131yor',
      'aktif olarak',
      'ba\u015fvuruldu',
      'actively',
      'do\u011frulan',
      'verification',
      'verified',
    ].join('|'),
    'i'
  );

  function isNoiseLine(line) {
    var s = String(line || '').trim();
    if (!s) return true;
    if (s.length > 80) return true;
    return NOISE_RE.test(s);
  }

  function cleanLine(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s*[\u00b7\u2022|]\s*/)[0]
      .trim();
  }

  /** Company = first non-noise line after the title (first line unless given). */
  function pickCompanyFromLines(lines, title) {
    var arr = (lines || []).map(cleanLine).filter(Boolean);
    if (!arr.length) return '';
    var t = cleanLine(title || arr[0]);
    var tNorm = t.toLowerCase();
    var start = 0;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].toLowerCase() === tNorm) {
        start = i + 1;
        break;
      }
    }
    for (var j = start; j < arr.length; j++) {
      var line = arr[j];
      var low = line.toLowerCase();
      if (low === tNorm || low.indexOf(tNorm) === 0) continue;
      if (isNoiseLine(line)) continue;
      return stripLogoSuffix(line);
    }
    return '';
  }

  /** Only trust img alt as a company when it looks like a logo alt. */
  function companyFromLogoAlt(alt) {
    var s = String(alt || '').replace(/\s+/g, ' ').trim();
    if (!/\s(?:logo|logosu)$/i.test(s)) return '';
    return stripLogoSuffix(s);
  }

  var WORK_MODE_SUFFIX_RE =
    /\((?:hybrid|hibrit|uzaktan|remote|on-site|onsite|i\u015f yerinde|yerinde|ofiste)\)\s*$/i;
  var COUNTRY_AFTER_COMMA_RE = /,\s*(?:t\u00fcrkiye|turkiye|turkey)\b/i;

  /**
   * Location lines ("İstanbul, Türkiye (Hybrid)", "Greater Istanbul (Hybrid)", "Türkiye (Uzaktan)").
   * A scraped application whose company is such a line must not become a company key,
   * otherwise every card's location row counts as a second company.
   */
  function isLocationLike(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    return WORK_MODE_SUFFIX_RE.test(t) || COUNTRY_AFTER_COMMA_RE.test(t);
  }

  function usableCompany(name) {
    return !!normCompany(name) && !isLocationLike(name);
  }

  /** Key for a short text / logo alt seen on the page, or null. */
  function hitKey(text, keys) {
    var raw = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s*[\u00b7\u2022|]\s*/)[0];
    if (!raw || raw.length > 120 || isLocationLike(raw)) return null;
    return matchCompanyKey(raw, keys);
  }

  /**
   * Chrome that must never count as a company hit: search field, typeahead,
   * filter pills, breadcrumbs, header/nav, or text that is only the current query.
   * ctx: { tag, role, contentEditable, inHeader, inNav, inSearch, inTypeahead,
   *        isFilterPill, isBreadcrumb, text, searchQuery }
   */
  function isIgnoredCompanyHit(ctx) {
    if (!ctx) return true;
    var tag = String(ctx.tag || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'SEARCH') return true;
    if (ctx.contentEditable) return true;
    var role = String(ctx.role || '').toLowerCase();
    if (role === 'search' || role === 'combobox') return true;
    if (ctx.inHeader || ctx.inNav || ctx.inSearch || ctx.inTypeahead) return true;
    if (ctx.isFilterPill || ctx.isBreadcrumb) return true;
    // Search chrome already filtered above. A job-card company line that equals the
    // current keywords (e.g. searching "Deloitte") must still count as a hit.
    return false;
  }

  function pageHitKey(text, keys, ctx) {
    if (isIgnoredCompanyHit(ctx)) return null;
    return hitKey(text, keys);
  }

  /**
   * Hosts that would paint the two-column jobs layout (or the whole viewport).
   * m: { width, height, viewportHeight, kind: 'card'|'detail',
   *      hasListJobLink, hasDetailApply }
   */
  function isOversizedHost(m) {
    if (!m) return true;
    var w = m.width || 0;
    var h = m.height || 0;
    var vh = m.viewportHeight || 0;
    if (m.hasListJobLink && m.hasDetailApply) return true;
    if (vh && h >= vh * 0.72) return true;
    if (m.kind === 'card' && w > 720) return true;
    if (h > 900 && w > 800) return true;
    return false;
  }

  /** True when the host's own company line is the stored company, not a stray string. */
  function hostMatchesCompany(hostCompanyRaw, hitKey) {
    if (!hitKey) return false;
    return matchCompanyKey(hostCompanyRaw, [hitKey]) === hitKey;
  }

  function needsAppScroller(n) {
    return n > APP_LIST_LIMIT;
  }

  /**
   * Job id from "/jobs/view/4470273631/", "/jobs/view/devops-engineer-at-kartaca-4470273631?…",
   * or "…currentJobId=4470273631&…". Same job via title and logo links → same id.
   */
  function jobIdFromHref(href) {
    var h = String(href || '');
    var m = h.match(/currentJobId=(\d{5,})/) || h.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{5,})(?=[/?#]|$)/);
    if (m) return m[1];
    var path = h.split(/[?#]/)[0].replace(/\/+$/, '');
    return path.indexOf('/jobs/view/') !== -1 ? path : '';
  }

  /**
   * Numeric job id from a bare id, a job URL, currentJobId, or a LinkedIn entity URN
   * (urn:li:jobPosting:ID, fsd_jobPosting, jobPostingCard:(ID,…)).
   */
  function jobIdFromToken(value) {
    var h = String(value == null ? '' : value).trim();
    if (/^\d{5,}$/.test(h)) return h;
    var urn = h.match(/(?:jobPostingCard:\(|(?:fsd_|fs_normalized_)?jobPosting:)(\d{5,})/i);
    if (urn) return urn[1];
    var fromHref = jobIdFromHref(h);
    if (fromHref && /^\d{5,}$/.test(fromHref)) return fromHref;
    var loose = String(fromHref || '').match(/(\d{5,})/);
    return loose ? loose[1] : '';
  }

  function jobIdOfApplication(app) {
    if (!app) return '';
    var fromId = jobIdFromToken(app.jobId);
    if (fromId) return fromId;
    return jobIdFromToken(app.jobUrl || app.url || '');
  }

  var DISMISS_RE = /kapat|gizle|reddet|kald\u0131r|ilgilenmiyorum|istemiyorum|dismiss|close|hide|not interested/i;

  function isDismissControl(ariaLabel, text) {
    var t = String(text || '').trim();
    if (t === '\u00d7' || t === '\u2715' || t === '\u2716') return true;
    return DISMISS_RE.test(String(ariaLabel || ''));
  }

  /** "Son başvuru 1 gün önce · 22 başvuru · 8 CV indirildi · ..." */
  function summaryText(info) {
    var c = (info && info.counts) || {};
    var parts = [];
    if (info && info.lastWhen) parts.push('Son ba\u015fvuru ' + info.lastWhen);
    parts.push(((info && info.total) || 0) + ' ba\u015fvuru');
    if (c.cv) parts.push(c.cv + ' CV indirildi');
    if (c.viewed) parts.push(c.viewed + ' g\u00f6r\u00fcnt\u00fclendi');
    if (c.unseen) parts.push(c.unseen + ' g\u00f6r\u00fcnt\u00fclenmedi');
    if (c.repostUnseen) parts.push(c.repostUnseen + ' g\u00f6r\u00fcnt\u00fclenmeden yeniden payla\u015f\u0131ld\u0131');
    return parts.join(' \u00b7 ');
  }

  var APP_LIST_LIMIT = 8;

  var SHORT_STATUS = {
    cv: 'CV indirildi',
    viewed: 'G\u00f6r\u00fcnt\u00fclendi',
    unseen: 'Ba\u015fvuru g\u00f6nderildi fakat g\u00f6r\u00fcnt\u00fclenmedi.',
    repostUnseen: 'G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131nland\u0131',
  };
  var CLOSED_STATUS = 'Ba\u015fvurular kapand\u0131';

  function shortWhen(appliedAt) {
    return String(appliedAt || '')
      .replace(/\s*ba\u015fvurdu\s*$/i, '')
      .trim();
  }

  /**
   * Absolute dates use Intl (tr-TR, day + short month; year only when it is not
   * the current year). A relative phrase such as "2 hafta önce" is shown as-is.
   * A trailing "başvurdu" is dropped because it is the tracker's verb, not the date.
   * now is injectable so tests do not depend on the clock.
   */
  function parseAbsoluteDate(value) {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && isFinite(value) && value > 1e11) {
      var fromNum = new Date(value);
      return isNaN(fromNum.getTime()) ? null : fromNum;
    }
    var s = String(value == null ? '' : value).trim();
    if (!s) return null;
    if (/^\d{11,}$/.test(s)) {
      var fromStr = new Date(Number(s));
      return isNaN(fromStr.getTime()) ? null : fromStr;
    }
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!iso) return null;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
      var zoned = new Date(s);
      return isNaN(zoned.getTime()) ? null : zoned;
    }
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      iso[4] ? Number(iso[4]) : 0,
      iso[5] ? Number(iso[5]) : 0,
      iso[6] ? Number(iso[6]) : 0
    );
  }

  function formatApplicationDate(value, now) {
    if (value == null || value === '') return '';
    var date = parseAbsoluteDate(value);
    if (!date) return shortWhen(value);
    var nowDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    var opts = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== nowDate.getFullYear()) opts.year = 'numeric';
    try {
      return new Intl.DateTimeFormat('tr-TR', opts).format(date);
    } catch (e) {
      return shortWhen(value);
    }
  }

  function formatLongDate(date) {
    try {
      return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    } catch (e) {
      return '';
    }
  }

  /** Calendar-aware relative phrase: "6 ay önce", "2 gün önce". */
  function relativePhrase(date, now) {
    var nowDate = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    var ms = nowDate.getTime() - date.getTime();
    if (ms < 0) ms = 0;
    var minutes = Math.floor(ms / 60000);
    if (minutes < 60) return Math.max(1, minutes) + ' dakika \u00f6nce';
    var hours = Math.floor(ms / 3600000);
    if (hours < 24) return hours + ' saat \u00f6nce';
    var days = Math.floor(ms / 86400000);
    if (days < 7) return Math.max(1, days) + ' g\u00fcn \u00f6nce';
    if (days < 30) return Math.max(1, Math.floor(days / 7)) + ' hafta \u00f6nce';
    var months = (nowDate.getFullYear() - date.getFullYear()) * 12 + (nowDate.getMonth() - date.getMonth());
    if (nowDate.getDate() < date.getDate()) months -= 1;
    if (months < 1) months = Math.floor(days / 30);
    if (months < 12) return Math.max(1, months) + ' ay \u00f6nce';
    return Math.max(1, Math.floor(months / 12)) + ' y\u0131l \u00f6nce';
  }

  function relativeDateLabel(value, now) {
    if (value == null || value === '') return '';
    var date = parseAbsoluteDate(value);
    if (!date) return shortWhen(value);
    return relativePhrase(date, now);
  }

  /** "12 Mart 2026 · 6 ay önce", or the relative phrase alone when that is all we have. */
  function formatModalDateLine(value, now) {
    if (value == null || value === '') return '';
    var date = parseAbsoluteDate(value);
    if (!date) return shortWhen(value);
    var abs = formatLongDate(date);
    var rel = relativePhrase(date, now);
    if (abs && rel) return abs + ' \u00b7 ' + rel;
    return abs || rel || shortWhen(value);
  }

  function statusApi(override) {
    return override || root.BasvuruStatus;
  }

  /**
   * Chip label. Closed is a flag, not a status key.
   * A sent application that was not viewed keeps
   * "Başvuru gönderildi fakat görüntülenmedi."
   * Other closed postings still show "Başvurular kapandı".
   */
  function shortAppStatus(app, S) {
    var api = statusApi(S);
    var st = api.applicationStatus(app || {});
    if (st.id === 'unseen') return SHORT_STATUS.unseen;
    if (st.closed) return CLOSED_STATUS;
    return SHORT_STATUS[st.id] || st.label;
  }

  function statusChipId(app, S) {
    var api = statusApi(S);
    var st = api.applicationStatus(app || {});
    if (st.id === 'unseen') return 'unseen';
    if (st.closed) return 'closed';
    return st.id || 'unseen';
  }

  /**
   * Past applications for one company, newest first, capped.
   * options: { status, limit, currentJobId } — status defaults to global BasvuruStatus.
   * jobUrl is kept for a later safeJobUrl() href; it is never written into the DOM here.
   */
  function listCompanyApps(apps, options) {
    var opts = options || {};
    var S = statusApi(opts.status);
    var limit = opts.limit != null ? opts.limit : APP_LIST_LIMIT;
    if (limit < 0) limit = 0;
    var currentId = jobIdFromToken(opts.currentJobId);
    var list = Array.isArray(apps) ? apps.slice() : [];
    list.sort(function (a, b) {
      return S.ageHours(a && a.appliedAt) - S.ageHours(b && b.appliedAt);
    });
    var more = Math.max(0, list.length - limit);
    var shown = list.slice(0, limit);
    var items = [];
    var i;
    for (i = 0; i < shown.length; i++) {
      var a = shown[i] || {};
      var title = String(a.jobTitle || '\u0130lan').replace(/\s+/g, ' ').trim() || '\u0130lan';
      var when = shortWhen(a.appliedAt);
      var dateLabel = formatApplicationDate(a.appliedAt, opts.now);
      var relativeLabel = relativeDateLabel(a.appliedAt, opts.now);
      var dateLine = formatModalDateLine(a.appliedAt, opts.now);
      var status = shortAppStatus(a, S);
      var jobId = jobIdOfApplication(a);
      var bits = [title];
      if (dateLabel) bits.push(dateLabel);
      else if (when) bits.push(when);
      if (status) bits.push(status);
      items.push({
        title: title,
        when: when,
        dateLabel: dateLabel,
        relativeLabel: relativeLabel,
        dateLine: dateLine,
        status: status,
        statusId: statusChipId(a, S),
        jobId: jobId,
        jobUrl: a.jobUrl || a.url || '',
        isCurrent: !!(currentId && jobId === currentId),
        line: bits.join(' \u00b7 '),
      });
    }
    return {
      items: items,
      more: more,
      total: list.length,
      lines: items.map(function (it) {
        return it.line;
      }),
    };
  }

  function appListTitle(info) {
    var listing = info && info.listing;
    if (!listing || !listing.items || !listing.items.length) return '';
    var lines = listing.items.map(function (it) {
      return it.line;
    });
    if (listing.more) lines.push('+' + listing.more + ' daha');
    return lines.join('\n');
  }

  /** Compact pill for the narrow left results list. */
  function cardBadgeSpec(info) {
    var strong = info && info.strength === 'strong';
    var title = summaryText(info);
    var extra = appListTitle(info);
    if (extra) title = title + '\n' + extra;
    return {
      level: strong ? 'strong' : 'light',
      text: strong
        ? 'Bu ilan kritik \u00b7 detaylar i\u00e7in t\u0131kla'
        : 'Daha \u00f6nce ba\u015fvurdun \u00b7 detaylar i\u00e7in t\u0131kla',
      title: title,
    };
  }

  /**
   * Narrow results-rail / recommendation-shelf card (including "Tercihlerinize uygun").
   * Those cards often have h2 + "Kolay Başvuru" and would otherwise look like a detail pane.
   * Detail top cards often carry data-job-id too — real Apply/Save with no dismiss is never a list card.
   */
  function looksLikeListCard(n, a) {
    var h = a.height(n);
    if (h < 40 || h > 500) return false;
    var w = a.width ? a.width(n) : 0;
    if (w > 720) return false;
    var d = a.dismissCount(n);
    var l = a.jobLinkCount(n);
    if (l > 1) return false;
    // Split-view detail top card: Apply/Save (+ optional big title), no dismiss X.
    // LinkedIn puts data-job-id on this node; that must not make it a list card.
    if (d === 0 && a.hasApply(n)) return false;
    if (isDetailMarker(n, a) && d === 0 && a.hasTitle && a.hasTitle(n)) return false;
    if (a.isListItem(n)) return true;
    if (d === 1) return true;
    if (l === 1 && !(a.hasTitle && a.hasTitle(n))) return true;
    if (a.sameTagSiblings && a.sameTagSiblings(n) >= 2 && l === 1) return true;
    return false;
  }

  function hostMetrics(n, a, kind) {
    return {
      width: a.width ? a.width(n) : 0,
      height: a.height(n),
      viewportHeight: a.viewportHeight ? a.viewportHeight() : 0,
      kind: kind || 'detail',
      hasListJobLink: a.jobLinkCount(n) > 1,
      hasDetailApply: !!(a.hasApply(n) && a.hasTitle && a.hasTitle(n)),
    };
  }

  /**
   * Walk up from a company text/logo element to the job card container.
   * Adapter a: parent, height, optional width/viewportHeight, isListItem,
   * dismissCount, jobLinkCount, hasApply, companyKeyCount.
   * Stops (keeping the best candidate so far) once a container holds more than one
   * dismiss button / job link / company, grows too tall, or is too wide.
   * A real detail top card (big h1 + Apply, no dismiss) is not a list card.
   */
  function resolveCardContainer(start, a, maxH) {
    var limit = maxH || 500;
    var cur = start;
    var best = null;
    var rowFallback = null;
    for (var depth = 0; cur && depth < 16; depth++, cur = a.parent(cur)) {
      if (a.companyKeyCount(cur) > 1) break;
      var d = a.dismissCount(cur);
      var l = a.jobLinkCount(cur);
      // Distinct job ids are the reliable card boundary; X buttons only when no job links exist.
      if (l > 1 || (l === 0 && d > 1)) break;
      if (isDetailMarker(cur, a) && !looksLikeListCard(cur, a)) {
        if (best || rowFallback) break;
        return null;
      }
      if (a.width && a.width(cur) > 720) break;
      var h = a.height(cur);
      if (h > limit) break;
      if (isOversizedHost(hostMetrics(cur, a, 'card'))) break;
      if (h >= 40 && a.isListItem(cur)) return cur;
      if (h >= 40 && (d === 1 || l === 1 || looksLikeListCard(cur, a))) best = cur;
      if (!rowFallback && h >= 60 && a.sameTagSiblings && a.sameTagSiblings(cur) >= 3) rowFallback = cur;
    }
    return best || rowFallback;
  }

  function isDetailMarker(n, a) {
    return !!(a.hasApply(n) || (a.hasTitle && a.hasTitle(n)) || (a.hasClosedNotice && a.hasClosedNotice(n)));
  }

  /**
   * Detail top card, with or without Apply/Save buttons (closed jobs on /jobs/view/ have none).
   * Nearest ancestor holding the big h1 title; widened up to 3 levels if a slightly larger
   * ancestor also holds the Apply/Save row or the closed notice.
   * Rejects the two-column jobs layout (too tall / too wide / list + Apply).
   */
  function resolveDetailHost(start, a) {
    var cur = a.parent(start);
    var titleHost = null;
    var titleDepth = 0;
    for (var depth = 0; cur && depth < 12; depth++, cur = a.parent(cur)) {
      var l = a.jobLinkCount(cur);
      if (l > 3 || (l === 0 && a.dismissCount(cur) > 1)) break;
      var h = a.height(cur);
      if (h > 800) break;
      if (a.width && a.width(cur) > 900) break;
      if (isOversizedHost(hostMetrics(cur, a, 'detail'))) break;
      var action = a.hasApply(cur) || (a.hasClosedNotice && a.hasClosedNotice(cur));
      if (!titleHost && a.hasTitle && a.hasTitle(cur)) {
        titleHost = cur;
        titleDepth = depth;
      }
      if (titleHost) {
        if (action) {
          var chosen = cur;
          if (isOversizedHost(hostMetrics(cur, a, 'detail'))) chosen = titleHost;
          if (chosen && isOversizedHost(hostMetrics(chosen, a, 'detail'))) return null;
          return chosen;
        }
        if (depth - titleDepth >= 3) break;
      } else if (a.hasApply(cur)) {
        if (h < 60 || isOversizedHost(hostMetrics(cur, a, 'detail'))) return null;
        return cur;
      }
    }
    if (titleHost && isOversizedHost(hostMetrics(titleHost, a, 'detail'))) return null;
    return titleHost;
  }

  /**
   * Where the summary box goes inside a detail host: after the Apply/Save row, else after the
   * closed notice row, else at the end. A "row" is the highest ancestor of the control that
   * does not also contain the title, so the box never lands inside the title/company rows.
   */
  function detailBoxAnchor(host, a) {
    var el = a.applyEl(host) || a.closedEl(host);
    if (!el) return { mode: 'end', el: null, via: 'end' };
    var via = a.applyEl(host) ? 'actions' : 'closed';
    var title = a.titleEl(host);
    var row = el;
    while (a.parent(row) && a.parent(row) !== host && !(title && a.contains(a.parent(row), title))) {
      row = a.parent(row);
    }
    return { mode: 'after', el: row, via: via };
  }

  /**
   * CSS top (px) for the detail summary box relative to the float/host top.
   * hostTop / applyRowBottom are viewport Y from getBoundingClientRect; box sits just
   * below the Apply/Save row so it never covers those buttons.
   */
  function detailBoxOffsetTop(hostTop, applyRowBottom, fallback) {
    var fb = fallback == null ? 72 : fallback;
    if (applyRowBottom == null || !isFinite(applyRowBottom) || !isFinite(hostTop)) return fb;
    var top = Math.round(applyRowBottom - hostTop + 8);
    return top < 8 ? 8 : top;
  }

  var CLOSED_RE = /art\u0131k ba\u015fvuru kabul etmiyor|no longer accepting applications/i;

  function isClosedNoticeText(t) {
    return CLOSED_RE.test(String(t || ''));
  }

  function applicationsFromSnapshot(snapshot) {
    if (Array.isArray(snapshot)) return snapshot;
    if (snapshot && Array.isArray(snapshot.applications)) return snapshot.applications;
    return [];
  }

  function scannedAtFromSnapshot(snapshot) {
    if (!snapshot || Array.isArray(snapshot)) return '';
    return snapshot.scrapedAt || snapshot.scrapedAtDisplay || snapshot.scannedAt || '';
  }

  /** Past applications grouped by canonical company key. Skips empty and location-like names. */
  function groupApplicationsByCompany(apps) {
    var list = Array.isArray(apps) ? apps : [];
    var order = [];
    var byKey = Object.create(null);
    var i;
    for (i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !usableCompany(a.company)) continue;
      var key = canonicalCompanyKey(a.company);
      if (!key) continue;
      var g = byKey[key];
      if (!g) {
        g = {
          key: key,
          company: String(a.company).replace(/\s+/g, ' ').trim(),
          applications: [],
        };
        byKey[key] = g;
        order.push(g);
      }
      g.applications.push(a);
    }
    return order;
  }

  var DETAIL_PREVIEW_LIMIT = 3;
  var DETAIL_SUBTEXT = 'Yeniden ba\u015fvurmadan \u00f6nce ge\u00e7mi\u015f kay\u0131tlar\u0131na g\u00f6z at.';
  var REPOST_WARNING = 'Ba\u015fvurun g\u00f6r\u00fcnt\u00fclenmeden ilan yeniden yay\u0131nlanm\u0131\u015f.';
  var MAJORITY_WARNING = 'Bu firmadaki ba\u015fvurular\u0131n\u0131n \u00e7o\u011fu g\u00f6r\u00fcnt\u00fclenmedi.';

  function timesAppliedText(total) {
    var n = Number(total) || 0;
    if (n <= 0) return '';
    return 'Bu firmaya daha \u00f6nce ' + n + ' kez ba\u015fvurdun';
  }

  function companyLabel(explicit, apps) {
    var name = String(explicit || '').replace(/\s+/g, ' ').trim();
    if (name) return name;
    var list = Array.isArray(apps) ? apps : [];
    var i;
    for (i = 0; i < list.length; i++) {
      name = String((list[i] && list[i].company) || '').replace(/\s+/g, ' ').trim();
      if (name) return name;
    }
    return '';
  }

  function modalTitle(company) {
    var name = String(company || '').replace(/\s+/g, ' ').trim() || 'Firma';
    return name + ' \u00b7 Ge\u00e7mi\u015f ba\u015fvurular\u0131n';
  }

  function modalSubtitle(total, relative) {
    var n = Number(total) || 0;
    var text = n + ' ba\u015fvuru';
    var when = String(relative || '').trim();
    if (when) text += ' \u00b7 son ba\u015fvuru ' + when;
    return text;
  }

  function modalFooter(scannedAt) {
    var prefix = 'Bu liste yaln\u0131zca bu bilgisayarda saklanan son taramana g\u00f6re haz\u0131rland\u0131';
    var raw = String(scannedAt || '').trim();
    if (!raw) return prefix + '.';
    var date = parseAbsoluteDate(raw);
    var tarih = date ? formatLongDate(date) : raw;
    if (!tarih) return prefix + '.';
    return prefix + ' (' + tarih + ').';
  }

  /**
   * Card hides the "only this job" state because LinkedIn already shows Başvuruldu.
   * Set showCurrentJob to true to show the short card label "Başvurdun" instead.
   */
  var CARD_BADGE_FLAGS = { showCurrentJob: false };
  var DETAIL_BADGE_MAX = 280;
  var DETAIL_BADGE_CHROME = 44;
  var DETAIL_CHAR_PX = 6.5;

  function detailTextWidth(text) {
    return DETAIL_BADGE_CHROME + String(text || '').length * DETAIL_CHAR_PX;
  }

  var INSPECT_HINT = 'incelemek i\u00e7in t\u0131kla';

  /**
   * Sağ panel rozetinin görünen yazısı. Kısa sayım ("Firmaya 5 başvuru") durur;
   * aynı metnin yanında inceleme ipucu vardır.
   */
  function detailPillText(copy) {
    if (!copy) return '';
    var base = String(copy.cardText || '').trim();
    if (!base) base = String(copy.detailText || '').trim();
    if (!base) return '';
    if (base.toLowerCase().indexOf(INSPECT_HINT) !== -1) return base;
    return base + ' \u00b7 ' + INSPECT_HINT;
  }

  function detailPillAria(label) {
    var text = String(label || '').trim();
    if (!text) return '';
    if (/incelemek i\u00e7in t\u0131kla/i.test(text)) return text;
    return text.replace(/\.?\s*$/, '') + '. \u0130ncelemek i\u00e7in t\u0131kla.';
  }

  /** Visible detail label. Appends " · Ayrıntılar" only when the 280px pill can hold it. */
  function detailVisibleText(base) {
    var text = String(base || '');
    if (!text) return '';
    var withMore = text + ' \u00b7 Ayr\u0131nt\u0131lar';
    if (detailTextWidth(withMore) <= DETAIL_BADGE_MAX) return withMore;
    return text;
  }

  /**
   * Short visible labels. otherCount is applications at the company other than the open job.
   * state: "company" | "current" | "mixed"
   * ariaLabel is always the full sentence.
   */
  function badgeCopy(state, otherCount) {
    var n = Number(otherCount) || 0;
    if (state === 'current') {
      return {
        state: 'current',
        tone: 'info',
        cardText: CARD_BADGE_FLAGS.showCurrentJob ? 'Ba\u015fvurdun' : '',
        detailText: 'Bu ilana ba\u015fvurdun',
        ariaLabel: 'Bu ilana ba\u015fvurdun. Ayr\u0131nt\u0131lar\u0131 g\u00f6ster.',
      };
    }
    if (state === 'mixed') {
      return {
        state: 'mixed',
        tone: 'amber',
        cardText: 'Firmaya ' + n + ' ba\u015fvuru daha',
        detailText: 'Bu ilana ba\u015fvurdun \u00b7 ' + n + ' ba\u015fvuru daha',
        ariaLabel: 'Bu ilana ba\u015fvurdun. Firmaya ' + n + ' ba\u015fvuru daha. Ayr\u0131nt\u0131lar\u0131 g\u00f6ster.',
      };
    }
    return {
      state: 'company',
      tone: 'amber',
      cardText: 'Firmaya ' + n + ' ba\u015fvuru',
      detailText: 'Bu firmaya ' + n + ' kez ba\u015fvurdun',
      ariaLabel: 'Bu firmaya daha \u00f6nce ' + n + ' kez ba\u015fvurdun. Ayr\u0131nt\u0131lar\u0131 g\u00f6ster.',
    };
  }

  function pinCurrentFirst(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    var current = null;
    var rest = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].isCurrent && !current) current = list[i];
      else rest.push(list[i]);
    }
    if (!current) return list;
    return [current].concat(rest);
  }

  function splitCurrentJob(apps, currentJobId) {
    var currentId = jobIdFromToken(currentJobId);
    var list = Array.isArray(apps) ? apps : [];
    var currentApp = null;
    var others = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var app = list[i];
      if (currentId && !currentApp && jobIdOfApplication(app) === currentId) currentApp = app;
      else others.push(app);
    }
    return { currentId: currentId, currentApp: currentApp, others: others };
  }

  function cardWarningText(total, lastDate) {
    var text = timesAppliedText(total);
    if (!text) return '';
    var when = String(lastDate || '').trim();
    if (when) text += ' \u00b7 son: ' + when;
    return text;
  }

  function detailWarningTitle(total) {
    var text = timesAppliedText(total);
    return text ? text + '.' : '';
  }

  function expandApplicationsLabel(hiddenCount, expanded) {
    if (expanded) return 'Daha az g\u00f6ster';
    var n = Number(hiddenCount) || 0;
    if (n <= 0) return '';
    return '+' + n + ' ba\u015fvuru daha';
  }

  /**
   * Copy + rows for one company's warning.
   * The listing shown in the modal is every application (newest first).
   * options.currentJobId, when that posting is in the snapshot, is not counted
   * as a past application to the company: the copy says "Bu ilana başvurdun"
   * and, if other applications remain, both facts.
   * options: { status, previewLimit, currentJobId, companyName }.
   */
  function buildCompanyWarning(apps, options) {
    var opts = options || {};
    var S = statusApi(opts.status);
    var split = splitCurrentJob(apps, opts.currentJobId);
    var listing = listCompanyApps(apps, {
      status: S,
      limit: Infinity,
      currentJobId: split.currentId,
      now: opts.now,
    });
    var otherCount = split.others.length;
    var counted = split.currentApp ? otherCount : listing.total;
    var state = '';
    if (split.currentApp && otherCount > 0) state = 'mixed';
    else if (split.currentApp) state = 'current';
    else if (counted > 0) state = 'company';
    var copy = state ? badgeCopy(state, state === 'company' ? counted : otherCount) : null;
    var cardText = copy ? copy.cardText : '';
    var detailText = copy ? detailPillText(copy) : '';
    var companyName = companyLabel(opts.companyName, apps);
    var newest = listing.items[0];
    var lastRelative = newest ? newest.relativeLabel || newest.dateLabel || newest.when : '';
    var items = pinCurrentFirst(listing.items);
    var warning = {
      state: state,
      tone: copy ? copy.tone : '',
      total: counted,
      modalCount: listing.total,
      companyName: companyName,
      modalTitle: modalTitle(companyName),
      modalSubtitle: modalSubtitle(listing.total, lastRelative),
      footer: modalFooter(opts.scannedAt),
      currentJobId: split.currentId,
      thisJob: !!split.currentApp,
      otherCount: otherCount,
      cardText: cardText,
      detailText: detailText,
      ariaLabel: copy ? detailPillAria(copy.ariaLabel) : '',
      items: items,
      signature: '',
    };
    var parts = [warning.cardText, warning.detailText, warning.ariaLabel, warning.modalTitle, warning.modalSubtitle, warning.footer];
    var i;
    for (i = 0; i < items.length; i++) parts.push(items[i].line);
    warning.signature = parts.join('\n');
    return warning;
  }

  function indexApplications(apps, options) {
    var groups = groupApplicationsByCompany(apps);
    var byKey = new Map();
    var keys = [];
    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      var groupOpts = options || {};
      g.warning = buildCompanyWarning(g.applications, {
        status: groupOpts.status,
        currentJobId: groupOpts.currentJobId,
        companyName: g.company,
        scannedAt: groupOpts.scannedAt,
        now: groupOpts.now,
      });
      byKey.set(g.key, g);
      keys.push(g.key);
    }
    var bySlug = new Map();
    var byJobId = new Map();
    var byLogo = new Map();
    for (i = 0; i < groups.length; i++) {
      var grp = groups[i];
      for (var j = 0; j < grp.applications.length; j++) {
        var app = grp.applications[j] || {};
        var jid = jobIdOfApplication(app);
        if (jid && !byJobId.has(jid)) byJobId.set(jid, grp.key);
        var slug = companySlugFromHref(app.companyUrl) || normSlug(app.companySlug);
        if (slug) claim(bySlug, slug, grp.key);
        if (app.companyId != null && /^\d+$/.test(String(app.companyId))) claim(bySlug, String(app.companyId), grp.key);
        var asset = logoAssetId(app.companyLogoUrl);
        if (asset) claim(byLogo, asset, grp.key);
      }
    }
    // A slug or logo claimed by two different companies is ambiguous: drop it.
    [bySlug, byLogo].forEach(function (m) {
      m.forEach(function (v, k) {
        if (v === null) m.delete(k);
      });
    });
    return {
      keys: keys,
      byKey: byKey,
      groups: groups,
      bySlug: bySlug,
      byJobId: byJobId,
      byLogo: byLogo,
      scannedAt: (options && options.scannedAt) || '',
    };
  }

  function claim(map, id, key) {
    if (!map.has(id)) map.set(id, key);
    else if (map.get(id) !== key) map.set(id, null);
  }

  function normSlug(value) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    try {
      s = decodeURIComponent(s);
    } catch (e) {}
    // Locale-independent: tr-TR would turn "IBM" into "ıbm" while the scraper stored "ibm".
    s = s.toLowerCase().replace(/\/+$/, '');
    return s.length >= 2 && s.length <= 120 ? s : '';
  }

  /** "https://www.linkedin.com/company/ictworks/life/" -> "ictworks". Also /showcase/. */
  function companySlugFromHref(href) {
    var m = String(href || '').match(/\/(?:company|showcase)\/([^/?#]+)/i);
    return m ? normSlug(m[1]) : '';
  }

  /**
   * Stable image asset id of a LinkedIn logo URL. The same logo is served in several
   * sizes ("company-logo_100_100", "_200_200") with different query tokens; the
   * path segment after /dms/image/(v2/) stays the same.
   */
  function logoAssetId(url) {
    var s = String(url || '');
    if (!/licdn\.com/i.test(s)) return '';
    if (!/company-logo|organization|logo/i.test(s)) return '';
    var m = s.match(/\/dms\/image\/(?:v\d+\/)?([A-Za-z0-9_-]{8,})\//);
    return m ? m[1] : '';
  }

  /**
   * Group of a company name seen on a job page: exact equality of the canonical key
   * (case / Turkish letters / punctuation / legal suffix normalised) only. No prefix or
   * substring matching: "Turkcell" must not claim "Turkcell Global Bilgi", "Meta" must
   * not claim "Metamorph". Name variants of the same LinkedIn company are covered by the
   * slug / company id / logo / job id indexes instead.
   */
  function lookupCompany(raw, index) {
    if (!raw || !index || !index.byKey) return null;
    var direct = canonicalCompanyKey(raw);
    if (direct && index.byKey.has(direct)) return index.byKey.get(direct);
    return null;
  }

  /** Words that are page chrome / placeholders far more often than a company name. */
  var GENERIC_COMPANY_KEYS = {
    remote: 1, uzaktan: 1, hybrid: 1, hibrit: 1, onsite: 1, 'on site': 1, 'is yerinde': 1, yerinde: 1,
    confidential: 1, gizli: 1, 'gizli firma': 1, 'gizli sirket': 1, stealth: 1, 'stealth startup': 1,
    freelance: 1, freelancer: 1, serbest: 1, 'self employed': 1, private: 1, various: 1, company: 1,
    sirket: 1, firma: 1, linkedin: 1, 'full time': 1, 'part time': 1, 'tam zamanli': 1, 'yari zamanli': 1,
    contract: 1, sozlesmeli: 1, internship: 1, staj: 1, stajyer: 1, group: 1, holding: 1, global: 1,
  };

  /** Safe for free-text / tab-title matching: not generic and at least 3 characters. */
  function isDistinctiveCompanyKey(key) {
    var k = String(key || '');
    if (k.replace(/\s+/g, '').length < 3) return false;
    return !GENERIC_COMPANY_KEYS[k];
  }

  var api = {
    stripLogoSuffix: stripLogoSuffix,
    normCompany: normCompany,
    stripLegalSuffixes: stripLegalSuffixes,
    canonicalCompanyKey: canonicalCompanyKey,
    matchCompanyKey: matchCompanyKey,
    isNoiseLine: isNoiseLine,
    pickCompanyFromLines: pickCompanyFromLines,
    companyFromLogoAlt: companyFromLogoAlt,
    isLocationLike: isLocationLike,
    usableCompany: usableCompany,
    hitKey: hitKey,
    isIgnoredCompanyHit: isIgnoredCompanyHit,
    pageHitKey: pageHitKey,
    isOversizedHost: isOversizedHost,
    hostMatchesCompany: hostMatchesCompany,
    needsAppScroller: needsAppScroller,
    looksLikeListCard: looksLikeListCard,
    jobIdFromHref: jobIdFromHref,
    jobIdFromToken: jobIdFromToken,
    jobIdOfApplication: jobIdOfApplication,
    isDismissControl: isDismissControl,
    summaryText: summaryText,
    APP_LIST_LIMIT: APP_LIST_LIMIT,
    shortWhen: shortWhen,
    formatApplicationDate: formatApplicationDate,
    CLOSED_STATUS: CLOSED_STATUS,
    shortAppStatus: shortAppStatus,
    listCompanyApps: listCompanyApps,
    cardBadgeSpec: cardBadgeSpec,
    resolveCardContainer: resolveCardContainer,
    resolveDetailHost: resolveDetailHost,
    detailBoxAnchor: detailBoxAnchor,
    detailBoxOffsetTop: detailBoxOffsetTop,
    isClosedNoticeText: isClosedNoticeText,
    applicationsFromSnapshot: applicationsFromSnapshot,
    scannedAtFromSnapshot: scannedAtFromSnapshot,
    groupApplicationsByCompany: groupApplicationsByCompany,
    DETAIL_PREVIEW_LIMIT: DETAIL_PREVIEW_LIMIT,
    DETAIL_SUBTEXT: DETAIL_SUBTEXT,
    REPOST_WARNING: REPOST_WARNING,
    MAJORITY_WARNING: MAJORITY_WARNING,
    cardWarningText: cardWarningText,
    detailWarningTitle: detailWarningTitle,
    formatModalDateLine: formatModalDateLine,
    relativeDateLabel: relativeDateLabel,
    modalTitle: modalTitle,
    modalSubtitle: modalSubtitle,
    modalFooter: modalFooter,
    CARD_BADGE_FLAGS: CARD_BADGE_FLAGS,
    detailVisibleText: detailVisibleText,
    detailTextWidth: detailTextWidth,
    badgeCopy: badgeCopy,
    expandApplicationsLabel: expandApplicationsLabel,
    buildCompanyWarning: buildCompanyWarning,
    indexApplications: indexApplications,
    lookupCompany: lookupCompany,
    isDistinctiveCompanyKey: isDistinctiveCompanyKey,
    companySlugFromHref: companySlugFromHref,
    logoAssetId: logoAssetId,
  };

  root.BasvuruBadgesCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
