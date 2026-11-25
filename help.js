/* Micro Market Studio help bubbles.
   A separate layer of "?" markers placed over each studio area. Clicking a marker
   opens a bubble that says what that area needs from you. It reads the page only
   for positions; it never changes data, calculations or drafts. */
(function () {
  'use strict';

  var TIPS = [
    { id: 'header', sel: '#profile-chip', pos: 'below', title: 'Your details',
      body: 'Needed before any report export: full name, brokerage, and a phone or email. Title, website and license line are optional. A red flag here means you are looking at fictional sample data, not your file.' },
    { id: 'drop', sel: '#drop', title: 'Drop the MLS CSV export',
      body: 'Needed: one listing-level export (one row per listing) for one ZIP. Required columns: Status, Community, List Price, Sold Price, Listing Date, Selling Date, DOM, Square Footage. Add Original List Price for price cuts and Lot Size for small-lot reporting. A Market Summary report will be rejected.' },
    { id: 'checklist', sel: 'details.checklist', title: 'Export checklist',
      body: 'Statuses: Active, Pending, Pending Inspection or Contingent, Sold, Expired. Sold window: at least the last 120 days, or 730 days if you want year-over-year Trends. Types: Residential, Townhouse, Condo.' },
    { id: 'parsed', sel: '#validation', title: 'Parsed bar and data check',
      body: 'Check the row count, the ZIP picked and the freshness date. If a Typo check button shows, open it and decide each flag: wrong or missing neighborhood, no square footage, a different ZIP, or a sold price that looks like a typo (Fix price, Leave out, Keep). Unreviewed price flags stay out of the numbers.' },
    { id: 'kpis', sel: '#kpis', title: 'KPI strip',
      body: 'Headline numbers for the last 30 days against the 30 days before. Nothing to enter. Read it to see whether your file looks right before you pick stories.' },
    { id: 'tabs', sel: 'nav.tabs', title: 'The six tabs',
      body: 'Each tab reads the same export a different way: Signal board, What changed, Price bands, Trends, Area report and Queue. The property type checkboxes and ZIP picker carry across all of them.' },
    { id: 'lens', sel: '#panel-signals .lens', pos: 'right', title: 'Audience lens',
      body: 'Pick who the post is for: Sellers, Buyers or Investors. Switching re-ranks the cards and rewrites the interpretation lines.' },
    { id: 'signals', sel: '#signal-grid', title: 'Signal board',
      body: 'Pick up to 3 cards to send to the Story builder. Story Score ranks how post-worthy a finding is, not how certain it is. Solid means 12 or more data points, Directional 6 to 11. Held back cards have under 6 and are for watching only.' },
    { id: 'diff', sel: '#panel-diff', title: 'What changed',
      body: 'Neighborhood by neighborhood, last 30 days against the 30 before. Nothing to enter. Click a neighborhood to filter the Signal board to it. Thin samples are marked.' },
    { id: 'bands', sel: '#panel-bands .band-control', title: 'Price bands',
      body: 'Slide to a buyer budget. The band is your price plus or minus 10%. Shows the typical home, how many sold, what is active now and months of supply.' },
    { id: 'trends', sel: '#panel-trends', title: 'Trends',
      body: 'Needs about two years (730 days) of sold data in the export to compare this year with last. Shorter files get coverage guidance instead. The mortgage rate line is national context, not a cause.' },
    { id: 'area', sel: '#panel-area .ar-settings', title: 'Area report settings',
      body: 'Choose the sold window (60, 90 or 120 days) and the minimum sales to rank a neighborhood. Report exports wait until your details are complete in the header.' },
    { id: 'areaout', sel: '#panel-area .ar-charts', title: 'Area report outputs',
      body: 'Charts download as PNG. The broadsheet, carousel, article and web page all use the same table, so the numbers match everywhere. Read the anomaly notes before you publish.' },
    { id: 'queue', sel: '#panel-queue .session-bar', title: 'Queue and session file',
      body: 'Save a session file before you close the tab. It keeps the queue, content memory, report settings and your data-check choices. It does not include the CSV, so keep the export too.' },
    { id: 'builder', sel: '.builder .builder-head .h2', pos: 'right', title: 'Story builder',
      body: 'Needs 1 to 3 signals picked from the Signal board. Every underlined number in the draft links to the rows it came from.' },
    { id: 'controls', sel: '.builder .controls .lens', pos: 'right', title: 'Format and voice',
      body: 'Pick a format (LinkedIn, Facebook, X thread, Broadsheet story or Voiceover draft) and a voice: Plain language for clients, Analyst for agents and lenders.' },
    { id: 'actions', sel: '.builder .builder-actions', title: 'Copy, download, queue',
      body: 'Copy the text or download it, then pick a posting date and Add to queue. Posting is manual: the studio never posts for you. Read the checks above these buttons first.' }
  ];

  var KEY = 'mms-help-bubbles';
  var on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* storage blocked */ }
  var openId = null;
  var layer, bubble, toggle, raf = 0;
  var markers = {};

  function visible(el) {
    if (!el || !el.isConnected) return null;
    if (el.closest('[hidden]')) return null;
    if (el.id === 'validation' && !el.textContent.trim()) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return r;
  }

  function build() {
    layer = document.createElement('div');
    layer.className = 'hb-layer';
    layer.setAttribute('data-testid', 'help-layer');
    TIPS.forEach(function (t, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb-mark';
      b.textContent = '?';
      b.setAttribute('aria-label', 'Help: ' + t.title);
      b.setAttribute('aria-expanded', 'false');
      b.setAttribute('data-testid', 'help-' + t.id);
      b.addEventListener('click', function (e) { e.stopPropagation(); openId = openId === t.id ? null : t.id; schedule(); });
      layer.appendChild(b);
      markers[t.id] = b;
    });
    bubble = document.createElement('div');
    bubble.className = 'hb-bubble';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('data-testid', 'help-bubble');
    bubble.addEventListener('click', function (e) { e.stopPropagation(); });
    layer.appendChild(bubble);
    document.body.appendChild(layer);

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn ghost hb-toggle';
    toggle.setAttribute('data-testid', 'button-help-toggle');
    toggle.addEventListener('click', function () {
      on = !on; openId = null;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ }
      schedule();
    });
    var right = document.querySelector('.top .top-right');
    if (right) right.insertBefore(toggle, right.firstChild);
  }

  function place() {
    raf = 0;
    toggle.textContent = on ? 'Hide help' : 'Show help';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    layer.hidden = !on;
    if (!on) return;
    var openRect = null, openTip = null;
    TIPS.forEach(function (t) {
      var m = markers[t.id];
      var r = visible(document.querySelector(t.sel));
      if (!r) { m.hidden = true; if (openId === t.id) openId = null; return; }
      m.hidden = false;
      var x, y;
      if (t.pos === 'right') { x = r.right + 8; y = r.top + r.height / 2 - 13; }
      else if (t.pos === 'below') { x = r.left + r.width / 2 - 13; y = r.bottom - 10; }
      else { x = r.right - 15; y = r.top - 13; }
      x = Math.min(window.innerWidth - 30, Math.max(4, x));
      y = Math.max(4, y);
      m.style.left = x + 'px';
      m.style.top = y + 'px';
      var isOpen = openId === t.id;
      m.classList.toggle('open', isOpen);
      m.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) { openRect = { x: x, y: y }; openTip = t; }
    });
    if (!openTip) { bubble.hidden = true; return; }
    bubble.hidden = false;
    bubble.innerHTML = '';
    var h = document.createElement('strong'); h.textContent = openTip.title;
    var p = document.createElement('p'); p.textContent = openTip.body;
    var c = document.createElement('button'); c.type = 'button'; c.className = 'hb-close'; c.textContent = 'Got it';
    c.addEventListener('click', function () { openId = null; schedule(); });
    bubble.appendChild(h); bubble.appendChild(p); bubble.appendChild(c);
    var bw = Math.min(320, window.innerWidth - 16);
    bubble.style.width = bw + 'px';
    var left = Math.min(window.innerWidth - bw - 8, Math.max(8, openRect.x + 13 - bw + 28));
    var bh = bubble.offsetHeight;
    var below = openRect.y + 34;
    var top = below + bh > window.innerHeight - 8 ? Math.max(8, openRect.y - bh - 10) : below;
    bubble.classList.toggle('above', top < openRect.y);
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.setProperty('--hb-arrow', Math.max(12, Math.min(bw - 24, openRect.x + 13 - left)) + 'px');
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(place); }

  function init() {
    build();
    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    document.addEventListener('click', function () { if (openId) { openId = null; } schedule(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openId) { openId = null; schedule(); } });
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { var t = list[i].target; if (!layer.contains(t) && t !== toggle && !toggle.contains(t)) { schedule(); return; } }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
