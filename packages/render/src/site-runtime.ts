/**
 * Shared multipage SiteRuntime — mark/share, count-up, reveal, mobile nav.
 * Bundled as assets/site.js (and optionally inlined). Numbers are never invented:
 * count-up reads data-countup / data-final / rendered text and restores the
 * original DOM string when the animation completes.
 *
 * Progressive enhancement only: content must remain visible if this never runs.
 * html.rs-motion is armed inside initReveal after above-fold items are marked visible.
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

  /* rs-motion is armed inside initReveal AFTER marking above-fold items visible.
     Arming first hid .reveal at opacity:0; iframe IO sometimes never fired → blank. */

  function pageKey(){
    try {
      var p = (location.pathname || '').split('/').filter(Boolean).pop() || 'index.html';
      return p.replace(/\\.html$/i,'') || 'index';
    } catch(e){ return 'index'; }
  }

  function marksKey(){
    return 'rs-marks-' + pageKey();
  }

  function pageTitle(){
    var h = document.querySelector('.page-hero h1, .home-hero h1, title');
    return (h && (h.textContent || '').trim()) || document.title || 'Results';
  }

  function linkedInShareUrl(){
    return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(location.href);
  }

  /* ── Toast ── */
  var toastTimer = null;
  function showToast(msg){
    var el = document.getElementById('share-toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      el.classList.remove('is-visible');
      setTimeout(function(){ el.hidden = true; }, 220);
    }, 1800);
  }

  function copyText(text, okMsg){
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){
        showToast(okMsg || 'Copied');
      }).catch(function(){
        fallbackCopy(text, okMsg);
      });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly','');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(okMsg || 'Copied');
    } catch(e) {}
  }

  function openEmailShare(extraBody){
    var subject = encodeURIComponent(pageTitle());
    var bodyTxt = pageTitle() + '\\n\\n' + location.href;
    if (extraBody) bodyTxt += '\\n\\n' + extraBody;
    location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(bodyTxt);
  }

  /* ── Sticky nav scroll state ── */
  function initNavScroll(){
    var nav = document.querySelector('.site-nav');
    if (!nav) return;
    var onScroll = function(){
      if (window.scrollY > 8) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Brand / banner images: hide broken <img>, fall back to text / atmosphere ── */
  function failBrandImg(img){
    if (!img || img.dataset.brandFailed === '1') return;
    img.dataset.brandFailed = '1';
    img.setAttribute('hidden', '');
    img.removeAttribute('src');
    var wrap = img.closest('.nav-brand__logo-wrap, .home-hero__lockup, .site-footer__lockup');
    if (wrap) wrap.classList.add('is-broken');
    var brand = img.closest('.nav-brand');
    if (brand) {
      brand.classList.remove('nav-brand--logo');
      if (!brand.querySelector('.nav-brand__mark')) {
        var mark = document.createElement('span');
        mark.className = 'nav-brand__mark';
        mark.setAttribute('aria-hidden', 'true');
        brand.insertBefore(mark, brand.firstChild);
      }
    }
  }

  function failBannerImg(img){
    if (!img || img.dataset.bannerFailed === '1') return;
    img.dataset.bannerFailed = '1';
    img.setAttribute('hidden', '');
    img.removeAttribute('src');
    var hero = img.closest('.home-hero');
    if (hero) {
      hero.classList.remove('home-hero--photo', 'home-hero--strip', 'home-hero--page');
      hero.classList.add('home-hero--atmosphere');
    }
  }

  function initBrandImages(){
    document.querySelectorAll('img[data-brand-img]').forEach(function(img){
      img.addEventListener('error', function(){ failBrandImg(img); });
      // Cached 404 / already-failed decode
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
        failBrandImg(img);
      }
    });
    document.querySelectorAll('img[data-banner-img]').forEach(function(img){
      img.addEventListener('error', function(){ failBannerImg(img); });
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
        failBannerImg(img);
      }
    });
  }

  /* ── Mobile nav ── */
  function setMobileNav(open){
    var btn = document.querySelector('[data-nav-toggle]');
    var panel = document.getElementById('nav-mobile');
    if (!panel) return;
    panel.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('nav-mobile-open', open);
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
  }

  function closeMobileNav(){
    setMobileNav(false);
  }

  function initMobileNav(){
    var btn = document.querySelector('[data-nav-toggle]');
    var panel = document.getElementById('nav-mobile');
    if (!btn || !panel) return;
    btn.addEventListener('click', function(){
      setMobileNav(!panel.classList.contains('is-open'));
    });
    panel.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(){ closeMobileNav(); });
    });
  }

  /* ── Financials dropdown (desktop) ── */
  function closeNavDropdowns(){
    document.querySelectorAll('.nav-dd-btn').forEach(function(b){
      b.setAttribute('aria-expanded', 'false');
      if (b.parentElement) b.parentElement.classList.remove('is-open');
    });
  }

  function initNavDropdown(){
    document.querySelectorAll('.nav-dd-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var open = btn.getAttribute('aria-expanded') === 'true';
        closeNavDropdowns();
        if (!open) {
          btn.setAttribute('aria-expanded', 'true');
          if (btn.parentElement) btn.parentElement.classList.add('is-open');
        }
      });
    });
    document.addEventListener('click', function(e){
      var t = e.target;
      if (t && t.closest && t.closest('.nav-dd')) return;
      closeNavDropdowns();
    });
  }

  /* ── Page share bar ── */
  function initShareBar(){
    document.querySelectorAll('[data-share="copy"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var url = location.href;
        var txt = btn.querySelector('.share-bar__txt');
        var prev = txt ? txt.textContent : btn.textContent;
        copyText(url, 'Link copied');
        btn.classList.add('is-active');
        if (txt) txt.textContent = 'Copied';
        else btn.textContent = 'Copied';
        setTimeout(function(){
          btn.classList.remove('is-active');
          if (txt) txt.textContent = prev;
          else btn.textContent = prev;
        }, 1600);
      });
    });
    document.querySelectorAll('[data-share="linkedin"]').forEach(function(el){
      el.addEventListener('click', function(e){
        e.preventDefault();
        window.open(linkedInShareUrl(), '_blank', 'noopener,noreferrer');
        showToast('Opening LinkedIn');
      });
    });
    document.querySelectorAll('[data-share="email"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        openEmailShare();
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
        var dur = 1200;
        function step(t){
          var p = Math.min((t - t0) / dur, 1);
          var ease = 1 - Math.pow(1 - p, 5);
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
    }, { threshold: 0.28 });
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
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    /* Sync: mark anything already in the viewport before hiding the rest. */
    items.forEach(function(el){
      var rect = el.getBoundingClientRect();
      if (rect.top < vh * 0.98 && rect.bottom > 0) {
        el.classList.add('is-visible', 'revealed');
      }
    });
    try { document.documentElement.classList.add('rs-motion'); } catch (e) {}
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
    }, { threshold: 0.05, rootMargin: '0px 0px 0px 0px' });
    items.forEach(function(el){
      if (!el.classList.contains('is-visible')) io.observe(el);
    });
    /* Failsafe — never leave editorial/KPI stuck at opacity:0 in iframe. */
    setTimeout(function(){
      items.forEach(function(el){
        if (!el.classList.contains('is-visible')) {
          el.classList.add('is-visible', 'revealed');
        }
      });
    }, 900);
  }

  /* ── Selection mark / share tooltip ── */
  function hideSelTooltip(){
    var tip = document.getElementById('share-tooltip');
    if (!tip) return;
    tip.classList.remove('is-visible');
    tip.hidden = true;
    tip._selectedText = '';
    tip._selectedRange = null;
  }

  function showSelTooltip(tip){
    tip.hidden = false;
    tip.classList.add('is-visible');
    var first = tip.querySelector('.share-tip-btn');
    if (first && first.focus) {
      try { first.focus({ preventScroll: true }); } catch (e) { try { first.focus(); } catch (e2) {} }
    }
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
      showToast('Highlight saved');
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
        if (node.parentElement && node.parentElement.closest && node.parentElement.closest('mark.user-mark, script, style, .site-nav, #share-tooltip, .share-bar')) continue;
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        try {
          var mark = document.createElement('mark');
          mark.className = 'user-mark';
          range.surroundContents(mark);
        } catch(e) {}
        break;
      }
    });
  }

  function placeSelTooltip(tip, rect){
    var tipH = 56;
    var top = rect.top + window.scrollY - tipH;
    if (rect.top < tipH + 8) top = rect.bottom + window.scrollY + 8;
    var left = rect.left + window.scrollX + rect.width / 2;
    var vw = document.documentElement.clientWidth || window.innerWidth || 320;
    var pad = 72;
    if (left < pad) left = pad;
    if (left > vw - pad) left = vw - pad;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function updateSelectionTip(){
    var tip = document.getElementById('share-tooltip');
    if (!tip) return;
    var sel = window.getSelection();
    var text = sel ? String(sel.toString()).trim() : '';
    if (text.length < 12) { hideSelTooltip(); return; }
    try {
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) { hideSelTooltip(); return; }
      // Ignore selections inside chrome / tip itself
      var anchor = range.commonAncestorContainer;
      var el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
      if (el && el.closest && el.closest('.site-nav, #share-tooltip, .share-bar, script, style')) {
        hideSelTooltip();
        return;
      }
      placeSelTooltip(tip, rect);
      tip._selectedText = text;
      tip._selectedRange = range.cloneRange();
      showSelTooltip(tip);
    } catch(e) { hideSelTooltip(); }
  }

  function initSelectionShare(){
    var tip = document.getElementById('share-tooltip');
    if (!tip) return;

    document.addEventListener('mouseup', function(){
      setTimeout(updateSelectionTip, 0);
    });
    document.addEventListener('keyup', function(e){
      if (e.key === 'Escape') return;
      if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        setTimeout(updateSelectionTip, 0);
      }
    });

    document.addEventListener('mousedown', function(e){
      if (tip.contains(e.target)) return;
      hideSelTooltip();
    });

    var copyBtn = document.getElementById('sel-share-copy');
    if (copyBtn) copyBtn.addEventListener('click', function(){
      var t = tip._selectedText || '';
      copyText(t, 'Selection copied');
      hideSelTooltip();
    });

    var markBtn = document.getElementById('sel-share-mark');
    if (markBtn) markBtn.addEventListener('click', function(){
      wrapRange(tip._selectedRange);
      hideSelTooltip();
    });

    var liBtn = document.getElementById('sel-share-linkedin');
    if (liBtn) liBtn.addEventListener('click', function(){
      window.open(linkedInShareUrl(), '_blank', 'noopener,noreferrer');
      showToast('Opening LinkedIn');
      hideSelTooltip();
    });

    var mailBtn = document.getElementById('sel-share-email');
    if (mailBtn) mailBtn.addEventListener('click', function(){
      openEmailShare(tip._selectedText || '');
      hideSelTooltip();
    });
  }

  /* Escape closes tip, mobile nav, and desktop dropdowns */
  function initEscape(){
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape') return;
      hideSelTooltip();
      closeMobileNav();
      closeNavDropdowns();
    });
  }

  function boot(){
    initNavScroll();
    initBrandImages();
    initMobileNav();
    initNavDropdown();
    initShareBar();
    initReveal();
    initCountUp();
    initSelectionShare();
    initEscape();
    restoreMarks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`.trim();
