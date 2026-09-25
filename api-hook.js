/**
 * MAIN-world network hook: ring-buffer same-origin fetch/XHR responses (+ request bodies,
 * header names) and inline HTML JSON/RSC blobs; replays list requests on demand with the
 * page's own headers (csrf-token re-read from the JSESSIONID cookie at call time).
 * The full request body is kept in memory and handed to the isolated runner for
 * replay. Reports and exports only receive the redacted snippet.
 * Loaded at document_start with world: MAIN, top frame only.
 * Replay is limited to BasvuruUrlAllow.isAllowedReplayUrl, captured at load
 * so a later page script cannot widen the allowlist.
 */
(function basvuruApiHookMain() {
  'use strict';
  // Non-enumerable symbol so the page has no named install flag to probe.
  var GUARD = Symbol.for('b.k');
  try {
    if (window[GUARD]) return;
    Object.defineProperty(window, GUARD, { value: true, enumerable: false, configurable: false, writable: false });
  } catch (_) {
    return;
  }
  try {
    delete window.__basvuruApiHookInstalled;
  } catch (_) {}

  var allowReplay = function () {
    return false;
  };
  try {
    if (window.BasvuruUrlAllow && typeof window.BasvuruUrlAllow.isAllowedReplayUrl === 'function') {
      allowReplay = window.BasvuruUrlAllow.isAllowedReplayUrl;
    }
  } catch (_) {}
  try {
    delete window.BasvuruUrlAllow;
  } catch (_) {}

  var SOURCE = 'basvuru-tracker-api';
  var RING_MAX = 80;
  var RING_PINNED_MAX = 400;
  var SNIP_MAX = 2048;
  var REQ_SNIP_MAX = 4096;
  var REQUEST_BODY_MAX = 256 * 1024;
  var BODY_KEEP_INTERESTING = 4 * 1024 * 1024;
  var BODY_KEEP_OTHER = 64 * 1024;
  var ring = [];
  var pinned = false;
  var seq = 0;
  var origFetch = window.fetch;

  function isSameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (_) {
      return false;
    }
  }

  function redact(text) {
    return String(text || '')
      .replace(/JSESSIONID=[^;"\s]+/gi, 'JSESSIONID=[redacted]')
      .replace(/csrf-token["']?\s*[:=]\s*["'][^"']+/gi, 'csrf-token:"[redacted]"')
      .replace(/([?&]csrf-token=)[^&\s"']+/gi, '$1[redacted]')
      .replace(/authorization["']?\s*[:=]\s*["'][^"']+/gi, 'authorization:"[redacted]"')
      .replace(/"cookie"\s*:\s*"[^"]*"/gi, '"cookie":"[redacted]"');
  }

  function headersFrom(init, requestObj) {
    var out = {};
    function absorb(h) {
      if (!h) return;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function (v, k) {
          out[String(k).toLowerCase()] = String(v);
        });
        return;
      }
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          if (h[i] && h[i][0]) out[String(h[i][0]).toLowerCase()] = String(h[i][1]);
        }
        return;
      }
      if (typeof h === 'object') {
        var keys = Object.keys(h);
        for (var k = 0; k < keys.length; k++) out[String(keys[k]).toLowerCase()] = String(h[keys[k]]);
      }
    }
    try {
      if (requestObj && requestObj.headers) absorb(requestObj.headers);
    } catch (_) {}
    absorb(init && init.headers);
    delete out.cookie;
    delete out.authorization;
    return out;
  }

  /** Resolve a fetch/XHR body to text (null when not replayable, e.g. FormData). */
  function bodyToText(body) {
    if (body == null) return Promise.resolve(null);
    try {
      if (typeof body === 'string') return Promise.resolve(body);
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return Promise.resolve(body.toString());
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob) return body.text();
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        return Promise.resolve(new TextDecoder().decode(body));
      }
    } catch (_) {}
    return Promise.resolve(null);
  }

  function interesting(text) {
    return /\/jobs\/view\/|jobPosting|opportunit/i.test(text);
  }

  function publicEntry(e, withBody) {
    return {
      id: e.id,
      at: e.at,
      url: e.url,
      method: e.method,
      status: e.status,
      contentType: e.contentType,
      size: e.size,
      snippet: e.snippet,
      source: e.source,
      headerNames: Object.keys(e._headers || {}),
      requestBody: typeof e._requestBody === 'string' ? e._requestBody : null,
      requestBodySnippet: e.requestBodySnippet,
      body: withBody ? e.body : undefined,
    };
  }

  function pushRing(entry) {
    ring.push(entry);
    var cap = pinned ? RING_PINNED_MAX : RING_MAX;
    while (ring.length > cap) ring.shift();
    try {
      window.postMessage({ source: SOURCE, type: 'ring', entry: publicEntry(entry, false), size: ring.length }, '*');
    } catch (_) {}
  }

  function recordResponse(meta, bodyText) {
    var url = String(meta.url || '');
    if (!url || !isSameOrigin(url)) return;
    if (/\.(png|jpe?g|gif|webp|svg|woff2?|css)(\?|$)/i.test(url)) return;
    if (/\/li\/track|\/collect|\/beacon|\/pixel/i.test(url)) return;

    var text = bodyText == null ? '' : String(bodyText);
    var keep = interesting(text) ? BODY_KEEP_INTERESTING : BODY_KEEP_OTHER;
    var reqBody = meta.requestBody != null ? String(meta.requestBody) : null;
    seq += 1;
    pushRing({
      id: 'r' + Date.now().toString(36) + '_' + seq,
      at: Date.now(),
      url: url.slice(0, 2000),
      method: String(meta.method || 'GET').toUpperCase(),
      status: meta.status != null ? meta.status : null,
      contentType: meta.contentType || null,
      size: text.length,
      snippet: redact(text.slice(0, SNIP_MAX)),
      body: text.length > keep ? text.slice(0, keep) : text,
      _headers: meta.headers || {},
      _requestBody: reqBody != null && reqBody.length <= REQUEST_BODY_MAX ? reqBody : null,
      requestBodySnippet: reqBody != null ? redact(reqBody.slice(0, REQ_SNIP_MAX)) : null,
      source: meta.source || 'network',
    });
  }

  // ---- fetch ----
  if (typeof origFetch === 'function') {
    window.fetch = function basvuruPatchedFetch(input, init) {
      var url = '';
      var method = (init && init.method) || 'GET';
      var reqObj = null;
      try {
        if (typeof input === 'string') url = input;
        else if (input && typeof input.href === 'string' && !input.method) url = input.href;
        else if (input && typeof input.url === 'string') {
          url = input.url;
          reqObj = input;
          if (!(init && init.method) && input.method) method = input.method;
        }
      } catch (_) {}
      var tracked = !!url && isSameOrigin(url);
      var headers = tracked ? headersFrom(init, reqObj) : null;
      var bodyP = Promise.resolve(null);
      if (tracked) {
        if (init && init.body != null) bodyP = bodyToText(init.body);
        else if (reqObj && !/^(GET|HEAD)$/i.test(method)) {
          try {
            bodyP = reqObj.clone().text();
          } catch (_) {}
        }
        bodyP = bodyP.catch(function () {
          return null;
        });
      }
      return origFetch.apply(this, arguments).then(function (res) {
        if (!tracked || !res || typeof res.clone !== 'function') return res;
        try {
          var clone = res.clone();
          var ct = (clone.headers && clone.headers.get && clone.headers.get('content-type')) || '';
          Promise.all([bodyP, clone.text()])
            .then(function (pair) {
              recordResponse(
                {
                  url: url,
                  method: method,
                  status: res.status,
                  contentType: ct,
                  headers: headers,
                  requestBody: pair[0],
                  source: 'fetch',
                },
                pair[1]
              );
            })
            .catch(function () {});
        } catch (_) {}
        return res;
      });
    };
  }

  // ---- XHR ----
  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.send;
  var XH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__basvuruMethod = method;
    this.__basvuruUrl = url;
    this.__basvuruHeaders = {};
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (!this.__basvuruHeaders) this.__basvuruHeaders = {};
      this.__basvuruHeaders[String(k).toLowerCase()] = String(v);
    } catch (_) {}
    return XH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var url = xhr.__basvuruUrl;
    var method = xhr.__basvuruMethod || 'GET';
    var headers = Object.assign({}, xhr.__basvuruHeaders || {});
    delete headers.cookie;
    delete headers.authorization;
    var reqBodyStr = null;
    try {
      if (typeof body === 'string') reqBodyStr = body;
      else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) reqBodyStr = body.toString();
      else if (body && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
        reqBodyStr = new TextDecoder().decode(body);
      }
    } catch (_) {}
    xhr.addEventListener('load', function () {
      try {
        if (!url || !isSameOrigin(url)) return;
        var ct = '';
        try {
          ct = (xhr.getResponseHeader && xhr.getResponseHeader('content-type')) || '';
        } catch (_) {}
        var text = '';
        try {
          text = xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText || '' : '';
        } catch (_) {
          text = '';
        }
        recordResponse(
          {
            url: url,
            method: method,
            status: xhr.status,
            contentType: ct,
            headers: headers,
            requestBody: reqBodyStr,
            source: 'xhr',
          },
          text
        );
      } catch (_) {}
    });
    return XS.apply(this, arguments);
  };

  // ---- Inline HTML / RSC blobs (after DOM available) ----
  var inlineSeen = Object.create(null);
  var inlineFlightLen = 0;

  function recordInline(tag, contentType, text, source) {
    var key = tag + ':' + text.length;
    if (inlineSeen[key]) return;
    inlineSeen[key] = true;
    recordResponse(
      {
        url: location.href.split('#')[0] + '#' + tag,
        method: 'INLINE',
        status: 200,
        contentType: contentType,
        headers: {},
        requestBody: null,
        source: source,
      },
      text
    );
  }

  function scanInlineBlobs() {
    try {
      var nodes = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], code[id*="bpr"]');
      for (var i = 0; i < Math.min(nodes.length, 60); i++) {
        var t = nodes[i].textContent || '';
        if (t.length < 40) continue;
        recordInline('inline-' + i, nodes[i].getAttribute('type') || 'application/json', t, 'inline');
      }
      var scripts = document.scripts || [];
      var pushes = [];
      for (var s = 0; s < scripts.length; s++) {
        var src = scripts[s].textContent || '';
        if (!src || src.length < 80) continue;
        if (/\.push\(\s*\[\s*1\s*,\s*"/.test(src)) {
          pushes.push(src);
          continue;
        }
        if (/(^|\n)[0-9a-f]{1,8}:(?:I\[|\[|\{)/.test(src.slice(0, 2000)) || /\/jobs\/view\/\d|fsd_jobPosting|jobPostingCard/i.test(src)) {
          recordInline('script-' + s, 'text/javascript+inline', src, 'script');
        }
      }
      if (pushes.length) {
        var combined = pushes.join('\n');
        if (combined.length > inlineFlightLen) {
          inlineFlightLen = combined.length;
          recordInline('rsc-inline', 'text/x-component+inline', combined, 'inline-rsc');
        }
      }
    } catch (_) {}
  }

  function scheduleScans() {
    setTimeout(scanInlineBlobs, 50);
    setTimeout(scanInlineBlobs, 1500);
    setTimeout(scanInlineBlobs, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleScans);
  else scheduleScans();

  function readCsrf() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)JSESSIONID\s*=\s*"?([^";]+)"?/);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  function findEntry(id) {
    for (var i = ring.length - 1; i >= 0; i--) if (ring[i].id === id) return ring[i];
    return null;
  }

  var templateHeaders = Object.create(null);
  var liveReplay = Object.create(null);

  function abortReplays(reqId) {
    var ids = reqId ? [String(reqId)] : Object.keys(liveReplay);
    for (var i = 0; i < ids.length; i++) {
      var ctrl = liveReplay[ids[i]];
      if (!ctrl) continue;
      delete liveReplay[ids[i]];
      try {
        ctrl.abort();
      } catch (_) {}
    }
  }

  function replay(d) {
    var reply = function (payload) {
      try {
        window.postMessage(Object.assign({ source: SOURCE, type: 'replay-result', reqId: d.reqId }, payload), '*');
      } catch (_) {}
    };
    var url = String(d.url || '');
    var method = String(d.method || 'GET').toUpperCase();
    if (typeof origFetch !== 'function' || !allowReplay(url, { method: method, body: d.body })) {
      reply({ ok: false, status: 0, error: 'bad_url' });
      return;
    }
    var tpl = d.templateId ? findEntry(d.templateId) : null;
    if (tpl) templateHeaders[d.templateId] = tpl._headers || {};
    var headers = Object.assign({}, templateHeaders[d.templateId] || {});
    delete headers['content-length'];
    var csrf = readCsrf();
    if (csrf) headers['csrf-token'] = csrf;
    var init = { method: method, headers: headers, credentials: 'include' };
    if (method !== 'GET' && method !== 'HEAD' && d.body != null) init.body = d.body;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) {
      init.signal = ctrl.signal;
      liveReplay[d.reqId] = ctrl;
    }
    var forget = function () {
      delete liveReplay[d.reqId];
    };
    origFetch
      .call(window, url, init)
      .then(function (res) {
        var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        return res.text().then(function (text) {
          forget();
          reply({ ok: res.ok, status: res.status, contentType: ct, text: text });
        });
      })
      .catch(function (err) {
        forget();
        var aborted = !!(err && err.name === 'AbortError');
        reply({
          ok: false,
          status: 0,
          error: aborted ? 'aborted' : String((err && err.message) || err),
        });
      });
  }

  window.addEventListener('message', function (ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data;
      if (!d || d.source !== SOURCE) return;
      if (d.type === 'dump-request') {
        var have = Object.create(null);
        (d.have || []).forEach(function (id) {
          have[id] = true;
        });
        window.postMessage(
          {
            source: SOURCE,
            type: 'dump',
            ring: ring.map(function (e) {
              return publicEntry(e, !have[e.id]);
            }),
            hookInstalled: true,
          },
          '*'
        );
      } else if (d.type === 'scan-begin') {
        pinned = true;
        scanInlineBlobs();
      } else if (d.type === 'scan-end') {
        pinned = false;
        while (ring.length > RING_MAX) ring.shift();
      } else if (d.type === 'replay-abort' || d.type === 'replay-abort-all') {
        abortReplays(d.type === 'replay-abort' ? d.reqId : null);
      } else if (d.type === 'replay' && d.reqId) {
        replay(d);
      }
    } catch (_) {}
  });

  try {
    window.postMessage({ source: SOURCE, type: 'hook-ready', at: Date.now() }, '*');
  } catch (_) {}
})();
