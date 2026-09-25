/**
 * Isolated-world "Hızlı mod (API)" orchestrator.
 * Discovers the tracker list request (initial load or one "İleri" click window), detects its
 * pagination fields, verifies page 1 via replay and fetches every page through the MAIN-world
 * hook (which re-sends the page's own headers). DOM helpers come from scrape.js via `deps`.
 */
(function (root) {
  'use strict';

  var SOURCE = 'basvuru-tracker-api';
  var STORAGE_SAMPLE = 'btApiSample';
  /**
   * How hard the applied-jobs scan hits LinkedIn.
   * concurrency is the max number of replay requests in flight.
   * Each replay waits a random delay in [delayMinMs, delayMaxMs].
   * HTTP 429 and 5xx wait backoffBaseMs * 2^attempt (capped at backoffMaxMs) plus jitter.
   */
  var SCAN_REQUEST_POLICY = {
    concurrency: 2,
    delayMinMs: 250,
    delayMaxMs: 500,
    backoffBaseMs: 1500,
    backoffMaxMs: 8000,
    maxAttempts: 3,
  };
  var BIG_SIZES = [100, 50, 25];

  var ring = new Map();
  var hookReady = false;
  var dumpWaiters = [];
  var replayWaiters = new Map();
  var reqSeq = 0;

  var INCOMING_TYPES = { 'hook-ready': true, ring: true, dump: true, 'replay-result': true };
  var REQUEST_BODY_MAX = 256 * 1024;

  function isDataObject(v) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
    var proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  function stringList(v, max) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length && out.length < max; i++) {
      if (typeof v[i] === 'string' && v[i].length <= 80) out.push(v[i]);
    }
    return out;
  }

  /**
   * Copy only known fields. requestBody is the full replay body (memory only).
   * requestBodySnippet is the redacted copy used in reports.
   */
  function sanitizeEntry(e) {
    if (!isDataObject(e)) return null;
    if (typeof e.id !== 'string' || !e.id || e.id.length > 80) return null;
    if (typeof e.url !== 'string' || !e.url || e.url.length > 2000) return null;
    if (e.method != null && typeof e.method !== 'string') return null;
    if (e.status != null && typeof e.status !== 'number') return null;
    if (e.at != null && typeof e.at !== 'number') return null;
    if (e.size != null && typeof e.size !== 'number') return null;
    if (e.body != null && typeof e.body !== 'string') return null;
    if (e.snippet != null && typeof e.snippet !== 'string') return null;
    if (e.source != null && typeof e.source !== 'string') return null;
    if (e.contentType != null && typeof e.contentType !== 'string') return null;
    if (e.requestBody != null && typeof e.requestBody !== 'string') return null;
    if (typeof e.requestBody === 'string' && e.requestBody.length > REQUEST_BODY_MAX) return null;
    if (e.requestBodySnippet != null && typeof e.requestBodySnippet !== 'string') return null;
    if (e.headerNames != null && !Array.isArray(e.headerNames)) return null;
    var out = {
      id: e.id,
      at: typeof e.at === 'number' ? e.at : 0,
      url: e.url,
      method: typeof e.method === 'string' ? e.method.slice(0, 16) : 'GET',
      status: typeof e.status === 'number' ? e.status : null,
      contentType: typeof e.contentType === 'string' ? e.contentType.slice(0, 200) : null,
      size: typeof e.size === 'number' ? e.size : 0,
      snippet: typeof e.snippet === 'string' ? e.snippet : '',
      source: typeof e.source === 'string' ? e.source.slice(0, 40) : '',
      headerNames: stringList(e.headerNames, 40),
      requestBody: typeof e.requestBody === 'string' ? e.requestBody : null,
      requestBodySnippet: typeof e.requestBodySnippet === 'string' ? e.requestBodySnippet : null,
    };
    if (typeof e.body === 'string') out.body = e.body;
    return out;
  }

  function sanitizeReplayResult(d) {
    if (typeof d.reqId !== 'string' || !d.reqId || d.reqId.length > 80) return null;
    if (typeof d.ok !== 'boolean') return null;
    if (d.status != null && typeof d.status !== 'number') return null;
    if (d.text != null && typeof d.text !== 'string') return null;
    if (d.error != null && typeof d.error !== 'string') return null;
    if (d.contentType != null && typeof d.contentType !== 'string') return null;
    var out = {
      source: SOURCE,
      type: 'replay-result',
      reqId: d.reqId,
      ok: d.ok,
      status: typeof d.status === 'number' ? d.status : 0,
    };
    if (typeof d.contentType === 'string') out.contentType = d.contentType.slice(0, 200);
    if (typeof d.text === 'string') out.text = d.text;
    if (typeof d.error === 'string') out.error = d.error.slice(0, 300);
    return out;
  }

  /**
   * Accept a MAIN-world postMessage only when source, type, and shape match.
   * Returns a sanitized copy, or null when the message must be ignored.
   */
  function acceptIncoming(d) {
    if (!isDataObject(d)) return null;
    if (d.source !== SOURCE || typeof d.type !== 'string' || !INCOMING_TYPES[d.type]) return null;
    if (d.type === 'hook-ready') return { source: SOURCE, type: 'hook-ready' };
    if (d.type === 'ring') {
      var entry = sanitizeEntry(d.entry);
      if (!entry) return null;
      return { source: SOURCE, type: 'ring', entry: entry };
    }
    if (d.type === 'dump') {
      if (!Array.isArray(d.ring)) return null;
      var ringOut = [];
      for (var i = 0; i < d.ring.length && ringOut.length < 500; i++) {
        var cleaned = sanitizeEntry(d.ring[i]);
        if (cleaned) ringOut.push(cleaned);
      }
      return { source: SOURCE, type: 'dump', ring: ringOut, hookInstalled: d.hookInstalled === true };
    }
    if (d.type === 'replay-result') {
      var result = sanitizeReplayResult(d);
      return result;
    }
    return null;
  }

  function mergeEntry(e) {
    var clean = sanitizeEntry(e);
    if (!clean) return;
    var prev = ring.get(clean.id);
    if (prev && prev.body !== undefined && clean.body === undefined) clean.body = prev.body;
    ring.set(clean.id, clean);
    if (ring.size > 500) ring.delete(ring.keys().next().value);
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', function (ev) {
      try {
        if (ev.source !== window) return;
        var d = acceptIncoming(ev.data);
        if (!d) return;
        if (d.type === 'hook-ready') hookReady = true;
        else if (d.type === 'ring') mergeEntry(d.entry);
        else if (d.type === 'dump') {
          hookReady = hookReady || d.hookInstalled === true;
          d.ring.forEach(mergeEntry);
          var ws = dumpWaiters;
          dumpWaiters = [];
          ws.forEach(function (fn) {
            fn();
          });
        } else if (d.type === 'replay-result' && replayWaiters.has(d.reqId)) {
          var w = replayWaiters.get(d.reqId);
          replayWaiters.delete(d.reqId);
          clearTimeout(w.timer);
          w.resolve(d);
        }
      } catch (_) {}
    });
  }

  function post(msg) {
    try {
      window.postMessage(Object.assign({ source: SOURCE }, msg), '*');
    } catch (_) {}
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function abortError() {
    var err = new Error('aborted');
    err.code = 'aborted';
    err.name = 'ScanAborted';
    return err;
  }

  function isAbortError(err) {
    return !!(err && (err.code === 'aborted' || err.name === 'ScanAborted'));
  }

  function ctxAborted(ctx) {
    return !!(ctx && typeof ctx.isAborted === 'function' && ctx.isAborted());
  }

  function throwIfAborted(ctx) {
    if (ctxAborted(ctx)) throw abortError();
  }

  function nap(ctx, ms) {
    if (ctxAborted(ctx)) return Promise.reject(abortError());
    var sleeper = ctx && typeof ctx.sleep === 'function' ? ctx.sleep : sleep;
    return Promise.resolve(sleeper(ms)).then(function () {
      if (ctxAborted(ctx)) throw abortError();
    });
  }

  function policyDelayMs() {
    var min = SCAN_REQUEST_POLICY.delayMinMs;
    var max = SCAN_REQUEST_POLICY.delayMaxMs;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function backoffDelayMs(attempt) {
    var base = SCAN_REQUEST_POLICY.backoffBaseMs * Math.pow(2, attempt);
    var capped = Math.min(base, SCAN_REQUEST_POLICY.backoffMaxMs);
    var jitter = Math.floor(Math.random() * Math.max(1, Math.floor(capped / 4)));
    return capped + jitter;
  }

  function isBackoffStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
  }

  function dump(ctx) {
    return new Promise(function (resolve, reject) {
      if (ctxAborted(ctx)) {
        reject(abortError());
        return;
      }
      var done = false;
      var unbind = null;
      var timer = null;
      var onDump = function () {
        finish(false);
      };
      function finish(aborted) {
        if (done) return;
        done = true;
        if (timer != null) clearTimeout(timer);
        if (unbind) unbind();
        var idx = dumpWaiters.indexOf(onDump);
        if (idx >= 0) dumpWaiters.splice(idx, 1);
        if (aborted === true || ctxAborted(ctx)) reject(abortError());
        else resolve();
      }
      if (ctx && typeof ctx.bindAbort === 'function') {
        unbind = ctx.bindAbort(function () {
          finish(true);
        });
      }
      if (done) return;
      dumpWaiters.push(onDump);
      var have = [];
      ring.forEach(function (e, id) {
        if (e.body !== undefined) have.push(id);
      });
      post({ type: 'dump-request', have: have });
      timer = setTimeout(function () {
        finish(false);
      }, 1500);
    });
  }

  function ringList() {
    return Array.from(ring.values()).sort(function (a, b) {
      return (a.at || 0) - (b.at || 0);
    });
  }

  function replayFetch(ctx, templateId, method, url, body) {
    if (ctxAborted(ctx)) return Promise.reject(abortError());
    reqSeq += 1;
    var reqId = 'q' + Date.now().toString(36) + '_' + reqSeq;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var unbind = null;
      var timer = null;
      function settle(fn) {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimeout(timer);
        if (unbind) unbind();
        replayWaiters.delete(reqId);
        fn();
      }
      function failAbort() {
        settle(function () {
          try {
            post({ type: 'replay-abort', reqId: reqId });
          } catch (_) {}
          reject(abortError());
        });
      }
      if (ctxAborted(ctx)) {
        reject(abortError());
        return;
      }
      timer = setTimeout(function () {
        settle(function () {
          resolve({ ok: false, status: 0, error: 'timeout' });
        });
      }, 25000);
      if (ctx && typeof ctx.bindAbort === 'function') unbind = ctx.bindAbort(failAbort);
      if (settled || ctxAborted(ctx)) {
        if (!settled) failAbort();
        return;
      }
      replayWaiters.set(reqId, {
        resolve: function (d) {
          if (ctxAborted(ctx) || (d && d.error === 'aborted')) {
            failAbort();
            return;
          }
          settle(function () {
            resolve(d);
          });
        },
        timer: timer,
      });
      post({ type: 'replay', reqId: reqId, templateId: templateId, method: method, url: url, body: body });
    });
  }

  function collectFingerprints(deps) {
    var links = deps.jobLinksOnPage();
    var jobIds = [];
    var titles = [];
    var companies = [];
    for (var i = 0; i < Math.min(links.length, 12); i++) {
      var id = deps.jobIdFromHref(links[i].href);
      if (id) jobIds.push(id);
      var row = null;
      try {
        row = deps.parseDomCard(links[i]);
      } catch (_) {}
      if (row && row.jobTitle) titles.push(String(row.jobTitle).slice(0, 80));
      if (row && row.company && !/^Bilinmeyen/.test(row.company)) companies.push(String(row.company).slice(0, 60));
    }
    return { jobIds: jobIds, titles: titles, companies: companies };
  }

  function currentIds(deps) {
    return deps
      .jobLinksOnPage()
      .map(function (a) {
        return deps.jobIdFromHref(a.href);
      })
      .filter(Boolean);
  }

  function overlap(ids, ref) {
    var set = new Set(ref);
    var n = 0;
    for (var i = 0; i < ids.length; i++) if (set.has(ids[i])) n++;
    return n;
  }

  async function waitForIds(deps, predicate, timeoutMs, ctx) {
    var t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      throwIfAborted(ctx);
      var ids = currentIds(deps);
      if (ids.length && predicate(ids)) return ids;
      await nap(ctx, 150);
    }
    throwIfAborted(ctx);
    return null;
  }

  function persistReport(text, extra) {
    try {
      chrome.storage.local.set({
        [STORAGE_SAMPLE]: {
          at: Date.now(),
          kind: 'discovery',
          sample: text,
          url: extra && extra.url,
          method: extra && extra.method,
          matched: !!(extra && extra.matched),
        },
      });
    } catch (_) {}
  }

  function templateOf(entry) {
    return { id: entry.id, url: entry.url, method: entry.method || 'GET', body: entry.requestBody };
  }

  function flipPageRoles(plan) {
    var changed = false;
    var fields = plan.fields.map(function (f) {
      if (f.role === 'page0' || f.role === 'page1') {
        changed = true;
        return Object.assign({}, f, { role: f.role === 'page0' ? 'page1' : 'page0' });
      }
      return f;
    });
    return changed ? Object.assign({}, plan, { fields: fields }) : null;
  }

  /** Click "İleri" once; return the page-2 strong match captured in that window (or null). */
  async function nextClickWindow(deps, fp1, log, ctx) {
    var A = root.BasvuruTrackerApi;
    var action = null;
    try {
      action = await deps.resolveNextPagination({ attempts: 2 });
    } catch (err) {
      if (isAbortError(err)) throw err;
    }
    if (!action || !action.el || deps.isControlDisabled(action.el)) {
      log.nextClick = { used: false, reason: 'no_next_control' };
      return null;
    }
    throwIfAborted(ctx);
    var clickAt = Date.now() - 50;
    action.el.click();
    var ids2 = await waitForIds(
      deps,
      function (ids) {
        return overlap(ids, fp1.jobIds) <= Math.floor(ids.length / 2);
      },
      5000,
      ctx
    );
    var fp2 = ids2 ? collectFingerprints(deps) : { jobIds: [], titles: [], companies: [] };
    var best = null;
    var matches = [];
    var t0 = Date.now();
    while (Date.now() - t0 < 2500) {
      throwIfAborted(ctx);
      await dump(ctx);
      var m = A.matchRingToFingerprints(ringList(), fp2, { sinceAt: clickAt, window: 'next-click' });
      matches = m.matches;
      if (m.best) {
        best = m.best;
        break;
      }
      if (!ids2) break;
      await nap(ctx, 300);
    }
    log.nextClick = {
      used: true,
      type: action.type,
      pageChanged: !!ids2,
      fingerprints: { jobIds: fp2.jobIds.slice(0, 10), titles: fp2.titles.slice(0, 5) },
      requestsInWindow: ringList().filter(function (e) {
        return (e.at || 0) >= clickAt;
      }).length,
      matched: !!best,
    };
    log.nextMatches = matches;
    return best ? { match: best, pageIndex: 1 } : null;
  }

  async function returnToFirstPage(deps, fp1, ctx) {
    var ids = currentIds(deps);
    if (overlap(ids, fp1.jobIds) >= Math.min(3, fp1.jobIds.length)) return;
    var btn = (deps.findPageNumberButton && deps.findPageNumberButton(1)) || (deps.findPrevPageButton && deps.findPrevPageButton(false));
    if (!btn) return;
    throwIfAborted(ctx);
    try {
      btn.click();
    } catch (_) {
      return;
    }
    await waitForIds(
      deps,
      function (now) {
        return overlap(now, fp1.jobIds) >= Math.min(3, fp1.jobIds.length);
      },
      6000,
      ctx
    );
    try {
      if (deps.scrollListToTop) await deps.scrollListToTop();
    } catch (err) {
      if (isAbortError(err)) throw err;
    }
  }

  /**
   * @param {{onStatus:Function, onItem?:Function, chipTotal?:number, isAborted?:Function, sleep?:Function, bindAbort?:Function}} hooks
   * @param {object} deps DOM helpers from scrape.js
   */
  async function run(hooks, deps) {
    var ctx = {
      isAborted: hooks && typeof hooks.isAborted === 'function' ? hooks.isAborted : function () { return false; },
      sleep: hooks && typeof hooks.sleep === 'function' ? hooks.sleep : null,
      bindAbort: hooks && typeof hooks.bindAbort === 'function' ? hooks.bindAbort : null,
    };
    try {
      return await runScan(hooks, deps, ctx);
    } catch (err) {
      if (isAbortError(err)) {
        try { post({ type: 'replay-abort-all' }); } catch (_) {}
        try { post({ type: 'scan-end' }); } catch (_) {}
      }
      throw err;
    }
  }

  async function runScan(hooks, deps, ctx) {
    var A = root.BasvuruTrackerApi;
    var Parse = root.BasvuruTrackerParse;
    var onStatus = hooks.onStatus || function () {};
    var onItem = hooks.onItem;
    var chipTotal = hooks.chipTotal || null;
    var scanStats = {
      mode: 'api',
      pages: [],
      endReason: null,
      cumulative: 0,
      totalExpected: chipTotal,
      incompletePages: [],
    };
    var log = { notes: [], nextClick: { used: false }, replay: [] };
    var label = function (n) {
      return A.formatModeStatus('api', n || 0, chipTotal);
    };
    var fp1 = { jobIds: [], titles: [], companies: [] };
    var initialMatch = { best: null, matches: [] };
    var chosen = null;
    var plan = null;
    var clicked = false;

    var finish = function (result) {
      var report = A.buildDiscoveryReport({
        ring: ringList(),
        match: initialMatch,
        extraMatches: log.nextMatches || [],
        fingerprints: fp1,
        hookInstalled: hookReady,
        nextClick: log.nextClick,
        plan: A.planSummary(plan),
        replay: { steps: log.replay.slice(0, 40), result: result.reason, parsed: result.rows ? result.rows.length : 0, chipTotal: chipTotal },
        notes: log.notes,
      });
      persistReport(report, chosen ? { url: chosen.url, method: chosen.method, matched: true } : { matched: false });
      post({ type: 'scan-end' });
      result.scanStats = result.scanStats || scanStats;
      return result;
    };
    var finishIfLive = function (result) {
      throwIfAborted(ctx);
      return finish(result);
    };

    post({ type: 'scan-begin' });
    onStatus(label(0) + ' \u00b7 liste verisi al\u0131n\u0131yor\u2026', { pct: 4, mode: 'api', totalExpected: chipTotal, count: 0 });

    await waitForIds(deps, function () {
      return true;
    }, 8000, ctx);
    fp1 = collectFingerprints(deps);
    await nap(ctx, 150);
    await dump(ctx);
    initialMatch = A.matchRingToFingerprints(ringList(), fp1, { window: 'initial' });

    if (initialMatch.best && initialMatch.best.method !== 'INLINE') {
      var p0 = A.detectPaginationPlan(templateOf(initialMatch.best.entry), { pageIndex: 0, pageSize: 10 });
      if (p0.supported) {
        chosen = initialMatch.best;
        plan = p0;
        log.notes.push('template from initial load');
      }
    }
    if (initialMatch.best && !chosen) {
      log.notes.push('initial strong match not replayable: ' + initialMatch.best.method);
      var whole = A.parseTrackerResponseText(initialMatch.best.entry.body || '');
      if (whole.count > 10 && chipTotal && whole.count >= chipTotal * 0.5) {
        chosen = initialMatch.best;
        throwIfAborted(ctx);
        if (Parse && Parse.resetDedupeCounter) Parse.resetDedupeCounter();
        whole.rows.forEach(function (row, i) {
          if (onItem) onItem(row, { page: 1, count: i + 1, totalExpected: chipTotal, mode: 'api' });
        });
        scanStats.cumulative = whole.count;
        scanStats.endReason = 'initial_blob';
        log.notes.push('initial blob holds ' + whole.count + ' rows');
        return finishIfLive({ ok: true, reason: 'ok', rows: whole.rows, scanStats: scanStats, parsedCount: whole.count, chipTotal: chipTotal });
      }
    }

    if (!chosen) {
      onStatus(label(0) + ' \u00b7 2. sayfa a\u00e7\u0131l\u0131yor\u2026', { pct: 5, mode: 'api', totalExpected: chipTotal });
      throwIfAborted(ctx);
      var nx = await nextClickWindow(deps, fp1, log, ctx);
      clicked = !!(log.nextClick && log.nextClick.used);
      if (nx) {
        chosen = nx.match;
        plan = A.detectPaginationPlan(templateOf(nx.match.entry), { pageIndex: nx.pageIndex, pageSize: 10 });
      }
    }
    if (clicked) await returnToFirstPage(deps, fp1, ctx);

    if (!chosen) return finishIfLive({ ok: false, reason: 'no_capture', rows: [] });
    if (!plan || !plan.supported) {
      log.notes.push(plan && plan.cursorOnly ? 'cursor-only pagination' : 'no pagination field');
      return finishIfLive({ ok: false, reason: 'no_pagination', rows: [], parsedCount: 0 });
    }

    var tpl = templateOf(chosen.entry);
    var fetchPage = async function (p, size, usePlan) {
      throwIfAborted(ctx);
      await nap(ctx, policyDelayMs());
      throwIfAborted(ctx);
      var req = A.applyPaginationPlan(tpl, usePlan || plan, p, size);
      var res = await replayFetch(ctx, tpl.id, tpl.method, req.url, req.body);
      throwIfAborted(ctx);
      if (log.replay.length < 40) log.replay.push({ page: p, size: size, status: res.status, ok: !!res.ok, bytes: res.text ? res.text.length : 0, error: res.error });
      if (!res.ok) {
        var err = new Error(res.error || 'http_' + res.status);
        err.status = res.status;
        throw err;
      }
      return A.parseTrackerResponseText(res.text || '');
    };

    onStatus(label(0) + ' \u00b7 1. sayfa do\u011frulan\u0131yor\u2026', { pct: 7, mode: 'api', totalExpected: chipTotal });
    var needHits = Math.min(5, fp1.jobIds.length || 5);
    var hitsOf = function (parsed) {
      return overlap(
        parsed.rows.map(function (r) {
          return r.jobId;
        }),
        fp1.jobIds
      );
    };
    var pageSize = null;
    var first = null;
    var sizes = plan.hasSize ? BIG_SIZES.concat([plan.pageSize]) : [plan.pageSize];
    for (var si = 0; si < sizes.length && !first; si++) {
      var size = sizes[si];
      try {
        var parsed = await fetchPage(0, size);
        var enough = size === plan.pageSize || parsed.count >= Math.min(size, chipTotal || size);
        if (hitsOf(parsed) >= needHits && enough) {
          first = parsed;
          pageSize = size;
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
      }
    }
    if (!first) {
      var flipped = flipPageRoles(plan);
      if (flipped) {
        try {
          var pf = await fetchPage(0, plan.pageSize, flipped);
          if (hitsOf(pf) >= needHits) {
            plan = flipped;
            first = pf;
            pageSize = plan.pageSize;
            log.notes.push('page index base flipped');
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }
    }
    if (!first) {
      log.notes.push('replay of page 1 did not return DOM page-1 jobs');
      return finishIfLive({ ok: false, reason: 'replay_mismatch', rows: [], parsedCount: 0 });
    }

    if (Parse && Parse.resetDedupeCounter) Parse.resetDedupeCounter();
    var seen = new Set();
    var pages = [];
    var total = chipTotal || (first.paging && first.paging.total) || null;
    var collected = 0;
    var failed = [];

    var absorb = function (p, parsed) {
      throwIfAborted(ctx);
      var added = [];
      var rows = (parsed && parsed.rows) || [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || (!row.jobId && !row.jobTitle)) continue;
        var key = Parse && Parse.rowDedupeKey ? Parse.rowDedupeKey(row) : 'id:' + row.jobId;
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(row);
      }
      pages[p] = added;
      collected += added.length;
      scanStats.pages.push({ page: p + 1, start: p * pageSize, count: pageSize, got: rows.length, added: added.length, cumulative: collected });
      for (var j = 0; j < added.length; j++) {
        if (onItem) onItem(added[j], { page: p + 1, count: collected, totalExpected: total, mode: 'api' });
      }
      onStatus(label(collected), {
        pct: Math.min(92, 10 + Math.round((collected / Math.max(total || 1, 1)) * 80)),
        mode: 'api',
        count: collected,
        totalExpected: total,
      });
      return added.length;
    };

    absorb(0, first);

    var fetchWithRetry = async function (p) {
      var attempts = SCAN_REQUEST_POLICY.maxAttempts;
      for (var attempt = 0; attempt < attempts; attempt++) {
        throwIfAborted(ctx);
        try {
          return await fetchPage(p, pageSize);
        } catch (err) {
          if (isAbortError(err)) throw err;
          var status = err && err.status;
          if (status === 401 || status === 403) throw err;
          if (attempt + 1 >= attempts) return null;
          if (isBackoffStatus(status)) await nap(ctx, backoffDelayMs(attempt));
        }
      }
      return null;
    };

    var nextPage = 1;
    var lastPage = total ? Math.ceil(total / pageSize) - 1 : null;
    var emptyTail = 0;
    var stop = false;
    var authError = null;

    var worker = async function () {
      while (!stop) {
        throwIfAborted(ctx);
        var p = nextPage;
        if (lastPage != null && p > lastPage + 3) return;
        if (lastPage == null && p > 400) return;
        nextPage += 1;
        var parsed;
        try {
          parsed = await fetchWithRetry(p);
        } catch (err) {
          if (isAbortError(err)) {
            stop = true;
            throw err;
          }
          authError = err;
          stop = true;
          return;
        }
        throwIfAborted(ctx);
        if (!parsed) {
          failed.push(p);
          continue;
        }
        var added = absorb(p, parsed);
        if (added === 0 && (lastPage == null || p >= lastPage)) {
          emptyTail += 1;
          if (emptyTail >= 2) stop = true;
        } else if (added > 0 && p > (lastPage || 0)) {
          lastPage = p;
        }
      }
    };

    var workers = [];
    for (var w = 0; w < SCAN_REQUEST_POLICY.concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    throwIfAborted(ctx);

    if (failed.length && !authError) {
      var still = [];
      for (var fi = 0; fi < failed.length; fi++) {
        throwIfAborted(ctx);
        var again = await fetchWithRetry(failed[fi]).catch(function (err) {
          if (isAbortError(err)) throw err;
          return null;
        });
        if (again) absorb(failed[fi], again);
        else still.push(failed[fi]);
      }
      failed = still;
    }

    var rowsOut = [];
    for (var pi = 0; pi < pages.length; pi++) if (pages[pi]) rowsOut.push.apply(rowsOut, pages[pi]);
    scanStats.cumulative = rowsOut.length;
    scanStats.totalExpected = total;
    scanStats.incompletePages = failed.map(function (p) {
      return p + 1;
    });
    scanStats.endReason = authError ? 'replay_error' : total && rowsOut.length >= total ? 'reached_total' : 'done';
    if (total && rowsOut.length < total) {
      scanStats.incompleteMessage = rowsOut.length + ' / ' + total + ' \u2014 baz\u0131 ba\u015fvurular okunamad\u0131';
    }
    if (authError) log.notes.push('replay stopped: ' + String(authError.message || authError));

    var decision = A.shouldFallbackToDom({
      captured: true,
      parsedCount: rowsOut.length,
      chipTotal: total,
      replayError: authError && !rowsOut.length ? String(authError.message || authError) : null,
    });
    return finishIfLive({
      ok: !decision.fallback,
      reason: decision.reason,
      replayError: authError ? String(authError.message || authError) : null,
      rows: rowsOut,
      scanStats: scanStats,
      parsedCount: rowsOut.length,
      chipTotal: total,
    });
  }

  root.BasvuruTrackerApiRunner = { run: run, SCAN_REQUEST_POLICY: SCAN_REQUEST_POLICY, acceptIncoming: acceptIncoming };
})(typeof globalThis !== 'undefined' ? globalThis : this);
