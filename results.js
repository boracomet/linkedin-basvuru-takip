'use strict';

/**
 * Extension results page. Loads basvuruSnapshot from chrome.storage.local.
 * All status badges derive from BasvuruStatus.applicationStatus only.
 */

const S = globalThis.BasvuruStatus;
if (!S) throw new Error('status.js must load before results.js');

const STORAGE_SNAPSHOT = 'basvuruSnapshot';
const CLOSED = S.CLOSED_PHRASE;

let apps = [];
let meta = {};
let lastSnapshot = null;

function companyName(a) {
  const n = (a.company || '').trim();
  return n || '(Bilinmeyen \u015firket)';
}
function statusOf(a) {
  return S.applicationStatus(a);
}
function isClosed(a) {
  return S.isClosed(a) || (a.postingStatus || '').includes(CLOSED);
}
function isResponseYes(a) {
  return String(a.response || '').toLowerCase() === 'yes';
}
function workBucket(wt) {
  const s = String(wt || '').toLowerCase();
  if (/uzak|remote/.test(s)) return 'remote';
  if (/hybrid|hibrit/.test(s)) return 'hybrid';
  if (/\u015f yerinde|onsite|on-?site|ofis|i\u015f yerinde/.test(s)) return 'onsite';
  return null;
}
function ageHours(text) {
  return S.ageHours(text);
}
function pctLabel(n, d) {
  if (!d) return '%0';
  const v = (100 * n) / d;
  if (v === 0) return '%0';
  const s = v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
  return '%' + s;
}
function shortWhen(s) {
  return String(s || '')
    .replace(/\s*ba\u015fvurdu\s*$/i, '')
    .trim();
}
function cleanLoc(a) {
  const loc = (a.location || '').replace(/\s*[\u2022\u00b7]\s*$/, '').trim();
  const wt = a.workType || '';
  return [loc, wt].filter(Boolean).join(' \u00b7 ');
}
function statusLabel(a) {
  if (isClosed(a)) return '';
  return a.postingStatus || '\u2014';
}
function hue(name) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 33 + c.charCodeAt(0)) % 360;
  return h;
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function withStatSpans(value) {
  return esc(value).replace(/(%?\d[\d.,]*)/g, '<span class="stat">$1</span>');
}
function setStatText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = withStatSpans(value);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function initials(name) {
  const parts = String(name || '')
    .replace(/[()]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function allowedJobHref(url) {
  const A = globalThis.BasvuruUrlAllow;
  const s = String(url || '').trim();
  if (!s || !A) return '';
  if (typeof A.safeJobUrl === 'function') {
    const out = A.safeJobUrl(s);
    return out ? String(out) : '';
  }
  if (typeof A.isAllowedJobUrl !== 'function' || !A.isAllowedJobUrl(s)) return '';
  return s;
}
function allowedLogoSrc(url) {
  const A = globalThis.BasvuruUrlAllow;
  const s = String(url || '').trim();
  if (!s || !A) return '';
  if (typeof A.safeLogoUrl === 'function') {
    const out = A.safeLogoUrl(s);
    return out ? String(out) : '';
  }
  if (typeof A.isAllowedLogoUrl !== 'function' || !A.isAllowedLogoUrl(s)) return '';
  return s;
}
function logoEl(url, name) {
  const safe = allowedLogoSrc(url);
  const ph =
    '<span class="logo ph" style="--h:' +
    hue(name) +
    ';' +
    (safe ? 'display:none' : '') +
    '">' +
    esc(initials(name)) +
    '</span>';
  if (safe) {
    return (
      '<img class="logo" src="' +
      esc(safe) +
      '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
      ph
    );
  }
  return ph;
}
function blankAnchorHtml(href, text) {
  return (
    '<a href="' +
    esc(href) +
    '" target="_blank" rel="noopener noreferrer">' +
    esc(text) +
    '</a>'
  );
}
function formatDisplayStamp(display, iso) {
  const raw = String(display || '').trim();
  if (/^\d{2}\.\d{2}\.\d{4}/.test(raw) && !/TRT/i.test(raw)) return raw;
  const wall = raw.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (wall && (/TRT/i.test(raw) || !iso)) {
    return wall[3] + '.' + wall[2] + '.' + wall[1] + (wall[4] ? ' ' + wall[4] + ':' + wall[5] : '');
  }
  const src = iso || (/^\d{4}-\d{2}-\d{2}T/.test(raw) ? raw : '');
  if (src) {
    const d = new Date(src);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    }
  }
  return raw || '\u2014';
}

const state = { view: 'companies', q: '', sort: 'count-desc', filters: new Set() };

function passesFilters(a) {
  const st = statusOf(a);
  if (state.filters.has('viewed') && st.id !== 'viewed' && st.id !== 'cv') return false;
  if (state.filters.has('cv') && st.id !== 'cv') return false;
  if (
    state.filters.has('repost') &&
    st.id !== 'repostUnseen' &&
    !S.detectYenidenPhrase([a.publishedAt, a.postingStatus].join(' '))
  )
    return false;
  if (state.filters.has('repost-nv') && st.id !== 'repostUnseen') return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    const postingHay = isClosed(a) ? '' : a.postingStatus || '';
    const hay = [companyName(a), a.jobTitle || '', a.location || '', postingHay]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function groupByCompany(list) {
  const map = new Map();
  for (const a of list) {
    const name = companyName(a);
    if (!map.has(name)) {
      map.set(name, {
        name,
        logo: null,
        apps: [],
        anySeen: false,
        anyYes: false,
        newestAge: Infinity,
        oldestAge: -Infinity,
      });
    }
    const g = map.get(name);
    g.apps.push(a);
    const st = statusOf(a);
    if (st.seen) g.anySeen = true;
    if (isResponseYes(a)) g.anyYes = true;
    const age = ageHours(a.appliedAt);
    if (age < g.newestAge) g.newestAge = age;
    if (age > g.oldestAge) g.oldestAge = age;
  }
  for (const g of map.values()) {
    const counts = new Map();
    for (const a of g.apps) {
      const u = allowedLogoSrc(a.companyLogoUrl);
      if (!u) continue;
      counts.set(u, (counts.get(u) || 0) + 1);
    }
    g.logo = counts.size
      ? [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0]
      : null;
    g.summary = S.summarizeStatuses(g.apps);
  }
  return [...map.values()];
}

function sortGroups(groups) {
  const s = state.sort;
  return groups.sort((a, b) => {
    if (s === 'name-asc') return a.name.localeCompare(b.name, 'tr');
    if (s === 'newest') return a.newestAge - b.newestAge || b.apps.length - a.apps.length;
    if (s === 'oldest') return b.oldestAge - a.oldestAge || a.apps.length - b.apps.length;
    if (s === 'viewed-first') {
      const av = a.anySeen ? 1 : 0;
      const bv = b.anySeen ? 1 : 0;
      if (bv !== av) return bv - av;
      return b.apps.length - a.apps.length || a.name.localeCompare(b.name, 'tr');
    }
    if (b.apps.length !== a.apps.length) return b.apps.length - a.apps.length;
    return a.name.localeCompare(b.name, 'tr');
  });
}
function sortAppsInGroup(list) {
  const dir = state.sort === 'oldest' ? -1 : 1;
  return [...list].sort((a, b) => dir * (ageHours(a.appliedAt) - ageHours(b.appliedAt)));
}
function newestWhen(list) {
  const newest = [...list].sort((a, b) => ageHours(a.appliedAt) - ageHours(b.appliedAt))[0];
  return shortWhen((newest && newest.appliedAt) || '');
}

/** Primary status badge (+ response secondary). */
function badgesForApp(a) {
  const st = statusOf(a);
  const b = ['<span class="badge ' + st.cssClass + '">' + esc(st.label) + '</span>'];
  if (isResponseYes(a)) b.push('<span class="badge yes">Yan\u0131t al\u0131nd\u0131</span>');
  return b.join('');
}

/** Company row: honest count chips from child statuses. */
function badgesForGroup(g) {
  const c = (g.summary && g.summary.counts) || S.summarizeStatuses(g.apps).counts;
  const b = [];
  if (c.cv) b.push('<span class="badge cv">' + c.cv + ' CV indirildi</span>');
  if (c.viewed) b.push('<span class="badge viewed">' + c.viewed + ' g\u00f6r\u00fcnt\u00fclendi</span>');
  if (c.unseen) b.push('<span class="badge unseen">' + c.unseen + ' g\u00f6r\u00fcnt\u00fclenmedi</span>');
  if (c.repostUnseen)
    b.push(
      '<span class="badge repost-nv">' +
        c.repostUnseen +
        ' g\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131n</span>'
    );
  if (g.anyYes) b.push('<span class="badge yes">Yan\u0131t al\u0131nd\u0131</span>');
  return b.join('');
}

function openCompany(name) {
  state.view = 'companies';
  state.q = name === '(Bilinmeyen \u015firket)' ? '' : name;
  const qEl = document.getElementById('q');
  if (qEl) qEl.value = state.q;
  document.querySelectorAll('#main-tabs .tab').forEach((t) => {
    const on = t.dataset.view === 'companies';
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  render();
  const ar = document.getElementById('arsiv');
  if (ar) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ar.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  setTimeout(() => {
    document.querySelectorAll('#view-companies .company-card').forEach((c) => {
      const n = (c.querySelector('.name') && c.querySelector('.name').textContent) || '';
      const head = c.querySelector('.company-toggle');
      if (n === name) {
        c.classList.add('open');
        if (head) head.setAttribute('aria-expanded', 'true');
      }
    });
  }, 0);
}

function renderTops() {
  const groups = groupByCompany(apps).sort(
    (a, b) => b.apps.length - a.apps.length || a.name.localeCompare(b.name, 'tr')
  );
  const root = document.getElementById('tops');
  if (!root) return;
  root.innerHTML = groups
    .slice(0, 8)
    .map(
      (g) =>
        '<button type="button" class="top-card" data-company="' +
        esc(g.name) +
        '">' +
        '<span class="logo-wrap">' +
        logoEl(g.logo, g.name) +
        '</span><span><span class="nm">' +
        esc(g.name) +
        '</span><span class="ct"><span class="stat">' +
        g.apps.length +
        '</span> ba\u015fvuru</span></span></button>'
    )
    .join('');
  root.querySelectorAll('.top-card').forEach((card) => {
    card.addEventListener('click', () => openCompany(card.dataset.company));
  });
}

function applicationCountText(n) {
  return '<span class="stat">' + n + '</span> ba\u015fvuru';
}

function renderCompanies(groups) {
  const root = document.getElementById('view-companies');
  if (!root) return;
  if (!groups.length) {
    root.innerHTML = '<div class="empty">Se\u00e7ili filtrelere uyan \u015firket yok.</div>';
    return;
  }
  root.innerHTML = groups
    .map((g) => {
      const jobs = sortAppsInGroup(g.apps)
        .map((a) => {
          const href = allowedJobHref(a.jobUrl);
          const title = href
            ? blankAnchorHtml(href, a.jobTitle || '\u0130lan')
            : esc(a.jobTitle || '\u0130lan');
          return (
            '<div class="job-row"><div class="title">' +
            title +
            '<div class="muted">' +
            esc(cleanLoc(a)) +
            '</div></div><div class="when">' +
            esc(shortWhen(a.appliedAt) || '\u2014') +
            '</div><div class="status">' +
            esc(statusLabel(a)) +
            '</div><div class="badges">' +
            badgesForApp(a) +
            '</div></div>'
          );
        })
        .join('');
      const newest = newestWhen(g.apps);
      const pdfLabel = 'Bu \u015firketteki ba\u015fvurular\u0131n\u0131 PDF olarak indir';
      return (
        '<article class="company-card" data-company="' +
        esc(g.name) +
        '"><div class="company-bar"><button type="button" class="company-toggle" aria-expanded="false">' +
        '<span class="logo-wrap">' +
        logoEl(g.logo, g.name) +
        '</span>' +
        '<span class="company-meta"><span class="name">' +
        esc(g.name) +
        '</span>' +
        '<span class="sub">' +
        (newest ? 'Son ba\u015fvuru ' + esc(newest) : g.apps.length + ' ba\u015fvuru') +
        '</span></span>' +
        '<span class="badges">' +
        badgesForGroup(g) +
        '</span>' +
        '<span class="count-pill">' +
        applicationCountText(g.apps.length) +
        '</span>' +
        '<span class="chev" aria-hidden="true"></span></button>' +
        '<button type="button" class="btn-co-pdf" data-company="' +
        esc(g.name) +
        '" aria-label="' +
        esc(pdfLabel) +
        '">' +
        '<svg class="btn-co-pdf-ico" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M8 1.5a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5zm-5 10a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H3z"/>' +
        '</svg></button></div><div class="job-list">' +
        jobs +
        '</div></article>'
      );
    })
    .join('');

  root.querySelectorAll('.company-toggle').forEach((head) => {
    const toggle = () => {
      const card = head.closest('.company-card');
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    head.addEventListener('click', toggle);
  });
  root.querySelectorAll('.btn-co-pdf').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      printCompanyPdf(btn.getAttribute('data-company'));
    });
  });
}

function renderGroupedHighlight(targetId, predicate, emptyMsg) {
  const filtered = apps.filter((a) => predicate(a) && passesFilters(a));
  const groups = sortGroups(groupByCompany(filtered));
  const root = document.getElementById(targetId);
  if (!root) return;
  if (!groups.length) {
    root.innerHTML = '<div class="empty">' + esc(emptyMsg) + '</div>';
    return;
  }
  root.innerHTML = groups
    .map((g) => {
      const items = sortAppsInGroup(g.apps)
        .map((a) => {
          const href = allowedJobHref(a.jobUrl);
          const title = href
            ? blankAnchorHtml(href, a.jobTitle || '\u0130lan')
            : esc(a.jobTitle || '\u0130lan');
          return (
            '<div class="hl-item"><div class="logo-wrap">' +
            logoEl(g.logo, g.name) +
            '</div><div class="info">' +
            '<div class="co">' +
            esc(g.name) +
            '</div><div class="jt">' +
            title +
            ' \u00b7 ' +
            esc(shortWhen(a.appliedAt)) +
            '</div><div class="st">' +
            esc([statusLabel(a), cleanLoc(a)].filter(Boolean).join(' \u00b7 ')) +
            '</div><div class="badges" style="margin-top:8px;justify-content:flex-start">' +
            badgesForApp(a) +
            '</div></div></div>'
          );
        })
        .join('');
      const header =
        g.apps.length > 1
          ? '<div class="group-label"><span class="stat">' + g.apps.length + '</span> ba\u015fvuru \u00b7 ' + esc(g.name) + '</div>'
          : '';
      return header + items;
    })
    .join('');
}

function renderGallery(groups) {
  const root = document.getElementById('view-gallery');
  if (!root) return;
  if (!groups.length) {
    root.innerHTML = '<div class="empty">Se\u00e7ili filtrelere uyan \u015firket yok.</div>';
    return;
  }
  root.innerHTML = groups
    .map((g) => {
      const sum = g.summary || S.summarizeStatuses(g.apps);
      const bits = ['<span class="stat">' + g.apps.length + '</span> ba\u015fvuru'];
      if (sum.counts.cv) bits.push('<span class="stat">' + sum.counts.cv + '</span> CV indirildi');
      if (sum.counts.viewed) bits.push('<span class="stat">' + sum.counts.viewed + '</span> g\u00f6r\u00fcnt\u00fclendi');
      if (sum.counts.unseen) bits.push('<span class="stat">' + sum.counts.unseen + '</span> g\u00f6r\u00fcnt\u00fclenmedi');
      if (sum.counts.repostUnseen)
        bits.push('<span class="stat">' + sum.counts.repostUnseen + '</span> g\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131n');
      return (
        '<button type="button" class="gal-card" data-company="' +
        esc(g.name) +
        '">' +
        '<span class="logo-wrap">' +
        logoEl(g.logo, g.name) +
        '</span><span class="txt">' +
        '<span class="n">' +
        esc(g.name) +
        '</span><span class="c">' +
        bits.join(' \u00b7 ') +
        '</span></span></button>'
      );
    })
    .join('');
  root.querySelectorAll('.gal-card').forEach((card) => {
    card.addEventListener('click', () => openCompany(card.dataset.company));
  });
}

function setVisiblePanels() {
  const map = {
    companies: 'view-companies',
    viewed: 'view-viewed',
    cv: 'view-cv',
    'repost-nv': 'view-repost-nv',
    gallery: 'view-gallery',
  };
  Object.keys(map).forEach((k) => {
    const el = document.getElementById(map[k]);
    if (el) el.classList.toggle('panel-hidden', state.view !== k);
  });
}

function renderMix() {
  const counts = { remote: 0, hybrid: 0, onsite: 0 };
  for (const a of apps) {
    const b = workBucket(a.workType);
    if (b) counts[b] += 1;
  }
  const known = counts.remote + counts.hybrid + counts.onsite;
  const root = document.getElementById('mix');
  if (!root) return;
  if (!known) {
    root.innerHTML = '<p class="mix-empty">\u00c7al\u0131\u015fma \u015fekli bilgisi yok.</p>';
    return;
  }
  const seg = (key) => {
    if (!counts[key]) return '';
    return '<span class="seg ' + key + '" style="width:' + (counts[key] / known) * 100 + '%"></span>';
  };
  const bits = [
    ['Uzaktan', counts.remote],
    ['Hibrit', counts.hybrid],
    ['\u0130\u015f yerinde', counts.onsite],
  ];
  const aria = bits.map((pair) => pair[0] + ' ' + pair[1] + ' (' + pctLabel(pair[1], known) + ')').join(', ');
  const legend = [
    ['remote', 'Uzaktan'],
    ['hybrid', 'Hibrit'],
    ['onsite', '\u0130\u015f yerinde'],
  ]
    .map(
      (pair) =>
        '<span><i class="sw ' +
        pair[0] +
        '" aria-hidden="true"></i>' +
        pair[1] +
        ' <b>' +
        counts[pair[0]] +
        '</b> <span class="mix-pct">' +
        pctLabel(counts[pair[0]], known) +
        '</span></span>'
    )
    .join('');
  root.innerHTML =
    '<div class="mix-bar" role="img" aria-label="' +
    esc(aria) +
    '">' +
    seg('remote') +
    seg('hybrid') +
    seg('onsite') +
    '</div>' +
    '<div class="mix-legend">' +
    legend +
    '</div>';
}

function renderHero() {
  const sum = S.summarizeStatuses(apps);
  const total = apps.length;
  const cv = sum.counts.cv;
  const seen = sum.seen;
  const unseen = sum.notSeen;
  const companies = new Set(apps.map(companyName)).size;
  const repostNv = sum.counts.repostUnseen;

  const rangeLabel = meta.rangeLabel || meta.range || 'Son tarama';
  const scraped = formatDisplayStamp(meta.scrapedAtDisplay, meta.scrapedAt);
  setText('kicker-range', rangeLabel);
  setText('kicker-scraped', scraped);
  setText('hero-total', total);
  setText('hero-apps', total);
  setText('hero-companies', companies);
  setText('hero-viewed', seen);
  setText('hero-cv', cv);
  setText('hero-unseen', unseen);
  setText('unseen-box-num', unseen);
  setStatText('unseen-box-sub', '/ ' + total + ' ba\u015fvuru');
  setText('seal-rate', pctLabel(seen, total));
  setStatText('seal-sub', 'CV indirilenler dahil \u00b7 ' + seen + ' / ' + total);
  setText('meter-label', pctLabel(unseen, total));
  setText('fn-total', total);
  setText('fn-viewed', seen);
  setText('fn-cv', cv);
  setText('fn-viewed-p', pctLabel(seen, total));
  setText('fn-cv-p', pctLabel(cv, total));
  setText('n-total', total);
  setText('n-unseen', unseen);
  setText('p-unseen', pctLabel(unseen, total));
  setText('n-viewed', seen);
  setText('n-cv', cv);
  setText('n-repost-nv', repostNv);
  setText('ft-scraped', scraped);
  setText('ft-count', String(apps.length));
  document.title = total + ' ba\u015fvuru \u2014 ' + rangeLabel + ' \u2014 Ba\u015fvuru \u0130statistikleri';

  requestAnimationFrame(() => {
    const unseenPct = total ? (unseen / total) * 100 : 0;
    const meter = document.getElementById('meter-fill');
    if (meter) meter.style.width = unseenPct + '%';
    const meterTrack = document.getElementById('meter-track');
    if (meterTrack) meterTrack.setAttribute('aria-valuenow', String(Math.round(unseenPct)));
    const bars = { total, viewed: seen, cv };
    document.querySelectorAll('[data-bar]').forEach((el) => {
      const n = bars[el.dataset.bar] || 0;
      el.style.width = n === 0 ? '0%' : Math.max(2.5, (n / total) * 100) + '%';
    });
  });
  renderMix();
  renderTops();
}

function render() {
  setVisiblePanels();
  const filteredApps = apps.filter(passesFilters);
  const groups = sortGroups(groupByCompany(filteredApps));
  if (state.view === 'companies') {
    renderCompanies(groups);
    setStatText('result-meta', groups.length + ' \u015firket \u00b7 ' + filteredApps.length + ' ba\u015fvuru');
  } else if (state.view === 'viewed') {
    renderGroupedHighlight(
      'view-viewed',
      (a) => statusOf(a).id === 'viewed' || statusOf(a).id === 'cv',
      'G\u00f6r\u00fcnt\u00fclenen ba\u015fvuru yok.'
    );
    setStatText(
      'result-meta',
      filteredApps.filter((a) => statusOf(a).seen).length + ' g\u00f6r\u00fcnt\u00fclenen ba\u015fvuru'
    );
  } else if (state.view === 'cv') {
    renderGroupedHighlight('view-cv', (a) => statusOf(a).id === 'cv', 'CV indirilen ba\u015fvuru yok.');
    setStatText(
      'result-meta',
      filteredApps.filter((a) => statusOf(a).id === 'cv').length + ' CV indirilen ba\u015fvuru'
    );
  } else if (state.view === 'repost-nv') {
    renderGroupedHighlight(
      'view-repost-nv',
      (a) => statusOf(a).id === 'repostUnseen',
      'G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131nlanan ba\u015fvuru yok.'
    );
    setStatText(
      'result-meta',
      filteredApps.filter((a) => statusOf(a).id === 'repostUnseen').length + ' ba\u015fvuru'
    );
  } else if (state.view === 'gallery') {
    renderGallery(groups);
    setStatText('result-meta', groups.length + ' \u015firket');
  }
}

function dateYmd(d) {
  const x = d || new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function companySlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'sirket';
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function printCreditHtml() {
  return (
    '<div class="print-credit">Geli\u015ftiren: Bora Ata T\u00fcrko\u011flu \u00b7 ' +
    '<a href="https://boraturkoglu.com">boraturkoglu.com</a> \u00b7 ' +
    '<a href="https://www.linkedin.com/in/boracomet/">LinkedIn</a> \u00b7 ' +
    '<a href="https://github.com/boracomet">GitHub</a></div>'
  );
}

function buildSummaryPrintHtml() {
  const sum = S.summarizeStatuses(apps);
  const groups = groupByCompany(apps).sort(
    (a, b) => b.apps.length - a.apps.length || a.name.localeCompare(b.name, 'tr')
  );
  const rangeLabel = meta.rangeLabel || meta.range || 'Son tarama';
  const scraped = formatDisplayStamp(meta.scrapedAtDisplay, meta.scrapedAt);
  const tops = groups
    .slice(0, 12)
    .map((g) => '<li>' + esc(g.name) + ' \u2014 <span class="stat">' + g.apps.length + '</span> ba\u015fvuru</li>')
    .join('');
  const rows = groups
    .map((g) => {
      const c = g.summary.counts;
      return (
        '<tr><td>' +
        esc(g.name) +
        '</td><td class="stat">' +
        g.apps.length +
        '</td><td class="stat">' +
        c.cv +
        '</td><td class="stat">' +
        c.viewed +
        '</td><td class="stat">' +
        c.unseen +
        '</td><td class="stat">' +
        c.repostUnseen +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<div class="print-doc">' +
    '<h1>Ba\u015fvuru \u00f6zeti</h1>' +
    '<div class="print-meta">' +
    esc(rangeLabel) +
    ' \u00b7 Tarama: ' +
    esc(scraped) +
    '</div>' +
    '<div class="print-kpis">' +
    '<div class="print-kpi"><div class="k">Toplam ba\u015fvuru</div><div class="n">' +
    sum.total +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">G\u00f6r\u00fcnt\u00fclenen ba\u015fvuru</div><div class="n">' +
    sum.seen +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">CV indirilen</div><div class="n">' +
    sum.counts.cv +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">Hi\u00e7 g\u00f6r\u00fcnt\u00fclenmeyen</div><div class="n">' +
    sum.notSeen +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131n</div><div class="n">' +
    sum.counts.repostUnseen +
    '</div></div>' +
    '</div>' +
    '<p class="print-note">G\u00f6r\u00fcnt\u00fclenen ba\u015fvuru, CV indirilenleri de kapsar. Hi\u00e7 g\u00f6r\u00fcnt\u00fclenmeyen say\u0131s\u0131, g\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131nlananlar\u0131 da kapsar.</p>' +
    '<h2>En \u00e7ok ba\u015fvurdu\u011fun \u015firketler</h2>' +
    '<ol class="print-tops">' +
    tops +
    '</ol>' +
    '<h2>\u015eirket tablosu</h2>' +
    '<table class="print-table"><thead><tr>' +
    '<th>\u015eirket</th><th>Ba\u015fvuru</th><th>CV indirildi</th><th>G\u00f6r\u00fcnt\u00fclendi (CV hari\u00e7)</th>' +
    '<th>G\u00f6r\u00fcnt\u00fclenmedi</th><th>G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131n</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    printCreditHtml() +
    '</div>'
  );
}

function buildCompanyPrintHtml(name) {
  const groups = groupByCompany(apps.filter((a) => companyName(a) === name));
  const g = groups[0];
  if (!g) return '<div class="print-doc">\u015eirket bulunamad\u0131.</div>';
  const c = g.summary.counts;
  const newest = newestWhen(g.apps);
  const jobs = sortAppsInGroup(g.apps)
    .map((a) => {
      const st = statusOf(a);
      return (
        '<div class="print-job">' +
        '<div class="jt">' +
        esc(a.jobTitle || '\u0130lan') +
        '</div>' +
        '<div class="meta">' +
        esc([cleanLoc(a), shortWhen(a.appliedAt), statusLabel(a)].filter(Boolean).join(' \u00b7 ')) +
        '</div>' +
        '<div class="badges"><span class="badge ' +
        st.cssClass +
        '">' +
        esc(st.label) +
        '</span></div>' +
        '</div>'
      );
    })
    .join('');
  return (
    '<div class="print-doc">' +
    '<div class="print-co-head">' +
    '<div class="logo-wrap">' +
    logoEl(g.logo, g.name) +
    '</div>' +
    '<div><div class="name">' +
    esc(g.name) +
    '</div><div class="sub">' +
    (newest ? 'Son ba\u015fvuru ' + esc(newest) + ' \u00b7 ' : '') +
    '<span class="stat">' +
    g.apps.length +
    '</span> ba\u015fvuru</div></div></div>' +
    '<div class="print-kpis">' +
    '<div class="print-kpi"><div class="k">Toplam ba\u015fvuru</div><div class="n">' +
    g.apps.length +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">G\u00f6r\u00fcnt\u00fclenen ba\u015fvuru</div><div class="n">' +
    (c.cv + c.viewed) +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">CV indirilen</div><div class="n">' +
    c.cv +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">Hi\u00e7 g\u00f6r\u00fcnt\u00fclenmeyen</div><div class="n">' +
    (c.unseen + c.repostUnseen) +
    '</div></div>' +
    '<div class="print-kpi"><div class="k">G\u00f6r\u00fcnt\u00fclenmeden yeniden yay\u0131n</div><div class="n">' +
    c.repostUnseen +
    '</div></div>' +
    '</div>' +
    '<h2>Ba\u015fvurular</h2>' +
    jobs +
    printCreditHtml() +
    '</div>'
  );
}

function runPrint(mode, html, titleBase) {
  const root = document.getElementById('print-root');
  if (!root) return;
  const prevTitle = document.title;
  root.innerHTML = html;
  root.hidden = false;
  document.body.setAttribute('data-print-mode', mode);
  document.title = titleBase;

  const cleanup = () => {
    document.body.removeAttribute('data-print-mode');
    root.innerHTML = '';
    root.hidden = true;
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Safety net if afterprint never fires
  setTimeout(() => {
    if (document.body.getAttribute('data-print-mode') === mode) cleanup();
  }, 120000);
}

function printSummaryPdf() {
  if (!apps.length) return;
  runPrint('summary', buildSummaryPrintHtml(), 'basvuru-ozet-' + dateYmd());
}

function printCompanyPdf(name) {
  if (!name || !apps.length) return;
  runPrint('company', buildCompanyPrintHtml(name), 'basvuru-' + companySlug(name) + '-' + dateYmd());
}

async function fetchExtText(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.text();
  }
  if (window.__BASVURU_ASSETS__) {
    if (path === 'results.css' || path === 'tokens.css') return window.__BASVURU_ASSETS__.css || '';
    if (path === 'status.js') return window.__BASVURU_ASSETS__.statusJs || '';
    if (path === 'results.js') return window.__BASVURU_ASSETS__.resultsJs || '';
  }
  throw new Error('Kaynak dosya okunamad\u0131');
}

async function downloadHtmlReport() {
  if (!lastSnapshot) return;
  const Ex = globalThis.BasvuruExportHtml;
  if (!Ex) {
    console.error('export-html.js y\u00fcklenmedi');
    return;
  }
  let css;
  let statusJs;
  let resultsJs;
  if (window.__BASVURU_ASSETS__ && window.__BASVURU_ASSETS__.css) {
    css = window.__BASVURU_ASSETS__.css;
    statusJs = window.__BASVURU_ASSETS__.statusJs;
    resultsJs = window.__BASVURU_ASSETS__.resultsJs;
  } else {
    const parts = await Promise.all([
      fetchExtText('tokens.css'),
      fetchExtText('results.css'),
      fetchExtText('status.js'),
      fetchExtText('results.js'),
    ]);
    css = parts[0] + '\n' + String(parts[1]).replace(/@import\s+url\([^)]+\)\s*;/g, '');
    statusJs = parts[2];
    resultsJs = parts[3];
  }
  const html = Ex.buildStandaloneHtml({
    snapshot: lastSnapshot,
    css: css,
    statusJs: statusJs,
    resultsJs: resultsJs,
  });
  downloadBlob(Ex.filenameForDate(new Date()), new Blob([html], { type: 'text/html;charset=utf-8' }));
}

function applySnapshot(snapshot) {
  lastSnapshot = snapshot || null;
  const empty = document.getElementById('boot-empty');
  const app = document.getElementById('app');
  if (!snapshot || !(snapshot.applications || []).length) {
    if (empty) empty.classList.remove('panel-hidden');
    if (app) app.classList.add('panel-hidden');
    return;
  }
  if (empty) empty.classList.add('panel-hidden');
  if (app) app.classList.remove('panel-hidden');
  apps = (snapshot.applications || []).map((a) => S.enrichApplication(a));
  const sum = S.summarizeStatuses(apps);
  const kpis = Object.assign({}, snapshot.kpis || {}, {
    total: apps.length,
    viewed: sum.counts.viewed,
    cvDownloaded: sum.counts.cv,
    repostedWithoutView: sum.counts.repostUnseen,
    uniqueCompanies:
      snapshot.kpis && snapshot.kpis.uniqueCompanies != null
        ? snapshot.kpis.uniqueCompanies
        : new Set(apps.map(companyName)).size,
  });
  lastSnapshot = Object.assign({}, snapshot, { applications: apps, kpis: kpis });
  meta = {
    scrapedAt: snapshot.scrapedAt,
    scrapedAtDisplay: snapshot.scrapedAtDisplay,
    cutoff: snapshot.cutoff,
    range: snapshot.range,
    rangeLabel: snapshot.rangeLabel,
    kpis: kpis,
  };
  renderHero();
  render();
}

function bindLogoFallback() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!img || String(img.tagName || '').toUpperCase() !== 'IMG') return;
      if (!img.classList || !img.classList.contains('logo')) return;
      img.style.display = 'none';
      const next = img.nextElementSibling;
      if (next) next.style.display = 'grid';
    },
    true
  );
}

function wireOnce() {
  if (window.__basvuruResultsWired) return;
  window.__basvuruResultsWired = true;
  bindLogoFallback();

  const qEl = document.getElementById('q');
  if (qEl)
    qEl.addEventListener('input', (e) => {
      state.q = e.target.value.trim();
      render();
    });
  const sortEl = document.getElementById('sort');
  if (sortEl)
    sortEl.addEventListener('change', (e) => {
      state.sort = e.target.value;
      render();
    });
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      if (state.filters.has(f)) {
        state.filters.delete(f);
        chip.classList.remove('on');
        chip.setAttribute('aria-pressed', 'false');
      } else {
        state.filters.add(f);
        chip.classList.add('on');
        chip.setAttribute('aria-pressed', 'true');
      }
      render();
    });
  });
  function selectTab(tab) {
    state.view = tab.dataset.view;
    document.querySelectorAll('#main-tabs .tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    render();
  }
  document.querySelectorAll('#main-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const tabs = [...document.querySelectorAll('#main-tabs .tab')];
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      selectTab(next);
    });
  });
  function closeExportMenu() {
    const menu = document.querySelector('#arsiv .export-menu');
    if (menu) menu.open = false;
  }
  const btnJson = document.getElementById('btn-json');
  if (btnJson)
    btnJson.addEventListener('click', () => {
      closeExportMenu();
      if (!lastSnapshot) return;
      downloadBlob(
        'basvuru-verisi-' + dateYmd() + '.json',
        new Blob([JSON.stringify(lastSnapshot, null, 2)], { type: 'application/json' })
      );
    });
  const btnHtml = document.getElementById('btn-html');
  if (btnHtml)
    btnHtml.addEventListener('click', () => {
      closeExportMenu();
      downloadHtmlReport().catch((err) => console.error(err));
    });
  const btnPdf = document.getElementById('btn-pdf');
  if (btnPdf)
    btnPdf.addEventListener('click', () => {
      closeExportMenu();
      printSummaryPdf();
    });
}

wireOnce();

function bootResults() {
  if (window.__BASVURU_SNAPSHOT__) {
    applySnapshot(window.__BASVURU_SNAPSHOT__);
    return;
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(STORAGE_SNAPSHOT, (data) => {
      applySnapshot(data[STORAGE_SNAPSHOT] || null);
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[STORAGE_SNAPSHOT]) return;
        applySnapshot(changes[STORAGE_SNAPSHOT].newValue || null);
      });
    }
  }
}

bootResults();
