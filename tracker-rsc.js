/**
 * React Server Components (flight) parser for LinkedIn flagship-web responses (no DOM).
 * Splits `<hexId>:<payload>` rows, resolves `$L`/`$@`/`$<id>` references and extracts
 * per-job tracker rows in the same record shape scrape.js page mode produces.
 */
(function (root) {
  'use strict';

  var CLOSED_PHRASE = 'Art\u0131k ba\u015fvuru kabul etmiyor';
  var COMPANY_SEP_RE = /\s*[\u00b7\u2022]\s*/;
  var MAX_DEPTH = 400;

  var TEXT_PROP_KEYS = {
    text: 1,
    content: 1,
    accessibilityText: 1,
    a11yText: 1,
    primaryText: 1,
    secondaryText: 1,
    tertiaryText: 1,
    subtitle: 1,
    headline: 1,
    caption: 1,
  };
  var SKIP_KEYS = {
    className: 1,
    style: 1,
    href: 1,
    src: 1,
    srcSet: 1,
    srcset: 1,
    id: 1,
    key: 1,
    type: 1,
    variant: 1,
    size: 1,
    color: 1,
    icon: 1,
    testId: 1,
    'data-testid': 1,
    trackingId: 1,
    controlName: 1,
    tracking: 1,
    trackingData: 1,
  };

  function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  function utf8Len(code) {
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    return 3;
  }

  /** Advance `from` by `bytes` UTF-8 bytes; returns end index in the JS string. */
  function advanceUtf8(s, from, bytes) {
    var i = from;
    var left = bytes;
    while (i < s.length && left > 0) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        left -= 4;
        i += 2;
      } else {
        left -= utf8Len(c);
        i += 1;
      }
    }
    return i;
  }

  function looksLikeFlight(text) {
    var s = String(text || '');
    return /(^|\n)[0-9a-f]{1,8}:(?:I\[|HL\[|T[0-9a-f]+,|\[|\{|")/.test(s.slice(0, 4000));
  }

  /** Concatenate `self.__next_f.push([1,"..."])`-style inline chunks into flight text. */
  function extractInlineFlight(text) {
    var s = String(text || '');
    if (s.indexOf('push(') === -1) return '';
    var re = /\.push\(\s*\[\s*1\s*,\s*("(?:[^"\\]|\\[\s\S])*")\s*\]\s*\)/g;
    var out = [];
    var m;
    while ((m = re.exec(s))) {
      try {
        out.push(JSON.parse(m[1]));
      } catch (_) {}
    }
    return out.join('');
  }

  /** Flight text for any captured body: raw flight, inline pushes, or ''. */
  function toFlightText(text) {
    var s = String(text || '');
    if (looksLikeFlight(s)) return s;
    var inline = extractInlineFlight(s);
    if (inline && looksLikeFlight(inline)) return inline;
    return '';
  }

  /**
   * @returns {{rows:Object<string,{tag:string,value:*}>, order:string[]}}
   */
  function parseFlightRows(text) {
    var s = String(text || '');
    var rows = Object.create(null);
    var order = [];
    var pos = 0;
    var headRe = /([0-9a-f]{1,8}):/y;
    while (pos < s.length) {
      if (s.charCodeAt(pos) === 10) {
        pos += 1;
        continue;
      }
      headRe.lastIndex = pos;
      var hm = headRe.exec(s);
      if (!hm) {
        var nl = s.indexOf('\n', pos);
        pos = nl < 0 ? s.length : nl + 1;
        continue;
      }
      var id = hm[1];
      var p = pos + hm[0].length;
      var tm = /^T([0-9a-f]+),/.exec(s.slice(p, p + 16));
      if (tm) {
        var startText = p + tm[0].length;
        var endText = advanceUtf8(s, startText, parseInt(tm[1], 16));
        rows[id] = { tag: 'T', value: s.slice(startText, endText) };
        order.push(id);
        pos = endText;
        continue;
      }
      var end = s.indexOf('\n', p);
      if (end < 0) end = s.length;
      var payload = s.slice(p, end);
      pos = end + 1;
      var tag = '';
      var tagM = /^([A-Z]{1,2})(?=[\[{"])/.exec(payload);
      if (tagM) {
        tag = tagM[1];
        payload = payload.slice(tag.length);
      }
      var value;
      try {
        value = JSON.parse(payload);
      } catch (_) {
        continue;
      }
      rows[id] = { tag: tag, value: value };
      order.push(id);
    }
    return { rows: rows, order: order };
  }

  var REF_RE = /^\$(?:L|@)?([0-9a-f]+)((?::[^:]+)*)$/;

  function refIdOf(str) {
    if (typeof str !== 'string' || str.charCodeAt(0) !== 36) return null;
    var m = REF_RE.exec(str);
    return m ? m[1] : null;
  }

  function collectRefs(v, out, depth) {
    if (depth > MAX_DEPTH || v == null) return;
    if (typeof v === 'string') {
      var id = refIdOf(v);
      if (id) out[id] = true;
      return;
    }
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) collectRefs(v[i], out, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      for (var k in v) collectRefs(v[k], out, depth + 1);
    }
  }

  function makeResolver(parsed) {
    var memo = Object.create(null);
    var busy = Object.create(null);

    function resolveRow(id) {
      if (memo[id] !== undefined) return memo[id];
      var row = parsed.rows[id];
      if (!row) return null;
      if (row.tag === 'I') return (memo[id] = { $$import: row.value });
      if (row.tag && row.tag !== 'T') return (memo[id] = null);
      if (busy[id]) return null;
      busy[id] = true;
      var out = resolve(row.value, 0);
      busy[id] = false;
      memo[id] = out;
      return out;
    }

    function resolve(v, depth) {
      if (v == null || depth > MAX_DEPTH) return v == null ? v : null;
      if (typeof v === 'string') {
        if (v.charCodeAt(0) !== 36) return v;
        if (v.charCodeAt(1) === 36) return v.slice(1);
        var m = REF_RE.exec(v);
        if (m) {
          var target = resolveRow(m[1]);
          if (m[2]) {
            var segs = m[2].split(':').slice(1);
            for (var i = 0; i < segs.length && target != null; i++) target = target[segs[i]];
          }
          return target === undefined ? null : target;
        }
        return null;
      }
      if (Array.isArray(v)) {
        var arr = new Array(v.length);
        for (var j = 0; j < v.length; j++) arr[j] = resolve(v[j], depth + 1);
        return arr;
      }
      if (typeof v === 'object') {
        var obj = {};
        for (var k in v) obj[k] = resolve(v[k], depth + 1);
        return obj;
      }
      return v;
    }

    return { resolveRow: resolveRow };
  }

  /** Resolved trees for rows that no other row references (usually just "0"). */
  function flightRoots(parsed) {
    var referenced = Object.create(null);
    for (var i = 0; i < parsed.order.length; i++) {
      var r = parsed.rows[parsed.order[i]];
      if (r && !r.tag) collectRefs(r.value, referenced, 0);
    }
    var resolver = makeResolver(parsed);
    var roots = [];
    for (var j = 0; j < parsed.order.length; j++) {
      var id = parsed.order[j];
      var row = parsed.rows[id];
      if (!row || row.tag || referenced[id]) continue;
      var v = resolver.resolveRow(id);
      if (v != null && typeof v === 'object') roots.push(v);
    }
    return roots;
  }

  function parseFlight(text) {
    var parsed = parseFlightRows(text);
    return { parsed: parsed, roots: flightRoots(parsed) };
  }

  // ---------- job-row extraction ----------

  function jobIdsInString(s, out) {
    if (s.length < 8) return;
    var re = /\/jobs\/view\/(\d{6,})|jobPosting(?:Card)?:(\d{6,})|currentJobId=(\d{6,})/gi;
    var m;
    while ((m = re.exec(s))) {
      var id = m[1] || m[2] || m[3];
      if (id && out.indexOf(id) < 0) out.push(id);
      if (out.length > 1) return;
    }
  }

  function addIds(target, src) {
    for (var i = 0; i < src.length && target.length < 2; i++) {
      if (target.indexOf(src[i]) < 0) target.push(src[i]);
    }
  }

  /** Distinct job ids (capped at 2 = "multi") for every object node, memoized. */
  function makeIdIndex() {
    var memo = new WeakMap();
    function idsOf(node, depth) {
      if (node == null || depth > MAX_DEPTH) return [];
      if (typeof node === 'string') {
        var o = [];
        jobIdsInString(node, o);
        return o;
      }
      if (typeof node !== 'object') return [];
      var hit = memo.get(node);
      if (hit) return hit;
      var out = [];
      memo.set(node, out);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && out.length < 2; i++) addIds(out, idsOf(node[i], depth + 1));
      } else {
        for (var k in node) {
          if (out.length > 1) break;
          var v = node[k];
          if ((k === 'jobId' || k === 'jobPostingId') && (typeof v === 'string' || typeof v === 'number')) {
            var sv = String(v);
            if (/^\d{6,}$/.test(sv) && out.indexOf(sv) < 0) out.push(sv);
            continue;
          }
          addIds(out, idsOf(v, depth + 1));
        }
      }
      return out;
    }
    return idsOf;
  }

  function childrenOf(node) {
    if (Array.isArray(node)) {
      if (node[0] === '$' && node.length >= 4 && isPlainObject(node[3])) return [node[3]];
      return node;
    }
    if (isPlainObject(node)) {
      var out = [];
      for (var k in node) {
        if (SKIP_KEYS[k] && typeof node[k] !== 'object') continue;
        out.push(node[k]);
      }
      return out;
    }
    return [];
  }

  /** Nodes that hold exactly one job id while their parent holds several. */
  function findJobRowNodes(roots) {
    var idsOf = makeIdIndex();
    var found = [];
    var seen = new Set();
    function visit(node, depth) {
      if (node == null || typeof node !== 'object' || depth > MAX_DEPTH) return;
      if (seen.has(node)) return;
      seen.add(node);
      var kids = childrenOf(node);
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid == null || typeof kid !== 'object') continue;
        var ids = idsOf(kid, 0);
        if (ids.length === 1) found.push({ jobId: ids[0], node: kid });
        else if (ids.length > 1) visit(kid, depth + 1);
      }
    }
    for (var r = 0; r < roots.length; r++) {
      var ids = idsOf(roots[r], 0);
      if (ids.length === 1) found.push({ jobId: ids[0], node: roots[r] });
      else if (ids.length > 1) visit(roots[r], 0);
    }
    return found;
  }

  /** "/company/ictworks/life/" -> "ictworks" (lowercase), or null. */
  function companySlugOf(href) {
    var m = String(href || '').match(/\/(?:company|showcase)\/([^/?#]+)/i);
    if (!m) return null;
    var s = m[1];
    try {
      s = decodeURIComponent(s);
    } catch (_) {}
    s = s.toLowerCase();
    return s.length >= 2 && s.length <= 120 ? s : null;
  }

  function cleanText(s) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  function logoFromValue(v) {
    if (typeof v === 'string') return /company-logo/i.test(v) && !/^data:/.test(v) ? v : null;
    if (isPlainObject(v) && typeof v.rootUrl === 'string' && Array.isArray(v.artifacts) && v.artifacts.length) {
      var best = v.artifacts[v.artifacts.length - 1] || v.artifacts[0];
      var seg = best && best.fileIdentifyingUrlPathSegment;
      if (seg) {
        var u = String(v.rootUrl) + seg;
        return /company-logo/i.test(u) ? u : null;
      }
    }
    return null;
  }

  /**
   * Leaf texts (direct string children joined, like a DOM leaf's innerText),
   * company-logo url + alt, and pressed Evet/Hayır state from one row subtree.
   */
  function collectRowContent(rowNode) {
    var texts = [];
    var logoUrl = null;
    var logoAlt = null;
    var ariaCompany = null;
    var companyUrl = null;
    var pressed = null;
    var seen = new Set();

    function pushText(t) {
      var c = cleanText(t);
      if (c && c.length < 220 && texts.indexOf(c) < 0) texts.push(c);
    }

    function directText(children) {
      if (typeof children === 'string' || typeof children === 'number') return String(children);
      if (!Array.isArray(children) || children[0] === '$') return '';
      var parts = [];
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (typeof c === 'string' || typeof c === 'number') parts.push(String(c));
      }
      return parts.join('');
    }

    function visitProps(props, depth) {
      if (seen.has(props)) return;
      seen.add(props);
      var own = directText(props.children);
      if (own) pushText(own);
      for (var k in TEXT_PROP_KEYS) {
        if (typeof props[k] === 'string' && props[k].charCodeAt(0) !== 36) pushText(props[k]);
      }
      if (!logoUrl) {
        var cand = logoFromValue(props.src) || logoFromValue(props.url) || logoFromValue(props.image) ||
          logoFromValue(props.logo) || logoFromValue(props.vectorImage);
        if (cand) {
          logoUrl = cand;
          if (typeof props.alt === 'string' && props.alt.trim()) logoAlt = cleanText(props.alt);
        }
      }
      if (!companyUrl && typeof props.href === 'string' && /\/(?:company|showcase)\/[^/?#]+/.test(props.href)) {
        companyUrl = props.href;
      }
      if (!ariaCompany && typeof props.href === 'string' && /\/company\//.test(props.href)) {
        var al = props['aria-label'] || props.ariaLabel || props.accessibilityText;
        if (typeof al === 'string' && al.trim()) ariaCompany = cleanText(al).replace(/\s+logo$/i, '');
      }
      var ap = props['aria-pressed'];
      if ((ap === true || ap === 'true') && own) {
        var low = own.trim().toLowerCase();
        if (low === 'evet' || low === 'yes') pressed = 'yes';
        if (low === 'hay\u0131r' || low === 'no') pressed = 'no';
      }
      for (var key in props) {
        if (SKIP_KEYS[key]) continue;
        visit(props[key], depth + 1);
      }
    }

    function visit(node, depth) {
      if (node == null || typeof node !== 'object' || depth > MAX_DEPTH) return;
      if (Array.isArray(node)) {
        if (node[0] === '$' && node.length >= 4) {
          if (isPlainObject(node[3])) visitProps(node[3], depth);
          return;
        }
        for (var i = 0; i < node.length; i++) visit(node[i], depth + 1);
        return;
      }
      if (node.$$import) return;
      visitProps(node, depth);
    }

    if (typeof rowNode === 'string') pushText(rowNode);
    else visit(rowNode, 0);
    return {
      texts: texts,
      logoUrl: logoUrl,
      logoAlt: logoAlt,
      ariaCompany: ariaCompany,
      companySlug: companySlugOf(companyUrl),
      response: pressed,
    };
  }

  function isMetaLeaf(t) {
    if (!t) return true;
    return (
      /\u00f6nce\s+ba\u015fvurdu/i.test(t) ||
      /yay\u0131nla(?:d\u0131|nd\u0131)/i.test(t) ||
      /payla\u015ft\u0131/i.test(t) ||
      /\u00f6zge\u00e7mi\u015f|cv[\u2019']?y[i\u0131]\s+g[o\u00f6]ster|cv\s+indirildi|resume\s+downloaded/i.test(t) ||
      /ba\u015fvuru(?:nuz)?\s+g\u00f6r\u00fcnt\u00fclendi/i.test(t) ||
      /g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(t) ||
      t.indexOf(CLOSED_PHRASE) !== -1 ||
      /no longer (accepting|taking) applications/i.test(t) ||
      /^(Evet|Hay\u0131r|Yes|No)$/i.test(t) ||
      /a\u011f\u0131n\u0131zda|ba\u011flant\u0131|connection/i.test(t) ||
      /^\+?\d+$/.test(t)
    );
  }

  var STATUS_LEAF_RE =
    /(?:cv|\u00f6zge\u00e7mi\u015f|resume|g\u00f6r\u00fcnt\u00fcle|indirildi|downloaded|g\u00f6ster|ba\u015fvuru\s+g\u00f6nderildi|application\s+(?:sent|viewed)|viewed)/i;

  function parseWorkTypeAndLocation(raw) {
    if (!raw) return { location: null, workType: null };
    var s = cleanText(raw);
    var workType = null;
    var wt = s.match(/\(([^)]*(?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site)[^)]*)\)/i);
    if (wt) {
      workType = wt[1].trim();
      s = s.replace(wt[0], '').trim();
    }
    return { location: s || null, workType: workType };
  }

  function stripTitlePrefixFromCompany(jobTitle, company) {
    if (!company) return null;
    var c = cleanText(company);
    var t = cleanText(jobTitle || '');
    if (!t || isMetaLeaf(t)) return c;
    if (c === t) return null;
    if (c.indexOf(t + ' ') === 0) return c.slice(t.length + 1).trim() || null;
    if (c.indexOf(t) === 0 && c.length > t.length) return c.slice(t.length).trim() || null;
    return c;
  }

  /** Same heuristics as scrape.js parseDomCard, applied to RSC leaf texts. */
  function rowFromContent(jobId, content) {
    var Parse = root.BasvuruTrackerParse;
    var texts = content.texts || [];
    var blob = texts.join(' ').replace(/\s+/g, ' ').trim();
    var statusLeaves = texts.filter(function (t) {
      return t.length >= 2 && t.length <= 180 && STATUS_LEAF_RE.test(t);
    });
    var rawStatus = statusLeaves.length ? statusLeaves.join(' \u00b7 ') : blob.slice(0, 500) || null;
    var statusHay = [rawStatus, blob].filter(Boolean).join(' \u00b7 ');
    var signals = Parse && Parse.parseTrackerRowText ? Parse.parseTrackerRowText(statusHay) : null;

    var hasSep = function (t) {
      return COMPANY_SEP_RE.test(t);
    };
    var jobTitle =
      texts.find(function (t) {
        return !hasSep(t) && !isMetaLeaf(t) && t.length > 2;
      }) || null;
    var sepLines = texts.filter(function (t) {
      return hasSep(t) && !isMetaLeaf(t);
    });
    var companyLine =
      (jobTitle &&
        sepLines.find(function (t) {
          return t.indexOf(jobTitle) !== 0;
        })) ||
      sepLines.slice().sort(function (x, y) {
        return x.length - y.length;
      })[0] ||
      null;

    var company = null;
    var locationRaw = null;
    if (companyLine) {
      var parts = companyLine.split(COMPANY_SEP_RE);
      company = (parts[0] || '').trim() || null;
      locationRaw = (parts.slice(1).join(' \u00b7 ') || '').trim() || null;
    } else {
      var titleIdx = jobTitle ? texts.indexOf(jobTitle) : -1;
      var after = texts.slice(titleIdx + 1).filter(function (t) {
        return !isMetaLeaf(t);
      });
      for (var i = 0; i < after.length; i++) {
        var t = after[i];
        if (Parse && Parse.isLocationLike && Parse.isLocationLike(t)) {
          if (!locationRaw) locationRaw = t;
        } else if (!company) {
          company = t;
        }
      }
    }

    var appliedM = blob.match(/(\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce(?:\s+ba\u015fvurdu)?)/i);
    var appliedAt = signals && signals.appliedAt ? signals.appliedAt : appliedM ? cleanText(appliedM[1]) : null;
    var publishedAt = signals ? signals.publishedAt : null;
    var postingStatus = signals ? signals.postingStatus : null;
    var closed = signals ? signals.closed : blob.indexOf(CLOSED_PHRASE) !== -1;
    if (!postingStatus) {
      if (closed) postingStatus = CLOSED_PHRASE;
      else if (publishedAt) postingStatus = publishedAt;
    }

    company = stripTitlePrefixFromCompany(jobTitle, company);
    var loc = parseWorkTypeAndLocation(locationRaw);
    var location = loc.location;
    var workType = loc.workType;
    var logoCompany = content.logoAlt ? content.logoAlt.replace(/\s+logo$/i, '').trim() || null : null;
    if (logoCompany && /^(logo|image|photo|avatar)$/i.test(logoCompany)) logoCompany = null;

    if (Parse && Parse.resolveCompanyAndLocation) {
      var resolved = Parse.resolveCompanyAndLocation({
        company: company,
        location: location,
        workType: workType,
        logoCompany: logoCompany,
        ariaCompany: content.ariaCompany,
      });
      company = resolved.company;
      location = resolved.location;
      workType = resolved.workType || workType;
    } else if (!company && logoCompany) {
      company = logoCompany;
    }

    var mapped = {
      jobTitle: jobTitle,
      company: company,
      location: location,
      workType: workType,
      appliedAt: appliedAt,
      postingStatus: postingStatus,
      publishedAt: publishedAt,
      response: content.response || 'unknown',
      applicationViewed: signals ? !!signals.applicationViewed : false,
      cvDownloaded: signals ? !!signals.cvDownloaded : false,
      rawStatus: rawStatus,
      companyLogoUrl: content.logoUrl || null,
      companySlug: content.companySlug || null,
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
   * Parse flight (or inline-push HTML) text into tracker rows.
   * @returns {{rows:Array, roots:Array, distinctIds:number, isFlight:boolean}}
   */
  function extractJobsFromFlight(text) {
    var flight = toFlightText(text);
    if (!flight) return { rows: [], roots: [], distinctIds: 0, isFlight: false };
    var f = parseFlight(flight);
    var nodes = findJobRowNodes(f.roots);
    var rows = [];
    var byKey = Object.create(null);
    var ids = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var content = collectRowContent(nodes[i].node);
      if (!content.texts.length) continue;
      var row = rowFromContent(nodes[i].jobId, content);
      if (!row.jobTitle && !row.appliedAt) continue;
      ids[row.jobId] = true;
      var key = row.jobId + '|' + (row.appliedAt || '');
      var idOnly = row.jobId + '|';
      var prev = byKey[key] || (!row.appliedAt ? findById(rows, row.jobId) : byKey[idOnly]);
      if (prev) {
        mergeInto(prev, row);
        continue;
      }
      byKey[key] = row;
      rows.push(row);
    }
    return { rows: rows, roots: f.roots, distinctIds: Object.keys(ids).length, isFlight: true };
  }

  function findById(rows, id) {
    for (var i = 0; i < rows.length; i++) if (rows[i].jobId === id) return rows[i];
    return null;
  }

  function mergeInto(prev, row) {
    for (var k in row) {
      if (row[k] != null && row[k] !== '' && (prev[k] == null || prev[k] === '' || prev[k] === 'unknown')) {
        prev[k] = row[k];
      }
      if (row[k] === true) prev[k] = true;
    }
  }

  var api = {
    looksLikeFlight: looksLikeFlight,
    extractInlineFlight: extractInlineFlight,
    toFlightText: toFlightText,
    parseFlightRows: parseFlightRows,
    parseFlight: parseFlight,
    findJobRowNodes: findJobRowNodes,
    collectRowContent: collectRowContent,
    rowFromContent: rowFromContent,
    extractJobsFromFlight: extractJobsFromFlight,
  };

  root.BasvuruTrackerRsc = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
