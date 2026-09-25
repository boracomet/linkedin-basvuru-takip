'use strict';

/**
 * Opens the results page, and mounts the LinkedIn scan panel without starting a scan.
 * Navigation stays here so closing the popup cannot drop the tab update.
 */

const TARGET_URL = 'https://www.linkedin.com/jobs-tracker/?stage=applied';
const STORAGE_OPEN_PANEL = 'basvuruOpenPanel';
const STORAGE_AUTOSTART = 'basvuruAutostart';
const OPEN_MSG = 'basvuru-open-panel';

const SCRAPE_FILES = [
  'url-allow.js',
  'status.js',
  'tracker-parse.js',
  'tracker-paginate.js',
  'tracker-hydrate.js',
  'tracker-rsc.js',
  'tracker-api.js',
  'tracker-api-runner.js',
  'scrape-panel-ui.js',
  'scrape.js',
];

const reloadedAt = new Map();

function classifyLinkedIn(url) {
  let u;
  try {
    u = new URL(url || '');
  } catch (_) {
    return 'other';
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return 'other';
  const path = (u.pathname || '').replace(/\/+$/, '') || '/';
  const onTracker =
    /(^|\/)jobs-tracker(\/|$)/.test(path) || /(^|\/)jobs\/tracker(\/|$)/.test(path);
  if (!onTracker) return 'linkedin';
  const stage = (u.searchParams.get('stage') || '').toLowerCase();
  if (stage && stage !== 'applied') return 'tracker';
  if (/\/(interviewed|interviewing|interview|archived|saved)(\/|$)/.test(path)) return 'tracker';
  return 'applied';
}

function tooSoon(tabId) {
  const t = reloadedAt.get(tabId) || 0;
  return Date.now() - t < 8000;
}

function markReload(tabId) {
  reloadedAt.set(tabId, Date.now());
}

async function pingPanel(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: OPEN_MSG });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

async function injectScrape(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId, allFrames: false },
    files: SCRAPE_FILES,
  });
}

async function rememberOpenWithoutScan() {
  await chrome.storage.local.set({ [STORAGE_OPEN_PANEL]: true });
  await chrome.storage.local.remove(STORAGE_AUTOSTART);
}

function scheduleNudges(tabId) {
  [600, 1600, 3200].forEach((ms) => {
    setTimeout(() => {
      nudge(tabId);
    }, ms);
  });
}

async function nudge(tabId) {
  let data;
  try {
    data = await chrome.storage.local.get(STORAGE_OPEN_PANEL);
  } catch (_) {
    return;
  }
  if (!data[STORAGE_OPEN_PANEL]) return;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    return;
  }
  if (classifyLinkedIn(tab.url) !== 'applied') return;
  const ok = await pingPanel(tabId);
  if (!ok) return;
  try {
    await chrome.storage.local.remove(STORAGE_OPEN_PANEL);
  } catch (_) {}
}

async function openScanPanel(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const kind = classifyLinkedIn(tab.url);
  if (kind === 'other') return { ok: false, code: 'need-linkedin' };

  if (kind === 'applied') {
    if (await pingPanel(tabId)) return { ok: true };
    try {
      await injectScrape(tabId);
    } catch (_) {}
    if (await pingPanel(tabId)) return { ok: true };
    if (tooSoon(tabId)) return { ok: false, code: 'no-panel' };
    await rememberOpenWithoutScan();
    markReload(tabId);
    await chrome.tabs.reload(tabId);
    scheduleNudges(tabId);
    return { ok: true, navigating: true };
  }

  if (tooSoon(tabId)) return { ok: false, code: 'no-panel' };
  await rememberOpenWithoutScan();
  markReload(tabId);
  await chrome.tabs.update(tabId, { url: TARGET_URL });
  scheduleNudges(tabId);
  return { ok: true, navigating: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'basvuru-open-results') {
    const url = chrome.runtime.getURL('results.html');
    chrome.tabs
      .create({ url: url })
      .then(() => sendResponse({ ok: true }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: String(err && err.message ? err.message : err),
        })
      );
    return true;
  }
  if (msg.type !== 'basvuru-open-panel-request') return;
  if (!msg.tabId) {
    sendResponse({ ok: false, code: 'no-tab' });
    return;
  }
  openScanPanel(msg.tabId).then(sendResponse, (err) =>
    sendResponse({
      ok: false,
      code: 'error',
      error: String(err && err.message ? err.message : err),
    })
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info || info.status !== 'complete') return;
  if (!tab || classifyLinkedIn(tab.url) !== 'applied') return;
  nudge(tabId);
});
