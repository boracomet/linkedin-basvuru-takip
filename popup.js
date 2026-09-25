'use strict';

/**
 * Encoding: UTF-8. Non-ASCII UI via \\uXXXX.
 * Popup opens the LinkedIn scan panel. Range and start stay on that panel.
 */

const STORAGE_SNAPSHOT = 'basvuruSnapshot';

const T = {
  lede:
    'Oturum a\u00e7t\u0131\u011f\u0131n LinkedIn hesab\u0131ndaki \u00abBa\u015fvuruldu\u00bb listesini okur. Verilerin yaln\u0131zca bilgisayar\u0131nda kal\u0131r, hi\u00e7bir yere g\u00f6nderilmez.',
  hint:
    'LinkedIn sekmesindeyken \u00abTarama arac\u0131n\u0131 a\u00e7\u00bba bas. \u00abBa\u015fvuruldu\u00bb sayfas\u0131nda de\u011filsen eklenti seni oraya g\u00f6t\u00fcr\u00fcr. Aral\u0131k se\u00e7imi ve tarama panelde yap\u0131l\u0131r.',
  start: 'Tarama arac\u0131n\u0131 a\u00e7',
  opening: 'A\u00e7\u0131l\u0131yor\u2026',
  results: 'Kay\u0131tl\u0131 sonu\u00e7lar\u0131 a\u00e7',
  report: 'Daha \u00f6nceki tarama raporu',
  needLinkedIn: 'Bu i\u015flem yaln\u0131zca LinkedIn sekmesinde \u00e7al\u0131\u015f\u0131r. linkedin.com\u2019u a\u00e7\u0131p yeniden dene.',
  navigating: '\u00abBa\u015fvuruldu\u00bb sayfas\u0131na gidiliyor\u2026 Tarama paneli orada a\u00e7\u0131lacak.',
  noTab: 'Etkin sekme bulunamad\u0131.',
  noSaved: 'Hen\u00fcz kay\u0131tl\u0131 tarama yok. \u00d6nce bir tarama yap.',
  savedPrefix: 'Son tarama: ',
  error: 'Bir sorun olu\u015ftu. Sayfay\u0131 yenileyip yeniden dene.',
};

const ledeEl = document.getElementById('lede');
const hintEl = document.getElementById('hint');
const btn = document.getElementById('btn-start');
const btnResults = document.getElementById('btn-results');
const reportLabelEl = document.getElementById('report-label');
const statusEl = document.getElementById('status');
let interactionLocked = false;

ledeEl.textContent = T.lede;
hintEl.textContent = T.hint;
btn.textContent = T.start;
btnResults.textContent = T.results;
reportLabelEl.textContent = T.report;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function setStatus(msg, kind) {
  statusEl.hidden = !msg;
  statusEl.textContent = msg || '';
  statusEl.classList.remove('warn', 'error', 'ok');
  if (kind) statusEl.classList.add(kind);
  if (reportLabelEl && (kind === 'error' || kind === 'warn')) reportLabelEl.hidden = true;
}

function isLinkedInUrl(url) {
  try {
    const u = new URL(url || '');
    return /(^|\.)linkedin\.com$/i.test(u.hostname);
  } catch (_) {
    return false;
  }
}

function hasSavedReport(snap) {
  if (!snap || typeof snap !== 'object') return false;
  if (snap.count) return true;
  return Array.isArray(snap.applications) && snap.applications.length > 0;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function refreshSavedHint() {
  const data = await chrome.storage.local.get(STORAGE_SNAPSHOT);
  // A click can set status before this first read finishes. Do not wipe it.
  if (interactionLocked) return;
  if (statusEl.classList.contains('error') || statusEl.classList.contains('warn')) return;
  const snap = data[STORAGE_SNAPSHOT];
  if (!hasSavedReport(snap)) {
    reportLabelEl.hidden = true;
    btnResults.hidden = true;
    setStatus('');
    return;
  }
  reportLabelEl.hidden = false;
  btnResults.hidden = false;
  const when = snap.scrapedAtDisplay || snap.scrapedAt || '';
  const range = snap.rangeLabel || snap.range || '';
  setStatus('', 'ok');
  statusEl.hidden = false;
  statusEl.innerHTML =
    escapeHtml(T.savedPrefix) +
    '<span class="stat">' +
    escapeHtml(String(snap.count || 0)) +
    '</span> ba\u015fvuru' +
    (range ? ' \u00b7 ' + escapeHtml(range) : '') +
    (when ? '\n' + escapeHtml(when) : '');
}

btnResults.addEventListener('click', async () => {
  const data = await chrome.storage.local.get(STORAGE_SNAPSHOT);
  if (!data[STORAGE_SNAPSHOT] || !(data[STORAGE_SNAPSHOT].applications || []).length) {
    setStatus(T.noSaved, 'warn');
    return;
  }
  await chrome.runtime.sendMessage({ type: 'basvuru-open-results' });
});

btn.addEventListener('click', async () => {
  if (btn.disabled) return;
  interactionLocked = true;
  btn.disabled = true;
  btn.textContent = T.opening;
  let started = false;

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus(T.noTab, 'error');
      return;
    }
    if (tab.url && !isLinkedInUrl(tab.url)) {
      setStatus(T.needLinkedIn, 'error');
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: 'basvuru-open-panel-request',
      tabId: tab.id,
    });
    if (!res || !res.ok) {
      if (res && res.code === 'need-linkedin') setStatus(T.needLinkedIn, 'error');
      else if (res && res.code === 'no-tab') setStatus(T.noTab, 'error');
      else {
        const detail = res && res.error ? res.error : '';
        setStatus(T.error + (detail ? ' (ayr\u0131nt\u0131: ' + detail + ')' : ''), 'error');
      }
      return;
    }
    if (res.navigating) setStatus(T.navigating);
    started = true;
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    setStatus(T.error + (detail ? ' (ayr\u0131nt\u0131: ' + detail + ')' : ''), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = T.start;
    if (!started) interactionLocked = false;
  }
  // Background has already delivered the panel message or the tab navigation.
  if (started) window.close();
});

refreshSavedHint();
