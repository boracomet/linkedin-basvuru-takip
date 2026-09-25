/**
 * Shared application status — single source of truth for results, scrape, and job badges.
 * Classic script (global BasvuruStatus) + CommonJS for node tests.
 */
(function (root) {
  'use strict';

  var CLOSED_PHRASE = 'Art\u0131k ba\u015fvuru kabul etmiyor';
  var YENIDEN_RE = /yeniden\s+(?:yay\u0131n|payla\u015f)/i;
  var REL_UNIT = 'dakika|saat|g\u00fcn|hafta|ay|y\u0131l';

  var STATUS = {
    CV: 'cv',
    VIEWED: 'viewed',
    REPOST_UNSEEN: 'repostUnseen',
    UNSEEN: 'unseen',
  };

  /*
   * Kısa etiketler. Anahtarlar (cv, viewed, repostUnseen, unseen) sabit.
   * unseen, gönderilip henüz görüntülenmeyen başvuru:
   * "Başvuru gönderildi fakat görüntülenmedi."
   * "Başvurular kapandı" bir durum anahtarı değil: closed bayrağı.
   * Kapalı ilan, gönderilip görüntülenmeyen başvurunun metnini değiştirmez.
   * Rozet metni badges-core CLOSED_STATUS içindedir.
   */
  var LABELS = {
    cv: 'CV indirildi',
    viewed: 'G\u00f6r\u00fcnt\u00fclendi',
    repostUnseen: 'G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131nland\u0131',
    unseen: 'Ba\u015fvuru g\u00f6nderildi fakat g\u00f6r\u00fcnt\u00fclenmedi.',
  };

  var CSS_CLASS = {
    cv: 'cv',
    viewed: 'viewed',
    repostUnseen: 'repost-nv',
    unseen: 'unseen',
  };

  function ageHours(text) {
    if (!text) return 1e12;
    var s = String(text).toLowerCase();
    var m = s.match(new RegExp('(\\d+)\\s*(' + REL_UNIT + ')', 'i'));
    if (!m) return 1e9;
    var n = parseInt(m[1], 10);
    var unit = m[2];
    if (unit.indexOf('dakika') === 0) return n / 60;
    if (unit.indexOf('saat') === 0) return n;
    if (unit.indexOf('g\u00fcn') === 0) return n * 24;
    if (unit.indexOf('hafta') === 0) return n * 24 * 7;
    if (unit.indexOf('ay') === 0) return n * 24 * 30;
    if (unit.indexOf('y\u0131l') === 0) return n * 24 * 365;
    return 1e9;
  }

  function detectCvDownloaded(blob) {
    var s = String(blob || '');
    if (!s) return false;
    // Match per segment so neighbor-row bleed can't turn "CV'yi g\u00f6ster" into a hit
    // via another row's "CV indirildi" in the same mega-blob.
    var parts = s.split(/\n+|\s*[|\u00b7\u2022]\s*/);
    var i;
    for (i = 0; i < parts.length; i++) {
      if (phraseIsCvDownloaded(parts[i])) return true;
    }
    return phraseIsCvDownloaded(s);
  }

  /** True only for employer-download phrases; never "CV'yi g\u00f6ster" / "\u00d6zge\u00e7mi\u015fi g\u00f6ster". */
  function phraseIsCvDownloaded(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    // Applicant self-service CTAs — never employer download.
    if (
      /(?:cv|\u00f6zge\u00e7mi\u015f|resume).{0,20}(?:g\u00f6ster|goster|ekle|y\u00fckle|yukle|view|show)/i.test(
        s
      ) &&
      !/indirildi|downloaded/i.test(s)
    ) {
      return false;
    }
    if (!/indirildi|downloaded/i.test(s)) return false;
    return (
      /\bcv(?:[\u2019'\u2018`]?(?:niz|n\u0131z|iniz|iniz|yi|y\u0131))?\s+indirildi\b/i.test(s) ||
      /\bcv\s+indirildi\b/i.test(s) ||
      /\u00f6zge\u00e7mi\u015f(?:iniz)?\s+indirildi\b/i.test(s) ||
      /(?:resume|cv)\s+downloaded\b/i.test(s)
    );
  }

  /**
   * Employer viewed the application — never from "g\u00f6r\u00fcnt\u00fclenmeden" /
   * "bak\u0131lmadan", never from LinkedIn job-card "G\u00f6r\u00fcnt\u00fclendi",
   * never from "CV'yi g\u00f6ster".
   */
  function detectApplicationViewed(blob) {
    var s = String(blob || '');
    if (!s) return false;
    if (/g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(s)) return false;
    var parts = s.split(/\n+|\s*[|\u00b7\u2022]\s*/);
    var i;
    for (i = 0; i < parts.length; i++) {
      if (phraseIsApplicationViewed(parts[i])) return true;
    }
    return phraseIsApplicationViewed(s);
  }

  function phraseIsApplicationViewed(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    if (/g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(s)) return false;
    // Lone "G\u00f6r\u00fcnt\u00fclendi" (job-card applicant view) — not employer.
    if (/^g\u00f6r\u00fcnt\u00fclendi$/i.test(s)) return false;
    return (
      /ba\u015fvuru(?:nuz)?\s+g\u00f6r\u00fcnt\u00fclendi(?!\w)/i.test(s) ||
      /application\s+viewed/i.test(s)
    );
  }

  function detectClosed(blob) {
    var s = String(blob || '');
    return s.indexOf(CLOSED_PHRASE) !== -1 || /no longer (accepting|taking) applications/i.test(s);
  }

  function detectYenidenPhrase(blob) {
    return YENIDEN_RE.test(String(blob || ''));
  }

  function hay(app) {
    return [
      app.rawStatus || '',
      app.publishedAt || '',
      app.postingStatus || '',
      app.rawBlob || '',
      app.trackerText || '',
    ].join(' ');
  }

  /** Prefer publishedAt; else parse relative publish/repost from postingStatus. */
  function resolvePublishedAt(app) {
    if (app.publishedAt) return String(app.publishedAt);
    var ps = String(app.postingStatus || '');
    var m = ps.match(
      new RegExp(
        '(\\d+\\s+(?:' +
          REL_UNIT +
          ')\\s+\\u00f6nce(?:\\s+yeniden)?\\s+(?:yay\\u0131nla(?:d\\u0131|nd\\u0131)|payla\\u015ft\\u0131))',
        'i'
      )
    );
    if (m) return m[1].replace(/\s+/g, ' ').trim();
    if (/yay\u0131nla|payla\u015f/i.test(ps)) return ps;
    return '';
  }

  /**
   * Publish/repost is STRICTLY newer than apply (smaller age in hours).
   * Equal ages (e.g. both "1 hafta \u00f6nce") are NOT after-apply.
   */
  function isRepublishedAfterApply(app) {
    var appliedAt = app.appliedAt || '';
    var publishedAt = resolvePublishedAt(app);
    if (!appliedAt || !publishedAt) return false;
    var pubH = ageHours(publishedAt);
    var appH = ageHours(appliedAt);
    if (!(pubH < 1e9 && appH < 1e9)) return false;
    return pubH < appH;
  }

  function hasCv(app) {
    // Prefer rawStatus when present so corrections recompute without trusting stale booleans.
    if (app.rawStatus != null && String(app.rawStatus).length) {
      return detectCvDownloaded(app.rawStatus);
    }
    if (app.cvDownloaded === true) return true;
    return detectCvDownloaded(hay(app));
  }

  function hasViewed(app) {
    if (app.rawStatus != null && String(app.rawStatus).length) {
      return detectApplicationViewed(app.rawStatus);
    }
    var h = hay(app);
    if (/g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(h)) return false;
    if (app.applicationViewed === true) return true;
    return detectApplicationViewed(h);
  }

  function isClosedApp(app) {
    if (app.closed === true) return true;
    return detectClosed(hay(app)) || detectClosed(app.postingStatus || '');
  }

  /**
   * Exactly ONE primary status, priority: cv > viewed > repostUnseen > unseen.
   * Closed is a separate secondary flag.
   */
  function applicationStatus(app) {
    var a = app || {};
    var closed = isClosedApp(a);
    var id;
    if (hasCv(a)) id = STATUS.CV;
    else if (hasViewed(a)) id = STATUS.VIEWED;
    else if (isRepublishedAfterApply(a)) id = STATUS.REPOST_UNSEEN;
    else id = STATUS.UNSEEN;

    return {
      id: id,
      label: LABELS[id],
      cssClass: CSS_CLASS[id],
      closed: closed,
      seen: id === STATUS.CV || id === STATUS.VIEWED,
      repostUnseen: id === STATUS.REPOST_UNSEEN,
    };
  }

  function enrichApplication(app) {
    var next = Object.assign({}, app);
    // When rawStatus exists, refresh booleans from it before status pick.
    if (next.rawStatus != null && String(next.rawStatus).length) {
      next.cvDownloaded = detectCvDownloaded(next.rawStatus);
      next.applicationViewed = detectApplicationViewed(next.rawStatus);
    }
    var st = applicationStatus(next);
    next.statusId = st.id;
    next.statusLabel = st.label;
    next.repostedWithoutView = st.id === STATUS.REPOST_UNSEEN;
    next.closed = st.closed;
    if (st.id === STATUS.CV) next.cvDownloaded = true;
    if (st.id === STATUS.VIEWED) next.applicationViewed = true;
    if (st.id === STATUS.UNSEEN || st.id === STATUS.REPOST_UNSEEN) {
      if (next.rawStatus != null && String(next.rawStatus).length) {
        next.cvDownloaded = detectCvDownloaded(next.rawStatus);
        next.applicationViewed = detectApplicationViewed(next.rawStatus);
      }
    }
    return next;
  }

  function summarizeStatuses(apps) {
    var counts = { cv: 0, viewed: 0, repostUnseen: 0, unseen: 0 };
    var closed = 0;
    var list = apps || [];
    for (var i = 0; i < list.length; i++) {
      var st = applicationStatus(list[i]);
      counts[st.id] += 1;
      if (st.closed) closed += 1;
    }
    return {
      counts: counts,
      closed: closed,
      total: list.length,
      seen: counts.cv + counts.viewed,
      notSeen: counts.unseen + counts.repostUnseen,
      anyRepostUnseen: counts.repostUnseen > 0,
      majorityUnseen: list.length > 0 && counts.unseen + counts.repostUnseen > list.length / 2,
    };
  }

  /** Job-search card overlay flags for a company. */
  function companyOverlayFlags(apps) {
    var sum = summarizeStatuses(apps);
    return {
      anyRepostUnseen: sum.anyRepostUnseen,
      majorityUnseen: sum.majorityUnseen,
      summary: sum,
    };
  }

  var api = {
    STATUS: STATUS,
    LABELS: LABELS,
    CSS_CLASS: CSS_CLASS,
    CLOSED_PHRASE: CLOSED_PHRASE,
    YENIDEN_RE: YENIDEN_RE,
    ageHours: ageHours,
    detectCvDownloaded: detectCvDownloaded,
    detectApplicationViewed: detectApplicationViewed,
    phraseIsCvDownloaded: phraseIsCvDownloaded,
    phraseIsApplicationViewed: phraseIsApplicationViewed,
    detectClosed: detectClosed,
    detectYenidenPhrase: detectYenidenPhrase,
    resolvePublishedAt: resolvePublishedAt,
    isRepublishedAfterApply: isRepublishedAfterApply,
    applicationStatus: applicationStatus,
    enrichApplication: enrichApplication,
    summarizeStatuses: summarizeStatuses,
    companyOverlayFlags: companyOverlayFlags,
    isClosed: isClosedApp,
  };

  root.BasvuruStatus = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
