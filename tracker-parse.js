/**
 * Pure tracker-row text parsing + dedupe keys (no DOM).
 * Used by scrape.js and node tests.
 */
(function (root) {
  'use strict';

  var CLOSED_PHRASE = 'Art\u0131k ba\u015fvuru kabul etmiyor';
  var REPOST_PHRASE = 'yeniden yay\u0131nlad\u0131';
  var REL_ONCE = '\\d+\\s+(?:dakika|saat|g\\u00fcn|hafta|ay|y\\u0131l)\\s+\\u00f6nce';
  var YENIDEN_RE = /yeniden\s+(?:yay\u0131n|payla\u015f)/i;
  var UNKNOWN_COMPANY = 'Bilinmeyen \u015firket';
  var uniqKeep = 0;

  var COUNTRY =
    '(?:T\u00fcrkiye|Turkey|Turkiye|Germany|Deutschland|United Kingdom|UK|USA|United States|Netherlands|Nederland|Poland|Polska|Canada|France|Spain|Espa\u00f1a|Italy|Italia|European Union|EMEA|Europe|Avrupa)';
  var COUNTRY_ONLY_RE = new RegExp('^' + COUNTRY + '(?:\\s*\\([^)]*\\))?$', 'i');
  var ENDS_WITH_COUNTRY_RE = new RegExp(',\\s*' + COUNTRY + '(?:\\s*\\([^)]*\\))?$', 'i');
  var LEGAL_SUFFIX_RE =
    /,\s*(?:Inc|Ltd|LLC|L\.L\.C|GmbH|AG|S\.A|A\.\u015e|A\.S|Ltd\.?\s*\u015eti|Corp|Co|PLC|BV|B\.V|SRL|S\.R\.L|Oy|AB|AS|SE)\.?\b/i;

  /**
   * Location / work-type strings that must never be used as company names.
   * A company name that merely contains a country word ("Randstad Türkiye",
   * "Octet Turkey") is still a company.
   */
  function isLocationLike(text) {
    var s = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s || s.length < 2) return false;
    if (COUNTRY_ONLY_RE.test(s)) return true;
    if (/\((?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site)\)/i.test(s)) return true;
    if (/^(?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site)$/i.test(s)) return true;
    if (LEGAL_SUFFIX_RE.test(s)) return false;
    if (ENDS_WITH_COUNTRY_RE.test(s)) return true;
    // "İstanbul, Türkiye" / "Berlin, Germany" / "Şişli (İş yerinde)"
    if (/^[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00c2Âa-z\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00e2â\s\-']+,\s*[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc]/u.test(s)) {
      return true;
    }
    if (/\([^)]*(?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site)[^)]*\)/i.test(s) && s.length < 80) {
      return true;
    }
    return false;
  }

  /**
   * Resolve company vs location when LinkedIn shows "İstanbul · (Uzaktan)" without a company.
   * @returns {{company:string|null,location:string|null,workType:string|null}}
   */
  function resolveCompanyAndLocation(opts) {
    opts = opts || {};
    var company = opts.company != null ? String(opts.company).replace(/\s+/g, ' ').trim() : '';
    var location = opts.location != null ? String(opts.location).replace(/\s+/g, ' ').trim() : '';
    var workType = opts.workType != null ? String(opts.workType).replace(/\s+/g, ' ').trim() : '';
    var logoCompany = opts.logoCompany != null ? String(opts.logoCompany).replace(/\s+/g, ' ').trim() : '';
    var ariaCompany = opts.ariaCompany != null ? String(opts.ariaCompany).replace(/\s+/g, ' ').trim() : '';

    if (company && isLocationLike(company)) {
      // Mis-parsed: location (and maybe work type) sat in the company slot
      if (!location) location = company;
      else if (!workType && /\((?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote)/i.test(location)) {
        workType = location;
        location = company;
      } else if (!workType) {
        location = company + (location ? ' \u00b7 ' + location : '');
      }
      company = '';
    }

    if (location && !workType) {
      var wt = location.match(/\(([^)]*(?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site)[^)]*)\)/i);
      if (wt) {
        workType = wt[1].trim();
        location = location.replace(wt[0], '').replace(/\s*[·•]\s*$/, '').trim();
      }
    }

    if (!company) {
      if (logoCompany && !isLocationLike(logoCompany)) company = logoCompany;
      else if (ariaCompany && !isLocationLike(ariaCompany)) company = ariaCompany;
    }

    if (!company) company = UNKNOWN_COMPANY;

    return {
      company: company || null,
      location: location || null,
      workType: workType || null,
    };
  }

  function detectCv(blob) {
    if (root.BasvuruStatus && root.BasvuruStatus.detectCvDownloaded) {
      return root.BasvuruStatus.detectCvDownloaded(blob);
    }
    return (
      /\bcv\s+indirildi/i.test(String(blob || '')) ||
      /\u00f6zge\u00e7mi\u015f(?:iniz)?\s+indirildi/i.test(String(blob || '')) ||
      /resume\s+downloaded/i.test(String(blob || ''))
    );
  }

  function detectViewed(blob) {
    if (root.BasvuruStatus && root.BasvuruStatus.detectApplicationViewed) {
      return root.BasvuruStatus.detectApplicationViewed(blob);
    }
    var s = String(blob || '');
    if (/g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(s)) return false;
    return (
      /ba\u015fvuru(?:nuz)?\s+g\u00f6r\u00fcnt\u00fclendi(?!\w)/i.test(s) ||
      /application\s+viewed/i.test(s)
    );
  }

  /**
   * Parse applied / publish / closed / viewed / cv from a single row's text blob.
   */
  function parseTrackerRowText(blob) {
    var text = String(blob || '').replace(/\s+/g, ' ').trim();
    var appliedM = text.match(
      /(\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce(?:\s+ba\u015fvurdu)?)/i
    );
    var appliedAt = appliedM ? appliedM[1].replace(/\s+/g, ' ').trim() : null;

    var closed =
      text.indexOf(CLOSED_PHRASE) !== -1 ||
      /no longer (accepting|taking) applications/i.test(text);

    var publishedAt = null;
    var yenidenPhrase = false;
    var repTimed = text.match(
      new RegExp(
        '(' + REL_ONCE + '\\s+yeniden\\s+(?:yay\\u0131nlad\\u0131|payla\\u015ft\\u0131))',
        'i'
      )
    );
    var pubTimed = text.match(
      new RegExp('\\(?\\s*(' + REL_ONCE + '\\s+yay\\u0131nla(?:d\\u0131|nd\\u0131))\\s*\\)?', 'i')
    );
    if (repTimed) {
      publishedAt = repTimed[1].replace(/\s+/g, ' ').trim();
      yenidenPhrase = true;
    } else if (YENIDEN_RE.test(text)) {
      yenidenPhrase = true;
      publishedAt = pubTimed
        ? pubTimed[1].replace(/\s+/g, ' ').trim().replace(/yay\u0131nland\u0131/i, 'yay\u0131nlad\u0131')
        : REPOST_PHRASE;
    } else if (pubTimed) {
      publishedAt = pubTimed[1]
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/yay\u0131nland\u0131/i, 'yay\u0131nlad\u0131');
    }

    var postingStatus = null;
    if (closed) postingStatus = CLOSED_PHRASE;
    else if (publishedAt) postingStatus = publishedAt;

    return {
      appliedAt: appliedAt,
      publishedAt: publishedAt,
      postingStatus: postingStatus,
      yenidenPhrase: yenidenPhrase,
      closed: closed,
      applicationViewed: detectViewed(text),
      cvDownloaded: detectCv(text),
      rawStatus: text || null,
    };
  }

  function rowDedupeKey(row) {
    if (!row) return 'keep:' + ++uniqKeep;
    var applied = row.appliedAt ? String(row.appliedAt).replace(/\s+/g, ' ').trim() : '';
    if (row.jobId) {
      // Same job may appear twice with different applied times — keep both.
      return applied ? 'id:' + String(row.jobId) + '|' + applied : 'id:' + String(row.jobId);
    }
    var url = row.jobUrl ? String(row.jobUrl) : '';
    if (url) {
      var m = url.match(/\/jobs\/view\/(\d+)/);
      if (m) {
        return applied ? 'id:' + m[1] + '|' + applied : 'id:' + m[1];
      }
      return applied ? 'url:' + url + '|' + applied : 'url:' + url;
    }
    // Deleted / no-link rows: stable synthetic key (include page when known)
    var syn =
      'syn:' +
      (row.company || '') +
      '|' +
      (row.jobTitle || '') +
      '|' +
      applied +
      '|' +
      (row._pageIndex != null ? String(row._pageIndex) : '');
    if (syn !== 'syn:|||') return syn;
    return 'keep:' + ++uniqKeep;
  }

  function resetDedupeCounter() {
    uniqKeep = 0;
  }

  var AGE_STOP_CONSECUTIVE = 5;
  var AGE_STOP_FULL_PAGE_MIN_PARSED = 3;

  function ymd(date) {
    if (!date) return '';
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1);
    var day = String(date.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  /**
   * Parse "X g\u00fcn/hafta/ay/y\u0131l \u00f6nce ba\u015fvurdu" into a Date.
   */
  function parseRelativeToDate(appliedAt, now) {
    if (!appliedAt) return null;
    now = now || new Date();
    var s = String(appliedAt).toLowerCase();
    var m = s.match(/(\d+)\s*(dakika|saat|g\u00fcn|hafta|ay|y\u0131l)/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (!isFinite(n)) return null;
    var unit = m[2];
    var d = new Date(now.getTime());
    if (unit.indexOf('dakika') === 0) d.setMinutes(d.getMinutes() - n);
    else if (unit.indexOf('saat') === 0) d.setHours(d.getHours() - n);
    else if (unit.indexOf('g\u00fcn') === 0) d.setDate(d.getDate() - n);
    else if (unit.indexOf('hafta') === 0) d.setDate(d.getDate() - n * 7);
    else if (unit.indexOf('ay') === 0) d.setMonth(d.getMonth() - n);
    else if (unit.indexOf('y\u0131l') === 0) d.setFullYear(d.getFullYear() - n);
    else return null;
    return d;
  }

  function isWithinCutoff(appliedAt, cutoff, now) {
    if (!cutoff) return true;
    var d = parseRelativeToDate(appliedAt, now);
    if (!d) return true;
    return ymd(d) >= cutoff;
  }

  /**
   * Confident signal that remaining pages are outside the selected applied-at range.
   * Does not stop on a single posted-date-sorted stray.
   * Range "T\u00fcm\u00fc" (cutoff null) never stops.
   *
   * Stop when:
   *  - N consecutive parsed out-of-range rows on the same page (N=5), or
   *  - every parsed appliedAt on the page is outside and at least 3 were parsed.
   * In-range rows on the stopping page are still returned in inRangeRows.
   *
   * @param {Array<{appliedAt?: string}>} pageRows
   * @param {string|null} cutoff YYYY-MM-DD or null
   * @param {Date} [now]
   * @param {{consecutiveN?: number, fullPageMinParsed?: number}} [opts]
   */
  function pageAgeStopDecision(pageRows, cutoff, now, opts) {
    now = now || new Date();
    opts = opts || {};
    var consecutiveN = opts.consecutiveN != null ? opts.consecutiveN : AGE_STOP_CONSECUTIVE;
    var fullPageMin =
      opts.fullPageMinParsed != null ? opts.fullPageMinParsed : AGE_STOP_FULL_PAGE_MIN_PARSED;
    var rows = pageRows || [];
    var inRangeRows = [];
    var i;

    if (!cutoff) {
      for (i = 0; i < rows.length; i++) inRangeRows.push(rows[i]);
      return {
        stop: false,
        reason: null,
        inRangeCount: inRangeRows.length,
        outsideCount: 0,
        parsedCount: 0,
        consecutiveOutside: 0,
        inRangeRows: inRangeRows,
      };
    }

    var parsedCount = 0;
    var parsedInside = 0;
    var outsideCount = 0;
    var consecutive = 0;
    var maxConsecutive = 0;

    for (i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var applied = row.appliedAt;
      var parsed = parseRelativeToDate(applied, now);
      var within = isWithinCutoff(applied, cutoff, now);
      if (within) {
        inRangeRows.push(row);
      } else {
        outsideCount += 1;
      }
      if (parsed) {
        parsedCount += 1;
        if (within) {
          parsedInside += 1;
          consecutive = 0;
        } else {
          consecutive += 1;
          if (consecutive > maxConsecutive) maxConsecutive = consecutive;
        }
      } else {
        consecutive = 0;
      }
    }

    var reason = null;
    if (maxConsecutive >= consecutiveN) {
      reason = 'consecutive_outside';
    } else if (parsedCount >= fullPageMin && parsedInside === 0) {
      reason = 'page_all_outside';
    }

    return {
      stop: !!reason,
      reason: reason,
      inRangeCount: inRangeRows.length,
      outsideCount: outsideCount,
      parsedCount: parsedCount,
      consecutiveOutside: maxConsecutive,
      inRangeRows: inRangeRows,
    };
  }

  var api = {
    CLOSED_PHRASE: CLOSED_PHRASE,
    UNKNOWN_COMPANY: UNKNOWN_COMPANY,
    AGE_STOP_CONSECUTIVE: AGE_STOP_CONSECUTIVE,
    AGE_STOP_FULL_PAGE_MIN_PARSED: AGE_STOP_FULL_PAGE_MIN_PARSED,
    parseTrackerRowText: parseTrackerRowText,
    rowDedupeKey: rowDedupeKey,
    resetDedupeCounter: resetDedupeCounter,
    isLocationLike: isLocationLike,
    resolveCompanyAndLocation: resolveCompanyAndLocation,
    parseRelativeToDate: parseRelativeToDate,
    isWithinCutoff: isWithinCutoff,
    pageAgeStopDecision: pageAgeStopDecision,
    ymd: ymd,
  };

  root.BasvuruTrackerParse = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
