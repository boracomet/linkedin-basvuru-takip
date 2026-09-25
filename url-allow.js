/**
 * URL allowlist shared by the extension.
 *
 * Classic script (content scripts and extension pages such as results.html):
 *   window.BasvuruUrlAllow
 * Node tests: require('./url-allow.js')
 *
 * Job links and company logos are checked before the extension renders or
 * follows them. Replay URLs are the only LinkedIn endpoints api-hook.js may
 * re-send with the user's session.
 */
(function (root) {
  'use strict';

  var JOB_HOST = 'www.linkedin.com';
  var LOGO_HOSTS = {
    'media.licdn.com': true,
    'static.licdn.com': true,
  };

  /** Exact pathnames api-hook.js may replay. Query strings are checked separately. */
  var REPLAY_ALLOW_PATHS = [
    '/voyager/api/graphql',
    '/voyager/api/voyagerJobsDashJobCards',
    '/flagship-web/rsc-action/actions/server-request',
    '/flagship-web/rsc-action/actions/pagination',
  ];

  var REPLAY_PATH = {};
  for (var i = 0; i < REPLAY_ALLOW_PATHS.length; i++) REPLAY_PATH[REPLAY_ALLOW_PATHS[i]] = true;

  var JOBS_QUERY_ID = /^voyagerJobs[A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/;
  var TRACKER_MARKER = /opportunity[_-]?tracker/i;
  /** Single path segment after /jobs/view/: optional lowercase slug, then the job id. */
  var JOB_VIEW_SEGMENT = /^(?:[a-z0-9-]+-)?\d{6,}$/;

  function parseHttpsUrl(input) {
    if (typeof input !== 'string') return null;
    var raw = input.trim();
    if (!raw || raw.length > 4096) return null;
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
    if (/^(?:javascript|data|blob|vbscript):/i.test(raw)) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;
    var u;
    try {
      u = new URL(raw);
    } catch (_) {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (u.port) return null;
    if (!u.hostname || u.hostname.slice(-1) === '.') return null;
    return u;
  }

  function normPath(pathname) {
    var p = String(pathname || '/');
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  function isAllowedJobUrl(url) {
    var u = parseHttpsUrl(url);
    if (!u || u.hostname !== JOB_HOST) return false;
    var path = normPath(u.pathname);
    var view = path.match(/^\/jobs\/view\/([^/]+)$/);
    if (view) return JOB_VIEW_SEGMENT.test(view[1]);
    if (path === '/jobs/search' || path === '/jobs/search-results' || /^\/jobs\/collections\/[^/]+$/.test(path)) {
      return /^\d{6,}$/.test(u.searchParams.get('currentJobId') || '');
    }
    return false;
  }

  /** Parsed https href when the job URL is on the allowlist, otherwise null. */
  function safeJobUrl(url) {
    if (!isAllowedJobUrl(url)) return null;
    var u = parseHttpsUrl(url);
    return u ? u.href : null;
  }

  function isAllowedLogoUrl(url) {
    var u = parseHttpsUrl(url);
    if (!u || !LOGO_HOSTS[u.hostname]) return false;
    var path = u.pathname || '/';
    if (path === '/') return false;
    if (/profile-displayphoto|profile-framedphoto|ghost-person/i.test(path + u.search)) return false;
    return true;
  }

  function jobsQueryIdOk(value) {
    return JOBS_QUERY_ID.test(String(value || ''));
  }

  function queryIdFromBody(body) {
    if (body == null) return '';
    var s = String(body).slice(0, 20000);
    var json = s.match(/"queryId"\s*:\s*"([^"]+)"/);
    if (json) return json[1];
    var form = s.match(/(?:^|[&\n])queryId=([^&\s]+)/);
    if (!form) return '';
    try {
      return decodeURIComponent(form[1]);
    } catch (_) {
      return '';
    }
  }

  function graphqlTargetsJobs(u, body) {
    if (u.searchParams.has('queryId') || /(?:^|[?&])queryId=/i.test(u.search)) {
      return jobsQueryIdOk(u.searchParams.get('queryId'));
    }
    return jobsQueryIdOk(queryIdFromBody(body));
  }

  function firstParam(u, names) {
    for (var i = 0; i < names.length; i++) {
      if (u.searchParams.has(names[i])) return u.searchParams.get(names[i]) || '';
    }
    return null;
  }

  function flagshipTargetsTracker(u, body) {
    var sdui = firstParam(u, ['sduiid', 'sduiId']);
    if (sdui != null) return TRACKER_MARKER.test(sdui);
    if (firstParam(u, ['componentId', 'componentid']) != null) return false;
    var s = body == null ? '' : String(body).slice(0, 20000);
    return TRACKER_MARKER.test(s);
  }

  /**
   * True only for the applied-jobs tracker calls the extension replays.
   * @param {string} url
   * @param {{method?:string, body?:string}|undefined} [opts]
   */
  function isAllowedReplayUrl(url, opts) {
    opts = opts || {};
    var method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') return false;
    var u = parseHttpsUrl(url);
    if (!u || u.hostname !== JOB_HOST) return false;
    var path = normPath(u.pathname);
    if (!REPLAY_PATH[path]) return false;
    if (path === '/voyager/api/graphql') return graphqlTargetsJobs(u, opts.body);
    if (path === '/voyager/api/voyagerJobsDashJobCards') return true;
    return flagshipTargetsTracker(u, opts.body);
  }

  var api = {
    isAllowedJobUrl: isAllowedJobUrl,
    safeJobUrl: safeJobUrl,
    isAllowedLogoUrl: isAllowedLogoUrl,
    isAllowedReplayUrl: isAllowedReplayUrl,
    REPLAY_ALLOW_PATHS: REPLAY_ALLOW_PATHS.slice(),
  };

  root.BasvuruUrlAllow = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
