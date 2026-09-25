/**
 * Pure LinkedIn tracker API helpers (no DOM).
 * URL/body pagination rewrite, response scoring, generic parse, fallback, sanitize.
 */
(function (root) {
  'use strict';

  var MSG_SOURCE = 'basvuru-tracker-api';
  var STORAGE_SAMPLE = 'btApiSample';
  var SAMPLE_MAX_CHARS = 120000;

  function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  function safeJsonParse(s) {
    try {
      return JSON.parse(String(s || ''));
    } catch (_) {
      return null;
    }
  }

  /** REST query + GraphQL variables=(start:N,count:M) / JSON body + page/offset aliases. */
  function rewritePagination(url, body, start, count) {
    var s = start != null ? Number(start) : 0;
    var c = count != null ? Number(count) : 50;
    if (!isFinite(s) || s < 0) s = 0;
    if (!isFinite(c) || c < 1) c = 50;

    var nextUrl = rewriteUrlPagination(String(url || ''), s, c);
    nextUrl = nextUrl.replace(/([?&]page=)\d+/gi, '$1' + (Math.floor(s / c) + 1));
    nextUrl = nextUrl.replace(/([?&]offset=)\d+/gi, '$1' + s);
    nextUrl = nextUrl.replace(/(page:)\d+/gi, '$1' + (Math.floor(s / c) + 1));
    nextUrl = nextUrl.replace(/(offset:)\d+/gi, '$1' + s);

    var nextBody = body == null || body === '' ? body : rewriteBodyPagination(body, s, c);
    if (nextBody != null && typeof nextBody === 'string') {
      nextBody = nextBody.replace(/("offset"\s*:\s*)\d+/gi, '$1' + s);
      nextBody = nextBody.replace(/("page"\s*:\s*)\d+/gi, '$1' + (Math.floor(s / c) + 1));
      nextBody = nextBody.replace(/("pageSize"\s*:\s*)\d+/gi, '$1' + c);
    }
    return { url: nextUrl, body: nextBody, start: s, count: c };
  }

  function rewriteUrlPagination(url, start, count) {
    var raw = String(url || '');
    if (!raw) return raw;
    var base = 'https://www.linkedin.com';
    var u;
    try {
      u = new URL(raw, base);
    } catch (_) {
      return rewriteLoosePaginationString(raw, start, count);
    }
    if (u.searchParams.has('start')) u.searchParams.set('start', String(start));
    else if (/[?&]start=/i.test(raw) || /start:\d+/i.test(raw)) {
      /* keep GraphQL-style below */
    }
    if (u.searchParams.has('count')) u.searchParams.set('count', String(count));

    // GraphQL-style in query: variables=(...,start:10,count:10,...)
    var href = u.toString();
    href = rewriteLoosePaginationString(href, start, count);
    return href;
  }

  function rewriteLoosePaginationString(s, start, count) {
    var out = String(s || '');
    if (/\bstart\s*[:=]\s*\d+/i.test(out)) {
      out = out.replace(/\bstart\s*[:=]\s*\d+/gi, function (m) {
        return /:/.test(m) ? 'start:' + start : m.replace(/\d+/, String(start));
      });
      // normalize start= and start:
      out = out.replace(/([?&]start=)\d+/gi, '$1' + start);
      out = out.replace(/(start:)\d+/gi, '$1' + start);
    } else if (/[?&]start=/i.test(out)) {
      out = out.replace(/([?&]start=)\d+/gi, '$1' + start);
    }
    if (/\bcount\s*[:=]\s*\d+/i.test(out)) {
      out = out.replace(/([?&]count=)\d+/gi, '$1' + count);
      out = out.replace(/(count:)\d+/gi, '$1' + count);
      out = out.replace(/("count"\s*:\s*)\d+/gi, '$1' + count);
    }
    out = out.replace(/("start"\s*:\s*)\d+/gi, '$1' + start);
    out = out.replace(/("count"\s*:\s*)\d+/gi, '$1' + count);
    return out;
  }

  function rewriteBodyPagination(body, start, count) {
    if (body == null) return body;
    if (typeof body === 'object' && !(typeof Blob !== 'undefined' && body instanceof Blob)) {
      try {
        var cloned = JSON.parse(JSON.stringify(body));
        rewritePaginationInObject(cloned, start, count);
        return JSON.stringify(cloned);
      } catch (_) {
        return body;
      }
    }
    var s = String(body);
    var parsed = safeJsonParse(s);
    if (parsed && (isPlainObject(parsed) || Array.isArray(parsed))) {
      rewritePaginationInObject(parsed, start, count);
      return JSON.stringify(parsed);
    }
    return rewriteLoosePaginationString(s, start, count);
  }

  function rewritePaginationInObject(obj, start, count) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) rewritePaginationInObject(obj[i], start, count);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'start') && typeof obj.start === 'number') {
      obj.start = start;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'count') && typeof obj.count === 'number') {
      obj.count = count;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'offset') && typeof obj.offset === 'number') {
      obj.offset = start;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'pageSize') && typeof obj.pageSize === 'number') {
      obj.pageSize = count;
    }
    if (Object.prototype.hasOwnProperty.call(obj, 'page') && typeof obj.page === 'number') {
      obj.page = Math.floor(start / Math.max(count, 1)) + 1;
    }
    if (typeof obj.variables === 'string') {
      obj.variables = rewriteLoosePaginationString(obj.variables, start, count);
    } else if (isPlainObject(obj.variables)) {
      rewritePaginationInObject(obj.variables, start, count);
    }
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === 'start' || key === 'count' || key === 'variables') continue;
      var v = obj[key];
      if (v && typeof v === 'object') rewritePaginationInObject(v, start, count);
    }
  }

  function urnLooksLikeJob(urn) {
    var s = String(urn || '');
    return /fsd_jobPosting|jobPosting|jobPostingCard|jobApplication|fsd_jobCard/i.test(s);
  }

  function typeLooksLikeJob(t) {
    var s = String(t || '');
    return /JobPosting|JobCard|JobApplication|ApplicationTracking|jobsDashJob/i.test(s);
  }

  /**
   * Score whether JSON looks like an applied-jobs tracker list.
   * @returns {{score:number,reasons:string[],paging:object|null,entityCount:number}}
   */
  function scoreTrackerResponse(json, chipTotal) {
    var reasons = [];
    var score = 0;
    var paging = findPaging(json);
    var entityCount = countJobLikeEntities(json);

    if (paging && paging.total != null && isFinite(paging.total) && paging.total > 0) {
      score += 40;
      reasons.push('paging.total');
      if (chipTotal && Math.abs(paging.total - chipTotal) <= Math.max(5, chipTotal * 0.05)) {
        score += 25;
        reasons.push('paging≈chip');
      }
    }
    if (entityCount >= 3) {
      score += Math.min(35, entityCount);
      reasons.push('entities:' + entityCount);
    }
    if (jsonHasAppliedSignal(json)) {
      score += 15;
      reasons.push('applied');
    }
    if (jsonHasInsightTexts(json)) {
      score += 10;
      reasons.push('insights');
    }

    return { score: score, reasons: reasons, paging: paging, entityCount: entityCount };
  }

  function looksLikeTrackerListResponse(json, chipTotal) {
    var s = scoreTrackerResponse(json, chipTotal);
    return s.score >= 40 || (s.entityCount >= 5 && s.paging);
  }

  function findPaging(root) {
    var found = null;
    walk(root, function (node) {
      if (found) return;
      if (!isPlainObject(node)) return;
      if (
        node.paging &&
        isPlainObject(node.paging) &&
        (node.paging.total != null || node.paging.count != null)
      ) {
        found = {
          start: node.paging.start != null ? Number(node.paging.start) : 0,
          count: node.paging.count != null ? Number(node.paging.count) : null,
          total: node.paging.total != null ? Number(node.paging.total) : null,
        };
        return;
      }
      if (
        (node.start != null || node.count != null) &&
        node.total != null &&
        typeof node.total === 'number' &&
        Object.keys(node).length <= 6
      ) {
        found = {
          start: node.start != null ? Number(node.start) : 0,
          count: node.count != null ? Number(node.count) : null,
          total: Number(node.total),
        };
      }
    });
    return found;
  }

  function countJobLikeEntities(root) {
    var n = 0;
    var seen = new Set();
    walk(root, function (node) {
      if (!isPlainObject(node)) return;
      var urn = node.entityUrn || node.urn || node['*elements'] || '';
      var id = node.jobPostingId || node.jobId || '';
      var key = String(urn || id || '');
      if (key && seen.has(key)) return;
      var hit =
        urnLooksLikeJob(urn) ||
        typeLooksLikeJob(node.$type) ||
        typeLooksLikeJob(node._type) ||
        (node.jobPosting && true) ||
        (node.title && (node.companyDetails || node.companyName || node.company) && (node.entityUrn || node.jobState || node.listedAt || node.appliedAt));
      if (hit) {
        if (key) seen.add(key);
        n += 1;
      }
    });
    return n;
  }

  function jsonHasAppliedSignal(root) {
    var hit = false;
    walk(root, function (node) {
      if (hit) return;
      if (typeof node === 'string') {
        if (/applied|ba\u015fvur/i.test(node) && node.length < 80) hit = true;
        return;
      }
      if (!isPlainObject(node)) return;
      if (node.appliedAt || node.applied || node.applicationStatus) hit = true;
      if (/APPLIED/i.test(String(node.jobCardType || node.cardType || ''))) hit = true;
    });
    return hit;
  }

  function jsonHasInsightTexts(root) {
    var hit = false;
    walk(root, function (node) {
      if (hit) return;
      if (typeof node === 'string' && node.length < 200) {
        if (
          /ba\u015fvuru\s+g\u00f6r\u00fcnt\u00fclendi|cv\s+indirildi|yeniden\s+yay\u0131n|application\s+viewed|resume\s+downloaded/i.test(
            node
          )
        ) {
          hit = true;
        }
      }
    });
    return hit;
  }

  function walk(node, fn, seen) {
    seen = seen || new Set();
    if (node == null) return;
    if (typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
    }
    fn(node);
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) walk(node[i], fn, seen);
      return;
    }
    if (isPlainObject(node)) {
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) walk(node[keys[k]], fn, seen);
    }
  }

  function buildIncludedIndex(root) {
    var idx = Object.create(null);
    var list = [];
    if (root && Array.isArray(root.included)) list = root.included;
    else {
      walk(root, function (node) {
        if (isPlainObject(node) && Array.isArray(node.included) && node.included.length) {
          list = list.concat(node.included);
        }
      });
    }
    for (var i = 0; i < list.length; i++) {
      var ent = list[i];
      if (!isPlainObject(ent)) continue;
      var urn = ent.entityUrn || ent.urn;
      if (urn) idx[String(urn)] = ent;
    }
    return idx;
  }

  function resolveRef(val, idx) {
    if (typeof val === 'string' && idx[val]) return idx[val];
    if (isPlainObject(val) && val.entityUrn && idx[val.entityUrn]) return idx[val.entityUrn];
    return val;
  }

  function extractJobId(obj) {
    if (!obj) return null;
    var candidates = [
      obj.jobId,
      obj.jobPostingId,
      obj.backendUrn,
      obj.entityUrn,
      obj.urn,
      obj.jobPostingUrn,
      obj['*jobPosting'],
      isPlainObject(obj.jobPosting) ? obj.jobPosting.entityUrn : obj.jobPosting,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var id = jobIdFromAny(candidates[i]);
      if (id) return id;
    }
    return null;
  }

  function jobIdFromAny(v) {
    if (v == null) return null;
    if (typeof v === 'number' && isFinite(v)) return String(Math.floor(v));
    var s = String(v);
    var m =
      s.match(/(?:jobPosting|fsd_jobPosting|jobPostingCard):(\d+)/i) ||
      s.match(/\/jobs\/view\/(\d+)/) ||
      s.match(/\b(\d{8,})\b/);
    return m ? m[1] : null;
  }

  function pickString(obj, keys) {
    if (!obj) return null;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (isPlainObject(v) && typeof v.text === 'string' && v.text.trim()) return v.text.trim();
      if (isPlainObject(v) && typeof v.value === 'string' && v.value.trim()) return v.value.trim();
    }
    return null;
  }

  function collectInsightBlob(obj) {
    var parts = [];
    walk(obj, function (node) {
      if (typeof node === 'string' && node.length > 3 && node.length < 240) {
        if (
          /ba\u015fvuru|g\u00f6r\u00fcnt\u00fcle|cv|resume|yeniden|indirildi|viewed|downloaded|applied|closed|art\u0131k ba\u015fvuru|no longer/i.test(
            node
          )
        ) {
          if (parts.indexOf(node) < 0) parts.push(node);
        }
      }
      if (isPlainObject(node)) {
        var t = pickString(node, ['insight', 'insightText', 'text', 'message', 'description']);
        if (t && parts.indexOf(t) < 0) parts.push(t);
      }
    });
    return parts.join(' \u00b7 ');
  }

  function boolish(v) {
    if (v === true || v === false) return v;
    if (typeof v === 'string') {
      if (/^(true|yes|1)$/i.test(v)) return true;
      if (/^(false|no|0)$/i.test(v)) return false;
    }
    return null;
  }

  function relativeFromMs(ms, now) {
    if (ms == null || !isFinite(ms)) return null;
    var n = now || Date.now();
    var diff = Math.max(0, n - Number(ms));
    var min = Math.floor(diff / 60000);
    if (min < 60) return min <= 1 ? '1 dakika \u00f6nce' : min + ' dakika \u00f6nce';
    var hr = Math.floor(min / 60);
    if (hr < 48) return hr <= 1 ? '1 saat \u00f6nce' : hr + ' saat \u00f6nce';
    var day = Math.floor(hr / 24);
    if (day < 14) return day <= 1 ? '1 g\u00fcn \u00f6nce' : day + ' g\u00fcn \u00f6nce';
    var week = Math.floor(day / 7);
    if (week < 8) return week <= 1 ? '1 hafta \u00f6nce' : week + ' hafta \u00f6nce';
    var month = Math.floor(day / 30);
    if (month < 24) return month <= 1 ? '1 ay \u00f6nce' : month + ' ay \u00f6nce';
    var year = Math.floor(day / 365);
    return year <= 1 ? '1 y\u0131l \u00f6nce' : year + ' y\u0131l \u00f6nce';
  }

  function pickAppliedAt(obj, insightBlob, now) {
    var text = pickString(obj, ['appliedAt', 'appliedAtText', 'listedAtText', 'relativeAppliedAt']);
    if (text && /\u00f6nce|ago/i.test(text)) return text.replace(/\s+/g, ' ').trim();
    var ms =
      obj.appliedAt != null && typeof obj.appliedAt === 'number'
        ? obj.appliedAt
        : obj.listedAt != null && typeof obj.listedAt === 'number'
          ? obj.listedAt
          : null;
    if (ms != null && ms > 1e12) {
      var rel = relativeFromMs(ms, now);
      if (rel) return rel + ' ba\u015fvurdu';
    }
    if (insightBlob) {
      var m = insightBlob.match(/(\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce(?:\s+ba\u015fvurdu)?)/i);
      if (m) return m[1].replace(/\s+/g, ' ').trim();
    }
    return text || null;
  }

  function allowedLogoUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    var allow = root.BasvuruUrlAllow;
    if (!allow || typeof allow.isAllowedLogoUrl !== 'function') return null;
    return allow.isAllowedLogoUrl(url) ? url : null;
  }

  function logoFromBuilt(rootUrl, artifacts) {
    if (!rootUrl || !artifacts || !artifacts[0] || !artifacts[0].fileIdentifyingUrlPathSegment) return null;
    return allowedLogoUrl(String(rootUrl).replace(/\/$/, '') + artifacts[0].fileIdentifyingUrlPathSegment);
  }

  function logoFromObj(obj, idx) {
    if (!obj) return null;
    var keys = ['logo', 'companyLogo', 'logoUrl', 'image', 'logoResolutionResult'];
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === 'string' && /^https?:/i.test(v)) {
        var direct = allowedLogoUrl(v);
        if (direct) return direct;
        continue;
      }
      v = resolveRef(v, idx);
      if (isPlainObject(v)) {
        if (typeof v.url === 'string') {
          var fromUrl = allowedLogoUrl(v.url);
          if (fromUrl) return fromUrl;
        }
        var built = logoFromBuilt(v.rootUrl, v.artifacts);
        if (built) return built;
        var vec = v.vectorImage || v.logoResolutionResult;
        if (isPlainObject(vec)) {
          var fromVec = logoFromBuilt(vec.rootUrl, vec.artifacts);
          if (fromVec) return fromVec;
        }
      }
    }
    return null;
  }

  /** "/company/ictworks/life/" -> "ictworks" (lowercase), or null. */
  function companySlugOfApi(href) {
    var m = String(href || '').match(/\/(?:company|showcase)\/([^/?#]+)/i);
    if (!m) return null;
    var s = m[1];
    try {
      s = decodeURIComponent(s);
    } catch (_) {}
    s = s.toLowerCase();
    return s.length >= 2 && s.length <= 120 ? s : null;
  }

  function mapEntityToApplication(raw, idx, now) {
    if (!raw || !isPlainObject(raw)) return null;
    var job = resolveRef(raw.jobPosting || raw['*jobPosting'] || raw.job, idx);
    if (!isPlainObject(job)) job = raw;

    var jobId = extractJobId(raw) || extractJobId(job);
    if (!jobId) return null;

    var companyObj =
      resolveRef(job.companyDetails || job.company || job.companyName || raw.company, idx) || {};
    if (typeof companyObj === 'string') companyObj = { name: companyObj };

    var jobTitle =
      pickString(job, ['title', 'jobPostingTitle', 'name', 'headline']) ||
      pickString(raw, ['title', 'jobPostingTitle', 'name', 'headline']);
    var company =
      pickString(companyObj, ['name', 'companyName', 'universalName', 'text']) ||
      pickString(job, ['companyName', 'company']) ||
      pickString(raw, ['companyName', 'company']);
    var location =
      pickString(job, ['formattedLocation', 'location', 'jobLocation']) ||
      pickString(raw, ['formattedLocation', 'location']);

    var insightBlob = collectInsightBlob(raw);
    if (job !== raw) insightBlob = [insightBlob, collectInsightBlob(job)].filter(Boolean).join(' \u00b7 ');

    var Parse = root.BasvuruTrackerParse;
    var signals = Parse && Parse.parseTrackerRowText ? Parse.parseTrackerRowText(insightBlob) : null;

    var applicationViewed = boolish(raw.applicationViewed);
    if (applicationViewed == null) applicationViewed = boolish(raw.viewed);
    if (applicationViewed == null && signals) applicationViewed = !!signals.applicationViewed;

    var cvDownloaded = boolish(raw.resumeDownloaded);
    if (cvDownloaded == null) cvDownloaded = boolish(raw.cvDownloaded);
    if (cvDownloaded == null && signals) cvDownloaded = !!signals.cvDownloaded;

    var closed = signals ? !!signals.closed : false;
    if (!closed && /no longer|art\u0131k ba\u015fvuru/i.test(insightBlob)) closed = true;

    var appliedAt = pickAppliedAt(raw, insightBlob, now) || (signals && signals.appliedAt) || null;
    var publishedAt = signals ? signals.publishedAt : null;
    var postingStatus = signals ? signals.postingStatus : null;
    if (!postingStatus && closed) {
      postingStatus = 'Art\u0131k ba\u015fvuru kabul etmiyor';
    }

    var companyLogoUrl = logoFromObj(companyObj, idx) || logoFromObj(job, idx) || logoFromObj(raw, idx);

    var mapped = {
      jobTitle: jobTitle || null,
      company: company || null,
      location: location || null,
      workType: null,
      appliedAt: appliedAt,
      postingStatus: postingStatus,
      publishedAt: publishedAt,
      response: 'unknown',
      applicationViewed: !!applicationViewed,
      cvDownloaded: !!cvDownloaded,
      rawStatus: insightBlob || null,
      companyLogoUrl: companyLogoUrl,
      companySlug:
        companySlugOfApi(pickString(companyObj, ['url', 'companyPageUrl', 'navigationUrl'])) ||
        (typeof companyObj.universalName === 'string' && companyObj.universalName
          ? String(companyObj.universalName).toLowerCase()
          : null),
      companyId: (String(companyObj.entityUrn || companyObj['*company'] || '').match(/company:(\d+)/) || [])[1] || null,
      jobUrl: 'https://www.linkedin.com/jobs/view/' + jobId + '/',
      jobId: String(jobId),
    };

    if (root.BasvuruStatus && root.BasvuruStatus.enrichApplication) {
      return root.BasvuruStatus.enrichApplication(mapped);
    }
    mapped.repostedWithoutView = false;
    return mapped;
  }

  /**
   * Parse Voyager normalized or GraphQL tracker JSON into application rows.
   */
  function parseTrackerApiResponse(json, opts) {
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    var idx = buildIncludedIndex(json);
    var byId = Object.create(null);
    var order = [];

    walk(json, function (node) {
      if (!isPlainObject(node)) return;
      var urn = node.entityUrn || node.urn || '';
      var likely =
        urnLooksLikeJob(urn) ||
        typeLooksLikeJob(node.$type) ||
        typeLooksLikeJob(node._type) ||
        (node.jobPosting && (node.title || node.entityUrn || node.appliedAt || node.insights)) ||
        (node.title && (node.companyName || node.companyDetails || node.company) && (node.appliedAt || node.listedAt || node.entityUrn));
      if (!likely) return;
      // Skip pure company / image entities
      if (/fsd_company:|fsd_profile:|fsd_image/i.test(String(urn)) && !node.jobPosting) return;

      var app = mapEntityToApplication(node, idx, now);
      if (!app || !app.jobId) return;
      if (!byId[app.jobId]) {
        byId[app.jobId] = app;
        order.push(app.jobId);
      } else {
        // merge non-empty
        var prev = byId[app.jobId];
        var keys = Object.keys(app);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (app[k] != null && app[k] !== '' && (prev[k] == null || prev[k] === '')) prev[k] = app[k];
          if (typeof app[k] === 'boolean' && app[k] === true) prev[k] = true;
        }
        if (root.BasvuruStatus && root.BasvuruStatus.enrichApplication) {
          byId[app.jobId] = root.BasvuruStatus.enrichApplication(prev);
        }
      }
    });

    var rows = order.map(function (id) {
      return byId[id];
    });
    var paging = findPaging(json);
    return { rows: rows, paging: paging, count: rows.length };
  }

  function shouldFallbackToDom(opts) {
    opts = opts || {};
    if (!opts.captured) return { fallback: true, reason: 'no_capture' };
    if (opts.replayError) return { fallback: true, reason: 'replay_error' };
    var chip = opts.chipTotal != null ? Number(opts.chipTotal) : null;
    var n = opts.parsedCount != null ? Number(opts.parsedCount) : 0;
    if (!isFinite(n) || n < 0) n = 0;
    if (chip && chip > 0 && n < chip * 0.5) {
      return { fallback: true, reason: 'low_yield' };
    }
    if ((!chip || chip <= 0) && n < 10) {
      return { fallback: true, reason: 'too_few' };
    }
    return { fallback: false, reason: 'ok' };
  }

  function redactSecrets(str) {
    return String(str || '')
      .replace(/csrf-token["']?\s*[:=]\s*["'][^"']+/gi, 'csrf-token:"[redacted]"')
      .replace(/([?&]csrf-token=)[^&\s"']+/gi, '$1[redacted]')
      .replace(/cookie["']?\s*[:=]\s*["'][^"']+/gi, 'cookie:"[redacted]"')
      .replace(/authorization["']?\s*[:=]\s*["'][^"']+/gi, 'authorization:"[redacted]"')
      .replace(/JSESSIONID=[^;"\s]+/gi, 'JSESSIONID=[redacted]');
  }

  function sanitizeApiSample(json, meta) {
    var clone;
    try {
      clone = JSON.parse(JSON.stringify(json));
    } catch (_) {
      clone = { note: 'unserializable' };
    }
    // Drop large binary-ish / trim included
    if (clone && Array.isArray(clone.included) && clone.included.length > 8) {
      clone.included = clone.included.slice(0, 8);
      clone._includedTruncated = true;
    }
    var text = '';
    try {
      text = JSON.stringify(
        {
          capturedAt: (meta && meta.capturedAt) || new Date().toISOString(),
          url: meta && meta.url ? redactSecrets(String(meta.url).slice(0, 500)) : null,
          method: (meta && meta.method) || null,
          score: meta && meta.score,
          paging: meta && meta.paging,
          sample: clone,
        },
        null,
        2
      );
    } catch (_) {
      text = '{"error":"stringify failed"}';
    }
    text = redactSecrets(text);
    if (text.length > SAMPLE_MAX_CHARS) {
      text = text.slice(0, SAMPLE_MAX_CHARS) + '\n/* truncated */\n';
    }
    return text;
  }

  function urlLooksInteresting(url) {
    var u = String(url || '');
    if (/\/li\/track|\/realtime|\/voyagerVideo|\.(png|jpe?g|gif|webp|css|woff2?)(\?|$)/i.test(u)) {
      return false;
    }
    return (
      /\/voyager\/api\/|\/graphql|\/flagship-web\/|\/sdui\/|\/li\/api\/|rsc-action|jobs-tracker|jobPosting|jobCard/i.test(
        u
      ) || /\/voyager\/api\//i.test(u)
    );
  }

  /** Extract JSON object/array fragments from RSC / streamed text. */
  function extractJsonFragmentsFromText(text) {
    var s = String(text || '');
    var out = [];
    // Lines like: 1a3f:{"..." }  or  just embedded JSON
    var lineRe = /^[0-9a-f]+:(\{[\s\S]*)$/gim;
    var m;
    while ((m = lineRe.exec(s))) {
      var frag = m[1];
      var parsed = tryParseBalancedJson(frag);
      if (parsed) out.push(parsed);
    }
    // Whole-body JSON
    var whole = safeJsonParse(s.trim());
    if (whole) out.push(whole);
    // Bracket scan for large objects containing job markers
    var idx = 0;
    while (idx < s.length && idx < 400000 && out.length < 12) {
      var start = s.indexOf('{', idx);
      if (start < 0) break;
      var window = s.slice(start, start + 8000);
      if (/fsd_jobPosting|jobPostingCard|jobPosting|appliedAt|Ba\u015fvuruldu/i.test(window)) {
        var obj = tryParseBalancedJson(s.slice(start));
        if (obj) out.push(obj);
      }
      idx = start + 1;
    }
    return out;
  }

  function tryParseBalancedJson(s) {
    var str = String(s || '');
    if (!str || str[0] !== '{' && str[0] !== '[') return null;
    var open = str[0];
    var close = open === '{' ? '}' : ']';
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = 0; i < str.length && i < 500000; i++) {
      var ch = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return safeJsonParse(str.slice(0, i + 1));
        }
      }
    }
    return null;
  }

  var REQ_BODY_MAX = 4096;

  /** Redacted + capped request body for reports (never used for replay). */
  function sanitizeRequestBody(body) {
    if (body == null) return null;
    var s = String(body);
    s = redactSecrets(s).replace(/("(?:csrf|token|csrfToken|jsessionid)"\s*:\s*")[^"]*"/gi, '$1[redacted]"');
    return s.length > REQ_BODY_MAX ? s.slice(0, REQ_BODY_MAX) + '\u2026' : s;
  }

  function rscLib() {
    return root.BasvuruTrackerRsc || null;
  }

  /** Text used for matching: raw body plus decoded inline flight pushes (unescaped). */
  function matchHaystack(entry) {
    var raw = String((entry && (entry.body || entry.snippet)) || '');
    var R = rscLib();
    if (R && R.extractInlineFlight && raw.indexOf('push(') !== -1) {
      var inline = R.extractInlineFlight(raw);
      if (inline) return raw + '\n' + inline;
    }
    return raw;
  }

  function countDistinctJobIds(hay, cap) {
    var re = /\/jobs\/view\/(\d{6,})|jobPosting(?:Card)?:(\d{6,})/gi;
    var seen = Object.create(null);
    var n = 0;
    var m;
    while ((m = re.exec(hay)) && n < (cap || 500)) {
      var id = m[1] || m[2];
      if (!seen[id]) {
        seen[id] = true;
        n += 1;
      }
    }
    return n;
  }

  function isExcludedListUrl(url) {
    return /opportunityContacts/i.test(String(url || ''));
  }

  function titleVariants(t) {
    var out = [t];
    try {
      var esc = JSON.stringify(t).slice(1, -1);
      if (esc !== t) out.push(esc);
    } catch (_) {}
    var amp = t.replace(/&/g, '\\u0026');
    if (amp !== t) out.push(amp);
    return out;
  }

  function hayHas(hay, text) {
    var vs = titleVariants(text);
    for (var i = 0; i < vs.length; i++) if (hay.indexOf(vs[i]) !== -1) return true;
    return false;
  }

  /**
   * Strong list evidence: ≥5 DOM job ids AND ≥3 DOM titles in one response,
   * never the per-row opportunityContacts widget.
   */
  function isStrongListMatch(m, fingerprints) {
    if (!m || m.excluded) return false;
    var ids = (fingerprints && fingerprints.jobIds) || [];
    var titles = (fingerprints && fingerprints.titles) || [];
    var needIds = ids.length >= 5 ? 5 : Math.max(3, ids.length);
    var needTitles = titles.length >= 3 ? 3 : Math.max(1, titles.length);
    return m.hitIds >= needIds && m.hitTitles >= needTitles;
  }

  function analyzeEntry(e, fingerprints) {
    var ids = fingerprints.jobIds || [];
    var titles = fingerprints.titles || [];
    var companies = fingerprints.companies || [];
    var hay = matchHaystack(e);
    var hitIds = 0;
    var hitTitles = 0;
    var hitCos = 0;
    var j;
    for (j = 0; j < ids.length; j++) {
      if (ids[j] && hay.indexOf(String(ids[j])) !== -1) hitIds++;
    }
    for (j = 0; j < titles.length; j++) {
      var t = String(titles[j] || '');
      if (t.length >= 4 && hayHas(hay, t)) hitTitles++;
    }
    for (j = 0; j < companies.length; j++) {
      var c = String(companies[j] || '');
      if (c.length >= 3 && hayHas(hay, c)) hitCos++;
    }
    var distinctJobIds = countDistinctJobIds(hay, 500);
    var excluded = isExcludedListUrl(e.url);
    var trackerMarker =
      /opportunity_?tracker/i.test(hay.slice(0, 400000)) || /jobs-tracker|opportunityTracker|opportunity_tracker/i.test(String(e.url || ''));
    var score = hitIds * 10 + hitTitles * 3 + hitCos * 2 + Math.min(distinctJobIds, 50);
    if (trackerMarker) score += 15;
    if (excluded) score -= 1000;
    return {
      id: e.id,
      at: e.at,
      url: e.url,
      method: e.method,
      status: e.status,
      contentType: e.contentType,
      size: e.size,
      source: e.source,
      score: score,
      hitIds: hitIds,
      hitTitles: hitTitles,
      hitCompanies: hitCos,
      distinctJobIds: distinctJobIds,
      trackerMarker: trackerMarker,
      excluded: excluded,
      snippet: e.snippet,
      entry: e,
    };
  }

  /**
   * Match ring-buffer entries against DOM fingerprints (jobIds / titles / companies).
   * `best` is only set for a strong list match (see isStrongListMatch).
   * @param {{sinceAt?:number, window?:string}} [opts]
   * @returns {{best:object|null, matches:Array}}
   */
  function matchRingToFingerprints(ring, fingerprints, opts) {
    fingerprints = fingerprints || {};
    opts = opts || {};
    var matches = [];
    var list = ring || [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !(e.body || e.snippet)) continue;
      if (opts.sinceAt != null && (e.at || 0) < opts.sinceAt) continue;
      var m = analyzeEntry(e, fingerprints);
      m.window = opts.window || 'initial';
      m.strong = isStrongListMatch(m, fingerprints);
      if (m.score > 0 || m.hitIds > 0) matches.push(m);
    }
    matches.sort(function (a, b) {
      if (a.strong !== b.strong) return a.strong ? -1 : 1;
      return b.score - a.score;
    });
    var best = matches.length && matches[0].strong ? matches[0] : null;
    return { best: best, matches: matches };
  }

  function candidateSummary(m) {
    var e = m.entry || {};
    return {
      url: redactSecrets(String(m.url || '').slice(0, 500)),
      method: m.method,
      status: m.status,
      contentType: m.contentType,
      size: m.size,
      source: m.source,
      window: m.window || 'initial',
      score: m.score,
      strong: !!m.strong,
      hitIds: m.hitIds,
      hitTitles: m.hitTitles,
      hitCompanies: m.hitCompanies,
      distinctJobIds: m.distinctJobIds,
      excluded: !!m.excluded,
      requestHeaderNames: e.headerNames || (e.headers ? Object.keys(e.headers) : []),
      requestBody: sanitizeRequestBody(typeof e.requestBodySnippet === 'string' ? e.requestBodySnippet : null),
      snippet: m.snippet ? String(m.snippet).slice(0, 600) : null,
    };
  }

  /**
   * Internal discovery report persisted as btApiSample.
   * @param {{ring, match, fingerprints, hookInstalled, nextClick?, plan?, replay?, notes?, extraMatches?}} opts
   */
  function buildDiscoveryReport(opts) {
    opts = opts || {};
    var ring = opts.ring || [];
    var match = opts.match || { best: null, matches: [] };
    var fingerprints = opts.fingerprints || {};
    var all = (match.matches || []).concat(opts.extraMatches || []);
    var seen = Object.create(null);
    var top = [];
    all
      .slice()
      .sort(function (a, b) {
        if (!!a.strong !== !!b.strong) return a.strong ? -1 : 1;
        return b.score - a.score;
      })
      .forEach(function (m) {
        var k = (m.id || m.url) + '|' + (m.window || '');
        if (seen[k] || top.length >= 5) return;
        seen[k] = true;
        top.push(candidateSummary(m));
      });
    var best = match.best || null;
    var report = {
      capturedAt: new Date().toISOString(),
      hookInstalled: opts.hookInstalled !== false,
      fingerprintCounts: {
        jobIds: (fingerprints.jobIds || []).length,
        titles: (fingerprints.titles || []).length,
        companies: (fingerprints.companies || []).length,
      },
      fingerprints: {
        jobIds: (fingerprints.jobIds || []).slice(0, 12),
        titles: (fingerprints.titles || []).slice(0, 8),
        companies: (fingerprints.companies || []).slice(0, 8),
      },
      nextClick: opts.nextClick || { used: false },
      bestMatch: best ? candidateSummary(best) : null,
      topCandidates: top,
      plan: opts.plan || null,
      replay: opts.replay || null,
      notes: opts.notes || [],
      ring: ring.slice(-60).map(function (e) {
        return {
          url: redactSecrets(String(e.url || '').slice(0, 300)),
          method: e.method,
          status: e.status,
          size: e.size,
          source: e.source,
          contentType: e.contentType,
        };
      }),
      note: best
        ? 'Strong list match (\u22655 ids, \u22653 titles).'
        : 'No strong list match. Send this report for parser updates.',
    };
    var text = '';
    try {
      text = JSON.stringify(report, null, 2);
    } catch (_) {
      text = '{"error":"report stringify failed"}';
    }
    text = redactSecrets(text);
    return text.length > SAMPLE_MAX_CHARS ? text.slice(0, SAMPLE_MAX_CHARS) + '\n/* truncated */\n' : text;
  }

  // ---------- pagination plan (URL query / JSON body / form / loose RSC args) ----------

  var KEY_ROLES = [
    [/^(start|offset|startIndex|startOffset|from|skip)$/i, 'offset'],
    [/^(page|pageNumber|pageNum|pageIndex|currentPage|pageNo)$/i, 'page'],
    [/^(count|pageSize|limit|size|numResults|perPage|resultsPerPage)$/i, 'size'],
    [/^(paginationToken|cursor|nextCursor|pageToken|nextPageToken)$/i, 'cursor'],
  ];

  function roleOfKey(k) {
    for (var i = 0; i < KEY_ROLES.length; i++) if (KEY_ROLES[i][0].test(String(k))) return KEY_ROLES[i][1];
    return null;
  }

  function numericValue(v) {
    if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) return v;
    if (typeof v === 'string' && /^\d{1,6}$/.test(v)) return Number(v);
    return null;
  }

  function collectJsonFields(node, path, out, depth) {
    if (depth > 30 || node == null) return;
    if (typeof node === 'string') {
      var t = node.trim();
      if ((t[0] === '{' || t[0] === '[') && t.length < 200000) {
        var inner = safeJsonParse(t);
        if (inner && typeof inner === 'object') collectJsonFields(inner, path.concat(['#json']), out, depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;
    var keys = Array.isArray(node) ? node.map(function (_, i) { return i; }) : Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = node[k];
      var role = typeof k === 'string' ? roleOfKey(k) : null;
      if (role) {
        var num = numericValue(v);
        if (num != null || (role === 'cursor' && typeof v === 'string')) {
          out.push({
            loc: 'json',
            path: path.concat([k]),
            container: path.join('/'),
            key: k,
            role: role,
            value: num != null ? num : v,
            asString: typeof v === 'string',
          });
          continue;
        }
      }
      if (v && (typeof v === 'object' || typeof v === 'string')) collectJsonFields(v, path.concat([k]), out, depth + 1);
    }
  }

  function rawFieldsOfTemplate(template) {
    var out = [];
    var url = String((template && template.url) || '');
    try {
      var u = new URL(url, 'https://www.linkedin.com');
      u.searchParams.forEach(function (v, k) {
        var role = roleOfKey(k);
        if (role && (numericValue(v) != null || role === 'cursor')) {
          out.push({ loc: 'query', key: k, container: 'query', role: role, value: numericValue(v) != null ? numericValue(v) : v });
        }
      });
    } catch (_) {}
    var looseRe = /[(,]([A-Za-z]+):(\d{1,6})(?=[,)])/g;
    var m;
    var decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch (_) {}
    while ((m = looseRe.exec(decoded))) {
      var r = roleOfKey(m[1]);
      if (r && r !== 'cursor') out.push({ loc: 'urlLoose', key: m[1], container: 'urlLoose', role: r, value: Number(m[2]) });
    }
    var body = template && template.body;
    if (body != null && body !== '') {
      var s = String(body);
      var parsed = safeJsonParse(s);
      if (parsed && typeof parsed === 'object') {
        collectJsonFields(parsed, [], out, 0);
      } else if (/^[\w.%\[\]-]+=[^&]*(&[\w.%\[\]-]+=[^&]*)*$/.test(s.trim())) {
        try {
          new URLSearchParams(s).forEach(function (v, k) {
            var role = roleOfKey(k);
            if (role && numericValue(v) != null) {
              out.push({ loc: 'form', key: k, container: 'form', role: role, value: numericValue(v) });
            }
          });
        } catch (_) {}
      } else {
        var bodyRe = /"([A-Za-z]+)"\s*:\s*(\d{1,6})(?!\d)/g;
        while ((m = bodyRe.exec(s))) {
          var br = roleOfKey(m[1]);
          if (br && br !== 'cursor') out.push({ loc: 'bodyLoose', key: m[1], container: 'bodyLoose', role: br, value: Number(m[2]) });
        }
      }
    }
    return out;
  }

  /**
   * Detect which URL/body fields carry pagination for a captured list request.
   * @param {{url:string, body?:string}} template
   * @param {{pageIndex?:number, pageSize?:number}} [known] 0-based page the template fetched
   * @returns {{fields:Array, pageSize:number, hasSize:boolean, supported:boolean, cursorOnly:boolean}}
   */
  function detectPaginationPlan(template, known) {
    known = known || {};
    var k = known.pageIndex != null ? Number(known.pageIndex) : null;
    var raw = rawFieldsOfTemplate(template);
    var navContainers = Object.create(null);
    var fields = [];
    var sizeValue = null;
    var i;
    for (i = 0; i < raw.length; i++) {
      var f = raw[i];
      if (f.role === 'page') {
        if (k != null && f.value !== k && f.value !== k + 1) continue;
        f.role = k != null ? (f.value === k + 1 ? 'page1' : 'page0') : f.value >= 1 ? 'page1' : 'page0';
        fields.push(f);
        navContainers[f.loc + ':' + f.container] = true;
      }
    }
    for (i = 0; i < raw.length; i++) {
      var g = raw[i];
      if (g.role === 'size' && g.value >= 1 && g.value <= 500) {
        if (sizeValue == null) sizeValue = g.value;
      }
    }
    var ps = known.pageSize || sizeValue || 10;
    for (i = 0; i < raw.length; i++) {
      var o = raw[i];
      if (o.role !== 'offset') continue;
      if (k != null && o.value !== k * ps) continue;
      fields.push(o);
      navContainers[o.loc + ':' + o.container] = true;
    }
    var hasSize = false;
    for (i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (s.role !== 'size' || s.value < 1 || s.value > 500) continue;
      var loose = s.loc === 'query' || s.loc === 'form' || s.loc === 'urlLoose';
      if (loose || navContainers[s.loc + ':' + s.container]) {
        fields.push(s);
        hasSize = true;
      }
    }
    var hasNav = fields.some(function (x) {
      return x.role === 'offset' || x.role === 'page0' || x.role === 'page1';
    });
    var cursor = raw.some(function (x) {
      return x.role === 'cursor';
    });
    return {
      fields: fields,
      pageSize: hasSize && sizeValue ? sizeValue : ps,
      hasSize: hasSize,
      supported: hasNav,
      cursorOnly: !hasNav && cursor,
    };
  }

  function fieldValue(role, pageIndex, pageSize) {
    if (role === 'offset') return pageIndex * pageSize;
    if (role === 'page1') return pageIndex + 1;
    if (role === 'page0') return pageIndex;
    if (role === 'size') return pageSize;
    return null;
  }

  function setAtPath(node, path, value, asString) {
    if (!path.length) return node;
    var head = path[0];
    if (head === '#json') {
      var inner = safeJsonParse(node);
      if (inner == null) return node;
      return JSON.stringify(setAtPath(inner, path.slice(1), value, asString));
    }
    if (node == null || typeof node !== 'object') return node;
    if (path.length === 1) {
      node[head] = asString ? String(value) : value;
      return node;
    }
    node[head] = setAtPath(node[head], path.slice(1), value, asString);
    return node;
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Rewrite a template for 0-based `pageIndex` with `pageSize` rows.
   * @returns {{url:string, body:*}}
   */
  function applyPaginationPlan(template, plan, pageIndex, pageSize) {
    var url = String(template.url || '');
    var body = template.body;
    var fields = (plan && plan.fields) || [];
    var size = pageSize || (plan && plan.pageSize) || 10;
    var u = null;
    try {
      u = new URL(url, 'https://www.linkedin.com');
    } catch (_) {}
    var jsonBody = null;
    var formBody = null;
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = fieldValue(f.role, pageIndex, size);
      if (v == null) continue;
      if (f.loc === 'query' && u) u.searchParams.set(f.key, String(v));
      else if (f.loc === 'urlLoose') {
        url = url.replace(new RegExp('([(,]|%28|%2C)(' + escapeRe(f.key) + ')(:|%3A)\\d+', 'g'), '$1$2$3' + v);
        if (u) {
          try {
            u = new URL(url, 'https://www.linkedin.com');
          } catch (_) {}
        }
      } else if (f.loc === 'json') {
        if (jsonBody == null) jsonBody = safeJsonParse(String(body));
        if (jsonBody != null) jsonBody = setAtPath(jsonBody, f.path, v, f.asString);
      } else if (f.loc === 'form') {
        if (formBody == null) formBody = new URLSearchParams(String(body));
        formBody.set(f.key, String(v));
      } else if (f.loc === 'bodyLoose') {
        body = String(body).replace(new RegExp('("' + escapeRe(f.key) + '"\\s*:\\s*)\\d+', 'g'), '$1' + v);
      }
    }
    if (u && fields.some(function (x) { return x.loc === 'query'; })) {
      var hadAbs = /^https?:/i.test(url);
      url = hadAbs ? u.toString() : u.pathname + u.search + u.hash;
    }
    if (jsonBody != null) body = JSON.stringify(jsonBody);
    if (formBody != null) body = formBody.toString();
    return { url: url, body: body };
  }

  function planSummary(plan) {
    if (!plan) return null;
    return {
      supported: plan.supported,
      cursorOnly: plan.cursorOnly,
      hasSize: plan.hasSize,
      pageSize: plan.pageSize,
      fields: plan.fields.map(function (f) {
        return { loc: f.loc, key: f.key, role: f.role, value: f.value, path: f.path ? f.path.join('.') : undefined };
      }),
    };
  }

  /**
   * Parse any response text (JSON or RSC) into applications.
   */
  function parseTrackerResponseText(text, opts) {
    var R = rscLib();
    var flight = R && R.extractJobsFromFlight ? R.extractJobsFromFlight(text) : null;
    if (flight && flight.isFlight) {
      var byId = Object.create(null);
      var rowsF = flight.rows.slice();
      for (var q = 0; q < rowsF.length; q++) byId[rowsF[q].jobId] = rowsF[q];
      var pagingF = null;
      for (var ri = 0; ri < flight.roots.length; ri++) {
        var extra = parseTrackerApiResponse(flight.roots[ri], opts);
        if (!pagingF && extra.paging && extra.paging.total != null) pagingF = extra.paging;
        if (rowsF.length) continue;
        for (var ei = 0; ei < extra.rows.length; ei++) {
          var er = extra.rows[ei];
          if (er && er.jobId && !byId[er.jobId]) {
            byId[er.jobId] = er;
            rowsF.push(er);
          }
        }
      }
      return { rows: rowsF, paging: pagingF, count: rowsF.length, format: 'rsc' };
    }
    var fragments = extractJsonFragmentsFromText(text);
    if (!fragments.length) {
      var one = safeJsonParse(text);
      if (one) fragments = [one];
    }
    var allRows = [];
    var seen = Object.create(null);
    var paging = null;
    for (var i = 0; i < fragments.length; i++) {
      var parsed = parseTrackerApiResponse(fragments[i], opts);
      if (parsed.paging && parsed.paging.total != null) paging = parsed.paging;
      for (var r = 0; r < parsed.rows.length; r++) {
        var row = parsed.rows[r];
        if (!row || !row.jobId || seen[row.jobId]) continue;
        seen[row.jobId] = true;
        allRows.push(row);
      }
    }
    return { rows: allRows, paging: paging, count: allRows.length };
  }

  function pickReplayHeaders(templateHeaders, csrf) {
    var src = templateHeaders || {};
    var out = {
      accept: src.accept || 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': src['x-restli-protocol-version'] || '2.0.0',
      'x-li-lang': src['x-li-lang'] || 'tr_TR',
    };
    if (csrf) out['csrf-token'] = csrf;
    else if (src['csrf-token']) out['csrf-token'] = src['csrf-token'];
    if (src['content-type']) out['content-type'] = src['content-type'];
    if (src['x-li-pem-metadata']) out['x-li-pem-metadata'] = src['x-li-pem-metadata'];
    return out;
  }

  function formatModeStatus(mode, collected, totalExpected) {
    var prefix = mode === 'api' ? 'H\u0131zl\u0131 tarama' : 'Sayfa modu';
    var count =
      totalExpected != null && isFinite(totalExpected) && totalExpected > 0
        ? collected + ' / ' + Math.floor(totalExpected)
        : String(collected != null ? collected : 0);
    return prefix + ' \u00b7 ' + count;
  }

  var api = {
    MSG_SOURCE: MSG_SOURCE,
    STORAGE_SAMPLE: STORAGE_SAMPLE,
    rewritePagination: rewritePagination,
    rewriteUrlPagination: rewriteUrlPagination,
    rewriteBodyPagination: rewriteBodyPagination,
    scoreTrackerResponse: scoreTrackerResponse,
    looksLikeTrackerListResponse: looksLikeTrackerListResponse,
    findPaging: findPaging,
    parseTrackerApiResponse: parseTrackerApiResponse,
    parseTrackerResponseText: parseTrackerResponseText,
    extractJsonFragmentsFromText: extractJsonFragmentsFromText,
    matchRingToFingerprints: matchRingToFingerprints,
    isStrongListMatch: isStrongListMatch,
    buildDiscoveryReport: buildDiscoveryReport,
    detectPaginationPlan: detectPaginationPlan,
    applyPaginationPlan: applyPaginationPlan,
    planSummary: planSummary,
    sanitizeRequestBody: sanitizeRequestBody,
    redactSecrets: redactSecrets,
    shouldFallbackToDom: shouldFallbackToDom,
    sanitizeApiSample: sanitizeApiSample,
    urlLooksInteresting: urlLooksInteresting,
    pickReplayHeaders: pickReplayHeaders,
    formatModeStatus: formatModeStatus,
    jobIdFromAny: jobIdFromAny,
  };

  root.BasvuruTrackerApi = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
