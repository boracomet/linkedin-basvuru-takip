/**
 * Pure page-hydration helpers (no DOM). Skeleton detection, progressive merge,
 * expected-per-page math. Used by scrape.js and node tests.
 */
(function (root) {
  'use strict';

  var DEFAULT_PAGE_SIZE = 10;

  function isSkeletonClassName(className) {
    var cn = String(className || '');
    if (!cn) return false;
    return /skeleton|ghost|shimmer|placeholder|artdeco-loader|lazy-?load|occludable.*placeholder|jobs-?skeleton|loading-animate|ember-view--loading/i.test(
      cn
    );
  }

  /**
   * @param {{className?:string,hasJobLink?:boolean,hasJobTitleText?:boolean,looksLikeRow?:boolean,skeletonChild?:boolean,emptyGrey?:boolean}} d
   */
  function isSkeletonRowDescriptor(d) {
    if (!d) return true;
    if (isSkeletonClassName(d.className)) return true;
    if (d.skeletonChild) return true;
    if (d.emptyGrey) return true;
    if (d.looksLikeRow && d.hasJobLink === false) return true;
    if (d.hasJobLink && d.hasJobTitleText === false) return true;
    return false;
  }

  function rowMergeKey(row) {
    if (!row) return null;
    if (row.jobId) {
      var applied = row.appliedAt ? String(row.appliedAt).replace(/\s+/g, ' ').trim() : '';
      return applied ? 'id:' + String(row.jobId) + '|' + applied : 'id:' + String(row.jobId);
    }
    if (row.jobUrl) return 'url:' + String(row.jobUrl);
    if (row._orphan || (!row.jobId && (row.jobTitle || row.company))) {
      return (
        'syn:' +
        (row.company || '') +
        '|' +
        (row.jobTitle || '') +
        '|' +
        (row.appliedAt || '') +
        '|' +
        (row._pageIndex != null ? String(row._pageIndex) : '')
      );
    }
    return null;
  }

  function pickDefined(src) {
    var out = {};
    if (!src) return out;
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = src[k];
      if (v != null && v !== '') out[k] = v;
    }
    return out;
  }

  /**
   * Merge a hydrated row into a per-page map keyed by jobId/url.
   * Later non-empty fields overwrite empties.
   */
  function mergeHydratedRow(map, row) {
    map = map || Object.create(null);
    var key = rowMergeKey(row);
    if (!key) return map;
    var prev = map[key];
    if (!prev) {
      map[key] = row;
      return map;
    }
    map[key] = Object.assign({}, prev, pickDefined(row));
    return map;
  }

  function hydratedCount(map) {
    if (!map) return 0;
    return Object.keys(map).length;
  }

  function hydratedRows(map) {
    if (!map) return [];
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  /**
   * How many rows we expect on this page given tracker total + collected so far.
   * @returns {{expected:number,isLastPage:boolean,remaining:number|null,pageSize:number}}
   */
  function expectedRowsForPage(opts) {
    opts = opts || {};
    var pageSize = opts.pageSize != null ? Number(opts.pageSize) : DEFAULT_PAGE_SIZE;
    if (!isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
    var total = opts.totalExpected;
    var collected = opts.collectedSoFar != null ? Number(opts.collectedSoFar) : 0;
    if (collected < 0 || !isFinite(collected)) collected = 0;

    if (total == null || !isFinite(total) || total <= 0) {
      return { expected: pageSize, isLastPage: false, remaining: null, pageSize: pageSize };
    }
    var remaining = Math.max(0, Math.floor(total) - collected);
    var expected = Math.min(pageSize, remaining);
    return {
      expected: expected,
      isLastPage: remaining <= pageSize,
      remaining: remaining,
      pageSize: pageSize,
    };
  }

  /** Flag page only when short of expected AND not the last page. */
  function shouldFlagPageIncomplete(opts) {
    opts = opts || {};
    if (opts.isLastPage) return false;
    var expected = opts.expected != null ? Number(opts.expected) : 0;
    var got = opts.got != null ? Number(opts.got) : 0;
    if (!isFinite(expected) || expected <= 0) return false;
    return got < expected;
  }

  /**
   * Whether hydration can stop for this page.
   * Once we have `expected` hydrated rows, stop even if decorative skeleton nodes remain
   * (false-positive skeleton detection used to stall forever at "10/10").
   */
  function isHydrationComplete(opts) {
    opts = opts || {};
    var hydrated = opts.hydrated != null ? Number(opts.hydrated) : 0;
    var expected = opts.expected != null ? Number(opts.expected) : DEFAULT_PAGE_SIZE;
    var skel = opts.skeletonsRemaining != null ? Number(opts.skeletonsRemaining) : 0;
    var stable = opts.stableTicks != null ? Number(opts.stableTicks) : 0;
    var needStable = opts.maxStableTicks != null ? Number(opts.maxStableTicks) : 3;

    if (expected <= 0) return true;
    // LinkedIn empty state ("Eşleşme yok") with zero rows — stop, do not wait out the timeout.
    if (opts.emptyState && hydrated === 0) return true;
    // Full page collected → done (do not wait for skeleton count to hit 0)
    if (hydrated >= expected) return true;
    // Last page / no more rows: stable even if short
    if (opts.isLastPage && skel <= 0 && stable >= needStable && hydrated > 0) return true;
    if (opts.noNextControl && skel <= 0 && stable >= needStable && hydrated > 0) return true;
    // Stable short page with no skeletons
    if (skel <= 0 && stable >= needStable && hydrated > 0 && hydrated >= Math.min(expected, 3)) {
      return true;
    }
    return false;
  }

  /**
   * Commit rows into a global collection (dedupe). Used by scrape + tests.
   * @returns {number} newly added count
   */
  function commitRowsToCollection(ctx, rows) {
    ctx = ctx || {};
    var all = ctx.all || (ctx.all = []);
    var seen = ctx.seen || (ctx.seen = Object.create(null));
    var feed = ctx.feed || null;
    var keyFn =
      ctx.keyFn ||
      function (row) {
        if (row && row.jobId) return 'id:' + String(row.jobId);
        if (row && row.jobUrl) return 'url:' + String(row.jobUrl);
        return null;
      };
    var added = 0;
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || (!row.jobTitle && !row.jobId)) continue;
      var key = keyFn(row);
      if (!key || seen[key]) continue;
      seen[key] = true;
      all.push(row);
      if (feed) feed.push(row);
      added += 1;
      if (typeof ctx.onItem === 'function') ctx.onItem(row, { count: all.length });
    }
    return added;
  }

  /**
   * Integration-style page-read loop: progressive hydrate + immediate commit.
   * @param {{pages:Array<Array<object>>, expectedPerPage?:number, sleep?:function, onStatus?:function, onItem?:function, hydrateDelayMs?:number}} opts
   */
  async function runPageReadLoop(opts) {
    opts = opts || {};
    var pages = opts.pages || [];
    var expectedPerPage = opts.expectedPerPage != null ? opts.expectedPerPage : DEFAULT_PAGE_SIZE;
    var delay = opts.hydrateDelayMs != null ? opts.hydrateDelayMs : 0;
    var sleepFn =
      opts.sleep ||
      function (ms) {
        return new Promise(function (r) {
          setTimeout(r, ms);
        });
      };
    var ctx = { all: [], seen: Object.create(null), feed: [], onItem: opts.onItem, keyFn: opts.keyFn };
    var pageStats = [];

    for (var p = 0; p < pages.length; p++) {
      var pageRows = pages[p] || [];
      var pageMap = Object.create(null);
      var pageNum = p + 1;
      for (var i = 0; i < pageRows.length; i++) {
        if (delay > 0) await sleepFn(delay);
        mergeHydratedRow(pageMap, pageRows[i]);
        // Progressive commit as each row hydrates
        commitRowsToCollection(ctx, [pageRows[i]]);
        if (typeof opts.onStatus === 'function') {
          opts.onStatus({
            page: pageNum,
            hydrated: hydratedCount(pageMap),
            expected: expectedPerPage,
            total: ctx.all.length,
          });
        }
        if (hydratedCount(pageMap) >= expectedPerPage) break;
      }
      // Flush any remaining in map (idempotent via seen)
      commitRowsToCollection(ctx, hydratedRows(pageMap));
      pageStats.push({
        page: pageNum,
        got: hydratedCount(pageMap),
        expected: expectedPerPage,
        cumulative: ctx.all.length,
      });
    }

    return {
      rows: ctx.all.slice(),
      feed: ctx.feed.slice(),
      total: ctx.all.length,
      pageStats: pageStats,
    };
  }

  /**
   * Page shows LinkedIn's empty list ("Eşleşme yok" / "No matches") and zero rows.
   * Finish the scan and open results instead of waiting for a page that will not load.
   */
  function shouldStopOnEmptyPage(opts) {
    opts = opts || {};
    if (!opts.emptyState) return false;
    var got = opts.got != null ? Number(opts.got) : opts.hydrated != null ? Number(opts.hydrated) : 0;
    if (!isFinite(got)) got = 0;
    return got === 0;
  }

  function shouldRetryPageRead(opts) {
    opts = opts || {};
    if (opts.emptyState) return false;
    if (opts.retried) return false;
    var got = opts.got != null ? Number(opts.got) : 0;
    var expected = opts.expected != null ? Number(opts.expected) : DEFAULT_PAGE_SIZE;
    if (expected <= 0) return false;
    return got < expected;
  }

  /** "Başvuruldu · 683" / "Applied · 683" */
  function parseAppliedCountFromChipText(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    var m = s.match(/(?:Ba\u015fvuruldu|Applied)\s*[·•.\u00b7\-]?\s*(\d{1,6})\b/i);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function formatScanProgress(collected, totalExpected) {
    var c = collected != null ? Number(collected) : 0;
    if (!isFinite(c) || c < 0) c = 0;
    if (totalExpected != null && isFinite(totalExpected) && totalExpected > 0) {
      return c + ' / ' + Math.floor(totalExpected);
    }
    return String(c);
  }

  /**
   * End-of-scan message when short of tracker total.
   * @param {number[]} incompletePages
   */
  function formatIncompleteEnd(collected, totalExpected, incompletePages) {
    var base = formatScanProgress(collected, totalExpected);
    if (totalExpected == null || !isFinite(totalExpected) || collected >= totalExpected) {
      return base;
    }
    var pages = (incompletePages || []).filter(function (p) {
      return p != null && isFinite(p);
    });
    if (pages.length) {
      return base + ' \u2014 okunamayan sayfalar: ' + pages.join(', ');
    }
    return base + ' \u2014 baz\u0131 ba\u015fvurular okunamad\u0131';
  }

  var api = {
    DEFAULT_PAGE_SIZE: DEFAULT_PAGE_SIZE,
    isSkeletonClassName: isSkeletonClassName,
    isSkeletonRowDescriptor: isSkeletonRowDescriptor,
    rowMergeKey: rowMergeKey,
    mergeHydratedRow: mergeHydratedRow,
    hydratedCount: hydratedCount,
    hydratedRows: hydratedRows,
    expectedRowsForPage: expectedRowsForPage,
    shouldFlagPageIncomplete: shouldFlagPageIncomplete,
    isHydrationComplete: isHydrationComplete,
    shouldStopOnEmptyPage: shouldStopOnEmptyPage,
    shouldRetryPageRead: shouldRetryPageRead,
    commitRowsToCollection: commitRowsToCollection,
    runPageReadLoop: runPageReadLoop,
    parseAppliedCountFromChipText: parseAppliedCountFromChipText,
    formatScanProgress: formatScanProgress,
    formatIncompleteEnd: formatIncompleteEnd,
  };

  root.BasvuruTrackerHydrate = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
