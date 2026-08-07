/**
 * Shared multipage SiteRuntime — mark/share, count-up, reveal, mobile nav.
 * Bundled as assets/site.js (and optionally inlined). Numbers are never invented:
 * count-up reads data-countup / data-final / rendered text and restores the
 * original DOM string when the animation completes.
 */

/** Relative href to assets/site.js from a page path. */
export function siteRuntimeHref(fromPath: string): string {
  const depth = fromPath.includes("/")
    ? fromPath.split("/").filter(Boolean).length - 1
    : 0;
  return `${"../".repeat(depth)}assets/site.js`;
}

export const SITE_RUNTIME_JS = `
(function(){
  'use strict';

  function pageKey(){
    try {
      var p = (location.pathname || '').split('/').filter(Boolean).pop() || 'index.html';
      return p.replace(/\\.html$/i,'') || 'index';
    } catch(e){ return 'index'; }
  }

  function marksKey(){
    return 'rs-marks-' + pageKey();
  }

  /* ── Mobile nav ── */
  function initMobileNav(){
    var btn = document.querySelector('[data-nav-toggle]');
    var panel = document.getElementById('nav-mobile');
    if (!btn || !panel) return;
    btn.addEventListener('click', function(){
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.documentElement.classList.toggle('nav-mobile-open', open);
    });
    panel.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        document.documentElement.classList.remove('nav-mobile-open');
      });
    });
  }

  /* ── Financials dropdown (desktop) ── */
  function initNavDropdown(){
    document.querySelectorAll('.nav-dd-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var open = btn.getAttribute('aria-expanded') === 'true';
        document.querySelectorAll('.nav-dd-btn').forEach(function(b){
          b.setAttribute('aria-expanded', 'false');
          if (b.parentElement) b.parentElement.classList.remove('is-open');
        });
        if (!open) {
          btn.setAttribute('aria-expanded', 'true');
          if (btn.parentElement) btn.parentElement.classList.add('is-open');
        }
      });
    });
    document.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.closest && t.closest('.nav-dd')) return;
      document.querySelectorAll('.nav-dd-btn').forEach(function(b){
        b.setAttribute('aria-expanded', 'false');
        if (b.parentElement) b.parentElement.classList.remove('is-open');
      });
    });
  }

  /* ── Page share bar ── */
  function initShareBar(){
    document.querySelectorAll('[data-share="copy"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var url = location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function(){
            var prev = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(function(){ btn.textContent = prev; }, 1600);
          });
        }
      });
    });
    document.querySelectorAll('[data-share="linkedin"]').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        var u = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(location.href);
        window.open(u, '_blank', 'noopener,noreferrer');
      });
    });
  }

  /* ── Count-up (DOM values only) ── */
  function parseEnd(el){
    if (el.dataset.countup != null && el.dataset.countup !== '') {
      var n = parseFloat(String(el.dataset.countup).replace(/\\s/g, ''));
      if (!isNaN(n)) return n;
    }
    var raw = (el.getAttribute('data-final') || el.textContent || '').replace(/[^0-9.+-]/g, '');
    var v = parseFloat(raw);
    return isNaN(v) ? 0 : v;
  }

  function formatCount(n, decimals, sep){
    var f = n.toFixed(decimals);
    var parts = f.split('.');
    var int = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, sep);
    return parts.length > 1 ? int + '.' + parts[1] : int;
  }

  function initCountUp(){
    var targets = document.querySelectorAll('[data-countup]');
    if (!targets.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        var el = entry.target;
        var finalText = el.getAttribute('data-final') || el.textContent || '';
        var end = parseEnd(el);
        var decimals = parseInt(el.dataset.decimals || '0', 10);
        if (isNaN(decimals)) decimals = 0;
        var sep = el.dataset.sep !== undefined ? el.dataset.sep : ' ';
        var prefix = el.dataset.prefix || '';
        var suffix = el.dataset.suffix || '';
        var t0 = performance.now();
        var dur = 1100;
        function step(t){
          var p = Math.min((t - t0) / dur, 1);
          var ease = 1 - Math.pow(1 - p, 4);
          var cur = end * ease;
          if (p < 1) {
            el.textContent = prefix + formatCount(cur, decimals, sep) + suffix;
            requestAnimationFrame(step);
          } else {
            // Restore exact rendered string — never invent a final figure.
            el.textContent = finalText;
          }
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.3 });
    targets.forEach(function(el){
      if (!el.getAttribute('data-final')) {
        el.setAttribute('data-final', el.textContent || '');
      }
      io.observe(el);
    });
  }

  /* ── Scroll reveal ── */
  function initReveal(){
    var items = document.querySelectorAll('.reveal, .kpi-card');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      items.forEach(function(el){ el.classList.add('is-visible', 'revealed'); });
      return;
    }
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible', 'revealed');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    items.forEach(function(el){ io.observe(el); });
  }

  /* ── Selection mark / share tooltip ── */
  function hideSelTooltip(){
    var tip = document.getElementById('share-tooltip');
    if (tip) tip.classList.remove('is-visible');
  }

  function saveMarks(){
    var marks = Array.prototype.map.call(
      document.querySelectorAll('mark.user-mark'),
      function(m){ return (m.textContent || '').trim(); }
    ).filter(Boolean);
    try { localStorage.setItem(marksKey(), JSON.stringify(marks)); } catch(e) {}
  }

  function wrapRange(range){
    if (!range) return;
    try {
      var mark = document.createElement('mark');
      mark.className = 'user-mark';
      range.surroundContents(mark);
      saveMarks();
    } catch(e) {
      // Partial-node selections can throw; ignore rather than break the page.
    }
  }

  function restoreMarks(){
    var raw;
    try { raw = localStorage.getItem(marksKey()); } catch(e) { return; }
    if (!raw) return;
    var list;
    try { list = JSON.parse(raw); } catch(e) { return; }
    if (!Array.isArray(list)) return;
    list.forEach(function(text){
      if (!text || typeof text !== 'string') return;
      if (document.body && document.body.textContent && document.body.textContent.indexOf(text) === -1) return;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var val = node.nodeValue || '';
        var idx = val.indexOf(text);
        if (idx === -1) continue;
        if (node.parentElement && node.parentElement.closest && node.parentElement.closest('mark.user-mark, script, style, .site-nav, #share-tooltip')) continue;
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        wrapRange(range);
        break;
      }
    });
  }

  function initSelectionShare(){
    var tip = document.getElementById('share-tooltip');
    if (!tip) return;

    document.addEventListener('mouseup', function(){
      var sel = window.getSelection();
      var text = sel ? String(sel.toString()).trim() : '';
      if (text.length < 12) { hideSelTooltip(); return; }
      try {
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) { hideSelTooltip(); return; }
        tip.style.top = (rect.top + window.scrollY - 48) + 'px';
        tip.style.left = (rect.left + window.scrollX + rect.width / 2) + 'px';
        tip._selectedText = text;
        tip._selectedRange = range.cloneRange();
        tip.classList.add('is-visible');
      } catch(e) { hideSelTooltip(); }
    });

    document.addEventListener('mousedown', function(e){
      if (tip.contains(e.target)) return;
      hideSelTooltip();
    });

    var copyBtn = document.getElementById('sel-share-copy');
    if (copyBtn) copyBtn.addEventListener('click', function(){
      var t = tip._selectedText || '';
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t);
      hideSelTooltip();
    });

    var markBtn = document.getElementById('sel-share-mark');
    if (markBtn) markBtn.addEventListener('click', function(){
      wrapRange(tip._selectedRange);
      hideSelTooltip();
    });

    var liBtn = document.getElementById('sel-share-linkedin');
    if (liBtn) liBtn.addEventListener('click', function(){
      window.open(
        'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(location.href),
        '_blank',
        'noopener,noreferrer'
      );
      hideSelTooltip();
    });
  }

  function boot(){
    initMobileNav();
    initNavDropdown();
    initShareBar();
    initReveal();
    initCountUp();
    initSelectionShare();
    restoreMarks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`.trim();
