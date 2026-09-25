/**
 * Pure pagination matchers (no DOM). Used by scrape.js and node tests.
 */
(function (root) {
  'use strict';

  function normLabel(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isDisabledFlag(c) {
    if (!c) return true;
    if (c.disabled) return true;
    if (c.ariaDisabled === true || c.ariaDisabled === 'true') return true;
    return false;
  }

  /** True if this control is a "next page" / ileri control. */
  function isNextLabel(label, text) {
    var L = normLabel(label);
    var T = normLabel(text);
    var either = L || T;
    if (!either) return false;
    if (/^(geri|previous|back)$/i.test(either)) return false;
    if (L === '\u0130leri' || T === '\u0130leri' || L === 'Ileri' || T === 'Ileri') return true;
    if (/^Next$/i.test(L) || /^Next$/i.test(T)) return true;
    if (/^Sonraki$/i.test(L) || /^Sonraki$/i.test(T)) return true;
    if (/^(next|sonraki)\s*(page|sayfa)?$/i.test(either)) return true;
    if (/aria-label/i.test(either)) return false;
    // Short "…ileri" labels (LinkedIn sometimes uses icon+İleri)
    if (either.length <= 14 && /ileri$/i.test(either) && !/sayfa|ana/i.test(either)) return true;
    if (/^go to next/i.test(either)) return true;
    return false;
  }

  /** Numbered page button: "2", "Sayfa 2", "Page 2", aria-label^="Sayfa ". */
  function isPageNumberLabel(label, text, n) {
    var want = String(n);
    var L = normLabel(label);
    var T = normLabel(text);
    if (T === want) {
      if (L && /geri|ileri|previous|next|sonraki/i.test(L) && !new RegExp('\\b' + want + '\\b').test(L)) {
        return false;
      }
      return true;
    }
    // Exact "Sayfa N" / "Page N" (LinkedIn aria-label)
    if (new RegExp('^(?:sayfa|page)\\s*' + want + '$', 'i').test(L)) return true;
    if (new RegExp('^(?:sayfa|page)\\s*' + want + '$', 'i').test(T)) return true;
    if (new RegExp('(?:sayfa|page)\\s*' + want + '\\b', 'i').test(L)) return true;
    if (new RegExp('(?:sayfa|page)\\s*' + want + '\\b', 'i').test(T)) return true;
    return false;
  }

  function isLoadMoreLabel(label, text) {
    var either = normLabel(label || text);
    if (!either) return false;
    return (
      /daha fazla (sonu\u00e7 )?g[oö]ster/i.test(either) ||
      /show more( results)?/i.test(either) ||
      /load more/i.test(either) ||
      /see more( results)?/i.test(either)
    );
  }

  /**
   * Pick next action from a list of control descriptors.
   * @param {Array<{disabled?:boolean,ariaDisabled?:any,label?:string,text?:string,kind?:string}>} controls
   * @param {{currentPage?:number|null}} opts
   * @returns {{type:'next'|'page'|'loadMore', control:object}|null}
   */
  function pickPaginationAction(controls, opts) {
    opts = opts || {};
    var list = controls || [];
    var i;
    var c;

    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (isDisabledFlag(c)) continue;
      if (isNextLabel(c.label, c.text)) return { type: 'next', control: c };
    }

    var cur = opts.currentPage != null ? Number(opts.currentPage) : null;
    if (cur != null && isFinite(cur) && cur >= 1) {
      var want = cur + 1;
      for (i = 0; i < list.length; i++) {
        c = list[i];
        if (isDisabledFlag(c)) continue;
        if (isPageNumberLabel(c.label, c.text, want)) return { type: 'page', control: c, page: want };
      }
    } else {
      // Prefer page "2" if we don't know current page
      for (i = 0; i < list.length; i++) {
        c = list[i];
        if (isDisabledFlag(c)) continue;
        if (isPageNumberLabel(c.label, c.text, 2)) return { type: 'page', control: c, page: 2 };
      }
    }

    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (isDisabledFlag(c)) continue;
      if (isLoadMoreLabel(c.label, c.text)) return { type: 'loadMore', control: c };
    }

    return null;
  }

  /**
   * Extract control descriptors from an HTML fixture string (no DOM needed).
   * Matches button/a tags and elements with role="button" without swallowing nested controls.
   */
  function controlsFromHtmlFixture(html) {
    var s = String(html || '');
    var out = [];

    function pushFromMatch(tag, attrs, inner) {
      var aria = (attrs.match(/\baria-label\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
      var disabled =
        /\bdisabled\b/i.test(attrs) || /\baria-disabled\s*=\s*["']true["']/i.test(attrs);
      var text = String(inner || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({
        tag: tag,
        label: aria,
        text: text,
        disabled: disabled,
        ariaDisabled: /\baria-disabled\s*=\s*["']true["']/i.test(attrs) ? 'true' : 'false',
      });
    }

    var reBtn = /<(button|a)([^>]*)>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = reBtn.exec(s))) {
      pushFromMatch(m[1].toLowerCase(), m[2] || '', m[3] || '');
    }

    var reRole = /<(div|li|span)([^>]*\brole\s*=\s*["']button["'][^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((m = reRole.exec(s))) {
      pushFromMatch(m[1].toLowerCase(), m[2] || '', m[3] || '');
    }

    return out;
  }

  var api = {
    normLabel: normLabel,
    isNextLabel: isNextLabel,
    isPageNumberLabel: isPageNumberLabel,
    isLoadMoreLabel: isLoadMoreLabel,
    pickPaginationAction: pickPaginationAction,
    controlsFromHtmlFixture: controlsFromHtmlFixture,
  };

  root.BasvuruTrackerPaginate = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
