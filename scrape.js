/**
 * Content script: Başvuruldu tracker panel + DOM scrape.
 * Prefer \uXXXX for non-ASCII. Saves to chrome.storage.local; opens results page.
 */
(function basvuruExtensionScrape() {
  'use strict';

  if (window.__basvuruExtScrapeBound) return;
  window.__basvuruExtScrapeBound = true;

  const SAFETY_MIN_COUNT = 50;
  const CLOSED_PHRASE =
    (globalThis.BasvuruStatus && globalThis.BasvuruStatus.CLOSED_PHRASE) ||
    'Art\u0131k ba\u015fvuru kabul etmiyor';
  const REPOST_PHRASE = 'yeniden yay\u0131nlad\u0131';
  const REL_ONCE =
    '\\d+\\s+(?:dakika|saat|g\\u00fcn|hafta|ay|y\\u0131l)\\s+\\u00f6nce';
  const YENIDEN_RE =
    (globalThis.BasvuruStatus && globalThis.BasvuruStatus.YENIDEN_RE) ||
    /yeniden\s+(?:yay\u0131n|payla\u015f)/i;
  const PANEL_ID = 'basvuru-scrape-panel';
  const PANEL_POS_KEY = 'basvuru-panel-pos';
  const PANEL_EDGE_PX = 48;
  const PAGE_WAIT_MS = 900;
  const MAX_PAGES = 120;
  const FEED_MAX = 8;
  const SCAN_KEEP_OPEN =
    'Tarama bitene kadar bu sekmeyi a\u00e7\u0131k tut ve ba\u015fka sekmeye ge\u00e7me.';
  const CREDIT_NAME = 'Geli\u015ftiren: Bora Ata T\u00fcrko\u011flu';
  const STORAGE_PANEL_COLLAPSED = 'basvuruPanelCollapsed';
  const CREDIT_WEB = 'https://boraturkoglu.com';
  const CREDIT_LI = 'https://www.linkedin.com/in/boracomet/';
  const CREDIT_GH = 'https://github.com/boracomet';
  const STORAGE_RANGE = 'basvuruRange';
  const STORAGE_AUTOSTART = 'basvuruAutostart';
  const STORAGE_OPEN_PANEL = 'basvuruOpenPanel';
  const STORAGE_SNAPSHOT = 'basvuruSnapshot';
  const STORAGE_API_SAMPLE =
    (globalThis.BasvuruTrackerApi && globalThis.BasvuruTrackerApi.STORAGE_SAMPLE) || 'btApiSample';
  const API_MSG_SOURCE =
    (globalThis.BasvuruTrackerApi && globalThis.BasvuruTrackerApi.MSG_SOURCE) || 'basvuru-tracker-api';
  const COMPANY_SEP_RE = /\s*[\u00b7\u2022]\s*/;

  const RANGE_OPTS = [
    { id: '1m', months: 1, label: 'Son 1 ay' },
    { id: '3m', months: 3, label: 'Son 3 ay' },
    { id: '6m', months: 6, label: 'Son 6 ay' },
    { id: '1y', months: 12, label: 'Son 1 y\u0131l' },
    { id: 'all', months: null, label: 'T\u00fcm\u00fc' },
  ];

  function getScrapeDoc() {
    return document;
  }

  function reportCompanyName(a) {
    const n = (a && a.company ? String(a.company) : '').trim();
    return n || '(Bilinmeyen \u015firket)';
  }

  let scanGeneration = 0;
  let scanBound = 0;
  let activeScanToken = 0;
  let suppressScanStatus = false;
  const scanWaiters = new Set();

  function scanAbortError() {
    const err = new Error('aborted');
    err.code = 'aborted';
    err.name = 'ScanAborted';
    return err;
  }

  function isScanAbortedError(err) {
    return !!(err && (err.code === 'aborted' || err.name === 'ScanAborted'));
  }

  function wakeScanWaiters() {
    const list = Array.from(scanWaiters);
    scanWaiters.clear();
    for (let i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (_) {}
    }
  }

  function beginScanGeneration() {
    scanGeneration += 1;
    wakeScanWaiters();
    scanBound = scanGeneration;
    activeScanToken = scanGeneration;
    suppressScanStatus = false;
    return scanGeneration;
  }

  function abortScanGeneration() {
    if (!scanBound || scanBound !== scanGeneration) return false;
    scanGeneration += 1;
    wakeScanWaiters();
    return true;
  }

  function endScanGeneration(token) {
    if (scanBound === token) scanBound = 0;
  }

  function throwIfScanAborted() {
    if (activeScanToken && activeScanToken !== scanGeneration) throw scanAbortError();
  }

  function bindScanAbort(fn) {
    if (!scanBound || scanBound !== scanGeneration) {
      try {
        fn();
      } catch (_) {}
      return function () {};
    }
    const wrapped = () => {
      scanWaiters.delete(wrapped);
      try {
        fn();
      } catch (_) {}
    };
    scanWaiters.add(wrapped);
    return function () {
      scanWaiters.delete(wrapped);
    };
  }

  function sleep(ms) {
    const token = scanBound;
    if (!token) return new Promise((r) => setTimeout(r, ms));
    return new Promise((resolve, reject) => {
      if (token !== scanGeneration) {
        reject(scanAbortError());
        return;
      }
      let timer = null;
      const wake = () => {
        if (timer != null) clearTimeout(timer);
        scanWaiters.delete(wake);
        reject(scanAbortError());
      };
      scanWaiters.add(wake);
      timer = setTimeout(() => {
        scanWaiters.delete(wake);
        if (token !== scanGeneration) reject(scanAbortError());
        else resolve();
      }, ms);
    });
  }

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatTrtDisplay(date = new Date()) {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function parseRelativeToDate(appliedAt, now = new Date()) {
    const P = globalThis.BasvuruTrackerParse;
    if (P && P.parseRelativeToDate) return P.parseRelativeToDate(appliedAt, now);
    if (!appliedAt) return null;
    const s = appliedAt.toLowerCase();
    const m = s.match(/(\d+)\s*(dakika|saat|g\u00fcn|hafta|ay|y\u0131l)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const d = new Date(now.getTime());
    if (unit.startsWith('dakika')) d.setMinutes(d.getMinutes() - n);
    else if (unit.startsWith('saat')) d.setHours(d.getHours() - n);
    else if (unit.startsWith('g\u00fcn')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('hafta')) d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('ay')) d.setMonth(d.getMonth() - n);
    else if (unit.startsWith('y\u0131l')) d.setFullYear(d.getFullYear() - n);
    else return null;
    return d;
  }

  /** Relative age in hours (smaller = more recent). */
  function relativeAgeHours(text) {
    if (globalThis.BasvuruStatus) return globalThis.BasvuruStatus.ageHours(text);
    if (!text) return 1e12;
    const s = String(text).toLowerCase();
    const m = s.match(/(\d+)\s*(dakika|saat|g\u00fcn|hafta|ay|y\u0131l)/i);
    if (!m) return 1e9;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit.startsWith('dakika')) return n / 60;
    if (unit.startsWith('saat')) return n;
    if (unit.startsWith('g\u00fcn')) return n * 24;
    if (unit.startsWith('hafta')) return n * 24 * 7;
    if (unit.startsWith('ay')) return n * 24 * 30;
    if (unit.startsWith('y\u0131l')) return n * 24 * 365;
    return 1e9;
  }

  function detectApplicationViewed(blob) {
    if (globalThis.BasvuruStatus) return globalThis.BasvuruStatus.detectApplicationViewed(blob);
    const s = String(blob || '');
    if (/g\u00f6r\u00fcnt\u00fclenmeden|bak\u0131lmadan/i.test(s)) return false;
    return (
      /ba\u015fvuru(?:nuz)?\s+g\u00f6r\u00fcnt\u00fclendi(?!\w)/i.test(s) ||
      /application\s+viewed/i.test(s)
    );
  }

  function detectCvDownloaded(blob) {
    if (globalThis.BasvuruStatus) return globalThis.BasvuruStatus.detectCvDownloaded(blob);
    const s = String(blob || '');
    return (
      /\u00f6zge\u00e7mi\u015f(?:iniz)?\s+indirildi/i.test(s) ||
      /\bcv\s+indirildi/i.test(s) ||
      /resume\s+downloaded/i.test(s)
    );
  }

  function parseWorkTypeAndLocation(raw) {
    if (!raw) return { location: null, workType: null };
    let s = String(raw).replace(/\s+/g, ' ').trim();
    let workType = null;
    const wt = s.match(/\(([^)]*(?:Uzaktan|Hybrid|Hibrit|\u0130\u015f yerinde|Remote|On-?site|Hybrid)[^)]*)\)/i);
    if (wt) {
      workType = wt[1].trim();
      s = s.replace(wt[0], '').trim();
    }
    return { location: s || null, workType };
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
      t.includes(CLOSED_PHRASE) ||
      /no longer (accepting|taking) applications/i.test(t) ||
      /^(Evet|Hay\u0131r|Yes|No)$/i.test(t)
    );
  }

  function hasCompanySep(t) {
    return COMPANY_SEP_RE.test(t);
  }

  function stripTitlePrefixFromCompany(jobTitle, company) {
    if (!company) return null;
    const c = String(company).replace(/\s+/g, ' ').trim();
    const t = (jobTitle || '').replace(/\s+/g, ' ').trim();
    if (!t || isMetaLeaf(t)) return c;
    if (c === t) return null;
    if (c.startsWith(t + ' ')) return c.slice(t.length + 1).trim() || null;
    if (c.startsWith(t) && c.length > t.length) return c.slice(t.length).trim() || null;
    return c;
  }

  function companyFromLogo(logo) {
    if (!logo) return null;
    const alt = String(logo.alt || logo.getAttribute?.('alt') || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!alt || alt.length < 2 || alt.length > 140) return null;
    if (/^(logo|image|photo|avatar)$/i.test(alt)) return null;
    return alt.replace(/\s+logo$/i, '').trim() || null;
  }

  function imgSrcCandidates(img) {
    if (!img) return [];
    return [
      img.currentSrc,
      img.src,
      img.getAttribute?.('src'),
      img.getAttribute?.('data-delayed-url'),
      img.getAttribute?.('data-src'),
      img.getAttribute?.('data-ghost-url'),
    ]
      .map((raw) => String(raw || '').trim())
      .filter(Boolean);
  }

  function isRealCompanyLogoUrl(url) {
    const s = String(url || '').trim();
    if (!s || s.startsWith('data:')) return false;
    if (/profile-displayphoto|profile-framedphoto|ghost-person/i.test(s)) return false;
    return /company-logo/i.test(s);
  }

  function pickCompanyLogoUrl(img) {
    if (!img) return null;
    for (const s of imgSrcCandidates(img)) {
      if (isRealCompanyLogoUrl(s)) return s;
    }
    return null;
  }

  function isInConnectionsArea(img, row) {
    if (!img || !row) return false;
    let n = img;
    while (n && n !== row) {
      const aria = String(n.getAttribute?.('aria-label') || '');
      const cls = String(n.className || '');
      if (/ba\u011flant|connect/i.test(aria + ' ' + cls)) return true;
      n = n.parentElement;
    }
    const cells = [...row.querySelectorAll('[role="gridcell"], td')];
    if (cells.length >= 2) {
      const idx = cells.findIndex((c) => c.contains(img));
      if (idx >= Math.max(0, cells.length - 2)) {
        const cell = cells[idx];
        const text = String(cell.innerText || '');
        if (/\+\d+/.test(text) || /ba\u011flant/i.test(text)) return true;
        if (cell.querySelectorAll('img').length > 1) return true;
        for (const s of imgSrcCandidates(img)) {
          if (/profile-displayphoto|profile-framedphoto|ghost-person/i.test(s)) return true;
        }
      }
    }
    return false;
  }

  function findCompanyLogo(a, row) {
    const scopes = [];
    const cell =
      a.closest('[role="gridcell"]') || a.closest('td') || a.closest('li') || null;
    if (cell) scopes.push(cell);
    scopes.push(a);
    const wrap = a.parentElement;
    if (wrap) {
      scopes.push(wrap);
      let sib = wrap.previousElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) scopes.push(sib);
      if (wrap.parentElement) {
        scopes.push(wrap.parentElement);
        let ps = wrap.parentElement.previousElementSibling;
        for (let i = 0; i < 2 && ps; i++, ps = ps.previousElementSibling) scopes.push(ps);
      }
    }

    const seenImg = new Set();
    const tryScope = (scope) => {
      if (!scope) return null;
      const imgs =
        scope.tagName === 'IMG' ? [scope] : [...scope.querySelectorAll('img')];
      for (const img of imgs) {
        if (seenImg.has(img)) continue;
        seenImg.add(img);
        if (row && !row.contains(img)) continue;
        if (isInConnectionsArea(img, row)) continue;
        const url = pickCompanyLogoUrl(img);
        if (url) return { img, url };
      }
      return null;
    };

    for (const scope of scopes) {
      const hit = tryScope(scope);
      if (hit) return hit;
    }

    if (row) {
      for (const img of row.querySelectorAll('img')) {
        if (isInConnectionsArea(img, row)) continue;
        const url = pickCompanyLogoUrl(img);
        if (url) return { img, url };
      }
    }
    return { img: null, url: null };
  }

  function scrubCrossCompanyLogos(apps) {
    const byUrl = new Map();
    for (const a of apps || []) {
      if (!a) continue;
      if (a.companyLogoUrl && !isRealCompanyLogoUrl(a.companyLogoUrl)) {
        a.companyLogoUrl = null;
        continue;
      }
      const u = a.companyLogoUrl;
      if (!u) continue;
      const name = reportCompanyName(a);
      if (!byUrl.has(u)) byUrl.set(u, new Set());
      byUrl.get(u).add(name);
    }
    const bad = new Set();
    for (const [u, names] of byUrl) {
      if (names.size >= 3) bad.add(u);
    }
    if (!bad.size) return;
    for (const a of apps) {
      if (a.companyLogoUrl && bad.has(a.companyLogoUrl)) a.companyLogoUrl = null;
    }
  }

  function resolveGroupLogo(apps) {
    const list = apps || [];
    const counts = new Map();
    for (const a of list) {
      const u = a && a.companyLogoUrl;
      if (!u || !isRealCompanyLogoUrl(u)) continue;
      counts.set(u, (counts.get(u) || 0) + 1);
    }
    if (!counts.size) return null;
    return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  }

  function pageShowsNoMatches() {
    if (jobLinksOnPage().length > 0) return false;
    const root = getScrapeDoc();
    const text = (root.body && (root.body.innerText || root.body.textContent)) || '';
    return /e\u015fle\u015fme yok|no matches|no matching jobs|no results found/i.test(text);
  }

  function jobLinksOnPage() {
    const seen = new Set();
    const out = [];
    const root = getScrapeDoc();
    for (const a of root.querySelectorAll('a[href*="/jobs/view/"]')) {
      const m = a.href.match(/\/jobs\/view\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(a);
    }
    return out;
  }

  function jobIdFromHref(href) {
    const m = String(href || '').match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : null;
  }

  /** Smallest ancestor that contains exactly this job link (no neighbor cards). */
  function findTrackerRow(anchor) {
    if (!anchor) return null;
    const wantId = jobIdFromHref(anchor.href);
    let best = null;
    let el = anchor;
    for (let depth = 0; depth < 12 && el; depth++, el = el.parentElement) {
      if (!el || el === document.documentElement || el === document.body) break;
      const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/jobs/view/"]') : [];
      const ids = new Set();
      for (let i = 0; i < links.length; i++) {
        const id = jobIdFromHref(links[i].href);
        if (id) ids.add(id);
      }
      if (wantId && ids.size > 1) break;
      if (wantId && ids.size === 1 && ids.has(wantId)) {
        best = el;
        if (el.getAttribute && el.getAttribute('role') === 'row') return el;
        if (el.tagName === 'LI') return el;
      } else if (!wantId && ids.size <= 1) {
        best = el;
      }
    }
    if (best) return best;
    return (
      anchor.closest('[role="row"]') ||
      anchor.closest('li') ||
      anchor.parentElement
    );
  }

  /** Status-ish leaf texts from a single row scope only. */
  function collectStatusLeaves(scope) {
    if (!scope) return [];
    const out = [];
    const nodes = scope.querySelectorAll('div,span,p,a,li,button');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.children && el.children.length > 3) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length < 2 || t.length > 180) continue;
      if (
        !/(?:cv|\u00f6zge\u00e7mi\u015f|resume|g\u00f6r\u00fcnt\u00fcle|indirildi|downloaded|g\u00f6ster|ba\u015fvuru\s+g\u00f6nderildi|application\s+(?:sent|viewed)|viewed)/i.test(
          t
        )
      ) {
        continue;
      }
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  function parseDomCard(a) {
    const jobId = jobIdFromHref(a.href);
    const jobUrl = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : a.href;
    const row = findTrackerRow(a);

    // Prefer this row's text only — never a parent that spans multiple job cards.
    let blob = '';
    if (row) {
      blob = (row.innerText || '').replace(/\s+/g, ' ').trim();
    }
    if (!blob) {
      blob = (a.innerText || '').replace(/\s+/g, ' ').trim();
    }

    const statusLeaves = collectStatusLeaves(row || a);
    // Include full row blob so "Başvuru görüntülendi" under the applied line is seen.
    const rawStatus =
      statusLeaves.length > 0
        ? statusLeaves.join(' \u00b7 ')
        : blob.slice(0, 500) || null;
    const statusHay = [rawStatus, blob].filter(Boolean).join(' \u00b7 ');

    const signals =
      globalThis.BasvuruTrackerParse && globalThis.BasvuruTrackerParse.parseTrackerRowText
        ? globalThis.BasvuruTrackerParse.parseTrackerRowText(statusHay)
        : null;

    // SDUI: title / "company \u00b7 location" / applied / posted are separate leaf texts
    const leafRoot = row || a;
    const leaves = [...leafRoot.querySelectorAll('div,span,p')]
      .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const uniqLeaves = [];
    for (const t of leaves) {
      if (!uniqLeaves.includes(t) && t.length < 220) uniqLeaves.push(t);
    }

    let jobTitle =
      uniqLeaves.find(
        (t) =>
          !hasCompanySep(t) &&
          !isMetaLeaf(t) &&
          t.length > 2
      ) || null;

    // Prefer a separator line that does not start with the job title (parent nodes often mash both).
    const sepLines = uniqLeaves.filter((t) => hasCompanySep(t) && !isMetaLeaf(t));
    let companyLine =
      (jobTitle && sepLines.find((t) => !t.startsWith(jobTitle) && !t.startsWith(jobTitle.replace(/\s+/g, '')))) ||
      (jobTitle && sepLines.find((t) => !t.includes(jobTitle))) ||
      [...sepLines].sort((x, y) => x.length - y.length)[0] ||
      null;

    let company = null;
    let locationRaw = null;
    if (companyLine) {
      const parts = companyLine.split(COMPANY_SEP_RE);
      company = (parts[0] || '').trim() || null;
      locationRaw = (parts.slice(1).join(' \u00b7 ') || '').trim() || null;
    }

    // Company and location as separate leaves (no middot line): take them in order after the title.
    if (!companyLine) {
      const P = globalThis.BasvuruTrackerParse;
      const titleIdx = jobTitle ? uniqLeaves.indexOf(jobTitle) : -1;
      const after = uniqLeaves
        .slice(titleIdx + 1)
        .filter(
          (t) =>
            t !== jobTitle &&
            !(jobTitle && t.includes(jobTitle)) &&
            !isMetaLeaf(t) &&
            !/^(?:Yan\u0131t ald\u0131n\u0131z m\u0131\??|Not ekle|\+\s*Not ekle|\+\d+)$/i.test(t) &&
            t.length <= 100
        );
      for (const t of after) {
        if (P && P.isLocationLike && P.isLocationLike(t)) {
          if (!locationRaw) locationRaw = t;
        } else if (!company) {
          company = t;
        }
        if (company && locationRaw) break;
      }
    }

    const appliedLeaf = uniqLeaves.find((t) => /\u00f6nce\s+ba\u015fvurdu/i.test(t));
    const appliedM =
      (appliedLeaf &&
        appliedLeaf.match(/(\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce(?:\s+ba\u015fvurdu)?)/i)) ||
      blob.match(/(\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce(?:\s+ba\u015fvurdu)?)/i);

    let appliedAt = signals && signals.appliedAt ? signals.appliedAt : null;
    if (!appliedAt && appliedM) appliedAt = appliedM[1].replace(/\s+/g, ' ').trim();

    let publishedAt = signals ? signals.publishedAt : null;
    let postingStatus = signals ? signals.postingStatus : null;
    let applicationViewed = signals
      ? signals.applicationViewed
      : detectApplicationViewed(statusHay);
    let cvDownloaded = signals ? signals.cvDownloaded : detectCvDownloaded(statusHay);
    const closed = signals
      ? signals.closed
      : blob.includes(CLOSED_PHRASE) || /no longer (accepting|taking) applications/i.test(blob);

    if (!postingStatus) {
      if (closed) postingStatus = CLOSED_PHRASE;
      else if (publishedAt) postingStatus = publishedAt;
    }

    if (!jobTitle) {
      const head = appliedM ? blob.slice(0, appliedM.index).trim() : blob;
      jobTitle = head.split(COMPANY_SEP_RE)[0] || head || null;
      if (jobTitle && isMetaLeaf(jobTitle)) jobTitle = null;
      if (
        jobTitle &&
        globalThis.BasvuruTrackerParse &&
        globalThis.BasvuruTrackerParse.isLocationLike &&
        globalThis.BasvuruTrackerParse.isLocationLike(jobTitle)
      ) {
        jobTitle = null;
      }
    }

    company = stripTitlePrefixFromCompany(jobTitle, company);

    const foundLogo = findCompanyLogo(a, row);
    const logo = foundLogo.img;
    const companyLogoUrl = foundLogo.url;
    const logoCompany = companyFromLogo(logo);
    let ariaCompany = null;
    let companySlug = null;
    if (row) {
      const coHref = row.querySelector('a[href*="/company/"], a[href*="/showcase/"]');
      const slugM = coHref && String(coHref.getAttribute('href') || '').match(/\/(?:company|showcase)\/([^/?#]+)/i);
      if (slugM) {
        try {
          companySlug = decodeURIComponent(slugM[1]).toLowerCase();
        } catch (_) {
          companySlug = slugM[1].toLowerCase();
        }
      }
      const coLink =
        row.querySelector('a[href*="/company/"]') ||
        row.querySelector('[aria-label*="logo" i], img[alt]');
      if (coLink) {
        ariaCompany =
          (coLink.getAttribute && coLink.getAttribute('aria-label')) ||
          (coLink.alt || '') ||
          null;
        if (ariaCompany) ariaCompany = String(ariaCompany).replace(/\s+logo$/i, '').trim();
      }
    }

    let location = null;
    let workType = null;
    const parsedLoc = parseWorkTypeAndLocation(locationRaw);
    location = parsedLoc.location;
    workType = parsedLoc.workType;

    if (globalThis.BasvuruTrackerParse && globalThis.BasvuruTrackerParse.resolveCompanyAndLocation) {
      const resolved = globalThis.BasvuruTrackerParse.resolveCompanyAndLocation({
        company: company,
        location: location,
        workType: workType,
        logoCompany: logoCompany,
        ariaCompany: ariaCompany,
      });
      company = resolved.company;
      location = resolved.location;
      workType = resolved.workType || workType;
    } else {
      if (!company && logoCompany) company = logoCompany;
      else if (
        company &&
        logoCompany &&
        jobTitle &&
        company.toLowerCase().includes(jobTitle.toLowerCase()) &&
        !logoCompany.toLowerCase().includes(jobTitle.toLowerCase())
      ) {
        company = logoCompany;
      }
    }

    let response = 'unknown';
    if (row) {
      const pressed = row.querySelector('button[aria-pressed="true"]');
      if (pressed) {
        const t = (pressed.textContent || '').trim().toLowerCase();
        if (t === 'evet' || t === 'yes') response = 'yes';
        if (t === 'no' || t === 'hay\u0131r') response = 'no';
      }
    }

    const mapped = {
      jobTitle,
      company,
      location,
      workType,
      appliedAt,
      postingStatus,
      publishedAt,
      response,
      applicationViewed,
      cvDownloaded,
      rawStatus,
      companyLogoUrl,
      companySlug,
      jobUrl,
      jobId,
    };
    if (globalThis.BasvuruStatus) {
      return globalThis.BasvuruStatus.enrichApplication(mapped);
    }
    mapped.repostedWithoutView = false;
    return mapped;
  }

  function buttonLabelParts(b) {
    const aria = (b.getAttribute('aria-label') || '').trim();
    const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
    return { aria, text, label: aria || text };
  }

  function isControlDisabled(b) {
    if (!b) return true;
    return (
      !!b.disabled ||
      b.getAttribute('aria-disabled') === 'true' ||
      b.getAttribute('disabled') != null
    );
  }

  /** All clickable pagination-like controls (button, a, [role=button]). */
  function collectPaginationControls() {
    const root = getScrapeDoc();
    const nodes = [
      ...root.querySelectorAll('button'),
      ...root.querySelectorAll('a'),
      ...root.querySelectorAll('[role="button"]'),
    ];
    const seen = new Set();
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (seen.has(el)) continue;
      seen.add(el);
      const { aria, text, label } = buttonLabelParts(el);
      out.push({
        el: el,
        label: label,
        text: text,
        aria: aria,
        disabled: isControlDisabled(el),
        ariaDisabled: el.getAttribute('aria-disabled'),
      });
    }
    return out;
  }

  function findPrevPageButton(includeDisabled) {
    const buttons = collectPaginationControls();
    return (
      buttons.find((c) => {
        if (!includeDisabled && c.disabled) return false;
        const either = c.label || c.text;
        return (
          either === 'Geri' ||
          c.text === 'Geri' ||
          /^Previous$/i.test(either) ||
          (either.length <= 10 && /^geri$/i.test(either))
        );
      }) || null
    );
  }

  function findPageNumberButton(n) {
    const P = globalThis.BasvuruTrackerPaginate;
    const controls = collectPaginationControls();
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.disabled) continue;
      if (P && P.isPageNumberLabel(c.label, c.text, n)) return c.el;
      if (!P && String((c.text || '').trim()) === String(n)) return c.el;
    }
    return null;
  }

  /**
   * Scroll the job list (or window) to the bottom so LinkedIn mounts pagination / load-more.
   */
  async function scrollListToBottom() {
    const root = getScrapeDoc();
    const candidates = [
      root.querySelector('.scaffold-layout__list'),
      root.querySelector('.jobs-search-results-list'),
      root.querySelector('[role="main"]'),
      root.querySelector('.jobs-tracker'),
      root.scrollingElement || root.documentElement,
    ].filter(Boolean);

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      try {
        if (typeof el.scrollTo === 'function') {
          el.scrollTo({ top: el.scrollHeight || 999999, behavior: 'auto' });
        } else {
          el.scrollTop = el.scrollHeight || 999999;
        }
      } catch (_) {
        try {
          el.scrollTop = 999999;
        } catch (_) {}
      }
    }
    try {
      window.scrollTo(0, document.body.scrollHeight || 999999);
    } catch (_) {}
    const lastLink = jobLinksOnPage().slice(-1)[0];
    if (lastLink && typeof lastLink.scrollIntoView === 'function') {
      try {
        lastLink.scrollIntoView({ block: 'end', inline: 'nearest' });
      } catch (_) {}
    }
    await sleep(500);
  }

  /**
   * Resolve next pagination action. Scroll + retry so controls that mount late are found.
   * Returns { el, type } or null.
   */
  async function resolveNextPagination(opts) {
    const P = globalThis.BasvuruTrackerPaginate;
    const currentPage = getActivePageNumber();
    const attempts = (opts && opts.attempts) || 4;
    const root = getScrapeDoc();

    for (let attempt = 0; attempt < attempts; attempt++) {
      await scrollListToBottom();

      // Fast path: LinkedIn aria-labels (TR + EN), including labels that appear only after scroll.
      const ariaSelectors = [
        'button[aria-label="\u0130leri"]',
        'button[aria-label="Ileri"]',
        'button[aria-label="Next"]',
        'button[aria-label="Sonraki"]',
        'button[aria-label*="Next page" i]',
        'button[aria-label*="next page" i]',
        'button[aria-label*="Go to next" i]',
        '[role="button"][aria-label="\u0130leri"]',
        '[role="button"][aria-label="Next"]',
        'a[aria-label="\u0130leri"]',
        'a[aria-label="Next"]',
      ];
      for (let si = 0; si < ariaSelectors.length; si++) {
        let el = null;
        try {
          el = root.querySelector(ariaSelectors[si]);
        } catch (_) {
          el = null;
        }
        if (el && !isControlDisabled(el)) {
          return { el: el, type: 'next' };
        }
      }

      // Numbered page: aria-label^="Sayfa " / "Page "
      const want = currentPage != null ? currentPage + 1 : 2;
      const pageAria = [
        'button[aria-label="Sayfa ' + want + '"]',
        'button[aria-label="Page ' + want + '"]',
        'button[aria-label^="Sayfa ' + want + '"]',
        'button[aria-label^="Page ' + want + '"]',
        '[role="button"][aria-label="Sayfa ' + want + '"]',
        '[role="button"][aria-label="Page ' + want + '"]',
      ];
      for (let pi = 0; pi < pageAria.length; pi++) {
        let el = null;
        try {
          el = root.querySelector(pageAria[pi]);
        } catch (_) {
          el = null;
        }
        if (el && !isControlDisabled(el)) {
          return { el: el, type: 'page', page: want };
        }
      }

      // Load more
      const loadMoreSel = [
        'button[aria-label*="Daha fazla" i]',
        'button[aria-label*="Show more" i]',
        'button[aria-label*="Load more" i]',
      ];
      for (let li = 0; li < loadMoreSel.length; li++) {
        let el = null;
        try {
          el = root.querySelector(loadMoreSel[li]);
        } catch (_) {
          el = null;
        }
        if (el && !isControlDisabled(el)) {
          return { el: el, type: 'loadMore' };
        }
      }

      const controls = collectPaginationControls();
      let action = null;
      if (P && P.pickPaginationAction) {
        action = P.pickPaginationAction(controls, { currentPage: currentPage });
      } else {
        const next = controls.find(
          (c) =>
            !c.disabled &&
            (c.label === '\u0130leri' ||
              c.text === '\u0130leri' ||
              /^Next$/i.test(c.label || '') ||
              /^Next$/i.test(c.text || ''))
        );
        if (next) action = { type: 'next', control: next };
      }

      if (action && action.control && action.control.el) {
        return { el: action.control.el, type: action.type, page: action.page };
      }

      // Fallback: classic İleri-only (matches scrape-console.js)
      const buttons = [...root.querySelectorAll('button')];
      const ileri = buttons.find((b) => {
        if (isControlDisabled(b)) return false;
        const aria = (b.getAttribute('aria-label') || '').trim();
        const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
        const label = aria || text;
        return (
          label === '\u0130leri' ||
          text === '\u0130leri' ||
          label === 'Ileri' ||
          /^Next$/i.test(label) ||
          (label.length <= 10 && /leri$/i.test(label) && !/sayfa|Ana/i.test(label))
        );
      });
      if (ileri) return { el: ileri, type: 'next' };

      const pageBtn = findPageNumberButton(want);
      if (pageBtn && !isControlDisabled(pageBtn)) {
        return { el: pageBtn, type: 'page', page: want };
      }

      // Text-content load more (TR/EN)
      const loadMoreText = buttons.find((b) => {
        if (isControlDisabled(b)) return false;
        const { label, text } = buttonLabelParts(b);
        if (P && P.isLoadMoreLabel) return P.isLoadMoreLabel(label, text);
        return /daha fazla|show more|load more/i.test(label || text);
      });
      if (loadMoreText) return { el: loadMoreText, type: 'loadMore' };

      await sleep(450);
    }
    return null;
  }

  /**
   * Infinite-scroll / virtualized list: scroll until job link count stops growing.
   * Returns number of new unique rows added into `all`/`seen`.
   */
  async function growByScrolling(all, seen, onItem, page, onStatus) {
    let stagnantScrolls = 0;
    let addedTotal = 0;
    for (let i = 0; i < 8; i++) {
      throwIfScanAborted();
      const beforeCount = jobLinksOnPage().length;
      const beforeSig = listSignature();
      await scrollListToBottom();
      await sleep(700);
      const afterCount = jobLinksOnPage().length;
      const afterSig = listSignature();
      if (afterCount <= beforeCount && afterSig === beforeSig) {
        stagnantScrolls += 1;
        if (stagnantScrolls >= 3) break;
        continue;
      }
      stagnantScrolls = 0;
      const links = jobLinksOnPage();
      let added = 0;
      for (const a of links) {
        let row;
        try {
          row = parseDomCard(a);
        } catch (_) {
          continue;
        }
        if (!row.jobTitle && !row.jobId) continue;
        const key = rowDedupeKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
        added += 1;
        addedTotal += 1;
        if (onItem) onItem(row, { page, count: all.length });
      }
      if (onStatus) {
        onStatus(page + '. sayfa taran\u0131yor \u00b7 ' + all.length + ' ba\u015fvuru', {
          page,
          count: all.length,
          pct: progressPctForPage(page, all.length, null),
        });
      }
      if (added === 0 && afterCount <= beforeCount) {
        stagnantScrolls += 1;
        if (stagnantScrolls >= 3) break;
      }
    }
    return addedTotal;
  }

  function paginationAnchor() {
    const prev = findPrevPageButton(true);
    return (prev && prev.el) || null;
  }

  function isNearPagination(el, anchor) {
    if (!el || !anchor) return false;
    let a = el;
    for (let i = 0; i < 12 && a; i++, a = a.parentElement) {
      if (a.contains(anchor)) return true;
    }
    let b = anchor;
    for (let i = 0; i < 12 && b; i++, b = b.parentElement) {
      if (b.contains(el)) return true;
    }
    return false;
  }

  function isPageButtonCurrent(b) {
    if (!b) return false;
    return (
      b.getAttribute('aria-current') === 'page' ||
      b.getAttribute('aria-pressed') === 'true' ||
      b.getAttribute('aria-selected') === 'true' ||
      (b.className && /active|selected|current/i.test(String(b.className)))
    );
  }

  function pageNumberFromEl(el) {
    if (!el) return null;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^\d+$/.test(text)) {
      const n = parseInt(text, 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    }
    const aria = (el.getAttribute('aria-label') || '').trim();
    const m = aria.match(/(?:sayfa|page)\s*(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    }
    return null;
  }

  function getActivePageNumber() {
    const root = getScrapeDoc();
    const anchor = paginationAnchor();
    const currentEls = [...root.querySelectorAll('[aria-current="page"], [aria-pressed="true"], [aria-selected="true"]')];
    for (const el of currentEls) {
      if (anchor && !isNearPagination(el, anchor)) continue;
      const n = pageNumberFromEl(el);
      if (n != null) return n;
    }
    const buttons = [...root.querySelectorAll('button, [role="button"]')];
    for (const b of buttons) {
      if (anchor && !isNearPagination(b, anchor)) continue;
      if (!isPageButtonCurrent(b)) continue;
      const n = pageNumberFromEl(b);
      if (n != null) return n;
    }
    if (anchor) {
      let node = anchor;
      for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
        const cur = node.querySelector('[aria-current="page"]');
        if (cur) {
          const n = pageNumberFromEl(cur);
          if (n != null) return n;
        }
      }
    }
    return null;
  }

  function firstJobHref() {
    const links = jobLinksOnPage();
    return links[0] && links[0].href;
  }

  /** Stable list fingerprint: page number + all job ids (not just first href). */
  function listSignature() {
    const ids = jobLinksOnPage()
      .map((a) => jobIdFromHref(a.href))
      .filter(Boolean);
    const active = getActivePageNumber();
    return (active != null ? 'p' + active + ':' : 'p?:') + ids.join(',');
  }

  function progressPctForPage(page, collected, totalExpected) {
    if (totalExpected && totalExpected > 0 && collected != null) {
      return Math.min(92, Math.round(8 + 84 * (Number(collected) / totalExpected)));
    }
    const p = Math.max(0, Number(page) || 0);
    return Math.min(92, Math.round(8 + 84 * (1 - Math.exp(-p / 12))));
  }

  function hydrateApi() {
    return globalThis.BasvuruTrackerHydrate || null;
  }

  /** Tracker chip: "Başvuruldu · 683" / "Applied · N". */
  function readAppliedTrackerCount() {
    const H = hydrateApi();
    const root = getScrapeDoc();
    const nodes = root.querySelectorAll('[role="radio"], button, a, span, div, label');
    let best = null;
    for (let i = 0; i < nodes.length; i++) {
      const t = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 40) continue;
      if (!/Ba\u015fvuruldu|Applied/i.test(t)) continue;
      const n = H
        ? H.parseAppliedCountFromChipText(t)
        : (function () {
            const m = t.match(/(?:Ba\u015fvuruldu|Applied)\s*[·•.\-]?\s*(\d+)/i);
            return m ? parseInt(m[1], 10) : null;
          })();
      if (n != null && n > 0 && (best == null || n > best)) best = n;
    }
    return best;
  }

  function getListRoots() {
    const root = getScrapeDoc();
    return [
      root.querySelector('.scaffold-layout__list'),
      root.querySelector('.jobs-search-results-list'),
      root.querySelector('[role="main"]'),
      root.querySelector('.jobs-tracker'),
      root.scrollingElement || root.documentElement,
    ].filter(Boolean);
  }

  async function scrollListToTop() {
    const roots = getListRoots();
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      try {
        if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, behavior: 'auto' });
        else el.scrollTop = 0;
      } catch (_) {
        try {
          el.scrollTop = 0;
        } catch (_) {}
      }
    }
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
    const first = jobLinksOnPage()[0];
    if (first && typeof first.scrollIntoView === 'function') {
      try {
        first.scrollIntoView({ block: 'start', inline: 'nearest' });
      } catch (_) {}
    }
    await sleep(200);
  }

  async function scrollListByStep(fraction) {
    const frac = fraction != null ? fraction : 0.55;
    const roots = getListRoots();
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      try {
        const h = el.clientHeight || 400;
        const next = (el.scrollTop || 0) + h * frac;
        if (typeof el.scrollTo === 'function') el.scrollTo({ top: next, behavior: 'auto' });
        else el.scrollTop = next;
      } catch (_) {}
    }
    try {
      window.scrollBy(0, Math.round((window.innerHeight || 600) * frac));
    } catch (_) {}
    await sleep(150);
  }

  function describeRowEl(el) {
    if (!el) {
      return { looksLikeRow: false, hasJobLink: false, hasJobTitleText: false };
    }
    const className = String(el.className || (el.getAttribute && el.getAttribute('class')) || '');
    const link = el.querySelector && el.querySelector('a[href*="/jobs/view/"]');
    const hasJobLink = !!link;
    let hasJobTitleText = false;
    if (link) {
      const t = (link.textContent || '').replace(/\s+/g, ' ').trim();
      hasJobTitleText = t.length >= 2 && !/^https?:/i.test(t);
    }
    let skeletonChild = false;
    let emptyGrey = false;
    try {
      if (el.querySelector) {
        skeletonChild = !!el.querySelector(
          '[class*="skeleton"], [class*="ghost"], [class*="shimmer"], [class*="placeholder"], .artdeco-loader'
        );
        const blanks = el.querySelectorAll
          ? el.querySelectorAll('[class*="skeleton"], [class*="ghost"], [class*="placeholder"]')
          : [];
        emptyGrey = blanks.length >= 2 && !hasJobTitleText;
      }
    } catch (_) {}
    return {
      className: className,
      hasJobLink: hasJobLink,
      hasJobTitleText: hasJobTitleText,
      looksLikeRow: true,
      skeletonChild: skeletonChild,
      emptyGrey: emptyGrey,
    };
  }

  function collectCandidateRows() {
    const root = getScrapeDoc();
    const main =
      root.querySelector('.scaffold-layout__list') ||
      root.querySelector('[role="main"]') ||
      root.querySelector('.jobs-tracker') ||
      root.body ||
      root;
    const seen = new Set();
    const out = [];
    const push = (el) => {
      if (!el || seen.has(el)) return;
      // Prefer outermost list items — skip nested skeleton chips inside a row
      for (let i = 0; i < out.length; i++) {
        if (out[i].contains && out[i].contains(el)) return;
        if (el.contains && el.contains(out[i])) {
          seen.delete(out[i]);
          out.splice(i, 1);
          i -= 1;
        }
      }
      seen.add(el);
      out.push(el);
    };

    const primary = [
      '[role="row"]',
      'li.scaffold-layout__list-item',
      'li.jobs-search-results__list-item',
      'ul.scaffold-layout__list > li',
      '[data-job-id]',
    ];
    for (let s = 0; s < primary.length; s++) {
      let nodes = [];
      try {
        nodes = main.querySelectorAll(primary[s]);
      } catch (_) {
        nodes = [];
      }
      for (let i = 0; i < nodes.length; i++) push(nodes[i]);
    }

    const links = jobLinksOnPage();
    for (let i = 0; i < links.length; i++) {
      const row = findTrackerRow(links[i]);
      if (row) push(row);
    }

    // Fallback: skeleton-looking blocks only if we barely found rows
    if (out.length < 3) {
      let sk = [];
      try {
        sk = main.querySelectorAll(
          '[class*="jobs-skeleton"], [class*="skeleton-entity"], [class*="artdeco-ghost"]'
        );
      } catch (_) {
        sk = [];
      }
      for (let i = 0; i < sk.length && out.length < 12; i++) {
        const el = sk[i];
        // Climb to a plausible row container
        let row = el;
        for (let d = 0; d < 6 && row; d++, row = row.parentElement) {
          if (row.getAttribute && row.getAttribute('role') === 'row') break;
          if (row.tagName === 'LI') break;
        }
        if (row) push(row);
      }
    }
    return out;
  }

  function countSkeletonRows() {
    const H = hydrateApi();
    const rows = collectCandidateRows();
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      const d = describeRowEl(rows[i]);
      if (H ? H.isSkeletonRowDescriptor(d) : d.hasJobLink === false || d.skeletonChild) n += 1;
    }
    return n;
  }

  function harvestLinksIntoMap(pageMap, pageIndex) {
    const H = hydrateApi();
    const P = globalThis.BasvuruTrackerParse;
    const links = jobLinksOnPage();
    let added = 0;
    for (let i = 0; i < links.length; i++) {
      let row;
      try {
        row = parseDomCard(links[i]);
      } catch (_) {
        continue;
      }
      if (!row || (!row.jobTitle && !row.jobId)) continue;
      if (pageIndex != null) row._pageIndex = pageIndex;
      const before = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (H) H.mergeHydratedRow(pageMap, row);
      else {
        const key = row.jobId ? 'id:' + row.jobId : 'url:' + row.jobUrl;
        pageMap[key] = Object.assign({}, pageMap[key] || {}, row);
      }
      const after = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (after > before) added += 1;
    }

    // Rows without job links (deleted postings): keep with synthetic key
    const candidates = collectCandidateRows();
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const d = describeRowEl(el);
      if (d.hasJobLink) continue;
      if (H && H.isSkeletonRowDescriptor(d)) continue;
      if (!H && (d.skeletonChild || !d.looksLikeRow)) continue;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 12) continue;
      const signals = P && P.parseTrackerRowText ? P.parseTrackerRowText(text) : null;
      const leaves = text
        .split(/(?=\d+\s+(?:dakika|saat|g\u00fcn|hafta|ay|y\u0131l)\s+\u00f6nce)/i)[0]
        .split(COMPANY_SEP_RE);
      let jobTitle = (leaves[0] || '').trim() || null;
      let company = leaves.length > 1 ? (leaves[1] || '').trim() : null;
      let location = leaves.length > 2 ? leaves.slice(2).join(' \u00b7 ').trim() : null;
      if (jobTitle && isMetaLeaf(jobTitle)) continue;
      if (P && P.isLocationLike && P.isLocationLike(jobTitle)) continue;
      const logo = el.querySelector && el.querySelector('img[alt]');
      const logoCompany = companyFromLogo(logo);
      if (P && P.resolveCompanyAndLocation) {
        const r = P.resolveCompanyAndLocation({
          company: company,
          location: location,
          logoCompany: logoCompany,
        });
        company = r.company;
        location = r.location;
      }
      const orphan = {
        jobTitle: jobTitle,
        company: company,
        location: location,
        workType: null,
        appliedAt: signals && signals.appliedAt,
        postingStatus: signals && signals.postingStatus,
        publishedAt: signals && signals.publishedAt,
        response: 'unknown',
        applicationViewed: !!(signals && signals.applicationViewed),
        cvDownloaded: !!(signals && signals.cvDownloaded),
        rawStatus: text.slice(0, 400),
        companyLogoUrl: pickCompanyLogoUrl(logo),
        jobUrl: null,
        jobId: null,
        _pageIndex: pageIndex != null ? pageIndex : null,
        _orphan: true,
      };
      if (!orphan.jobTitle && !orphan.company) continue;
      if (globalThis.BasvuruStatus && globalThis.BasvuruStatus.enrichApplication) {
        Object.assign(orphan, globalThis.BasvuruStatus.enrichApplication(orphan));
      }
      const before = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (H) H.mergeHydratedRow(pageMap, orphan);
      else {
        const key =
          (P && P.rowDedupeKey ? P.rowDedupeKey(orphan) : null) ||
          'syn:' + orphan.company + '|' + orphan.jobTitle + '|' + (orphan.appliedAt || '');
        pageMap[key] = Object.assign({}, pageMap[key] || {}, orphan);
      }
      const after = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (after > before) added += 1;
    }
    return added;
  }

  /**
   * Wait until list signature differs from previous page and some real rows exist.
   */
  async function waitForPageHydrationStart(beforeSig, opts) {
    const timeout = (opts && opts.timeoutMs) || 12000;
    const start = Date.now();
    let sawChange = !beforeSig;
    while (Date.now() - start < timeout) {
      if (pageShowsNoMatches()) return 'empty';
      const sig = listSignature();
      const links = jobLinksOnPage().length;
      const skel = countSkeletonRows();
      if (beforeSig && sig && sig !== beforeSig) sawChange = true;
      if (!beforeSig && (links > 0 || skel > 0)) sawChange = true;
      if (sawChange && (links >= 1 || skel >= 1)) {
        // Prefer leaving once at least one real job link appeared
        if (links >= 1) return true;
        // Or skeletons present (page mounted) — hydrate loop will scroll them in
        if (skel >= 3 && Date.now() - start > 800) return true;
      }
      await sleep(280);
    }
    return jobLinksOnPage().length > 0 || countSkeletonRows() > 0;
  }

  /**
   * Incrementally scroll the list so lazy rows hydrate; merge into a per-page map.
   * Calls onRow for each newly hydrated row so the caller can commit immediately.
   */
  async function hydrateCurrentPage(opts) {
    const H = hydrateApi();
    const expected = (opts && opts.expected) != null ? opts.expected : 10;
    const isLastPage = !!(opts && opts.isLastPage);
    const timeoutMs = (opts && opts.timeoutMs) || 8000;
    const onProgress = opts && opts.onProgress;
    const onRow = opts && opts.onRow;
    const pageIndex = opts && opts.pageIndex != null ? opts.pageIndex : null;
    const pageMap = Object.create(null);
    const emitted = Object.create(null);
    const start = Date.now();
    let stableTicks = 0;
    let lastCount = 0;
    let skeletonsRemaining = countSkeletonRows();

    function emitNewRows() {
      if (!onRow) return;
      const rows = H ? H.hydratedRows(pageMap) : Object.keys(pageMap).map((k) => pageMap[k]);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const key = rowDedupeKey(row);
        if (!key || emitted[key]) continue;
        emitted[key] = true;
        try {
          onRow(row);
        } catch (_) {}
      }
    }

    await scrollListToTop();

    while (Date.now() - start < timeoutMs) {
      throwIfScanAborted();
      const emptyState = pageShowsNoMatches();
      harvestLinksIntoMap(pageMap, pageIndex);
      emitNewRows();
      skeletonsRemaining = countSkeletonRows();
      const hydrated = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (emptyState && hydrated === 0) {
        return {
          rows: [],
          got: 0,
          expected: expected,
          skeletonsRemaining: 0,
          emptyState: true,
          pageMap: pageMap,
        };
      }

      if (hydrated === lastCount) stableTicks += 1;
      else {
        stableTicks = 0;
        lastCount = hydrated;
      }

      if (onProgress) onProgress(hydrated, skeletonsRemaining);

      const done = H
        ? H.isHydrationComplete({
            hydrated: hydrated,
            expected: expected,
            skeletonsRemaining: skeletonsRemaining,
            stableTicks: stableTicks,
            maxStableTicks: 3,
            isLastPage: isLastPage,
            noNextControl: !!(opts && opts.noNextControl),
            emptyState: emptyState,
          })
        : hydrated >= expected;

      if (done) break;

      const rows = collectCandidateRows().slice(0, 16);
      for (let i = 0; i < rows.length; i++) {
        if (Date.now() - start >= timeoutMs) break;
        const el = rows[i];
        try {
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
          }
        } catch (_) {}
        await sleep(70);
        harvestLinksIntoMap(pageMap, pageIndex);
        emitNewRows();
        const hNow = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
        if (onProgress) onProgress(hNow, countSkeletonRows());
        if (hNow >= expected) break;
      }

      const hAfter = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (hAfter >= expected) break;

      await scrollListByStep(0.5);
      await sleep(120);
      harvestLinksIntoMap(pageMap, pageIndex);
      emitNewRows();
    }

    harvestLinksIntoMap(pageMap, pageIndex);
    emitNewRows();
    const midRows = collectCandidateRows().slice(0, 10);
    for (let i = 0; i < midRows.length; i++) {
      const hNow = H ? H.hydratedCount(pageMap) : Object.keys(pageMap).length;
      if (hNow >= expected) break;
      try {
        midRows[i].scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_) {}
      await sleep(40);
      harvestLinksIntoMap(pageMap, pageIndex);
      emitNewRows();
    }

    skeletonsRemaining = countSkeletonRows();
    const rowsOut = H ? H.hydratedRows(pageMap) : Object.keys(pageMap).map((k) => pageMap[k]);
    emitNewRows();
    return {
      rows: rowsOut,
      got: rowsOut.length,
      expected: expected,
      skeletonsRemaining: skeletonsRemaining,
      pageMap: pageMap,
    };
  }

  function formatCountLabel(collected, totalExpected) {
    const H = hydrateApi();
    if (H) return H.formatScanProgress(collected, totalExpected);
    if (totalExpected) return collected + ' / ' + totalExpected;
    return String(collected);
  }

  async function yieldUi() {
    await new Promise((r) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(r, 0));
      } else {
        setTimeout(r, 0);
      }
    });
    throwIfScanAborted();
  }

  async function waitForRows(timeoutMs) {
    const limit = timeoutMs || 15000;
    const start = Date.now();
    while (Date.now() - start < limit) {
      if (jobLinksOnPage().length > 0 || countSkeletonRows() > 0) return true;
      await sleep(400);
    }
    return jobLinksOnPage().length > 0 || countSkeletonRows() > 0;
  }

  /** Wait for list/page change using full job-id signature + optional page number. */
  async function waitForListChange(beforeSig, opts) {
    const expectPage = opts && opts.expectPage != null ? opts.expectPage : null;
    await sleep(PAGE_WAIT_MS);
    for (let i = 0; i < 16; i++) {
      const sig = listSignature();
      const active = getActivePageNumber();
      if (beforeSig && sig && sig !== beforeSig) return true;
      if (expectPage != null && active === expectPage) return true;
      await sleep(350);
    }
    return false;
  }

  function rowDedupeKey(row) {
    if (globalThis.BasvuruTrackerParse && globalThis.BasvuruTrackerParse.rowDedupeKey) {
      return globalThis.BasvuruTrackerParse.rowDedupeKey(row);
    }
    if (row && row.jobId) return 'id:' + String(row.jobId);
    if (row && row.jobUrl) return 'url:' + String(row.jobUrl);
    return 'keep:' + Math.random();
  }

  function ensureAppliedTab() {
    const radios = [...getScrapeDoc().querySelectorAll('[role="radio"], button, a')];
    const tab = radios.find((el) => /^Ba\u015fvuruldu/i.test((el.textContent || '').trim()));
    if (tab && tab.getAttribute('aria-checked') !== 'true' && !tab.checked) {
      tab.click();
      return true;
    }
    return false;
  }
  function rangeMeta(rangeId) {
    return RANGE_OPTS.find((r) => r.id === rangeId) || RANGE_OPTS.find((r) => r.id === '1y');
  }

  function cutoffForRange(rangeId, now) {
    const opt = rangeMeta(rangeId);
    if (!opt || opt.months == null) return null;
    const d = new Date(now.getTime());
    d.setMonth(d.getMonth() - opt.months);
    return ymd(d);
  }

  function isWithinCutoff(appliedAt, cutoff, now) {
    const P = globalThis.BasvuruTrackerParse;
    if (P && P.isWithinCutoff) return P.isWithinCutoff(appliedAt, cutoff, now);
    if (!cutoff) return true;
    const d = parseRelativeToDate(appliedAt, now);
    if (!d) return true;
    return ymd(d) >= cutoff;
  }

  function pageAgeStopDecision(pageRows, cutoff, now) {
    const P = globalThis.BasvuruTrackerParse;
    if (P && P.pageAgeStopDecision) return P.pageAgeStopDecision(pageRows, cutoff, now);
    return { stop: false, reason: null, inRangeRows: pageRows || [] };
  }

  async function scrapeDomPages(hooks) {
    const { onStatus, onItem, cutoff, now } = hooks;
    const H = hydrateApi();
    const totalExpected = readAppliedTrackerCount();
    const scanStats = {
      pages: [],
      endReason: null,
      cumulative: 0,
      totalExpected: totalExpected,
      incompletePages: [],
    };

    if (globalThis.BasvuruTrackerParse && globalThis.BasvuruTrackerParse.resetDedupeCounter) {
      globalThis.BasvuruTrackerParse.resetDedupeCounter();
    }

    if (ensureAppliedTab()) {
      onStatus('Ba\u015fvuruldu sekmesine ge\u00e7ildi\u2026', { page: 0, pct: 2, totalExpected });
      await sleep(1200);
    }

    onStatus(
      'Liste bekleniyor\u2026' + (totalExpected ? ' (hedef ' + totalExpected + ')' : ''),
      { page: 0, pct: 3, totalExpected }
    );
    const hasRows = await waitForRows(18000);
    if (!hasRows) {
      scanStats.endReason = 'no_rows';
      return { rows: [], scanStats };
    }

    const all = [];
    const seen = new Set();
    let page = 0;
    let stagnant = 0;
    let previousSig = null;
    const incompletePages = [];

    while (page < MAX_PAGES) {
      throwIfScanAborted();
      page += 1;

      // After a navigation, wait for signature change / skeletons to appear before reading.
      if (previousSig) {
        const started = await waitForPageHydrationStart(previousSig, { timeoutMs: 12000 });
        if (started === 'empty' || pageShowsNoMatches()) {
          scanStats.endReason = 'no_matches';
          onStatus(
            'Ba\u015fka ba\u015fvuru bulunamad\u0131 \u00b7 sonu\u00e7lar haz\u0131rlan\u0131yor \u00b7 ' +
              formatCountLabel(all.length, totalExpected),
            {
              page,
              count: all.length,
              totalExpected,
              pct: 94,
            }
          );
          break;
        }
      }

      const expInfo = H
        ? H.expectedRowsForPage({
            pageSize: 10,
            totalExpected: totalExpected,
            collectedSoFar: all.length,
          })
        : {
            expected: 10,
            isLastPage: false,
            remaining: totalExpected != null ? Math.max(0, totalExpected - all.length) : null,
          };

      if (expInfo.expected === 0) {
        scanStats.endReason = 'reached_total';
        break;
      }

      const countLabel = () => formatCountLabel(all.length, totalExpected);
      onStatus(page + '. sayfa taran\u0131yor \u00b7 ' + countLabel(), {
        page,
        count: all.length,
        totalExpected,
        pct: progressPctForPage(page, all.length, totalExpected),
      });
      await yieldUi();

      let pageCommitted = 0;
      let pageResult = await hydrateCurrentPage({
        expected: expInfo.expected,
        isLastPage: expInfo.isLastPage,
        pageIndex: page,
        timeoutMs: 8000,
        onRow: (row) => {
          if (!row || (!row.jobTitle && !row.jobId && !row.company)) return;
          const key = rowDedupeKey(row);
          if (seen.has(key)) return;
          seen.add(key);
          all.push(row);
          pageCommitted += 1;
          if (onItem) onItem(row, { page, count: all.length, totalExpected });
          onStatus(
            page +
              '. sayfa taran\u0131yor \u00b7 ' +
              formatCountLabel(all.length, totalExpected) +
              ' \u00b7 bu sayfada ' +
              pageCommitted +
              '/' +
              expInfo.expected,
            {
              page,
              count: all.length,
              totalExpected,
              pct: progressPctForPage(page, all.length, totalExpected),
            }
          );
        },
        onProgress: (hydrated, skel) => {
          onStatus(
            page +
              '. sayfa taran\u0131yor \u00b7 ' +
              formatCountLabel(all.length, totalExpected) +
              ' \u00b7 bu sayfada ' +
              Math.max(hydrated, pageCommitted) +
              '/' +
              expInfo.expected,
            {
              page,
              count: all.length,
              totalExpected,
              pct: progressPctForPage(page, all.length, totalExpected),
            }
          );
        },
      });

      const emptyStop = !!(
        pageResult.emptyState ||
        (pageResult.got === 0 && pageShowsNoMatches()) ||
        (H && H.shouldStopOnEmptyPage({ emptyState: pageResult.emptyState || pageShowsNoMatches(), got: pageResult.got }))
      );

      let retried = false;
      const needRetry =
        !emptyStop &&
        (H
          ? H.shouldRetryPageRead({
              got: pageResult.got,
              expected: expInfo.expected,
              retried: false,
              emptyState: emptyStop,
            }) && pageResult.got < expInfo.expected
          : pageResult.got < expInfo.expected);

      if (needRetry) {
        retried = true;
        await scrollListToTop();
        await sleep(350);
        await scrollListToBottom();
        await sleep(350);
        await scrollListToTop();
        const retryResult = await hydrateCurrentPage({
          expected: expInfo.expected,
          isLastPage: expInfo.isLastPage,
          pageIndex: page,
          timeoutMs: 6000,
          onRow: (row) => {
            if (!row || (!row.jobTitle && !row.jobId && !row.company)) return;
            const key = rowDedupeKey(row);
            if (seen.has(key)) return;
            seen.add(key);
            all.push(row);
            pageCommitted += 1;
            if (onItem) onItem(row, { page, count: all.length, totalExpected });
          },
        });
        if (retryResult.got >= pageResult.got) pageResult = retryResult;
      }

      // Flush any rows not yet committed (idempotent via seen)
      let added = 0;
      const skipReasons = {
        duplicate: 0,
        noTitleOrId: 0,
        orphanKept: 0,
      };
      for (let i = 0; i < pageResult.rows.length; i++) {
        const row = pageResult.rows[i];
        if (!row.jobTitle && !row.jobId && !row.company) {
          skipReasons.noTitleOrId += 1;
          continue;
        }
        const key = rowDedupeKey(row);
        if (seen.has(key)) {
          skipReasons.duplicate += 1;
          continue;
        }
        seen.add(key);
        all.push(row);
        added += 1;
        if (row._orphan) skipReasons.orphanKept += 1;
        if (onItem) onItem(row, { page, count: all.length, totalExpected });
      }

      const flagIncomplete =
        !emptyStop &&
        (H
          ? H.shouldFlagPageIncomplete({
              got: pageResult.got,
              expected: expInfo.expected,
              isLastPage: expInfo.isLastPage,
            })
          : pageResult.got < expInfo.expected && !expInfo.isLastPage);

      scanStats.pages.push({
        page,
        expected: expInfo.expected,
        got: pageResult.got,
        isLastPage: !!expInfo.isLastPage,
        remaining: expInfo.remaining,
        skeletonsRemaining: pageResult.skeletonsRemaining,
        added: added + pageCommitted,
        skipped: skipReasons,
        cumulative: all.length,
        retried,
        flaggedIncomplete: flagIncomplete,
        emptyState: emptyStop,
      });
      scanStats.cumulative = all.length;

      if (emptyStop) {
        scanStats.endReason = 'no_matches';
        onStatus(
          'Ba\u015fka ba\u015fvuru bulunamad\u0131 \u00b7 sonu\u00e7lar haz\u0131rlan\u0131yor \u00b7 ' +
            formatCountLabel(all.length, totalExpected),
          {
            page,
            count: all.length,
            totalExpected,
            pct: 94,
          }
        );
        break;
      }

      if (flagIncomplete) {
        incompletePages.push(page);
      }

      onStatus(page + '. sayfa taran\u0131yor \u00b7 ' + formatCountLabel(all.length, totalExpected), {
        page,
        count: all.length,
        totalExpected,
        pct: progressPctForPage(page, all.length, totalExpected),
      });
      await yieldUi();

      const ageStop = pageAgeStopDecision(pageResult.rows, cutoff, now);
      if (ageStop.stop) {
        scanStats.endReason = 'outside_range';
        onStatus(
          'Se\u00e7ilen zaman aral\u0131\u011f\u0131n\u0131n sonuna gelindi \u00b7 tarama bitiyor \u00b7 ' +
            formatCountLabel(all.length, totalExpected),
          {
            page,
            count: all.length,
            totalExpected,
            pct: 94,
          }
        );
        await yieldUi();
        break;
      }

      if (totalExpected && all.length >= totalExpected) {
        scanStats.endReason = 'reached_total';
        break;
      }

      const pageNew = added + pageCommitted;
      if (pageNew === 0) {
        stagnant += 1;
        if (stagnant >= 2) {
          const grown = await growByScrolling(all, seen, onItem, page, onStatus);
          if (grown > 0) {
            stagnant = 0;
            previousSig = listSignature();
            continue;
          }
          scanStats.endReason = 'no_new_rows';
          break;
        }
      } else {
        stagnant = 0;
      }

      // Only after a full hydrate: scroll to bottom and find next control.
      previousSig = listSignature();
      let nextAction = await resolveNextPagination({ attempts: 5 });
      if (!nextAction || !nextAction.el) {
        const grown = await growByScrolling(all, seen, onItem, page, onStatus);
        if (grown > 0) {
          stagnant = 0;
          scanStats.endReason = '';
          continue;
        }
        const retry = await resolveNextPagination({ attempts: 3 });
        if (!retry || !retry.el) {
          // Last page: never flag solely because remaining chip gap (may be duplicates in LI count)
          scanStats.endReason = 'no_next_button';
          break;
        }
        nextAction = retry;
      }
      if (isControlDisabled(nextAction.el)) {
        const grown = await growByScrolling(all, seen, onItem, page, onStatus);
        if (grown > 0) {
          stagnant = 0;
          continue;
        }
        scanStats.endReason = 'next_disabled';
        break;
      }
      const beforeSig = listSignature();
      throwIfScanAborted();
      try {
        nextAction.el.click();
      } catch (_) {
        scanStats.endReason = 'next_click_failed';
        break;
      }
      let changed = await waitForListChange(beforeSig);
      if (!changed) {
        await sleep(800);
        changed = listSignature() !== beforeSig;
      }
      if (!changed && nextAction.type === 'loadMore') {
        const grown = await growByScrolling(all, seen, onItem, page, onStatus);
        if (grown > 0) {
          stagnant = 0;
          continue;
        }
      }
      if (!changed) {
        stagnant += 1;
        if (stagnant >= 2) {
          scanStats.endReason = 'list_unchanged';
          break;
        }
      } else {
        stagnant = 0;
      }
    }

    // Final targeted re-read of flagged pages via numbered pagination (if available).
    const flagged =
      scanStats.endReason === 'no_matches' ? [] : [...new Set(incompletePages)].sort((a, b) => a - b);
    const stillIncomplete = [];
    if (flagged.length) {
      const sampleBtn = findPageNumberButton(flagged[0]) || findPageNumberButton(2) || findPageNumberButton(1);
      if (!sampleBtn) {
        // No numbered page controls — cannot re-navigate; keep flags as-is.
        stillIncomplete.push(...flagged);
      } else {
        onStatus(
          'Okunamayan sayfalar yeniden taran\u0131yor\u2026 (' + flagged.length + ')',
          {
            pct: 90,
            count: all.length,
            totalExpected,
          }
        );
        for (let fi = 0; fi < flagged.length; fi++) {
          throwIfScanAborted();
          const pageNum = flagged[fi];
          const btn = findPageNumberButton(pageNum);
          if (!btn || isControlDisabled(btn)) {
            stillIncomplete.push(pageNum);
            continue;
          }
          const beforeSig = listSignature();
          throwIfScanAborted();
          try {
            btn.click();
          } catch (_) {
            stillIncomplete.push(pageNum);
            continue;
          }
          await waitForPageHydrationStart(beforeSig, { timeoutMs: 8000 });
          const pageStat = scanStats.pages.find((p) => p.page === pageNum);
          const expectN =
            pageStat && pageStat.expected != null
              ? pageStat.expected
              : H
                ? H.expectedRowsForPage({
                    totalExpected: totalExpected,
                    collectedSoFar: Math.max(0, (pageNum - 1) * 10),
                  }).expected
                : 10;
          let addedHere = 0;
          await hydrateCurrentPage({
            expected: expectN,
            isLastPage: false,
            pageIndex: pageNum,
            timeoutMs: 7000,
            onRow: (row) => {
              if (!row || (!row.jobTitle && !row.jobId && !row.company)) return;
              const key = rowDedupeKey(row);
              if (seen.has(key)) return;
              seen.add(key);
              all.push(row);
              addedHere += 1;
              if (onItem) onItem(row, { page: pageNum, count: all.length, totalExpected });
            },
          });
          scanStats.pages.push({
            page: pageNum,
            reread: true,
            expected: expectN,
            added: addedHere,
            cumulative: all.length,
          });
          if (addedHere < expectN && !(totalExpected && all.length >= totalExpected)) {
            stillIncomplete.push(pageNum);
          }
          onStatus(
            pageNum +
              '. sayfa yeniden okunuyor \u00b7 ' +
              formatCountLabel(all.length, totalExpected),
            { pct: 91, count: all.length, totalExpected }
          );
        }
      }
    }

    // Drop last-page false positives from any remaining flags
    const cleanedIncomplete = stillIncomplete.filter((p) => {
      const st = scanStats.pages.filter((x) => x.page === p && !x.reread).pop();
      if (!st) return true;
      if (H && H.shouldFlagPageIncomplete) {
        return H.shouldFlagPageIncomplete({
          got: st.got,
          expected: st.expected,
          isLastPage: st.isLastPage,
        });
      }
      return !st.isLastPage && st.got < st.expected;
    });

    scanStats.incompletePages = cleanedIncomplete;
    scanStats.cumulative = all.length;
    if (!scanStats.endReason) {
      scanStats.endReason = page >= MAX_PAGES ? 'max_pages' : 'done';
    }
    if (scanStats.endReason === 'no_matches' || scanStats.endReason === 'outside_range') {
      scanStats.incompletePages = [];
      scanStats.incompleteMessage = null;
    } else if (totalExpected && all.length < totalExpected) {
      scanStats.incompleteMessage = H
        ? H.formatIncompleteEnd(all.length, totalExpected, cleanedIncomplete)
        : all.length + ' / ' + totalExpected + ' \u2014 baz\u0131 ba\u015fvurular okunamad\u0131';
    } else if (cleanedIncomplete.length) {
      // Collected enough vs chip but some pages still short — still report lightly
      scanStats.incompleteMessage = H
        ? H.formatIncompleteEnd(all.length, totalExpected || all.length, cleanedIncomplete)
        : null;
    }
    return { rows: all, scanStats };
  }

  // ---------- API mode (MAIN-world api-hook.js + tracker-api-runner.js) ----------
  function apiLib() {
    return globalThis.BasvuruTrackerApi || null;
  }

  async function scrapeViaApi(hooks) {
    const runner = globalThis.BasvuruTrackerApiRunner;
    if (!runner || !apiLib()) {
      return { ok: false, reason: 'no_capture', rows: [], scanStats: { mode: 'api' } };
    }
    return runner.run(hooks, {
      jobLinksOnPage,
      jobIdFromHref,
      parseDomCard,
      resolveNextPagination,
      isControlDisabled,
      findPrevPageButton,
      findPageNumberButton,
      scrollListToTop,
    });
  }

  async function runScrape(hooks) {
    const scanToken = hooks && hooks.scanToken != null ? hooks.scanToken : activeScanToken;
    const stale = () => scanToken != null && scanToken !== scanGeneration;
    const rawStatus = hooks.onStatus;
    const rawItem = hooks.onItem;
    const onStatus = (msg, meta) => {
      if (suppressScanStatus || stale()) return;
      if (rawStatus) rawStatus(msg, meta);
    };
    const onItem = (row, meta) => {
      if (suppressScanStatus || stale()) return;
      if (rawItem) rawItem(row, meta);
    };
    const rangeId = hooks.rangeId;
    const abortHooks = {
      isAborted: () => stale(),
      sleep: (ms) => sleep(ms),
      bindAbort: bindScanAbort,
      scanToken: scanToken,
    };
    const range = rangeMeta(rangeId || '1y');
    const now = new Date();
    const cutoff = cutoffForRange(range.id, now);
    const A = apiLib();
    const chipTotal = readAppliedTrackerCount();
    if (globalThis.BasvuruTrackerParse && globalThis.BasvuruTrackerParse.resetDedupeCounter) {
      globalThis.BasvuruTrackerParse.resetDedupeCounter();
    }

    let allMapped = [];
    let scanStats = null;
    let mode = 'dom';

    onStatus(
      A && A.formatModeStatus
        ? A.formatModeStatus('api', 0, chipTotal) + ' \u00b7 ba\u015flat\u0131l\u0131yor\u2026'
        : 'H\u0131zl\u0131 tarama deneniyor\u2026',
      { pct: 3, mode: 'api', totalExpected: chipTotal, count: 0 }
    );

    let apiResult = null;
    try {
      apiResult = await scrapeViaApi(Object.assign({ onStatus: onStatus, onItem: onItem, chipTotal: chipTotal }, abortHooks));
    } catch (err) {
      if (isScanAbortedError(err) || stale()) throw isScanAbortedError(err) ? err : scanAbortError();
      apiResult = {
        ok: false,
        reason: 'replay_error',
        replayError: String(err && err.message ? err.message : err),
        rows: [],
        parsedCount: 0,
      };
    }

    const decision = A
      ? A.shouldFallbackToDom({
          captured: !!(apiResult && apiResult.reason !== 'no_capture'),
          parsedCount: (apiResult && (apiResult.parsedCount || (apiResult.rows && apiResult.rows.length))) || 0,
          chipTotal: chipTotal,
          replayError: apiResult && !apiResult.ok && apiResult.reason === 'replay_error' ? apiResult.replayError || 'error' : null,
        })
      : { fallback: true, reason: 'no_api_lib' };

    // no_capture → captured false
    if (apiResult && apiResult.reason === 'no_capture') {
      decision.fallback = true;
      decision.reason = 'no_capture';
    }

    if (stale()) throw scanAbortError();

    if (apiResult && apiResult.ok && apiResult.rows && apiResult.rows.length && !decision.fallback) {
      mode = 'api';
      allMapped = apiResult.rows;
      scanStats = apiResult.scanStats || { mode: 'api', cumulative: allMapped.length, totalExpected: chipTotal };
      scanStats.mode = 'api';
      onStatus(
        (A && A.formatModeStatus ? A.formatModeStatus('api', allMapped.length, chipTotal) : '') +
          ' \u00b7 tamamland\u0131',
        { pct: 94, mode: 'api', count: allMapped.length, totalExpected: chipTotal }
      );
    } else {
      mode = 'dom';
      const why = (decision && decision.reason) || (apiResult && apiResult.reason) || 'fallback';
      onStatus(
        (A && A.formatModeStatus
          ? A.formatModeStatus('dom', 0, chipTotal)
          : 'Sayfa modu') +
          ' \u00b7 h\u0131zl\u0131 tarama kullan\u0131lamad\u0131, sayfa sayfa taran\u0131yor',
        { pct: 6, mode: 'dom', totalExpected: chipTotal, count: 0 }
      );
      const scraped = await scrapeDomPages({
        onStatus: (msg, meta) =>
          onStatus(
            msg,
            Object.assign({}, meta || {}, {
              mode: 'dom',
              totalExpected:
                meta && meta.totalExpected != null ? meta.totalExpected : chipTotal,
            })
          ),
        onItem,
        cutoff,
        now,
        scanToken: scanToken,
      });
      if (stale()) throw scanAbortError();
      allMapped = scraped.rows || scraped;
      scanStats = scraped.scanStats || {};
      scanStats.mode = 'dom';
      scanStats.apiFallbackReason = why;
      if (chipTotal && !scanStats.totalExpected) scanStats.totalExpected = chipTotal;
    }

    if (stale()) throw scanAbortError();
    if (!allMapped.length) {
      throw new Error(
        'Ba\u015fvuru listesi okunamad\u0131. LinkedIn\u2019de \u00abBa\u015fvuruldu\u00bb sayfas\u0131nda oldu\u011fundan emin olup yeniden dene.'
      );
    }

    onStatus('Sonu\u00e7lar haz\u0131rlan\u0131yor\u2026', { pct: 96, mode });

    // Always filter to the selected cutoff. DOM paging may also stop early
    // when pageAgeStopDecision sees a confident out-of-range streak.
    const applications = allMapped.filter((a) => isWithinCutoff(a.appliedAt, cutoff, now));
    scrubCrossCompanyLogos(applications);

    if (!applications.length && allMapped.length) {
      throw new Error(
        'Tarama ' +
          allMapped.length +
          ' ba\u015fvuru buldu ama se\u00e7ilen zaman aral\u0131\u011f\u0131nda hi\u00e7 ba\u015fvuru yok. Daha geni\u015f bir aral\u0131k se\u00e7ip yeniden dene.'
      );
    }

    const uniqueCompanies = new Set(
      applications.map((a) => (a.company || '').trim()).filter(Boolean)
    ).size;
    const sum =
      globalThis.BasvuruStatus && globalThis.BasvuruStatus.summarizeStatuses
        ? globalThis.BasvuruStatus.summarizeStatuses(applications)
        : null;
    const viewed = sum ? sum.counts.viewed : applications.filter((a) => a.applicationViewed).length;
    const cvDownloaded = sum
      ? sum.counts.cv
      : applications.filter((a) => a.cvDownloaded).length;
    const responseYes = applications.filter((a) => {
      const r = (a.response || '').toLowerCase();
      return r === 'yes' || r === 'true' || r === 'olumlu';
    }).length;
    const repostedWithoutView = sum
      ? sum.counts.repostUnseen
      : applications.filter((a) => a.repostedWithoutView).length;
    const reposted = applications.filter(
      (a) =>
        a.statusId === 'repostUnseen' ||
        a.repostedWithoutView ||
        YENIDEN_RE.test(a.postingStatus || '') ||
        YENIDEN_RE.test(a.publishedAt || '')
    ).length;

    const scrapedAt = now.toISOString();
    const scrapedAtDisplay = formatTrtDisplay(now);

    const snapshot = {
      scrapedAt,
      scrapedAtDisplay,
      cutoff,
      range: range.id,
      rangeLabel: range.label,
      count: applications.length,
      scrapeMode: mode,
      scanStats: scanStats
        ? Object.assign({}, scanStats, {
            mode: mode,
            crawledRaw: allMapped.length,
            rangeFiltered: applications.length,
          })
        : { mode: mode, crawledRaw: allMapped.length, rangeFiltered: applications.length },
      kpis: {
        total: applications.length,
        uniqueCompanies,
        viewed,
        cvDownloaded,
        responseYes,
        reposted,
        repostedWithoutView,
      },
      applications,
    };

    const signalSum = viewed + cvDownloaded + reposted;
    if (applications.length >= SAFETY_MIN_COUNT && signalSum === 0) {
      onStatus(
        'Uyar\u0131: ' +
          applications.length +
          ' ba\u015fvurunun hi\u00e7birinde g\u00f6r\u00fcnt\u00fclenme, CV indirme veya yeniden yay\u0131n bilgisi bulunamad\u0131; sonu\u00e7lar yine de kaydediliyor.',
        { pct: 97, mode }
      );
    }

    if (stale()) throw scanAbortError();
    let knewPrevious = false;
    let previousSnapshot;
    try {
      const prevStored = await chrome.storage.local.get(STORAGE_SNAPSHOT);
      knewPrevious = true;
      previousSnapshot = prevStored ? prevStored[STORAGE_SNAPSHOT] : undefined;
    } catch (_) {}
    if (stale()) throw scanAbortError();

    await chrome.storage.local.set({
      [STORAGE_SNAPSHOT]: snapshot,
      [STORAGE_RANGE]: range.id,
    });
    if (stale()) {
      try {
        if (knewPrevious && previousSnapshot) {
          await chrome.storage.local.set({ [STORAGE_SNAPSHOT]: previousSnapshot });
        } else if (knewPrevious) {
          await chrome.storage.local.remove(STORAGE_SNAPSHOT);
        }
      } catch (_) {}
      throw scanAbortError();
    }

    onStatus(
      'Tamamland\u0131 \u00b7 ' +
        applications.length +
        ' ba\u015fvuru \u00b7 ' +
        uniqueCompanies +
        ' \u015firket \u00b7 ' +
        range.label,
      { pct: 100 }
    );
    return snapshot;
  }
  function blankAnchorHtml(href, label) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function creditFooterHtml(extraClass) {
    const cls = extraClass ? ' credit ' + extraClass : ' credit';
    return (
      '<div class="' +
      cls.trim() +
      '">' +
      '<div class="credit-name">' +
      CREDIT_NAME +
      '</div>' +
      '<div class="credit-links">' +
      blankAnchorHtml(CREDIT_WEB, 'boraturkoglu.com') +
      '<span class="credit-sep">\u00b7</span>' +
      blankAnchorHtml(CREDIT_LI, 'LinkedIn') +
      '<span class="credit-sep">\u00b7</span>' +
      blankAnchorHtml(CREDIT_GH, 'GitHub') +
      '</div></div>'
    );
  }

  function q(panel, sel) {
    if (!panel) return null;
    const root = panel.shadowRoot || panel;
    return root.querySelector(sel);
  }

  function dismissPanel(panel) {
    const p = panel || document.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
    try {
      chrome.storage.local.remove(STORAGE_PANEL_COLLAPSED);
    } catch (_) {}
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;
    if (collapsed) {
      dismissPanel(panel);
      return;
    }
    panel.classList.remove('bsp-collapsed');
  }

  function setPanelPhase(panel, phase) {
    if (!panel) return;
    const rootEl = q(panel, '.bsp-root');
    if (rootEl) rootEl.setAttribute('data-phase', phase || 'idle');
    const label = q(panel, '#basvuru-scrape-phase');
    const U = globalThis.BasvuruScrapePanelUi;
    if (label) label.textContent = U && U.phaseLabel ? U.phaseLabel(phase) : (phase || '');
  }

  function eachStopButton(fn) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const ids = ['#basvuru-scrape-stop', '#basvuru-scrape-stop-mini'];
    for (let i = 0; i < ids.length; i++) {
      const btn = q(panel, ids[i]);
      if (btn) fn(btn);
    }
  }

  function setStopVisible(on) {
    eachStopButton((btn) => {
      btn.hidden = !on;
      if (on) btn.disabled = false;
    });
  }

  function ensureStopButton(panel) {
    if (!panel) return;
    const actions = q(panel, '.bsp-actions');
    if (actions && !q(panel, '#basvuru-scrape-stop')) {
      const btn = document.createElement('button');
      btn.id = 'basvuru-scrape-stop';
      btn.type = 'button';
      btn.className = 'bsp-stop';
      btn.hidden = true;
      btn.textContent = 'Durdur';
      actions.insertBefore(btn, actions.firstChild);
    }
    const mini = q(panel, '.bsp-mini');
    if (mini && !q(panel, '#basvuru-scrape-stop-mini')) {
      const btn = document.createElement('button');
      btn.id = 'basvuru-scrape-stop-mini';
      btn.type = 'button';
      btn.className = 'bsp-stop';
      btn.hidden = true;
      btn.textContent = 'Durdur';
      mini.appendChild(btn);
    }
  }

  function bindStopClicks(panel) {
    const ids = ['#basvuru-scrape-stop', '#basvuru-scrape-stop-mini'];
    for (let i = 0; i < ids.length; i++) {
      const btn = q(panel, ids[i]);
      if (!btn || btn.dataset.stopWired) continue;
      btn.dataset.stopWired = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        requestStop();
      });
    }
  }

  function requestStop() {
    if (!scanBound || scanBound !== scanGeneration) return;
    suppressScanStatus = true;
    eachStopButton((btn) => {
      btn.disabled = true;
    });
    abortScanGeneration();
    try {
      window.postMessage({ source: API_MSG_SOURCE, type: 'replay-abort-all' }, '*');
    } catch (_) {}
    showStoppedPanel();
  }

  function showStoppedPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    setPanelPhase(panel, 'stopped');
    const statusEl = q(panel, '#basvuru-scrape-status');
    if (statusEl) {
      statusEl.removeAttribute('data-total');
      statusEl.textContent = 'Tarama durduruldu. K\u0131smi sonu\u00e7 kaydedilmedi.';
    }
    const startBtn = q(panel, '#basvuru-scrape-start');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'Ba\u015flat';
    }
    setStopVisible(false);
    const keep = q(panel, '#basvuru-scrape-keepopen');
    if (keep) keep.hidden = true;
    chrome.storage.local.get(STORAGE_SNAPSHOT, (data) => {
      if (!suppressScanStatus) return;
      const live = document.getElementById(PANEL_ID);
      const resultsBtn = q(live, '#basvuru-scrape-results');
      if (!resultsBtn) return;
      const snap = data && data[STORAGE_SNAPSHOT];
      const has = !!(snap && Array.isArray(snap.applications) && snap.applications.length);
      const U = globalThis.BasvuruScrapePanelUi;
      const show =
        U && U.shouldShowGoToResults
          ? U.shouldShowGoToResults({ scanning: false, hasSnapshot: has, stopped: true })
          : has;
      resultsBtn.hidden = !show;
    });
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      ensureResultsButton(panel);
      ensureStopButton(panel);
      const U0 = globalThis.BasvuruScrapePanelUi;
      if (U0 && U0.watchHostTheme) U0.watchHostTheme(panel, document);
      return panel;
    }
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('lang', 'tr');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Ba\u015fvuru Taray\u0131c\u0131s\u0131');
    const shadow = panel.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelStyleCss();
    const inner = document.createElement('div');
    inner.className = 'bsp-root';
    inner.setAttribute('data-phase', 'idle');
    inner.setAttribute('lang', 'tr');
    const optsHtml = RANGE_OPTS.map(
      (r) =>
        '<option value="' +
        r.id +
        '"' +
        (r.id === '1y' ? ' selected' : '') +
        '>' +
        r.label +
        '</option>'
    ).join('');
    const U = globalThis.BasvuruScrapePanelUi;
    inner.innerHTML =
      U && U.panelInnerHtml
        ? U.panelInnerHtml({
            rangeOptionsHtml: optsHtml,
            creditHtml: creditFooterHtml('bsp-credit'),
          })
        : '';
    shadow.append(style, inner);
    var idleStatus = inner.querySelector('#basvuru-scrape-status');
    if (idleStatus) idleStatus.textContent = 'Haz\u0131r. Aral\u0131\u011f\u0131 se\u00e7ip Ba\u015flat\u2019a bas.';
    var idleMini = inner.querySelector('#basvuru-scrape-status-mini');
    if (idleMini) idleMini.textContent = 'Haz\u0131r';
    var keepOpenEl = inner.querySelector('#basvuru-scrape-keepopen');
    if (keepOpenEl) keepOpenEl.textContent = SCAN_KEEP_OPEN;
    var feedEmptyHost = inner.querySelector('#basvuru-scrape-feed');
    if (feedEmptyHost) {
      var feedEmpty = document.createElement('p');
      feedEmpty.className = 'bsp-feed-empty';
      feedEmpty.textContent = 'Tarama ba\u015flay\u0131nca okunan ba\u015fvurular burada g\u00f6r\u00fcnecek.';
      feedEmptyHost.append(feedEmpty);
    }
    if (U && U.watchHostTheme) U.watchHostTheme(panel, document);
    ensureStopButton(panel);
    document.documentElement.appendChild(panel);
    restorePanelPosition(panel);
    makePanelDraggable(panel);
    return panel;
  }

  function ensureResultsButton(panel) {
    if (!panel || q(panel, '#basvuru-scrape-results')) return;
    const actions = q(panel, '.bsp-actions');
    const startBtn = q(panel, '#basvuru-scrape-start');
    if (!actions || !startBtn) return;
    const btn = document.createElement('button');
    btn.id = 'basvuru-scrape-results';
    btn.type = 'button';
    btn.className = 'bsp-results';
    btn.hidden = true;
    btn.textContent = 'Sonu\u00e7lara git';
    actions.insertBefore(btn, startBtn);
  }

  function panelStyleCss() {
    const U = globalThis.BasvuruScrapePanelUi;
    return U && U.panelCss ? U.panelCss() : '';
  }

  function readStoredPanelPos() {
    try {
      const raw = sessionStorage.getItem(PANEL_POS_KEY);
      if (!raw) return null;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return null;
      return pos;
    } catch (_) {
      return null;
    }
  }

  function clampPanelPos(left, top, width) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 800;
    const vh = window.innerHeight || document.documentElement.clientHeight || 600;
    return {
      left: Math.min(vw - PANEL_EDGE_PX, Math.max(PANEL_EDGE_PX - width, left)),
      top: Math.min(Math.max(0, vh - PANEL_EDGE_PX), Math.max(0, top)),
    };
  }

  function applyPanelPos(panel, left, top) {
    const rect = panel.getBoundingClientRect();
    const pos = clampPanelPos(left, top, rect.width || 410);
    const set = (prop, value) => {
      if (panel.style && panel.style.setProperty) panel.style.setProperty(prop, value, 'important');
    };
    set('left', pos.left + 'px');
    set('top', pos.top + 'px');
    set('right', 'auto');
    set('bottom', 'auto');
    return pos;
  }

  function restorePanelPosition(panel) {
    const stored = readStoredPanelPos();
    if (!stored) return;
    applyPanelPos(panel, stored.left, stored.top);
  }

  function makePanelDraggable(panel) {
    const head = q(panel, '.bsp-head');
    if (!head) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let pointerId = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      panel.classList.add('bsp-dragging');
      try {
        head.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
      applyPanelPos(panel, origLeft + (e.clientX - startX), origTop + (e.clientY - startY));
    });
    const up = (e) => {
      if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      panel.classList.remove('bsp-dragging');
      const rect = panel.getBoundingClientRect();
      const pos = applyPanelPos(panel, rect.left, rect.top);
      try {
        sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify(pos));
      } catch (_) {}
    };
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  function wirePanel(panel) {
    ensureResultsButton(panel);
    ensureStopButton(panel);
    bindStopClicks(panel);
    if (panel.dataset.wired === '1') {
      const existingResults = q(panel, '#basvuru-scrape-results');
      if (existingResults && !existingResults.dataset.clickWired) {
        existingResults.dataset.clickWired = '1';
        existingResults.onclick = () => {
          chrome.runtime.sendMessage({ type: 'basvuru-open-results' }).catch(() => {});
        };
      }
      return;
    }
    panel.dataset.wired = '1';
    const rangeEl = q(panel, '#basvuru-scrape-range');
    const feedItems = [];

    function liveUi() {
      const p = document.getElementById(PANEL_ID) || panel;
      if (!p) return null;
      return {
        panel: p,
        statusEl: q(p, '#basvuru-scrape-status'),
        barEl: q(p, '#basvuru-scrape-bar'),
        feedEl: q(p, '#basvuru-scrape-feed'),
        startBtn: q(p, '#basvuru-scrape-start'),
        resultsBtn: q(p, '#basvuru-scrape-results'),
        closeBtn: q(p, '#basvuru-scrape-close'),
        rangeEl: q(p, '#basvuru-scrape-range'),
        keepOpenEl: q(p, '#basvuru-scrape-keepopen'),
      };
    }

    function shouldShowGoToResults(state) {
      const U = globalThis.BasvuruScrapePanelUi;
      if (U && typeof U.shouldShowGoToResults === 'function') {
        return U.shouldShowGoToResults(state);
      }
      if (!state || state.scanning) return false;
      if (state.failed && !state.hasSnapshot) return false;
      return !!state.hasSnapshot;
    }

    function setGoToResultsVisible(state) {
      const ui = liveUi();
      if (!ui || !ui.resultsBtn) return;
      ui.resultsBtn.hidden = !shouldShowGoToResults(state);
    }

    async function openResultsPage() {
      await chrome.runtime.sendMessage({ type: 'basvuru-open-results' });
    }

    chrome.storage.local.get(STORAGE_RANGE, (data) => {
      const id = data[STORAGE_RANGE] || '1y';
      const ui = liveUi();
      if (ui && ui.rangeEl && RANGE_OPTS.some((r) => r.id === id)) ui.rangeEl.value = id;
    });
    if (rangeEl) {
      rangeEl.addEventListener('change', () => {
        chrome.storage.local.set({ [STORAGE_RANGE]: rangeEl.value });
      });
    }

    function setBar(pct) {
      const ui = liveUi();
      if (!ui || !ui.barEl) return;
      const n = Math.max(0, Math.min(100, Number(pct) || 0));
      ui.barEl.style.width = n + '%';
      const prog = q(ui.panel, '#basvuru-scrape-progress');
      if (prog) prog.setAttribute('aria-valuenow', String(Math.round(n)));
    }
    function setKeepOpenVisible(on) {
      const ui = liveUi();
      if (!ui || !ui.keepOpenEl) return;
      ui.keepOpenEl.hidden = !on;
    }
    function setStatus(msg, meta) {
      if (suppressScanStatus) return;
      const ui = liveUi();
      if (!ui || !ui.statusEl) return;
      var message = msg && typeof msg === 'object' ? msg : null;
      let text = message
        ? String(
            message.text != null
              ? message.text
              : message.message != null
                ? message.message
                : message.status != null
                  ? message.status
                  : ''
          )
        : String(msg || '');
      var messageMode = message && message.mode;
      var metaMode = meta && meta.mode;
      var explicitMode =
        messageMode === 'api' || messageMode === 'page'
          ? messageMode
          : metaMode === 'api' || metaMode === 'page'
            ? metaMode
            : '';
      var U = globalThis.BasvuruScrapePanelUi;
      var fields = {};
      if (message && message.count != null) fields.count = message.count;
      if (meta && meta.count != null) fields.count = meta.count;
      if (message && ('total' in message || 'totalExpected' in message)) {
        fields.total = 'total' in message ? message.total : message.totalExpected;
      }
      if (meta && ('total' in meta || 'totalExpected' in meta)) {
        fields.total = 'total' in meta ? meta.total : meta.totalExpected;
      }
      if (explicitMode) fields.mode = explicitMode;
      var payload = text;
      if (message) {
        payload = { text: text };
        if (message.count != null) payload.count = message.count;
        if ('total' in message || 'totalExpected' in message) {
          payload.total = 'total' in message ? message.total : message.totalExpected;
        }
        if (messageMode === 'api' || messageMode === 'page') payload.mode = messageMode;
      }
      if (U && U.formatPanelStatus) {
        var formatted = U.formatPanelStatus(payload, fields);
        text = formatted.text;
        if (U.rememberScanMode) U.rememberScanMode(ui.panel, formatted.scanMode);
      } else if (
        meta &&
        meta.count != null &&
        meta.totalExpected != null &&
        Number(meta.totalExpected) > 0 &&
        !/\d+\s*\/\s*\d+/.test(text) &&
        !/\d+\s*ba\u015fvuru/i.test(text)
      ) {
        text += ' \u00b7 ' + meta.count + ' / ' + meta.totalExpected;
      } else if (meta && meta.count != null && !/\d+\s*ba\u015fvuru/i.test(text) && !/\d+\s*\/\s*\d+/.test(text)) {
        text += ' \u00b7 ' + meta.count + ' ba\u015fvuru';
      }
      var totalProvided =
        (meta && ('total' in meta || 'totalExpected' in meta)) ||
        (message && ('total' in message || 'totalExpected' in message));
      if (totalProvided) {
        var known = typeof fields.total === 'number' && isFinite(fields.total) && fields.total > 0;
        ui.statusEl.setAttribute('data-total', known ? String(Math.floor(fields.total)) : 'null');
      } else {
        ui.statusEl.removeAttribute('data-total');
      }
      ui.statusEl.textContent = text;
      var pct = meta && meta.pct != null ? meta.pct : message && message.pct != null ? message.pct : null;
      if (pct != null) setBar(pct);
    }
    function pushFeed(row) {
      if (suppressScanStatus || (activeScanToken && activeScanToken !== scanGeneration)) return;
      const ui = liveUi();
      if (!ui || !ui.feedEl) return;
      feedItems.unshift(row);
      if (feedItems.length > FEED_MAX) feedItems.length = FEED_MAX;
      const feed = ui.feedEl;
      feed.replaceChildren();
      for (let i = 0; i < feedItems.length; i++) {
        const r = feedItems[i];
        const wrap = document.createElement('div');
        wrap.className = 'bsp-row';
        const co = document.createElement('div');
        co.className = 'bsp-co';
        co.textContent = r.company || '\u2014';
        const jt = document.createElement('div');
        jt.className = 'bsp-jt';
        jt.textContent = r.jobTitle || '\u2014';
        const when = document.createElement('div');
        when.className = 'bsp-when';
        when.textContent = r.appliedAt || '\u00a0';
        wrap.append(co, jt, when);
        feed.append(wrap);
      }
    }

    const closeBtn = q(panel, '#basvuru-scrape-close');
    if (closeBtn) closeBtn.onclick = () => {
      dismissPanel(document.getElementById(PANEL_ID));
    };

    async function startScrape(forcedRange, opts) {
      const fromAutostart = !!(opts && opts.fromAutostart);
      setPanelCollapsed(document.getElementById(PANEL_ID) || panel, false);
      setPanelPhase(document.getElementById(PANEL_ID) || panel, 'scanning');
      const ui0 = liveUi();
      const startBtn = ui0 && ui0.startBtn;
      if (!startBtn || startBtn.disabled) return;
      const rangeId =
        forcedRange || (ui0.rangeEl && ui0.rangeEl.value) || rangeEl.value || '1y';
      if (ui0.rangeEl) ui0.rangeEl.value = rangeId;

      // Fresh load = page 1. Avoid old go-to-page-1 click retries.
      if (!fromAutostart) {
        suppressScanStatus = false;
        chrome.storage.local.set({ [STORAGE_AUTOSTART]: true, [STORAGE_RANGE]: rangeId });
        setKeepOpenVisible(true);
        setGoToResultsVisible({ scanning: true, hasSnapshot: false });
        setStatus('Ba\u015fvuruldu sayfas\u0131 a\u00e7\u0131l\u0131yor\u2026', { pct: 1 });
        try {
          location.assign('https://www.linkedin.com/jobs-tracker/?stage=applied');
        } catch (_) {
          location.href = 'https://www.linkedin.com/jobs-tracker/?stage=applied';
        }
        return;
      }

      startBtn.disabled = true;
      startBtn.textContent = '\u00c7al\u0131\u015f\u0131yor\u2026';
      const scanToken = beginScanGeneration();
      setStopVisible(true);
      setGoToResultsVisible({ scanning: true, hasSnapshot: false });
      feedItems.length = 0;
      const feedEl = ui0.feedEl;
      if (feedEl) feedEl.replaceChildren();
      setBar(0);
      setKeepOpenVisible(true);
      chrome.storage.local.set({ [STORAGE_RANGE]: rangeId });
      try {
        const snapshot = await runScrape({
          onStatus: setStatus,
          onItem: pushFeed,
          rangeId,
          scanToken: scanToken,
        });
        if (scanToken !== scanGeneration) {
          if (suppressScanStatus) showStoppedPanel();
          return;
        }
        const n = (snapshot.applications || []).length;
        const ss = snapshot.scanStats || {};
        const totalExp = ss.totalExpected;
        const incompleteMsg = ss.incompleteMessage;
        const mode = snapshot.scrapeMode || ss.mode || 'dom';
        const modePrefix = mode === 'api' ? 'H\u0131zl\u0131 tarama' : 'Sayfa modu';
        const U = globalThis.BasvuruScrapePanelUi;
        const reasonNote = U && U.humanEndReason ? U.humanEndReason(ss.endReason) : '';
        let doneMsg;
        if (incompleteMsg) {
          doneMsg =
            'Tamamland\u0131 \u00b7 ' + modePrefix + ' \u00b7 ' + incompleteMsg + '. Sonu\u00e7lar haz\u0131r.';
        } else if (totalExp) {
          doneMsg =
            'Tamamland\u0131 \u00b7 ' +
            modePrefix +
            ' \u00b7 ' +
            n +
            ' / ' +
            totalExp +
            '. Sonu\u00e7lar haz\u0131r.';
        } else {
          doneMsg =
            'Tamamland\u0131 \u00b7 ' + modePrefix + ' \u00b7 ' + n + ' ba\u015fvuru. Sonu\u00e7lar haz\u0131r.';
        }
        if (reasonNote) doneMsg += ' \u00b7 ' + reasonNote;
        setStatus(doneMsg, { pct: 100, count: n, totalExpected: totalExp, mode });
        setPanelPhase(document.getElementById(PANEL_ID) || panel, 'done');
        setGoToResultsVisible({ scanning: false, hasSnapshot: true });
        try {
          await openResultsPage();
        } catch (_) {}
        const ui1 = liveUi();
        if (ui1 && ui1.startBtn) {
          ui1.startBtn.disabled = false;
          ui1.startBtn.textContent = 'Tekrar ba\u015flat';
        }
      } catch (err) {
        if (isScanAbortedError(err) || scanToken !== scanGeneration) {
          if (suppressScanStatus) showStoppedPanel();
          return;
        }
        const detail = String(err && err.message ? err.message : err);
        setStatus(
          'Bir sorun olu\u015ftu. Sayfay\u0131 yenileyip yeniden dene.' +
            (detail ? ' (ayr\u0131nt\u0131: ' + detail + ')' : ''),
          { pct: 0 }
        );
        setPanelPhase(document.getElementById(PANEL_ID) || panel, 'error');
        setGoToResultsVisible({ scanning: false, hasSnapshot: false, failed: true });
        const ui1 = liveUi();
        if (ui1 && ui1.startBtn) {
          ui1.startBtn.disabled = false;
          ui1.startBtn.textContent = 'Ba\u015flat';
        }
      } finally {
        if (scanBound === scanToken) {
          endScanGeneration(scanToken);
          setStopVisible(false);
          setKeepOpenVisible(false);
        }
      }
    }

    const startBtn = q(panel, '#basvuru-scrape-start');
    if (startBtn) startBtn.onclick = () => startScrape();
    const resultsBtn = q(panel, '#basvuru-scrape-results');
    if (resultsBtn) {
      resultsBtn.dataset.clickWired = '1';
      resultsBtn.onclick = () => {
        openResultsPage().catch(() => {});
      };
    }
    window.__basvuruStartScrape = startScrape;
  }

  function mount() {
    const panel = ensurePanel();
    wirePanel(panel);
    return panel;
  }

  function isAppliedTrackerLocation() {
    try {
      const u = new URL(location.href);
      if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return false;
      const path = (u.pathname || '').replace(/\/+$/, '') || '/';
      const onTracker =
        /(^|\/)jobs-tracker(\/|$)/.test(path) || /(^|\/)jobs\/tracker(\/|$)/.test(path);
      if (!onTracker) return false;
      const stage = (u.searchParams.get('stage') || '').toLowerCase();
      if (stage && stage !== 'applied') return false;
      if (/\/(interviewed|interviewing|interview|archived|saved)(\/|$)/.test(path)) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function openPanelWithoutScan() {
    const existed = !!document.getElementById(PANEL_ID);
    const panel = mount();
    setPanelCollapsed(panel, false);
    if (!panel.isConnected) document.documentElement.appendChild(panel);
    const U = globalThis.BasvuruScrapePanelUi;
    if (U && U.layoutPanel) U.layoutPanel(panel);
    if (!existed) setPanelPhase(panel, 'idle');
    return panel;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'basvuru-open-panel') {
      try {
        openPanelWithoutScan();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    if (msg.type !== 'basvuru-start') return;
    mount();
    const start = window.__basvuruStartScrape;
    if (typeof start === 'function') {
      // Message start: still go through fresh-page path unless already autostarting.
      Promise.resolve(start(msg.range)).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: String(err) })
      );
      return true;
    }
    sendResponse({ ok: false, error: 'panel yok' });
  });

  chrome.storage.local.get([STORAGE_AUTOSTART, STORAGE_RANGE, STORAGE_OPEN_PANEL], (data) => {
    try {
      chrome.storage.local.remove(STORAGE_PANEL_COLLAPSED);
    } catch (_) {}
    if (data[STORAGE_OPEN_PANEL] && isAppliedTrackerLocation()) {
      chrome.storage.local.remove([STORAGE_OPEN_PANEL, STORAGE_AUTOSTART]);
      openPanelWithoutScan();
      return;
    }
    if (data[STORAGE_AUTOSTART]) {
      const panel = mount();
      setPanelCollapsed(panel, false);
      chrome.storage.local.remove(STORAGE_AUTOSTART);
      const live = document.getElementById(PANEL_ID);
      if (live) {
        const st = q(live, '#basvuru-scrape-status');
        if (st) st.textContent = 'Ba\u015fvuruldu sayfas\u0131 a\u00e7\u0131l\u0131yor\u2026';
        setPanelPhase(live, 'scanning');
      }
      setTimeout(() => {
        if (typeof window.__basvuruStartScrape === 'function') {
          window.__basvuruStartScrape(data[STORAGE_RANGE] || '1y', { fromAutostart: true });
        }
      }, 900);
      return;
    }
  });
})();
