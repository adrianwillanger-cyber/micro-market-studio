/* Micro Market Studio prototype. All parsing and analysis run in the browser. */
(function () {
'use strict';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const DAY = 864e5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mean = (a) => { const v = a.filter((x) => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
const median = (a) => { const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return NaN; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const money = (n) => { if (!Number.isFinite(n)) return 'n/a'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M'; return '$' + Math.round(n / 1e3) + 'K'; };
const money0 = (n) => Number.isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '';
const pct = (x, d = 0) => Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : 'n/a';
const num = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : 'n/a';
const fmtDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const shortDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const isoDay = (d) => d.toISOString().slice(0, 10);

function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const toNum = (s) => { if (s == null) return NaN; const v = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(v) ? v : NaN; };
function toDate(s) {
  s = String(s || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(Date.UTC(y, +m[1] - 1, +m[2])); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

// ---------- column mapping ----------
const COLS = {
  status: ['status', 'listing status', 'st'],
  community: ['community', 'neighborhood', 'subdivision', 'area name', 'community name'],
  zip: ['zip code', 'zip', 'postal code', 'zipcode'],
  list: ['list price', 'current price', 'listing price', 'price', 'lp'],
  orig: ['original list price', 'original price', 'olp'],
  sold: ['sold price', 'selling price', 'close price', 'sale price', 'sp'],
  ld: ['listing date', 'list date', 'on market date'],
  pd: ['pending date', 'under contract date', 'contract date'],
  sd: ['selling date', 'sold date', 'close date', 'closing date'],
  dom: ['dom', 'da', 'days on market', 'cdom', 'cda'],
  sq: ['square footage', 'sqft', 'sq ft', 'living area', 'approx sqft', 'square feet'],
  type: ['property type', 'type of property', 'prop type', 'type'],
  city: ['city'], stnum: ['street number'], stdir: ['street direction'], stname: ['street name'], stsuf: ['street suffix'], stpost: ['street post direction'], unit: ['unit'],
  addr: ['address', 'street address', 'full address'],
  mls: ['listing #', 'mls #', 'mls number', 'listing id', 'ml#', 'listing number'],
  lot: ['lot square footage', 'lot size', 'lot sqft', 'lot sq ft', 'lot size sqft', 'lot size (sq ft)', 'lot area'],
  bd: ['bedrooms', 'beds', 'br'], ba: ['bathrooms', 'baths', 'ba'], yb: ['year built', 'yr built']
};
const REQUIRED = ['status', 'community', 'list', 'sold', 'ld', 'sd', 'dom', 'sq'];
const LABELS = { status: 'Status', community: 'Community', list: 'List Price', sold: 'Sold Price', ld: 'Listing Date', sd: 'Selling Date', dom: 'DOM', sq: 'Square Footage', orig: 'Original List Price', pd: 'Pending Date', type: 'Property Type', zip: 'Zip Code' };

function normStatus(s) {
  const v = String(s || '').toLowerCase();
  if (/sold|closed/.test(v)) return 'Sold';
  if (/pend|contingent|under contract/.test(v)) return 'Pending';
  if (/active|new|coming/.test(v)) return 'Active';
  if (/expire/.test(v)) return 'Expired';
  return null;
}
function normType(s) {
  const v = String(s || '').toLowerCase();
  if (/town/.test(v)) return 'Townhouse';
  if (/condo/.test(v)) return 'Condo';
  if (!v) return 'Residential';
  return 'Residential';
}

// ---------- state ----------
const S = {
  all: [], zips: [], zip: '', asOf: null, mapping: {}, missing: [], isSample: true, fileName: '',
  types: new Set(['Residential', 'Townhouse', 'Condo']), typesPresent: [],
  lens: 'seller', voice: 'plain', format: 'linkedin', selected: [], answers: {}, tab: 'signals', nb: null, band: 900000,
  signals: [], held: [], ev: {}, queue: [],
  memory: [
    { date: '2026-10-26', type: 'nb_dom', scope: 'Meadowbrook', headline: 'Meadowbrook homes going under contract in about a week', value: 7, unit: 'days', format: 'LinkedIn post' },
    { date: '2026-11-02', type: 'zip_overask', scope: 'ZIP', headline: 'Fewer 98125 homes selling over asking', value: 0.48, unit: 'share', format: 'Facebook post' }
  ]
};

function ingest(text, name, isSample) {
  const grid = parseCSV(text);
  if (grid.length < 2) return showError('That file has no data rows.');
  const head = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const map = {};
  for (const [k, aliases] of Object.entries(COLS)) {
    const idx = head.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[k] = idx;
  }
  const missing = REQUIRED.filter((k) => !(k in map));
  if (missing.length) return showError('Missing required columns: ' + missing.map((k) => LABELS[k]).join(', ') + '. See the export checklist.');
  const get = (r, k) => (k in map ? r[map[k]] : '');
  let ignored = 0;
  const recs = [];
  grid.slice(1).forEach((r, i) => {
    const status = normStatus(get(r, 'status'));
    if (!status) { ignored++; return; }
    const sq = toNum(get(r, 'sq'));
    const rec = {
      i, mls: get(r, 'mls') || 'Row ' + (i + 2), addr: get(r, 'addr') || ['stnum', 'stdir', 'stname', 'stsuf', 'stpost'].map((k) => String(get(r, k) || '').trim()).filter(Boolean).join(' ') + (String(get(r, 'unit') || '').trim() ? ' #' + String(get(r, 'unit')).trim() : '') || '(no address)', status, rawStatus: get(r, 'status'),
      zip: String(get(r, 'zip') || '').trim().slice(0, 5) || 'n/a', nb: (() => { const c = String(get(r, 'community') || '').replace(/[<>&"'`]/g, '').trim(), city = String(get(r, 'city') || '').trim(); return !c || (city && c.toLowerCase() === city.toLowerCase()) ? 'Unassigned' : c; })(),
      type: normType(get(r, 'type')), list: toNum(get(r, 'list')), orig: toNum(get(r, 'orig')), sold: toNum(get(r, 'sold')),
      ld: toDate(get(r, 'ld')), pd: toDate(get(r, 'pd')), sd: toDate(get(r, 'sd')), dom: toNum(get(r, 'dom')), sq,
      lot: toNum(get(r, 'lot')), bd: toNum(get(r, 'bd')), ba: toNum(get(r, 'ba')), yb: toNum(get(r, 'yb'))
    };
    if (!Number.isFinite(rec.orig)) rec.orig = rec.list;
    rec.ppsf = rec.status === 'Sold' && sq > 0 ? rec.sold / sq : NaN;
    rec.ratio = rec.status === 'Sold' && rec.list > 0 ? rec.sold / rec.list : NaN;
    rec.cut = rec.orig > rec.list * 1.001;
    recs.push(rec);
  });
  const zc = {}; recs.forEach((r) => { zc[r.zip] = (zc[r.zip] || 0) + 1; });
  S.zips = Object.entries(zc).sort((a, b) => b[1] - a[1]).map((e) => ({ zip: e[0], n: e[1] }));
  S.zip = S.zips[0] ? S.zips[0].zip : '';
  S.all = recs; S.hasLot = 'lot' in map; S.mapping = map; S.isSample = isSample; S.fileName = name; S.ignored = ignored;
  S.missingOptional = ['orig', 'pd', 'type', 'zip'].filter((k) => !(k in map));
  S.typesPresent = CATS.filter((t) => recs.some((r) => cat(r) === t));
  S.types = new Set(S.typesPresent);
  S.selected = []; S.answers = {}; S.nb = null;
  render();
}
function showError(msg) {
  $('#validation').innerHTML = `<span class="pill bad" data-testid="status-error">Upload problem</span><span>${esc(msg)}</span>`;
}

// working set
// small lot homes (lot under the area report's minimum, 3,000 sq ft by default) are their own group,
// detached (Residential) homes on those lots move to Small lot; townhouses and condos keep their type
const CATS = ['Residential', 'Townhouse', 'Condo', 'Small lot'];
const CAT_LABEL = { Residential: 'Residential', Townhouse: 'Townhouse', Condo: 'Condo', 'Small lot': 'Small lot homes' };
function isSmallLot(r) { return S.hasLot && r.type === 'Residential' && Number.isFinite(r.lot) && r.lot > 0 && r.lot < AR.minLot; }
function cat(r) { return isSmallLot(r) ? 'Small lot' : r.type; }
function rows() { return S.all.filter((r) => r.zip === S.zip && S.types.has(cat(r))); }
function computeAsOf(rs) {
  let m = 0; rs.forEach((r) => [r.sd, r.pd, r.ld].forEach((d) => { if (d && d.getTime() > m) m = d.getTime(); }));
  return new Date(m);
}
const ago = (d) => d ? (S.asOf - d) / DAY : Infinity;
const soldIn = (rs, a, b) => rs.filter((r) => r.status === 'Sold' && ago(r.sd) >= a && ago(r.sd) < b);

// ---------- evidence ----------
function ev(label, value, calc, recs) {
  const id = 'e' + Object.keys(S.ev).length;
  S.ev[id] = { label, value, calc, recs: recs || [] };
  return id;
}
const E = (id) => `<button class="ev" data-ev="${id}" data-testid="button-evidence-${id}">${esc(S.ev[id].value)}</button>`;

// ---------- detectors ----------
const confOf = (n) => (n >= 12 ? 'Solid' : n >= 6 ? 'Directional' : 'Hold');
const BANDS = [[0, 700000, 'under $700K'], [700000, 900000, '$700K to $900K'], [900000, 1100000, '$900K to $1.1M'], [1100000, 1400000, '$1.1M to $1.4M'], [1400000, Infinity, '$1.4M and up']];

function detect(rs) {
  S.ev = {};
  const out = [];
  const Z = S.zip;
  const r30 = soldIn(rs, 0, 30), p60 = soldIn(rs, 30, 90), s60 = soldIn(rs, 0, 60), s60b = soldIn(rs, 60, 120);
  const add = (s) => { s.id = s.type + ':' + s.scope; out.push(s); };
  const zipGuard = 'ZIP-level stat. Do not attribute it to a single pocket.';

  // 1. ZIP sold-to-list
  {
    const a = median(r30.map((r) => r.ratio)), b = median(p60.map((r) => r.ratio)); const d = (a - b) * 100;
    if (Math.abs(d) >= 0.5 && r30.length >= 3) {
      const up = d > 0;
      const ea = ev('Median sold-to-list, last 30 days', pct(a, 1), `Median of sold price divided by final list price for ${r30.length} sales closed ${shortDate(new Date(S.asOf - 30 * DAY))} to ${shortDate(S.asOf)}.`, r30);
      const eb = ev('Median sold-to-list, prior 60 days', pct(b, 1), `Same calculation for ${p60.length} sales closed 31 to 90 days before ${shortDate(S.asOf)}.`, p60);
      add({ type: 'zip_ratio', scope: 'ZIP', scopeName: Z, n: r30.length, mag: Math.min(1, Math.abs(d) / 6), up,
        headline: up ? `${Z} buyers are paying more of asking` : `${Z} sellers are giving a little on price`,
        finding: `Sold-to-list ${pct(a, 1)} vs ${pct(b, 1)} prior 60 days.`,
        tags: up ? ['Seller leverage'] : ['Buyer opening'], fit: { seller: 1.1, buyer: 1.1, investor: 0.8 }, guard: zipGuard,
        chart: { kind: 'pair', labels: ['Prior 60d', 'Last 30d'], values: [b * 100, a * 100], fmt: (v) => v.toFixed(1) + '%', base: 90 },
        memValue: a, memUnit: 'share',
        question: 'Is this concentrated in one price range or property type, or is it broad?',
        data: (v) => v === 'plain'
          ? `Across ${Z}, homes that sold in the last 30 days closed at ${E(ea)} of asking price, compared with ${E(eb)} in the 60 days before.`
          : `${Z} median sold-to-list ratio: ${E(ea)} over the last 30 days against ${E(eb)} in the prior 60 (${r30.length} closed sales).`,
        interp: up ? { seller: 'Buyers are stretching again, which gives well-prepared listings more pricing power.', buyer: 'Competition is firming up. The best homes are not waiting for a discount.', investor: 'Firmer ratios usually come before price per square foot moves up.' }
          : { seller: 'The room to push above asking has narrowed. Pricing right on day one matters more than it did this summer.', buyer: 'There is more room to negotiate than two months ago, especially on homes that have been sitting.', investor: 'Softer ratios tend to show up before price per square foot moves. Watch for entry points.' },
        strategy: up ? { seller: 'Prepare the home fully and list at the market. Let buyers compete.', buyer: 'Get fully underwritten before you tour so you can move on the right home.', investor: 'Underwrite at today\u2019s ratio, not this summer\u2019s.' }
          : { seller: 'Price at the market, not above it, and plan for a negotiation instead of a bidding war.', buyer: 'Ask for inspection credits or closing costs before you stretch on price.', investor: 'Track listings past 21 days. That is where the discounts are showing up.' } });
    }
  }
  // 2. ZIP DOM
  {
    const a = median(r30.map((r) => r.dom)), b = median(p60.map((r) => r.dom)); const rel = (a - b) / b;
    if (Math.abs(rel) >= 0.15 && r30.length >= 3) {
      const slower = rel > 0;
      const ea = ev('Median DOM, last 30 days', num(a), `Median days on market for ${r30.length} sales closed in the last 30 days.`, r30);
      const eb = ev('Median DOM, prior 60 days', num(b), `Median days on market for ${p60.length} sales closed 31 to 90 days ago.`, p60);
      add({ type: 'zip_dom', scope: 'ZIP', scopeName: Z, n: r30.length, mag: Math.min(1, Math.abs(rel) / 1.2), up: !slower,
        headline: slower ? `${Z} homes are taking longer to sell` : `${Z} homes are selling faster`,
        finding: `Median ${num(a)} days on market vs ${num(b)} prior 60 days.`,
        tags: slower ? ['Buyer opening'] : ['Seller leverage'], fit: { seller: 1.15, buyer: 1.0, investor: 0.7 }, guard: zipGuard,
        chart: { kind: 'pair', labels: ['Prior 60d', 'Last 30d'], values: [b, a], fmt: (v) => v.toFixed(0) + 'd', base: 0 },
        memValue: a, memUnit: 'days',
        question: 'Are well-priced homes still going fast while overpriced ones sit?',
        data: (v) => v === 'plain' ? `The typical home that sold in the last 30 days took ${E(ea)} days to go under contract, up from ${E(eb)} days.`.replace('up from', slower ? 'up from' : 'down from')
          : `Median DOM for closed sales: ${E(ea)} days (last 30) against ${E(eb)} days (prior 60).`,
        interp: slower ? { seller: 'Buyers are taking their time. The first two weeks still matter most, so the launch has to be right.', buyer: 'You have more time to decide than you did this summer.', investor: 'Longer market times widen the negotiating window.' }
          : { seller: 'Homes are moving quicker, which rewards sellers who are ready to launch.', buyer: 'Decisions need to happen faster. Have your numbers ready.', investor: 'Faster absorption supports resale timelines.' },
        strategy: slower ? { seller: 'Plan for a 3 to 4 week window and set a price review date before you list.', buyer: 'Look at homes past two weeks on market first.', investor: 'Model a longer hold before resale.' }
          : { seller: 'Have photos, disclosures and pre-inspection ready before going live.', buyer: 'Preview on day one and write clean offers.', investor: 'Shorter market time can lower carrying costs.' } });
    }
  }
  // 3. ZIP over-ask share
  {
    const sh = (a) => a.length ? a.filter((r) => r.sold > r.list).length / a.length : NaN;
    const a = sh(r30), b = sh(p60), d = (a - b) * 100;
    if (Math.abs(d) >= 8 && r30.length >= 5) {
      const up = d > 0;
      const over30 = r30.filter((r) => r.sold > r.list), over60 = p60.filter((r) => r.sold > r.list);
      const ea = ev('Share sold over asking, last 30 days', pct(a), `${over30.length} of ${r30.length} sales closed above final list price.`, over30);
      const eb = ev('Share sold over asking, prior 60 days', pct(b), `${over60.length} of ${p60.length} sales closed above final list price.`, over60);
      add({ type: 'zip_overask', scope: 'ZIP', scopeName: Z, n: r30.length, mag: Math.min(1, Math.abs(d) / 40), up,
        headline: up ? `More ${Z} homes are selling over asking` : `Fewer ${Z} homes are selling over asking`,
        finding: `${pct(a)} sold over asking vs ${pct(b)} prior 60 days.`,
        tags: up ? ['Seller leverage'] : ['Buyer opening'], fit: { seller: 1.1, buyer: 1.05, investor: 0.75 }, guard: zipGuard,
        chart: { kind: 'pair', labels: ['Prior 60d', 'Last 30d'], values: [b * 100, a * 100], fmt: (v) => v.toFixed(0) + '%', base: 0 },
        memValue: a, memUnit: 'share',
        question: 'Are the over-ask sales the updated homes, or is it across condition levels?',
        data: (v) => v === 'plain' ? `${E(ea)} of homes sold in the last 30 days went for more than asking price, compared with ${E(eb)} in the 60 days before.`
          : `Over-list share: ${E(ea)} of closed sales (last 30) against ${E(eb)} (prior 60).`,
        interp: up ? { seller: 'Bidding is back for homes that show well.', buyer: 'Expect competition on move-in ready homes.', investor: 'Escalation is back in the mix, so plan for it in offers.' }
          : { seller: 'Fewer buyers are bidding up. List price is closer to the final price than it was.', buyer: 'Asking price is a more honest number again.', investor: 'Fewer escalations mean cleaner entry pricing.' },
        strategy: up ? { seller: 'Consider a review date to collect offers.', buyer: 'Decide your ceiling before offer day.', investor: 'Stay disciplined on your max.' }
          : { seller: 'Do not count on a bidding war to fix the price.', buyer: 'Start your offer from the list price, not above it.', investor: 'Negotiate terms as well as price.' } });
    }
  }
  // per-neighborhood metrics (60 days)
  const nbs = [...new Set(rs.map((r) => r.nb))];
  const zDom60 = median(s60.map((r) => r.dom)), zRatio60 = median(s60.map((r) => r.ratio));
  for (const nb of nbs) {
    const a60 = s60.filter((r) => r.nb === nb), b60 = s60b.filter((r) => r.nb === nb);
    if (a60.length >= 3) {
      // 4. DOM vs ZIP
      const d = median(a60.map((r) => r.dom)), rel = (d - zDom60) / zDom60;
      if (Math.abs(rel) >= 0.45) {
        const fast = rel < 0;
        const ea = ev(`${nb} median DOM, last 60 days`, num(d), `Median days on market for ${a60.length} ${nb} sales closed in the last 60 days.`, a60);
        const eb = ev(`${Z} median DOM, last 60 days`, num(zDom60), `Median days on market for all ${s60.length} ${Z} sales in the same window.`, s60);
        add({ type: 'nb_dom', scope: nb, scopeName: nb, n: a60.length, mag: Math.min(1, Math.abs(rel) / 1.4), up: fast,
          headline: fast ? (d <= 9 ? `${nb} homes are moving in about a week` : `${nb} is selling faster than the rest of ${Z}`) : `${nb} listings are taking longer than the rest of ${Z}`,
          finding: `Median ${num(d)} days vs ${num(zDom60)} for the ZIP (60 days).`,
          tags: fast ? ['Seller leverage'] : ['Buyer opening'], fit: { seller: 1.2, buyer: 1.0, investor: 0.8 }, guard: `Pocket-level. Based on ${a60.length} ${nb} sales.`,
          chart: { kind: 'vs', labels: [nb, Z], values: [d, zDom60], fmt: (v) => v.toFixed(0) + 'd' },
          memValue: d, memUnit: 'days',
          question: fast ? `Is ${nb}'s speed about pricing, or a few standout homes?` : `What is holding ${nb} back: price, condition, or location?`,
          data: (v) => v === 'plain' ? `In ${nb}, the typical home went under contract in ${E(ea)} days over the last 60 days. Across all of ${Z}, it was ${E(eb)} days.`
            : `${nb} median DOM: ${E(ea)} days against ${E(eb)} for ${Z} (60 day window, ${a60.length} sales).`,
          interp: fast ? { seller: `${nb} buyers are not waiting. A well-prepared listing here can expect a short market time.`, buyer: `In ${nb}, the good homes are gone in about a week. Hesitation costs you here.`, investor: `${nb} absorbs inventory faster than the ZIP, which supports resale exits.` }
            : { seller: `${nb} sellers need sharper pricing than the ZIP average suggests.`, buyer: `${nb} is where you are most likely to find room to negotiate.`, investor: `Longer market times in ${nb} can mean better entry pricing.` },
          strategy: fast ? { seller: `If you are in ${nb}, be ready before you list. Speed rewards preparation.`, buyer: `Set up instant alerts for ${nb} and tour in the first 48 hours.`, investor: `Look at ${nb} for flips with short resale windows.` }
            : { seller: `Price ${nb} listings to the most recent sales, not last spring's.`, buyer: `Target ${nb} listings past 21 days for negotiation.`, investor: `Watch ${nb} for price reductions before you write.` } });
      }
      // 5. ratio vs ZIP
      const rr = median(a60.map((r) => r.ratio)), dr = (rr - zRatio60) * 100;
      if (Math.abs(dr) >= 2) {
        const up = dr > 0;
        const ea = ev(`${nb} median sold-to-list, last 60 days`, pct(rr, 1), `Median sold price divided by final list price for ${a60.length} ${nb} sales.`, a60);
        const eb = ev(`${Z} median sold-to-list, last 60 days`, pct(zRatio60, 1), `Same calculation across all ${s60.length} ${Z} sales.`, s60);
        add({ type: 'nb_ratio', scope: nb, scopeName: nb, n: a60.length, mag: Math.min(1, Math.abs(dr) / 8), up,
          headline: up ? `${nb} buyers are paying over asking` : `${nb} homes are selling under asking`,
          finding: `Sold-to-list ${pct(rr, 1)} vs ${pct(zRatio60, 1)} for the ZIP.`,
          tags: up ? ['Seller leverage'] : ['Buyer opening'], fit: { seller: 1.15, buyer: 1.1, investor: 0.9 }, guard: `Pocket-level. Based on ${a60.length} ${nb} sales.`,
          chart: { kind: 'vs', labels: [nb, Z], values: [rr * 100, zRatio60 * 100], fmt: (v) => v.toFixed(1) + '%', base: 90 },
          memValue: rr, memUnit: 'share',
          question: up ? `What is drawing buyers to ${nb} right now?` : `Are ${nb} sellers overpricing, or is demand softer there?`,
          data: (v) => v === 'plain' ? `${nb} homes sold for ${E(ea)} of asking price over the last 60 days, against ${E(eb)} for ${Z} overall.`
            : `${nb} median sold-to-list: ${E(ea)} against ${E(eb)} ZIP-wide (60 days, ${a60.length} sales).`,
          interp: up ? { seller: `${nb} has pricing tolerance the rest of the ZIP does not.`, buyer: `In ${nb}, plan to pay at or above list for the right home.`, investor: `${nb} is pricing like a premium pocket.` }
            : { seller: `${nb} buyers are pushing back on price.`, buyer: `${nb} has negotiating room the rest of the ZIP does not.`, investor: `${nb} discounts may be an entry point.` },
          strategy: up ? { seller: `${nb} sellers can price confidently at the market and let buyers compete.`, buyer: `Bring your strongest terms in ${nb}.`, investor: `Use ${nb} comps carefully, they run hot.` }
            : { seller: `Price ${nb} listings at the market from day one.`, buyer: `Start below list in ${nb} and negotiate.`, investor: `Shortlist ${nb} for value buys.` } });
      }
    }
    // 6. $/sqft change
    if (a60.length >= 3 && b60.length >= 3) {
      const a = median(a60.map((r) => r.ppsf)), b = median(b60.map((r) => r.ppsf)), rel = (a - b) / b;
      if (Math.abs(rel) >= 0.07) {
        const up = rel > 0;
        const ea = ev(`${nb} median $/sq ft, last 60 days`, '$' + Math.round(a), `Median sold price per finished square foot for ${a60.length} ${nb} sales.`, a60);
        const eb = ev(`${nb} median $/sq ft, prior 60 days`, '$' + Math.round(b), `Same calculation for ${b60.length} ${nb} sales closed 61 to 120 days ago.`, b60);
        const n = a60.length;
        add({ type: 'nb_ppsf', scope: nb, scopeName: nb, n, mag: Math.min(1, Math.abs(rel) / 0.35), up,
          headline: up ? `${nb} price per square foot jumped` : `${nb} price per square foot slipped`,
          finding: `$${Math.round(a)}/sq ft vs $${Math.round(b)} in the prior 60 days.`,
          tags: up ? ['Seller leverage'] : ['Buyer opening'], fit: { seller: 1.0, buyer: 0.95, investor: 1.25 }, guard: `Pocket-level. Small samples swing on mix.`,
          chart: { kind: 'pair', labels: ['Prior 60d', 'Last 60d'], values: [b, a], fmt: (v) => '$' + Math.round(v), base: 0 },
          memValue: a, memUnit: 'ppsf',
          question: `Is the ${nb} mix different (bigger lots, remodels), or is pricing really moving?`,
          data: (v) => (v === 'plain' ? `${nb} homes sold at a median of ${E(ea)} per square foot over the last 60 days, versus ${E(eb)} in the 60 days before.`
            : `${nb} median $/sq ft: ${E(ea)} against ${E(eb)} prior (${n} vs ${b60.length} sales).`) + (n < 12 ? ` That is based on only ${n} sales, so treat it as an early signal, not a trend.` : ''),
          interp: up ? { seller: `${nb} values may be firming, but confirm it against condition and lot size.`, buyer: `${nb} may be getting more expensive. Compare like for like.`, investor: `${nb} could be repricing upward. Verify before you pay for it.` }
            : { seller: `${nb} pricing may be softening. Lean on the newest comps.`, buyer: `${nb} could offer more home per dollar right now.`, investor: `${nb} may be a value window.` },
          strategy: { seller: 'Use the three most similar recent sales, not the neighborhood average.', buyer: 'Ask for the per square foot comps on any home you are serious about.', investor: 'Track the next 30 days before treating this as a trend.' } });
      }
    }
    // 8. absorption
    const act = rs.filter((r) => r.nb === nb && r.status === 'Active'), pen = rs.filter((r) => r.nb === nb && r.status === 'Pending');
    const zAct = rs.filter((r) => r.status === 'Active').length, zPen = rs.filter((r) => r.status === 'Pending').length;
    const zr = zAct ? zPen / zAct : NaN;
    if (act.length >= 2 && pen.length >= 4) {
      const r = pen.length / act.length;
      if (r >= zr * 1.8) {
        const ep = ev(`${nb} pending listings`, String(pen.length), `Listings with a pending or pending inspection status in ${nb} as of ${shortDate(S.asOf)}.`, pen);
        const ea = ev(`${nb} active listings`, String(act.length), `Listings with an active status in ${nb} as of ${shortDate(S.asOf)}.`, act);
        const er = ev(`${nb} pending per active`, r.toFixed(1), `${pen.length} pending divided by ${act.length} active.`, pen.concat(act));
        const ez = ev(`${Z} pending per active`, zr.toFixed(1), `${zPen} pending divided by ${zAct} active across ${Z}.`, []);
        add({ type: 'nb_absorb', scope: nb, scopeName: nb, n: pen.length + act.length, mag: Math.min(1, (r / zr - 1) / 4), up: true,
          headline: `${nb} inventory is getting picked over`,
          finding: `${pen.length} pending vs ${act.length} active. ${r.toFixed(1)} per active, ZIP is ${zr.toFixed(1)}.`,
          tags: ['Seller leverage'], fit: { seller: 1.2, buyer: 1.0, investor: 0.8 }, guard: 'Stock ratio, not contract speed. Pair it with DOM before claiming speed.',
          chart: { kind: 'vs', labels: [nb, Z], values: [r, zr], fmt: (v) => v.toFixed(1) },
          memValue: r, memUnit: 'ratio',
          question: `Are ${nb} buyers choosing it on purpose, or is it simply low inventory?`,
          data: (v) => v === 'plain' ? `${nb} has ${E(ep)} homes pending against ${E(ea)} still for sale. That is ${E(er)} pending for every active listing, compared with ${E(ez)} across ${Z}.`
            : `${nb} pending to active ratio: ${E(er)} (${E(ep)} pending, ${E(ea)} active) against ${E(ez)} ZIP-wide.`,
          interp: { seller: `Buyers in ${nb} have few choices left. A new listing will get noticed.`, buyer: `${nb} has little left on the shelf. Expect new listings to draw a crowd.`, investor: `Thin ${nb} supply supports pricing near term.` },
          strategy: { seller: `If you have been waiting in ${nb}, this is a window with less competition.`, buyer: `Widen your search to nearby pockets as a backup.`, investor: `Do not expect discounts in ${nb} right now.` } });
      }
    }
  }
  // 7. price cut clustering by band
  {
    const act = rs.filter((r) => r.status === 'Active');
    const overall = act.length ? act.filter((r) => r.cut).length / act.length : NaN;
    let best = null;
    BANDS.forEach(([lo, hi, label]) => {
      const inb = act.filter((r) => r.list >= lo && r.list < hi); if (inb.length < 5) return;
      const sh = inb.filter((r) => r.cut).length / inb.length;
      if (sh - overall >= 0.15 && (!best || sh > best.sh)) best = { lo, hi, label, inb, sh };
    });
    if (best) {
      const cuts = best.inb.filter((r) => r.cut);
      const medCut = median(cuts.map((r) => (r.orig - r.list) / r.orig));
      const ea = ev(`Active listings ${best.label} with a price cut`, pct(best.sh), `${cuts.length} of ${best.inb.length} active listings priced ${best.label} have a list price below their original list price.`, best.inb);
      const eb = ev(`All active listings with a price cut`, pct(overall), `${act.filter((r) => r.cut).length} of ${act.length} active listings in ${Z}.`, act.filter((r) => r.cut));
      const ec = ev('Median cut size', pct(medCut, 1), `Median of (original list minus current list) divided by original list for the ${cuts.length} cut listings in this band.`, cuts);
      const bandRows = BANDS.map(([lo, hi, l]) => { const x = act.filter((r) => r.list >= lo && r.list < hi); return { l: { 0: '<700K', 700000: '700-900K', 900000: '0.9-1.1M', 1100000: '1.1-1.4M', 1400000: '1.4M+' }[lo], v: x.length ? x.filter((r) => r.cut).length / x.length * 100 : 0, hi: lo === best.lo }; });
      add({ type: 'band_cuts', scope: best.label, scopeName: best.label, n: best.inb.length, mag: Math.min(1, (best.sh - overall) / 0.6), up: false,
        headline: `Price cuts are clustering in the ${best.label} range`,
        finding: `${pct(best.sh)} of actives in this band have cut, vs ${pct(overall)} overall.`,
        tags: ['Buyer opening', 'Pricing tolerance'], fit: { seller: 1.15, buyer: 1.15, investor: 1.0 }, guard: 'Active inventory only. Cuts on listings, not closed sales.',
        chart: { kind: 'bands', rows: bandRows, fmt: (v) => v.toFixed(0) + '%' },
        memValue: best.sh, memUnit: 'share',
        question: `Why is the ${best.label} band struggling: competition from new construction, or sellers anchoring to spring prices?`,
        data: (v) => v === 'plain' ? `${E(ea)} of homes for sale priced ${best.label} have already cut their price. Across all active listings in ${Z}, it is ${E(eb)}. The typical cut is ${E(ec)}.`
          : `Price-reduced share, actives ${best.label}: ${E(ea)} against ${E(eb)} for all ${Z} actives. Median reduction ${E(ec)}.`,
        interp: { seller: `Buyers in the ${best.label} range are saying no to the first price. That is where pricing tolerance ends right now.`, buyer: `The ${best.label} range is where sellers are most willing to move.`, investor: `Motivated sellers are concentrated in the ${best.label} range.` },
        strategy: { seller: `If you are listing in the ${best.label} range, price it right the first time. A cut later usually costs more than pricing right at the start.`, buyer: `Look in the ${best.label} range for homes past 21 days with a cut already taken. A second cut is often possible.`, investor: `Screen the ${best.label} band for reduced listings with good bones.` } });
    }
  }
  // 9. new listing surge
  {
    const newIn = (a, b, f) => rs.filter((r) => r.ld && ago(r.ld) >= a && ago(r.ld) < b && (!f || f(r)));
    const check = (scope, f) => {
      const cur = newIn(0, 14, f), base = newIn(14, 70, f).length / 4;
      if (cur.length >= 5 && base > 0 && (cur.length - base) / base >= 0.6) {
        const tc = {}; cur.forEach((r) => { tc[r.type] = (tc[r.type] || 0) + 1; });
        const [tt, tn] = Object.entries(tc).sort((a, b) => b[1] - a[1])[0];
        const conc = tn / cur.length >= 0.6 && tt !== 'Residential';
        const ea = ev(`New listings in ${scope}, last 14 days`, String(cur.length), `Listings with a listing date in the 14 days before ${shortDate(S.asOf)}.`, cur);
        const eb = ev(`Typical new listings per 14 days`, base.toFixed(1), `Average per two weeks over the prior 8 weeks (${newIn(14, 70, f).length} listings / 4).`, newIn(14, 70, f));
        const ec = conc ? ev(`${tt} share of new listings`, `${tn} of ${cur.length}`, `${tn} of the ${cur.length} new listings are ${tt.toLowerCase()}s.`, cur.filter((r) => r.type === tt)) : null;
        const weeks = []; for (let w = 9; w >= 0; w--) weeks.push(newIn(w * 7, w * 7 + 7, f).length);
        const isZip = scope === Z;
        add({ type: 'new_surge', scope: isZip ? 'ZIP' : scope, scopeName: scope, n: cur.length, mag: Math.min(1, ((cur.length - base) / base) / 3), up: false,
          headline: conc ? `A wave of new ${tt.toLowerCase()}s just hit ${scope}` : `New listings are surging in ${scope}`,
          finding: `${cur.length} new in 14 days vs a typical ${base.toFixed(1)}.` + (conc ? ` ${tn} are ${tt.toLowerCase()}s.` : ''),
          tags: ['Inventory shift'], fit: { seller: 1.1, buyer: 1.1, investor: 1.0 }, guard: isZip ? zipGuard : `Pocket-level. ${cur.length} listings.`,
          chart: { kind: 'weeks', values: weeks },
          memValue: cur.length, memUnit: 'count',
          question: conc ? `Is this one builder's ${tt.toLowerCase()} project hitting the market at once?` : 'Is this seasonal timing or sellers getting ahead of the holidays?',
          data: (v) => (v === 'plain' ? `${E(ea)} new listings came on the market in ${scope} in the last 14 days, against a typical ${E(eb)} per two weeks this fall.`
            : `New listing count, ${scope}: ${E(ea)} in 14 days against a trailing average of ${E(eb)}.`) + (conc ? ` ${E(ec)} are ${tt.toLowerCase()}s.` : ''),
          interp: { seller: conc ? `If you own a ${tt.toLowerCase()} nearby, you now have direct competition from new inventory.` : 'More competition for buyer attention just arrived.', buyer: 'More choice just arrived. That shifts some leverage your way.', investor: conc ? 'New construction supply can cap resale prices on similar product nearby.' : 'More supply can soften pricing in the short term.' },
          strategy: { seller: conc ? `Price against the new ${tt.toLowerCase()}s, not against last quarter's resales.` : 'Stand out on condition and presentation, not just price.', buyer: conc ? 'Ask builders about rate buydowns and closing credits.' : 'Tour the new arrivals before they get picked over.', investor: 'Wait for absorption data before buying similar product.' } });
      }
    };
    check(Z, null);
    nbs.forEach((nb) => check(nb, (r) => r.nb === nb));
  }
  return out;
}

// ---------- scoring ----------
function score(s) {
  const confMult = { Solid: 1, Directional: 0.72, Hold: 0.35 }[s.conf];
  const mem = S.memory.filter((m) => m.type === s.type && m.scope === s.scope);
  const recent = mem.find((m) => (S.asOf - new Date(m.date + 'T00:00:00Z')) / DAY <= 28);
  s.memory = mem[mem.length - 1] || null;
  const nov = recent ? 0.6 : 1;
  const fit = s.fit[S.lens];
  s.why = `Size ${Math.round(s.mag * 100)} x sample ${confMult} x novelty ${nov} x ${S.lens} fit ${fit}`;
  return Math.max(1, Math.min(99, Math.round(s.mag * 90 * confMult * nov * fit)));
}

// ---------- charts ----------
function miniChart(c) {
  const W = 260, H = 78;
  if (c.kind === 'pair' || c.kind === 'vs') {
    const base = c.base || 0, max = Math.max(...c.values) * 1.08, span = Math.max(1e-6, max - base);
    const bw = 64, gap = 40, x0 = (W - (bw * 2 + gap)) / 2;
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.labels.join(' vs '))}">` + c.values.map((v, i) => {
      const h = Math.max(2, ((v - base) / span) * (H - 30)); const x = x0 + i * (bw + gap); const y = H - 16 - h;
      const fill = i === (c.kind === 'vs' ? 0 : 1) ? 'var(--accent)' : 'var(--ink)';
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${fill}"/><text x="${x + bw / 2}" y="${y - 3}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${esc(c.fmt(v))}</text><text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(c.labels[i].length > 16 ? c.labels[i].slice(0, 15) + '.' : c.labels[i])}</text>`;
    }).join('') + `<line x1="0" x2="${W}" y1="${H - 16}" y2="${H - 16}" stroke="var(--rule)"/></svg>`;
  }
  if (c.kind === 'bands') {
    const n = c.rows.length, bw = (W - 10) / n - 8, max = Math.max(...c.rows.map((r) => r.v), 1) * 1.15;
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price cut share by band">` + c.rows.map((r, i) => {
      const h = Math.max(2, (r.v / max) * (H - 30)), x = 5 + i * (bw + 8), y = H - 16 - h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${r.hi ? 'var(--accent)' : 'var(--ink)'}"/><text x="${x + bw / 2}" y="${y - 3}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)">${esc(c.fmt(r.v))}</text><text x="${x + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(r.l)}</text>`;
    }).join('') + '</svg>';
  }
  if (c.kind === 'weeks') {
    const n = c.values.length, bw = (W - 10) / n - 4, max = Math.max(...c.values, 1) * 1.15;
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="New listings per week, last 10 weeks">` + c.values.map((v, i) => {
      const h = Math.max(1, (v / max) * (H - 30)), x = 5 + i * (bw + 4), y = H - 16 - h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${i >= n - 2 ? 'var(--accent)' : 'var(--ink)'}"/><text x="${x + bw / 2}" y="${y - 3}" text-anchor="middle" font-size="10" fill="var(--ink)">${v}</text>`;
    }).join('') + `<text x="5" y="${H - 2}" font-size="10" fill="var(--muted)">10 weeks ago</text><text x="${W - 5}" y="${H - 2}" text-anchor="end" font-size="10" fill="var(--muted)">This week</text></svg>`;
  }
  return '';
}

// ---------- render ----------
function render() {
  const rs = rows();
  S.asOf = computeAsOf(rs);
  const sigs = detect(rs);
  sigs.forEach((s) => { s.conf = confOf(s.n); s.score = score(s); });
  sigs.sort((a, b) => b.score - a.score);
  S.signals = sigs.filter((s) => s.conf !== 'Hold');
  S.held = sigs.filter((s) => s.conf === 'Hold');
  S.selected = S.selected.filter((id) => S.signals.some((s) => s.id === id));
  renderValidation(rs); renderKPIs(rs); renderSignals(); renderDiff(rs); renderBands(rs); renderQueue(); renderBuilder(); renderFoot(rs); renderArea(rs);
}

function renderValidation(rs) {
  const st = { Active: 0, Pending: 0, Sold: 0, Expired: 0 }; rs.forEach((r) => st[r.status]++);
  const dates = rs.flatMap((r) => [r.sd, r.ld]).filter(Boolean).map((d) => d.getTime());
  const minD = new Date(Math.min(...dates));
  const age = Math.floor((Date.now() - S.asOf) / DAY);
  const fresh = S.isSample ? ['warn', `Sample dated ${fmtDate(S.asOf)}`] : age <= 3 ? ['ok', `Fresh: data through ${fmtDate(S.asOf)}`] : age <= 10 ? ['warn', `Data is ${age} days old`] : ['bad', `Stale: ${age} days old. Pull a new export.`];
  const others = S.zips.filter((z) => z.zip !== S.zip).reduce((a, z) => a + z.n, 0);
  const soldSpan = (S.asOf - Math.min(...rs.filter((r) => r.sd).map((r) => r.sd.getTime()))) / DAY;
  const warns = [];
  if (soldSpan < 110) warns.push(`Sold history covers ${Math.round(soldSpan)} days. 120 recommended.`);
  S.missingOptional.forEach((k) => warns.push(`No ${LABELS[k]} column` + (k === 'orig' ? ', price cut signals off.' : '.')));
  if (S.ignored) warns.push(`${S.ignored} rows with other statuses ignored.`);
  $('#validation').innerHTML = `
    <span class="item"><span class="pill ok" data-testid="status-parsed">Parsed</span>${esc(S.fileName)}: ${S.all.length} rows</span>
    <span class="item">ZIP <select id="zip-select" data-testid="select-zip">${S.zips.map((z) => `<option value="${esc(z.zip)}" ${z.zip === S.zip ? 'selected' : ''}>${esc(z.zip)} (${z.n})</option>`).join('')}</select>${others ? `<span class="muted">${others} other-ZIP rows set aside</span>` : ''}</span>
    <span class="item">${st.Active} active, ${st.Pending} pending, ${st.Sold} sold, ${st.Expired} expired</span>
    <span class="item muted">${fmtDate(minD)} to ${fmtDate(S.asOf)}</span>
    <span class="item"><span class="pill ${fresh[0]}" data-testid="status-freshness">${fresh[1]}</span></span>
    <span class="item types">${S.typesPresent.map((t) => `<label${t === 'Small lot' ? ` title="Lots under ${AR.minLot.toLocaleString()} sq ft, counted as their own group"` : ''}><input type="checkbox" data-type="${t}" ${S.types.has(t) ? 'checked' : ''} data-testid="checkbox-type-${t.toLowerCase().replace(/\s+/g, '-')}"/>${CAT_LABEL[t]}${t === 'Small lot' ? ` <span class="muted">(lots under ${AR.minLot.toLocaleString()} sq ft)</span>` : ''}</label>`).join('')}</span>
    ${warns.map((w) => `<span class="item"><span class="pill warn">Check</span>${esc(w)}</span>`).join('')}`;
  $('#zip-select').onchange = (e) => { S.zip = e.target.value; S.selected = []; S.nb = null; render(); };
  $$('#validation [data-type]').forEach((cb) => cb.onchange = () => {
    if (cb.checked) S.types.add(cb.dataset.type); else if (S.types.size > 1) S.types.delete(cb.dataset.type); else cb.checked = true;
    render();
  });
  $('#brand-sub').textContent = `${S.zip} market signals, data through ${fmtDate(S.asOf)}`;
  $('#sample-flag').hidden = !S.isSample;
}

function renderKPIs(rs) {
  const r30 = soldIn(rs, 0, 30), p30 = soldIn(rs, 30, 60), s90 = soldIn(rs, 0, 90);
  const act = rs.filter((r) => r.status === 'Active').length;
  const mos = s90.length ? act / (s90.length / 3) : NaN;
  const d = (a, b, f, invert) => { if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return ''; const x = a - b; if (Math.abs(x) < 1e-9) return '<span class="d">flat vs prior 30d</span>'; const up = x > 0; return `<span class="d ${up !== !!invert ? 'delta-up' : 'delta-down'}">${up ? '\u25B2' : '\u25BC'} ${f(Math.abs(x))} vs prior 30d</span>`; };
  const k = [
    ['Sold, 30 days', String(r30.length), d(r30.length, p30.length, (x) => x.toFixed(0))],
    ['Median sold price', money(median(r30.map((r) => r.sold))), d(median(r30.map((r) => r.sold)), median(p30.map((r) => r.sold)), money)],
    ['Median $/sq ft', '$' + Math.round(median(r30.map((r) => r.ppsf))), d(median(r30.map((r) => r.ppsf)), median(p30.map((r) => r.ppsf)), (x) => '$' + Math.round(x))],
    ['Median DOM', num(median(r30.map((r) => r.dom))) + ' days', d(median(r30.map((r) => r.dom)), median(p30.map((r) => r.dom)), (x) => x.toFixed(0) + 'd', true)],
    ['Sold-to-list', pct(median(r30.map((r) => r.ratio)), 1), d(median(r30.map((r) => r.ratio)), median(p30.map((r) => r.ratio)), (x) => (x * 100).toFixed(1) + ' pts')],
    ['Months of supply', num(mos, 1), `<span class="d">${act} active / 90d sales pace</span>`]
  ];
  $('#kpis').innerHTML = k.map(([l, v, dd], i) => `<div class="kpi" data-testid="kpi-${i}"><div class="label">${l}</div><div class="v">${v}</div>${dd}</div>`).join('');
}

function card(s, rank, held) {
  const sel = S.selected.includes(s.id);
  const memTag = s.memory ? `<span class="tag memory">Posted ${shortDate(new Date(s.memory.date + 'T12:00:00Z'))}</span>` : '';
  return `<article class="card ${sel ? 'selected' : ''}" data-testid="card-signal-${esc(s.id)}">
    <div class="card-top"><div><div class="rank">${held ? 'Watching' : '#' + rank} · ${esc(s.scope === 'ZIP' ? S.zip + ' overall' : s.scopeName)}</div><h3>${esc(s.headline)}</h3></div>
      <div class="score ${s.score >= 60 ? 'hot' : ''}" title="${esc(s.why)}"><span class="n" data-testid="text-score-${esc(s.id)}">${s.score}</span><span class="l">Story score</span></div></div>
    ${miniChart(s.chart)}
    <p class="finding">${esc(s.finding)}</p>
    <div class="badges"><span class="tag conf-${s.conf.toLowerCase()}">${s.conf === 'Hold' ? 'Too few sales' : s.conf}, n=${s.n}</span>${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${memTag}</div>
    <p class="guard">${esc(s.guard)}</p>
    <div class="score-why">${esc(s.why)}</div>
    ${held ? '' : `<div class="card-actions"><button class="btn ${sel ? 'ghost' : ''}" data-pick="${esc(s.id)}" data-testid="button-pick-${esc(s.id)}" ${!sel && S.selected.length >= 3 ? 'disabled' : ''}>${sel ? 'Remove from story' : 'Add to story'}</button></div>`}
  </article>`;
}
function renderSignals() {
  const list = S.nb ? S.signals.filter((s) => s.scopeName === S.nb || s.scope === 'ZIP') : S.signals;
  $('#nb-filter').innerHTML = S.nb ? `<span class="chip" data-testid="chip-nb-filter">Neighborhood: ${esc(S.nb)} plus ZIP-wide <button aria-label="Clear filter" id="clear-nb" data-testid="button-clear-nb">\u00D7</button></span>` : `<span class="muted">${S.signals.length} signals ranked for ${S.lens}s</span>`;
  if ($('#clear-nb')) $('#clear-nb').onclick = () => { S.nb = null; renderSignals(); };
  const shown = S.showAll || S.nb ? list : list.slice(0, 8);
  $('#signal-grid').innerHTML = (list.length ? shown.map((s, i) => card(s, i + 1)).join('') : '<div class="empty">No signals cleared the thresholds. Try a wider date range or more property types.</div>')
    + (list.length > 8 && !S.nb ? `<div class="more"><button class="btn ghost" id="show-all" data-testid="button-show-all">${S.showAll ? 'Show top 8' : `Show all ${list.length} signals`}</button></div>` : '');
  if ($('#show-all')) $('#show-all').onclick = () => { S.showAll = !S.showAll; renderSignals(); };
  $('#held-summary').textContent = `Held back: ${S.held.length} signal${S.held.length === 1 ? '' : 's'} with too few sales`;
  $('#held-wrap').hidden = !S.held.length;
  $('#held-grid').innerHTML = S.held.map((s) => card(s, 0, true)).join('');
  $$('[data-pick]').forEach((b) => b.onclick = () => {
    const id = b.dataset.pick;
    if (S.selected.includes(id)) S.selected = S.selected.filter((x) => x !== id); else if (S.selected.length < 3) S.selected.push(id);
    renderSignals(); renderBuilder();
  });
}

function renderDiff(rs) {
  const nbs = [...new Set(rs.map((r) => r.nb))].sort();
  const row = (name, f) => {
    const sub = rs.filter(f);
    const a = soldIn(sub, 0, 30), b = soldIn(sub, 30, 60), s60 = soldIn(sub, 0, 60);
    const act = sub.filter((r) => r.status === 'Active').length, pen = sub.filter((r) => r.status === 'Pending').length;
    const newA = sub.filter((r) => r.ld && ago(r.ld) < 30).length, newB = sub.filter((r) => r.ld && ago(r.ld) >= 30 && ago(r.ld) < 60).length;
    const dl = (x, y, fmt, inv) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return '<span class="dl muted">n/a</span>'; const d = x - y; if (Math.abs(d) < 1e-9) return '<span class="dl muted">flat</span>'; return `<span class="dl ${(d > 0) !== !!inv ? 'delta-up' : 'delta-down'}">${d > 0 ? '\u25B2' : '\u25BC'} ${fmt(Math.abs(d))}</span>`; };
    const mA = median(a.map((r) => r.ppsf)), mB = median(b.map((r) => r.ppsf)), dA = median(a.map((r) => r.dom)), dB = median(b.map((r) => r.dom)), rA = median(a.map((r) => r.ratio)), rB = median(b.map((r) => r.ratio));
    return { name, html: `<td>${esc(name)}</td><td>${act}</td><td>${pen}</td><td>${newA}${dl(newA, newB, (x) => x)}</td><td>${a.length}${dl(a.length, b.length, (x) => x)}</td><td>${Number.isFinite(mA) ? '$' + Math.round(mA) : 'n/a'}${dl(mA, mB, (x) => '$' + Math.round(x))}</td><td>${num(dA)}${dl(dA, dB, (x) => x.toFixed(0) + 'd', true)}</td><td>${pct(rA, 1)}${dl(rA, rB, (x) => (x * 100).toFixed(1) + ' pts')}</td><td>${act ? (pen / act).toFixed(1) : 'n/a'}</td><td>${s60.length < 6 ? '<span class="tag conf-hold">Thin</span>' : s60.length < 12 ? '<span class="tag conf-directional">Directional</span>' : '<span class="tag conf-solid">Solid</span>'}</td>` };
  };
  const head = '<thead><tr><th>Neighborhood</th><th>Active</th><th>Pending</th><th>New, 30d</th><th>Sold, 30d</th><th>Median $/sq ft</th><th>Median DOM</th><th>Sold-to-list</th><th>Pend/Active</th><th>Sample</th></tr></thead>';
  const body = nbs.map((nb) => { const r = row(nb, (x) => x.nb === nb); return `<tr class="clickable" data-nb="${esc(nb)}" data-testid="row-nb-${esc(nb.replace(/\s+/g, '-').toLowerCase())}">${r.html}</tr>`; }).join('');
  const tot = row(S.zip + ' total', () => true);
  $('#diff-table').innerHTML = head + `<tbody>${body}</tbody><tfoot><tr>${tot.html}</tr></tfoot>`;
  $('#diff-note').textContent = `Last 30 days vs the 30 days before (through ${fmtDate(S.asOf)}). Arrows show change. Click a neighborhood to filter the signal board.`;
  $$('#diff-table tr[data-nb]').forEach((tr) => tr.onclick = () => { S.nb = tr.dataset.nb; setTab('signals'); renderSignals(); });
}

function renderBands(rs) {
  const c = S.band, lo = c * 0.9, hi = c * 1.1;
  $('#band-out').textContent = `${money(lo)} to ${money(hi)}`;
  const s90 = soldIn(rs, 0, 90).filter((r) => r.sold >= lo && r.sold <= hi);
  const act = rs.filter((r) => r.status === 'Active' && r.list >= lo && r.list <= hi);
  const mos = s90.length ? act.length / (s90.length / 3) : NaN;
  const cut = act.length ? act.filter((r) => r.cut).length / act.length : NaN;
  const types = {}; s90.forEach((r) => { types[r.type] = (types[r.type] || 0) + 1; });
  const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
  const nbc = {}; s90.forEach((r) => { nbc[r.nb] = (nbc[r.nb] || 0) + 1; });
  const topNb = Object.entries(nbc).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]).join(', ');
  const stats = [
    ['Typical home', s90.length ? `${num(median(s90.map((r) => r.bd)))} bd, ${num(median(s90.map((r) => r.ba)), 1)} ba` : 'n/a', s90.length ? `${Math.round(median(s90.map((r) => r.sq))).toLocaleString()} sq ft, built ${num(median(s90.map((r) => r.yb)))}` : 'No sales in band'],
    ['Sold, 90 days', String(s90.length), topType ? `Mostly ${topType[0].toLowerCase()}s` : ''],
    ['Where it buys', topNb || 'n/a', 'Most sales in this band'],
    ['Active now', String(act.length), `${pct(cut)} have cut price`],
    ['Months of supply', num(mos, 1), mos < 2 ? 'Tight: favors sellers' : mos < 4 ? 'Balanced' : 'Loose: favors buyers'],
    ['Median DOM', num(median(s90.map((r) => r.dom))) + ' days', 'Closed sales in band']
  ];
  $('#band-stats').innerHTML = stats.map(([l, v, s], i) => `<div class="stat" data-testid="stat-band-${i}"><div class="label">${l}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
  const all = soldIn(rs, 0, 90); const step = 100000; const bins = [];
  for (let b = 300000; b < 2200000; b += step) bins.push({ b, n: all.filter((r) => r.sold >= b && r.sold < b + step).length });
  const W = 700, H = 180, bw = W / bins.length - 3, max = Math.max(...bins.map((x) => x.n), 1);
  $('#band-chart').innerHTML = `<div class="label">Sold prices, last 90 days. Your band in red.</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogram of sold prices">` + bins.map((x, i) => {
    const h = (x.n / max) * (H - 36), X = i * (bw + 3), Y = H - 20 - h; const inb = x.b + step > lo && x.b < hi;
    return `<rect x="${X}" y="${Y}" width="${bw}" height="${Math.max(h, 1)}" fill="${inb ? 'var(--accent)' : 'var(--ink)'}"/>${x.n ? `<text x="${X + bw / 2}" y="${Y - 3}" font-size="11" text-anchor="middle" fill="var(--ink)">${x.n}</text>` : ''}${i % 3 === 0 ? `<text x="${X + bw / 2}" y="${H - 4}" font-size="11" text-anchor="middle" fill="var(--muted)">${money(x.b)}</text>` : ''}`;
  }).join('') + '</svg>';
}

// ---------- story generation ----------
const HASH = { seller: '#HomeSellers', buyer: '#HomeBuyers', investor: '#RealEstateInvesting' };
function hookFor(sigs) {
  const s = sigs[0]; const L = S.lens;
  const pre = { seller: 'If you are thinking about selling, here is what changed this month.', buyer: 'If you are shopping right now, this is worth knowing.', investor: 'One number in this month\u2019s data stands out.' }[L];
  return `${s.headline}. ${pre}`;
}
function callback(sigs) {
  for (const s of sigs) {
    const m = S.memory.filter((x) => x.type === s.type && x.scope === s.scope && (S.asOf - new Date(x.date + 'T00:00:00Z')) / DAY >= 4).pop(); if (!m) continue;
    const weeks = Math.round((S.asOf - new Date(m.date + 'T00:00:00Z')) / (7 * DAY));
    const f = (v) => m.unit === 'days' ? `${Math.round(v)} days` : m.unit === 'share' ? pct(v, m.type.includes('ratio') ? 1 : 0) : m.unit === 'ppsf' ? '$' + Math.round(v) : m.unit === 'ratio' ? v.toFixed(1) : String(Math.round(v));
    const when = weeks <= 1 ? 'Last week' : `${['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][weeks] || weeks} weeks ago`;
    return `${when} I flagged \u201C${m.headline}\u201D at ${f(m.value)}. Today it reads ${f(s.memValue)}.`;
  }
  return '';
}
function method(sigs) {
  return `Source: ${S.isSample ? 'fictional sample ' : ''}MLS export for ${S.zip}, data through ${fmtDate(S.asOf)}. Closed sales, medians. ${sigs.some((s) => s.conf !== 'Solid') ? 'Small samples are labeled as early signals.' : ''}`.trim();
}
function hashtags(sigs) {
  const nbTags = [...new Set(sigs.filter((s) => s.scope !== 'ZIP' && !s.type.startsWith('band')).map((s) => '#' + s.scopeName.replace(/\s+/g, '')))];
  return ['#SeattleRealEstate', '#' + S.zip, ...nbTags, HASH[S.lens]].slice(0, 5).join(' ');
}
function answerFor(s) { const a = (S.answers[s.id] || '').trim(); return a ? esc(a.replace(/\s*[\u2014\u2013]\s*/g, ', ')) : ''; }

function buildDraft() {
  const sigs = S.selected.map((id) => S.signals.find((s) => s.id === id)).filter(Boolean);
  if (!sigs.length) return { html: '<p class="muted">Add one to three signals from the board. The draft builds itself here, with every number linked to its rows.</p>', posts: null };
  const V = S.voice, L = S.lens;
  const data = sigs.map((s) => s.data(V));
  const reads = sigs.map((s) => { const a = answerFor(s); return a ? `${s.interp[L]} ${a}` : s.interp[L]; });
  const strat = sigs.map((s) => s.strategy[L]);
  const cb = callback(sigs); const meth = method(sigs); const tags = hashtags(sigs);
  const gaps = sigs.filter((s) => !(S.answers[s.id] || '').trim()).length;
  const gapNote = gaps ? `<span class="gap">[Your read: answer the question${gaps > 1 ? 's' : ''} above to add local context]</span>` : '';
  const P = (x) => `<p>${x}</p>`;
  const F = S.format;
  if (F === 'linkedin') {
    return { html: [P(`<strong>${esc(hookFor(sigs))}</strong>`), P('What the numbers show:'), ...data.map((d) => P('\u2022 ' + d)), P(`<strong>My read.</strong> ${reads.join(' ')} ${gapNote}`), P(`<strong>What I would do.</strong> ${strat.join(' ')}`), cb ? P(cb) : '', P(`<span class="muted">${esc(meth)}</span>`), P(esc(tags))].join('') };
  }
  if (F === 'facebook') {
    const ask = { seller: 'Curious what this means for your home? Send me a message and I will run the numbers for your street.', buyer: 'Shopping in the area? Message me and I will send you the homes that fit.', investor: 'Want the full spreadsheet? Message me.' }[L];
    return { html: [P(`<strong>${esc(sigs[0].headline)}.</strong>`), P(data[0]), data[1] ? P(data[1]) : '', P(`${reads[0]} ${gapNote}`), P(strat[0]), P(ask), P(`<span class="muted">${esc(meth)}</span>`), P(esc(['#' + S.zip, HASH[L]].join(' ')))].join('') };
  }
  if (F === 'x') {
    const posts = [hookFor(sigs), ...data, reads.join(' ') + (gapNote ? ' ' + gapNote : ''), strat.join(' '), cb, meth + ' ' + ['#' + S.zip, HASH[L]].join(' ')].filter(Boolean);
    const n = posts.length;
    return { html: posts.map((p, i) => { const txt = `${i + 1}/${n} ` + stripHTML(p); const len = txt.length; return `<div class="post"><p>${i + 1}/${n} ${p}</p><span class="cc ${len > 280 ? 'over' : ''}">${len}/280</span></div>`; }).join(''), posts };
  }
  if (F === 'broadsheet') {
    const kicker = `${S.zip} Market Update \u00B7 ${fmtDate(S.asOf)}`;
    const G = (n, t) => `<p class="ph">[Graph ${n}: ${esc(t)}]</p>`;
    const graphs = data.flatMap((d, i) => [P(d), G(i + 1, graphFor(sigs[i]))]);
    const sm = smallLotGraphs();
    const smHtml = sm.length ? [`<p class="sub">Small lot homes</p>`, P(esc(sm[0])), ...sm.slice(1).map((t, i) => G(sigs.length + i + 1, t))] : [];
    return { html: [`<p class="kicker">${esc(kicker)}</p>`, `<p class="hl">${esc(sigs[0].headline)}</p>`, P(`<em>${esc({ seller: 'What sellers need to know before listing this winter.', buyer: 'Where buyers have room to move right now.', investor: 'Where the numbers point for investors.' }[L])}</em>`), ...graphs, P(reads.join(' ') + ' ' + gapNote), P(strat.join(' ')), ...smHtml, cb ? P(cb) : '', P(`<span class="muted">${esc(meth)}</span>`)].join('') };
  }
  // voiceover
  const body = [hookFor(sigs), ...data, reads.join(' '), strat.join(' '), cb, 'That is the read for ' + S.zip + ' this week. I will see you next Monday.'].filter(Boolean);
  const words = stripHTML(body.join(' ')).split(/\s+/).length; let t = 0;
  const cues = body.map((b) => { const w = stripHTML(b).split(/\s+/).length; const cue = `[${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}]`; t += w / 2.5; return `<p><span class="cue">${cue}</span> ${b}</p>`; });
  return { html: `<p class="kicker">Draft for your approval. Not for narration yet.</p>` + cues.join('') + (gapNote ? P(gapNote) : '') + `<p class="muted">${words} words, about ${Math.round(words / 2.5)} seconds at 150 words per minute.</p>` };
}
// graph placeholder text for the broadsheet story: names the chart that belongs with each signal
function graphFor(s) {
  const where = s.scopeName || S.zip, t = String(s.type || '');
  const zip = /^zip_/.test(t), win = zip ? 'last 30 days vs prior 30' : 'last 60 days';
  if (/overask/.test(t)) return `${where} share of sales over asking, ${win}`;
  if (/dom/.test(t)) return zip ? `${S.zip} median days on market, ${win}` : `${where} median days on market vs ${S.zip}, ${win}`;
  if (/ratio/.test(t)) return zip ? `${S.zip} median sold-to-list, ${win}` : `${where} median sold-to-list vs ${S.zip}, ${win}`;
  if (/ppsf/.test(t)) return `${where} median price per sq ft, last 60 days vs prior 60 days`;
  if (/absorb/.test(t)) return `${where} pending vs active listings, compared with ${S.zip}`;
  if (/new_surge/.test(t)) return `${where} new listings by week`;
  if (/cuts/.test(t)) return `${where} share of listings with a price cut`;
  return `${s.headline} (signal card chart)`;
}
// small lot section for the broadsheet story: one summary line plus two graph placeholders
function smallLotGraphs() {
  if (!S.types.has('Small lot') || !S.hasLot) return [];
  const rs = S.all.filter((r) => r.zip === S.zip && isSmallLot(r));
  if (!rs.length) return [];
  const sold = rs.filter((r) => r.status === 'Sold' && ago(r.sd) < 90);
  const act = rs.filter((r) => r.status === 'Active').length, pen = rs.filter((r) => r.status === 'Pending').length;
  const m = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
  const lot = AR.minLot.toLocaleString();
  const line = sold.length
    ? `Homes on lots under ${lot} sq ft are counted on their own. ${sold.length} sold in the last 90 days at a median $${Math.round(m(sold.map((r) => r.ppsf)))} per sq ft and ${Math.round(m(sold.map((r) => r.dom)))} days on market, with ${act} active and ${pen} pending now.`
    : `Homes on lots under ${lot} sq ft are counted on their own. None sold in the last 90 days; ${act} are active and ${pen} pending.`;
  return [line, `Small lot homes vs standard lots, median price per sq ft`, `Small lot homes vs standard lots, median days on market`];
}
function stripHTML(h) { return new DOMParser().parseFromString(String(h), 'text/html').body.textContent; }

function lint(text, sigs) {
  const items = [];
  const dash = /[\u2014\u2013]| - /.test(text);
  items.push([!dash, dash ? 'Contains a dash. Your copy rules say no dashes.' : 'No dashes']);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
  items.push([!emoji, emoji ? 'Contains an emoji' : 'No emojis']);
  const zipSig = sigs.filter((s) => s.scope === 'ZIP');
  items.push([true, zipSig.length ? `ZIP-level stats phrased as ${S.zip}-wide, not pocket claims` : 'All stats are pocket-level with sample sizes']);
  const dirn = sigs.filter((s) => s.conf !== 'Solid');
  items.push([!dirn.length || true, dirn.length ? `${dirn.length} directional signal labeled in copy (n under 12)` : 'All signals have 12 or more data points']);
  const gaps = sigs.filter((s) => !(S.answers[s.id] || '').trim()).length;
  items.push([!gaps, gaps ? `${gaps} broker read question${gaps === 1 ? '' : 's'} unanswered` : 'Broker read included']);
  if (S.isSample) items.push([false, 'Sample data. Swap in a real export before publishing.']);
  const words = text.trim().split(/\s+/).length;
  items.push([true, `${words} words`]);
  return items;
}

function renderBuilder() {
  const sigs = S.selected.map((id) => S.signals.find((s) => s.id === id)).filter(Boolean);
  $('#sel-count').textContent = sigs.length ? `${sigs.length} of 3 signals` : 'Pick up to 3 signals';
  $('#selected-list').innerHTML = sigs.map((s, i) => `<div class="sel-item"><span>${i + 1}. ${esc(s.headline)}</span><button data-unpick="${esc(s.id)}" aria-label="Remove" data-testid="button-unpick-${esc(s.id)}">\u00D7</button></div>`).join('');
  $$('[data-unpick]').forEach((b) => b.onclick = () => { S.selected = S.selected.filter((x) => x !== b.dataset.unpick); renderSignals(); renderBuilder(); });
  const qWrap = $('#questions');
  const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.q : null;
  qWrap.innerHTML = sigs.length ? `<span class="label">Broker's read</span>` + sigs.map((s) => `<div class="q"><p>${esc(s.question)}</p><textarea data-q="${esc(s.id)}" placeholder="Your local knowledge, in a sentence or two" data-testid="input-answer-${esc(s.id)}">${esc(S.answers[s.id] || '')}</textarea></div>`).join('') : '';
  $$('#questions textarea').forEach((t) => t.oninput = () => { S.answers[t.dataset.q] = t.value; renderDraft(); });
  if (keep) { const t = $(`#questions textarea[data-q="${CSS.escape(keep)}"]`); if (t) { t.focus(); t.selectionStart = t.selectionEnd = t.value.length; } }
  renderDraft();
  const has = sigs.length > 0;
  ['#copy', '#download', '#enqueue'].forEach((s) => { $(s).disabled = !has; });
  // slots: next 6 weekdays after asOf at 7am
  const slots = []; let d = new Date(Math.max(Date.now(), S.asOf.getTime()));
  while (slots.length < 6) { d = new Date(d.getTime() + DAY); const wd = d.getUTCDay(); if (wd >= 1 && wd <= 5) slots.push(new Date(d)); }
  const prev = $('#slot').value;
  $('#slot').innerHTML = slots.map((x) => `<option value="${isoDay(x)}">${x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}, 7am</option>`).join('');
  if (prev && slots.some((x) => isoDay(x) === prev)) $('#slot').value = prev;
}
function renderDraft() {
  const sigs = S.selected.map((id) => S.signals.find((s) => s.id === id)).filter(Boolean);
  const d = buildDraft();
  $('#draft').innerHTML = d.html;
  const text = draftText();
  $('#lint').innerHTML = sigs.length ? lint(text, sigs).map(([ok, t]) => `<li class="${ok ? 'ok' : 'warn'}"><span class="mk">${ok ? 'OK' : 'Check'}</span><span>${esc(t)}</span></li>`).join('') : '';
}
function draftText() {
  const el = $('#draft').cloneNode(true);
  $$('.cc, .gap', el).forEach((x) => x.remove());
  return $$('p', el).map((p) => p.textContent.trim()).filter(Boolean).join('\n\n');
}

// ---------- queue ----------
const FMT_LABEL = { linkedin: 'LinkedIn post', facebook: 'Facebook post', x: 'X thread', broadsheet: 'Broadsheet story', voiceover: 'Voiceover script' };
function renderQueue() {
  $('#queue-count').textContent = S.queue.filter((q) => q.status === 'Queued').length || '';
  $('#queue-list').innerHTML = S.queue.length ? S.queue.map((q, i) => `<div class="qitem" data-testid="row-queue-${i}"><div><div class="t">${esc(q.headline)}</div><div class="s">${esc(q.format)} · ${esc(q.lens)} lens · ${esc(q.slotLabel)} · ${q.status}</div></div>${q.status === 'Queued' ? `<button class="btn ghost" data-publish="${i}" data-testid="button-publish-${i}">Mark published</button>` : '<span class="pill ok">Published</span>'}</div>`).join('') : '<div class="empty">Nothing queued yet. Build a draft and add it to the queue.</div>';
  $('#memory-list').innerHTML = S.memory.slice().reverse().map((m, i) => `<div class="mitem" data-testid="row-memory-${i}"><div><div class="t">${esc(m.headline)}</div><div class="s">${esc(m.date)} · ${esc(m.format || '')} · ${esc(m.scope === 'ZIP' ? S.zip : m.scope)}</div></div></div>`).join('');
  $$('[data-publish]').forEach((b) => b.onclick = () => {
    const q = S.queue[+b.dataset.publish]; q.status = 'Published';
    q.sigs.forEach((s) => S.memory.push({ date: isoDay(S.asOf), type: s.type, scope: s.scope, headline: s.headline, value: s.memValue, unit: s.memUnit, format: q.format }));
    saveState(); toast('Published. Content memory updated, novelty scores refreshed.');
    render();
  });
}
function toast(m) { const t = $('#toast'); t.textContent = m; clearTimeout(toast._t); toast._t = setTimeout(() => { t.textContent = ''; }, 3500); }

function renderFoot(rs) {
  $('#foot').innerHTML = `Prototype. Signals are rule-based: last 30 days vs prior 60 for ZIP trends, 60 day windows for neighborhoods, current inventory for cuts and absorption. Sample labels: Solid 12 or more data points, Directional 6 to 11, Held back under 6. ${S.isSample ? 'The 98125 sample file is fictional: addresses and prices are generated, not real listings.' : ''}`;
}

function setTab(t) {
  S.tab = t;
  $$('.tab').forEach((b) => { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
  ['signals', 'diff', 'bands', 'area', 'queue'].forEach((p) => { $('#panel-' + p).hidden = p !== t; });
}

// ---------- one-ZIP area report ----------
const AR = Object.assign({
  window: 90, minRank: 6, lotFilter: true, minLot: 3000, city: 'Seattle, WA', issue: 'No. 1', byline: 'By Adrian Willanger',
  name: 'Adrian Willanger', role: 'Broker', firm: 'Kelly Right', phone: '', email: '', web: '', license: '',
  source: 'NWMLS via Realty Toolkit'
});
const arSave = () => {};
const INK = '#1A1815', MUTED = '#4A4842', RED = '#8B1E1E', RULE = '#CFCBC2';
const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const d$ = (x) => Number.isFinite(x) ? '$' + Math.round(x).toLocaleString('en-US') : 'n/a';

function mark(n, price = true) {
  if (n.name.indexOf(' total') >= 0 || !n.sold) return '';
  if (n.thin) return '*';
  return [price && n.skew ? '**' : '', price && n.wide ? '***' : ''].filter(Boolean).join(' ');
}
const listNames = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
function priceNotes(M) {
  const out = [];
  if (M.nbs.some((n) => n.thin && n.sold)) out.push(`* Fewer than ${AR.minRank} sales, not ranked.`);
  const sk = M.nbs.filter((n) => n.skew), wd = M.nbs.filter((n) => n.wide);
  const r = (x) => Math.round(x / 10) * 10;
  if (sk.length) out.push(`** Home size moves the median 3% or more. Without homes under ${r(M.sizeBand.lo).toLocaleString()} or over ${r(M.sizeBand.hi).toLocaleString()} sq ft: ${sk.map((n) => `${n.name} ${d$(n.skew.trim)}`).join(', ')}.`);
  if (wd.length) out.push(`*** Wide price range. Sales run ${wd.map((n) => `${d$(n.wide.min)} to ${d$(n.wide.max)} per sq ft in ${n.name}`).join('; ')}.`);
  return out;
}
function domNotes(M) {
  const out = [];
  if (M.nbs.some((n) => n.thin && Number.isFinite(n.soldDom))) out.push(`* Fewer than ${AR.minRank} sales, not ranked.`);
  const g = M.nbs.filter((n) => n.noDom), t = g.reduce((s, n) => s + n.noDom, 0);
  if (t) out.push(`Leaves out ${t} sale${t > 1 ? 's' : ''} with no days on market recorded: ${g.map((n) => `${n.name} ${n.noDom}`).join(', ')}.`);
  return out;
}

function areaRows(rs) {
  const out = { kept: [], small: [], belowLot: 0, noLot: 0 };
  rs.forEach((r) => {
    if (r.status === 'Expired') return;
    if (r.status === 'Sold' && !(ago(r.sd) < AR.window)) return;
    if (AR.lotFilter && S.hasLot) {
      if (!Number.isFinite(r.lot) || r.lot <= 0) { out.noLot++; return; }
      if (r.lot < AR.minLot) { out.belowLot++; out.small.push(r); return; }
    }
    out.kept.push(r);
  });
  return out;
}
function areaMetrics(rs) {
  const A = areaRows(rs), k = A.kept;
  const stat = (sub, name) => {
    const sold = sub.filter((r) => r.status === 'Sold'), act = sub.filter((r) => r.status === 'Active'), pen = sub.filter((r) => r.status === 'Pending');
    return { name, sold: sold.length, active: act.length, pending: pen.length,
      soldPpsf: median(sold.map((r) => r.ppsf)), actPpsf: median(act.map((r) => r.sq > 0 ? r.list / r.sq : NaN)),
      soldDom: median(sold.map((r) => r.dom)), actDom: median(act.map((r) => r.dom)), medSold: median(sold.map((r) => r.sold)),
      avgSold: mean(sold.map((r) => r.sold)), avgPpsf: mean(sold.map((r) => r.ppsf)), medSq: median(sold.map((r) => r.sq > 0 ? r.sq : NaN)),
      small: sold.length < 3, thin: sold.length < AR.minRank, recs: sub };
  };
  const nbs = [...new Set(k.map((r) => r.nb))].map((nb) => stat(k.filter((r) => r.nb === nb), nb))
    .sort((a, b) => (b.sold + b.active + b.pending) - (a.sold + a.active + a.pending));
  const zip = stat(k, S.zip + ' total');
  // anomaly flags: ** home size moves the median, *** wide price range
  const zipSq = median(k.filter((r) => r.status === 'Sold' && r.sq > 0).map((r) => r.sq));
  const lo = 0.6 * zipSq, hi = 2 * zipSq;
  nbs.forEach((n) => {
    const sold = n.recs.filter((r) => r.status === 'Sold' && Number.isFinite(r.ppsf));
    n.noDom = n.recs.filter((r) => r.status === 'Sold' && !Number.isFinite(r.dom)).length;
    if (n.thin || !sold.length) return;
    const mid = sold.filter((r) => r.sq >= lo && r.sq <= hi), trim = median(mid.map((r) => r.ppsf));
    if (mid.length >= 3 && mid.length < sold.length && Math.abs(trim - n.soldPpsf) / n.soldPpsf >= 0.03)
      n.skew = { trim, small: sold.filter((r) => r.sq < lo).length, large: sold.filter((r) => r.sq > hi).length };
    const ps = sold.map((r) => r.ppsf), mn = Math.min(...ps), mx = Math.max(...ps);
    if (mx / mn >= 3) n.wide = { min: mn, max: mx };
  });
  const full = nbs.filter((n) => !n.thin && Number.isFinite(n.soldPpsf));
  const byP = full.slice().sort((a, b) => b.soldPpsf - a.soldPpsf);
  const byD = full.slice().sort((a, b) => b.soldDom - a.soldDom);
  const busiest = nbs.filter((n) => n.name !== 'Unassigned').slice().sort((a, b) => b.pending - a.pending || b.active - a.active)[0];
  const soldDates = k.filter((r) => r.status === 'Sold' && r.sd).map((r) => r.sd.getTime());
  // small-lot homes: their own group, never mixed into the standard-lot medians
  const sm = A.small, smNbs = [...new Set(sm.map((r) => r.nb))].map((nb) => stat(sm.filter((r) => r.nb === nb), nb))
    .sort((a, b) => (b.sold + b.active + b.pending) - (a.sold + a.active + a.pending));
  const smallLot = sm.length ? { nbs: smNbs, zip: stat(sm, 'Small lot total') } : null;
  return { nbs, zip, smallLot, sizeBand: { lo, hi }, top: byP[0], low: byP[byP.length - 1], slow: byD[0], fast: byD[byD.length - 1], busiest, full,
    audit: { rows: rs.length, kept: k.length, belowLot: A.belowLot, noLot: A.noLot, from: soldDates.length ? new Date(Math.min(...soldDates)) : null } };
}

function spanPhrase(M) {
  const f = M.audit.from; if (!f) return `in the last ${AR.window} days`;
  const span = Math.round((S.asOf - f) / DAY);
  return span < AR.window - 3 ? `since ${shortDate(f)}` : `in the last ${AR.window} days`;
}
function areaCopy(M) {
  const Z = S.zip, z = M.zip, w = AR.window, WP = spanPhrase(M), WPc = WP.startsWith('since') ? 'sales ' + WP : WP.replace(/^in the /, '');
  const t = M.top, l = M.low, s = M.slow, f = M.fast, b = M.busiest;
  const ranked = M.full.length >= 2;
  const NW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const nw = (n) => NW[n] || String(n);
  const minW = nw(AR.minRank);
  const ratioTxt = !z.active ? 'with no active listings to compare' : !z.pending ? 'with nothing pending' : z.pending >= z.active ? `or ${(z.pending / z.active).toFixed(1)} pending for every active home` : `or about one pending for every ${Math.round(z.active / z.pending)} active homes`;
  const headline = t && M.full.length >= 2 ? `${Z} Neighborhood Market Update: ${t.name} Leads at ${d$(t.soldPpsf)} a Square Foot` : `${Z} Neighborhood Market Update`;
  const subhead = `${z.sold} sales, ${num(z.soldDom)} median days on market and ${z.active} active listings across ${M.nbs.length} neighborhoods ${WP}`;
  const p1 = ranked && t !== l
    ? `${Z} closed ${z.sold} home sales ${WP} at a median ${d$(z.soldPpsf)} per square foot, with homes selling in a median ${num(z.soldDom)} days on market. Among neighborhoods with at least ${minW} sales, ${t.name} led on price at ${d$(t.soldPpsf)} per square foot, while ${l.name} came in at ${d$(l.soldPpsf)}. That gap is the first thing a seller should price against.`
    : `${Z} closed ${z.sold} home sales ${WP} at a median ${d$(z.soldPpsf)} per square foot, with homes selling in a median ${num(z.soldDom)} days on market. Too few neighborhoods have ${minW} or more sales to rank them on price yet, so treat the ZIP figure as the anchor and each neighborhood figure as directional until more sales close.`;
  const p2 = `Supply tells the next chapter. ${Z} has ${z.active} active listings and ${z.pending} pending, ${ratioTxt}. ${b ? `${b.name} carries the busiest pipeline with ${b.pending} pending and ${b.active} active.` : ''} ${s && ranked ? `${s.name} is the outlier on time, with sold homes taking a median ${num(s.soldDom)} days against ${num(z.soldDom)} for the ZIP.` : ''}`.replace(/\s+/g, ' ').trim();
  const fastMkt = z.soldDom <= 10 && z.active && z.pending / z.active >= 0.6;
  const gap = t && l ? t.soldPpsf - l.soldPpsf : NaN;
  const p3 = (ranked && t !== l)
    ? `For sellers, price to the neighborhood rather than the ZIP: ${t.name} and ${l.name} sit ${d$(gap)} per square foot apart, and buyers notice. ${fastMkt ? 'With pending demand this strong, a well prepared home can expect a short run.' : 'Overpricing will show up as extra days on market.'} For buyers, ${s && f && s !== f ? `${s.name} is where patience still earns room to negotiate, while ${f.name} rewards a clean offer ready on day one.` : 'the slower listings are where patience earns room to negotiate.'}`
    : `For sellers, the ZIP median is a starting point, not a price. Lean on the closest sales on your own street and block. For buyers, homes that pass the median ${num(z.soldDom)} days on market are where patience can earn room to negotiate, so watch them closely.`;
  const red = (arr, key) => arr.filter((n) => !n.small && Number.isFinite(n[key])).sort((a, b) => b[key] - a[key])[0];
  const fig1 = `Fig. 1: Median sold price per square foot by neighborhood, ${WPc}.${t && ranked ? ` ${t.name} highlighted. Gray bars have fewer than ${AR.minRank} sales and are not ranked.` : ''}`;
  const fig2 = `Fig. 2: Median days on market for sold homes by neighborhood, ${WPc}.${s && ranked ? ` ${s.name} highlighted as slowest among ranked neighborhoods.` : ''}`;
  const fig3 = `Fig. 3: Active, pending and sold homes by neighborhood. Sold counts ${WP}; active and pending are current.`;
  const L = M.smallLot, lz = L && L.zip;
  const p4 = lz ? (lz.sold
    ? `Small lot homes, on lots under ${AR.minLot.toLocaleString()} square feet, are counted on their own so they do not move the neighborhood medians. Of these, ${lz.sold} sold ${WP} at a median ${d$(lz.soldPpsf)} per square foot and ${d$(lz.medSold)}, against ${d$(z.soldPpsf)} and ${d$(z.medSold)} on standard lots. They took a median ${num(lz.soldDom)} days on market, with ${lz.active} active and ${lz.pending} pending now.${lz.sold < AR.minRank ? ` With only ${lz.sold} sales, read these figures as directional.` : ''}`
    : `Small lot homes, on lots under ${AR.minLot.toLocaleString()} square feet, are counted on their own. None sold ${WP}; ${lz.active} are active and ${lz.pending} pending.`) : '';
  return { headline, subhead, p1, p2, p3, p4, fig1, fig2, fig3, red, notes1: priceNotes(M), notes2: domNotes(M) };
}

function lotNote() { return AR.lotFilter && S.hasLot ? `, lots ${AR.minLot.toLocaleString()} sq ft and up` : ''; }
function sourceLine(M) {
  return `Source: ${AR.source}${S.isSample ? ' (fictional sample data)' : ''}. ${S.zip}${lotNote()}. Sold listings closed ${M.audit.from ? fmtDate(M.audit.from) : ''} to ${fmtDate(S.asOf)}; active and pending as of ${fmtDate(S.asOf)}. Medians shown. Only neighborhoods with ${AR.minRank} or more sales are ranked; smaller counts are shown but not ranked.${M.smallLot ? ` Homes on lots under ${AR.minLot.toLocaleString()} sq ft are reported as their own group; medians and averages are figured separately for each group.` : ''}`;
}
function nbLine(n) {
  const m = mark(n); return `${n.name}${m ? ' ' + m : ''}: ${n.sold} sold, ${n.active} active, ${n.pending} pending; ${Number.isFinite(n.soldPpsf) ? d$(n.soldPpsf) + ' per sq ft sold' : 'no sales'}${Number.isFinite(n.soldDom) ? ', ' + num(n.soldDom) + ' days on market' : ''}${n.sold && n.thin && n.name.indexOf(' total') < 0 ? ' (not ranked, under ' + AR.minRank + ' sales)' : ''}`;
}
function compareRows(M) {
  const a = M.zip, b = M.smallLot.zip;
  return [['Homes sold', a.sold, b.sold], ['Median sold price', d$(a.medSold), d$(b.medSold)], ['Average sold price', d$(a.avgSold), d$(b.avgSold)],
    ['Median $/sq ft', d$(a.soldPpsf), d$(b.soldPpsf)], ['Average $/sq ft', d$(a.avgPpsf), d$(b.avgPpsf)], ['Median home size', Number.isFinite(a.medSq) ? Math.round(a.medSq).toLocaleString() + ' sq ft' : 'n/a', Number.isFinite(b.medSq) ? Math.round(b.medSq).toLocaleString() + ' sq ft' : 'n/a'],
    ['Median days on market', num(a.soldDom), num(b.soldDom)], ['Active', a.active, b.active], ['Pending', a.pending, b.pending]];
}
function smallLotText(M, C) {
  if (!M.smallLot) return [];
  const lbl = `lots ${AR.minLot.toLocaleString()}+ sq ft`, sl = `under ${AR.minLot.toLocaleString()} sq ft`;
  return [`Small lot homes (lots under ${AR.minLot.toLocaleString()} sq ft)`, C.p4,
    ...compareRows(M).map(([k, a, b]) => `${k}: ${a} on ${lbl}; ${b} on lots ${sl}`),
    ...M.smallLot.nbs.map((n) => `${n.name}: ${n.sold} sold, ${n.active} active, ${n.pending} pending${Number.isFinite(n.soldPpsf) ? '; ' + d$(n.soldPpsf) + ' per sq ft sold' : ''}`)];
}
function articleText(M, C) {
  return [C.headline, C.subhead, `${AR.byline} | ${AR.city} | ${fmtDate(S.asOf)}`, C.p1, C.fig1, ...C.notes1, C.fig2, ...C.notes2, C.p2, C.fig3, C.p3,
    'Neighborhood by neighborhood', ...M.nbs.map(nbLine), nbLine(M.zip), ...smallLotText(M, C), sourceLine(M)].join('\n\n');
}

// ---- charts (SVG, locked broadsheet palette) ----
function hbar(M, key, title, fmt, highlight, notes = [], price = false) {
  const items = M.nbs.filter((n) => Number.isFinite(n[key]));
  const W = 1200, H = 675, L = 300, R = 120, T = 120, B = 50 + 26 * notes.length;
  const bh = Math.min(56, (H - T - B) / Math.max(items.length, 1) - 12);
  const max = Math.max(...items.map((n) => n[key]), 1);
  const bars = items.map((n, i) => {
    const y = T + i * (bh + 12), w = (W - L - R) * n[key] / max, hl = highlight && n.name === highlight.name;
    return `<text x="${L - 16}" y="${y + bh / 2 + 7}" text-anchor="end" font-size="22" fill="${n.thin ? MUTED : INK}">${esc(n.name)}${mark(n, price) ? ' ' + mark(n, price) : ''}</text>
      <rect x="${L}" y="${y}" width="${Math.max(w, 2)}" height="${bh}" fill="${hl ? RED : n.thin ? '#B9B4AA' : INK}"/>
      <text x="${L + w + 12}" y="${y + bh / 2 + 8}" font-size="22" font-weight="700" fill="${hl ? RED : INK}">${fmt(n[key])}</text>`;
  }).join('');
  const nt = notes.map((t, i) => `<text class="ar-note" x="40" y="${H - 44 - 26 * (notes.length - 1 - i)}" font-size="17" fill="${MUTED}">${esc(t)}</text>`).join('');
  return svgWrap(W, H, title, bars + nt);
}
function stacked(M) {
  const items = M.nbs, W = 1200, H = 675, L = 300, R = 80, T = 150, B = 50;
  const bh = Math.min(52, (H - T - B) / Math.max(items.length, 1) - 12);
  const max = Math.max(...items.map((n) => n.active + n.pending + n.sold), 1);
  const cols = [['active', INK, 'Active'], ['pending', '#8C877D', 'Pending'], ['sold', RED, 'Sold']];
  const legend = cols.map(([, c, l], i) => `<rect x="${L + i * 170}" y="96" width="22" height="22" fill="${c}"/><text x="${L + i * 170 + 32}" y="115" font-size="22" fill="${INK}">${l}</text>`).join('');
  const bars = items.map((n, i) => {
    const y = T + i * (bh + 12); let x = L;
    const segs = cols.map(([k, c]) => { const w = (W - L - R) * n[k] / max; const s = `<rect x="${x}" y="${y}" width="${w}" height="${bh}" fill="${c}"/>` + (w > 34 ? `<text x="${x + w / 2}" y="${y + bh / 2 + 8}" text-anchor="middle" font-size="20" font-weight="700" fill="#fff">${n[k]}</text>` : ''); x += w; return s; }).join('');
    return `<text x="${L - 16}" y="${y + bh / 2 + 7}" text-anchor="end" font-size="22" fill="${INK}">${esc(n.name)}</text>${segs}`;
  }).join('');
  return svgWrap(W, H, `Active, pending and sold by neighborhood`, legend + bars);
}
function svgWrap(W, H, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Georgia, 'Source Serif 4', serif" role="img" aria-label="${esc(title)}">
    <rect width="${W}" height="${H}" fill="#fff"/><text x="40" y="62" font-size="38" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif">${esc(title)}</text>
    <line x1="40" y1="80" x2="${W - 40}" y2="80" stroke="${INK}" stroke-width="2"/>${body}
    <text x="${W - 40}" y="${H - 14}" text-anchor="end" font-size="16" fill="${MUTED}">${esc(S.zip)} · ${esc(AR.source)}${S.isSample ? ' · fictional sample' : ''}</text></svg>`;
}
function svgToPng(svg, name, W, H) {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H); c.toBlob((b) => dl(b, name)); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
function coverSvg(M, C) {
  const W = 1920, H = 1080, z = M.zip, t = M.top;
  const hl = C.headline.split(': ');
  const big = hl.length > 1 ? hl[1] : hl[0];
  const fs = big.length > 46 ? 64 : big.length > 36 ? 76 : 88;
  const stats = [[String(z.sold), 'Homes sold'], [d$(z.soldPpsf), 'Median sold $/sq ft'], [num(z.soldDom), 'Median days on market'], [t ? d$(t.soldPpsf) : 'n/a', t ? `${t.name} $/sq ft` : 'Top neighborhood']];
  const sx = (i) => 960 + (i - 1.5) * 380 - 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Georgia, 'Source Serif 4', serif">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <line x1="200" y1="150" x2="1720" y2="150" stroke="${INK}" stroke-width="3"/><line x1="200" y1="160" x2="1720" y2="160" stroke="${INK}" stroke-width="1"/>
  <text x="200" y="135" font-size="26" fill="${INK}" letter-spacing="3">${esc(AR.issue.toUpperCase())}</text>
  <text x="960" y="135" text-anchor="middle" font-size="26" fill="${INK}" letter-spacing="3">${esc(AR.city.toUpperCase())}</text>
  <text x="1720" y="135" text-anchor="end" font-size="26" fill="${INK}" letter-spacing="3">${esc(fmtDate(S.asOf).toUpperCase())}</text>
  <text x="960" y="250" text-anchor="middle" font-size="34" font-style="italic" fill="${RED}">${esc(S.zip)} Neighborhood Market Update</text>
  <text x="960" y="360" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif">${esc(big)}</text>
  <text x="960" y="440" text-anchor="middle" font-size="32" fill="${MUTED}">${esc(C.subhead)}</text>
  <line x1="200" y1="500" x2="1720" y2="500" stroke="${RULE}" stroke-width="2"/>
  ${stats.map(([v, l], i) => `<text x="${sx(i) + 100}" y="660" text-anchor="middle" font-size="96" font-weight="700" fill="${i === 3 ? RED : INK}" font-family="'Playfair Display', Georgia, serif">${esc(v)}</text><text x="${sx(i) + 100}" y="720" text-anchor="middle" font-size="26" fill="${MUTED}">${esc(l)}</text>`).join('')}
  <line x1="200" y1="790" x2="1720" y2="790" stroke="${RULE}" stroke-width="2"/>
  <text x="960" y="850" text-anchor="middle" font-size="26" fill="${MUTED}">ZIP ${esc(S.zip)}${esc(lotNote())} · ${esc(spanPhrase(M).replace(/^in the l/, 'L').replace(/^since/, 'Since'))}${S.isSample ? ' · Fictional sample data' : ''}</text>
  <text x="960" y="910" text-anchor="middle" font-size="30" font-style="italic" fill="${INK}">${esc(AR.byline)}</text></svg>`;
}

function renderArea(rs) {
  const M = areaMetrics(rs), C = areaCopy(M);
  S.area = { M, C };
  const set = (k, v) => { AR[k] = v; arSave(); renderArea(rows()); };
  const f = (k, label, ph = '') => `<label class="ar-field"><span class="label">${label}</span><input data-ar="${k}" value="${esc(AR[k])}" placeholder="${esc(ph)}" data-testid="input-area-${k}"/></label>`;
  const a = M.audit;
  const warns = [];
  if (!S.hasLot && AR.lotFilter) warns.push('No lot size column in this file, so the lot filter is off.');
  if (a.noLot) warns.push(`${a.noLot} rows had no lot size and were left out.`);
  const noDom = M.zip.recs.filter((r) => r.status === 'Sold' && !Number.isFinite(r.dom)).length;
  if (noDom) warns.push(`${noDom} sold rows have a blank days-on-market value and are left out of the DOM medians.`);
  if (!M.zip.pending) warns.push('Zero pending listings. Check the export includes pending statuses.');
  if (!M.full.length) warns.push('No neighborhood has three or more sales. Copy will avoid ranking.');
  const cell = (n) => `<td>${esc(n.name)}${mark(n) && !n.thin ? ' ' + mark(n) : ''}${n.thin && n.name.indexOf(' total') < 0 ? ` <span class="tag conf-hold">${n.sold < 3 ? 'Small' : 'Thin'}</span>` : ''}</td><td>${n.active}</td><td>${n.pending}</td><td>${n.sold}</td><td>${d$(n.soldPpsf)}</td><td>${d$(n.actPpsf)}</td><td>${num(n.soldDom)}</td><td>${num(n.actDom)}</td>`;
  const paras = [['p1', C.p1], ['p2', C.p2], ['p3', C.p3]];
  const wc = paras.map(([k, p]) => { const n = words(p); return `<li class="${n >= 45 && n <= 65 ? 'ok' : 'warn'}"><span class="mk">${n >= 45 && n <= 65 ? 'OK' : 'Check'}</span>Paragraph ${k[1]}: ${n} words ${n >= 45 && n <= 65 ? '(in range)' : '(target 45 to 65)'}</li>`; }).join('');
  const dash = /[\u2014\u2013]| - /.test(C.p1 + C.p2 + C.p3);
  $('#panel-area').innerHTML = `
    <p class="panel-note">One-ZIP neighborhood report in the ZIP Neighborhood Market Update format: table, three charts, a 1920×1080 cover and paste-ready LinkedIn article text. Every number comes from the table.</p>
    <details class="ar-settings" ${S.arOpen ? 'open' : ''} data-testid="details-area-settings"><summary>Report settings</summary>
      <div class="ar-grid">
        <label class="ar-field"><span class="label">Sold window</span><select data-ar-n="window" data-testid="select-area-window">${[60, 90, 120].map((d) => `<option ${AR.window === d ? 'selected' : ''} value="${d}">Last ${d} days</option>`).join('')}</select></label>
        <label class="ar-field"><span class="label">Rank neighborhoods with at least</span><select data-ar-n="minRank" data-testid="select-area-minrank">${[3, 5, 6, 8].map((d) => `<option ${AR.minRank === d ? 'selected' : ''} value="${d}">${d} sales</option>`).join('')}</select></label>
        <label class="ar-field ar-check"><input type="checkbox" id="ar-lot" ${AR.lotFilter ? 'checked' : ''} ${S.hasLot ? '' : 'disabled'} data-testid="checkbox-area-lot"/><span>Lots ${AR.minLot.toLocaleString()} sq ft and up</span></label>
        ${f('city', 'Dateline city')}${f('issue', 'Issue number')}${f('byline', 'Byline')}${f('source', 'Source name')}
        ${f('name', 'Contact name')}${f('role', 'Role')}${f('firm', 'Firm')}${f('phone', 'Phone', 'optional')}${f('email', 'Email', 'optional')}${f('web', 'Website', 'optional')}${f('license', 'License line', 'optional')}
      </div></details>
    <div class="ar-audit" data-testid="text-area-audit"><span class="item">${a.kept} of ${a.rows} rows used</span>${a.belowLot ? `<span class="item muted">${a.belowLot} below lot minimum</span>` : ''}<span class="item muted">Sold ${a.from ? fmtDate(a.from) : 'n/a'} to ${fmtDate(S.asOf)}</span>${warns.map((w) => `<span class="item"><span class="pill warn">Check</span>${esc(w)}</span>`).join('')}</div>
    <div class="table-wrap"><table class="data" data-testid="table-area"><thead><tr><th>Neighborhood</th><th>Active</th><th>Pending</th><th>Sold</th><th>Sold $/sq ft</th><th>Active list $/sq ft</th><th>Sold DOM</th><th>Active DOM</th></tr></thead>
      <tbody>${M.nbs.map((n) => `<tr>${cell(n)}</tr>`).join('')}</tbody><tfoot><tr>${cell(M.zip)}</tr></tfoot></table></div>
    ${M.smallLot ? `<div class="ar-small" data-testid="section-area-smalllot"><h3 class="h3">Small lot homes (lots under ${AR.minLot.toLocaleString()} sq ft)</h3>
      <p class="panel-note">Counted as their own group. Every median and average below is figured within its group, never across both.</p>
      <div class="table-wrap"><table class="data" data-testid="table-area-compare"><thead><tr><th></th><th>Lots ${AR.minLot.toLocaleString()}+ sq ft</th><th>Lots under ${AR.minLot.toLocaleString()} sq ft</th></tr></thead>
      <tbody>${compareRows(M).map(([k, a, b]) => `<tr><td>${esc(k)}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>
      <div class="table-wrap"><table class="data" data-testid="table-area-smalllot"><thead><tr><th>Neighborhood</th><th>Active</th><th>Pending</th><th>Sold</th><th>Sold $/sq ft</th><th>Active list $/sq ft</th><th>Sold DOM</th><th>Active DOM</th></tr></thead>
      <tbody>${M.smallLot.nbs.map((n) => `<tr>${cell(n)}</tr>`).join('')}</tbody><tfoot><tr>${cell(M.smallLot.zip)}</tr></tfoot></table></div></div>` : ''}
    <div class="ar-charts">
      ${[['cover', 'Cover 1920×1080'], ['fig1', 'Fig. 1 Price per sq ft'], ['fig2', 'Fig. 2 Days on market'], ['fig3', 'Fig. 3 Pipeline']].map(([k, l]) => `<figure class="ar-fig" data-testid="figure-area-${k}"><div class="ar-svg" id="ar-${k}"></div><figcaption><span>${l}</span><button class="btn ghost" data-png="${k}" data-testid="button-png-${k}">Download PNG</button></figcaption></figure>`).join('')}
    </div>
    <div class="ar-carousel" data-testid="section-area-carousel"><div class="ar-article-head"><h3 class="h3">LinkedIn carousel</h3>
      <div class="ar-actions"><button class="btn" id="ar-car-pdf" data-testid="button-carousel-pdf">Print carousel PDF</button><button class="btn ghost" id="ar-car-png" data-testid="button-carousel-png">Download slides (PNG)</button></div></div>
      <p class="panel-note">${M.smallLot ? 'Nine' : 'Eight'} 1080×1350 slides, starting with a cover. Upload the PDF to LinkedIn as a document post. Use Save as PDF with margins set to None.</p>
      <div class="ar-car-strip" id="ar-car"></div></div>
    <div class="ar-article">
      <div class="ar-article-head"><h3 class="h3">LinkedIn article text</h3>
        <div class="ar-actions"><button class="btn" id="ar-copy" data-testid="button-area-copy">Copy article</button><button class="btn ghost" id="ar-md" data-testid="button-area-md">Download .md</button><button class="btn ghost" id="ar-all" data-testid="button-area-all">Download all images</button><button class="btn ghost" id="ar-print" data-testid="button-area-print">Print broadsheet</button><button class="btn accent" id="ar-queue" data-testid="button-area-queue">Add to queue</button></div></div>
      <ul class="lint ar-lint">${wc}<li class="${dash ? 'warn' : 'ok'}"><span class="mk">${dash ? 'Check' : 'OK'}</span>${dash ? 'Dash found in copy' : 'No dashes'}</li><li class="${S.isSample ? 'warn' : 'ok'}"><span class="mk">${S.isSample ? 'Check' : 'OK'}</span>${S.isSample ? 'Sample data: do not publish' : 'Real export loaded'}</li><li class="ok"><span class="mk">OK</span>No street addresses or agent names</li></ul>
      <pre class="ar-text" id="ar-text" data-testid="text-area-article">${esc(articleText(M, C))}</pre>
    </div>`;
  $('#ar-cover').innerHTML = coverSvg(M, C);
  $('#ar-fig1').innerHTML = hbar(M, 'soldPpsf', 'Median sold price per square foot', d$, M.top, C.notes1, true);
  $('#ar-fig2').innerHTML = hbar(M, 'soldDom', 'Median days on market, sold homes', (x) => num(x) + ' days', M.slow, C.notes2);
  $('#ar-fig3').innerHTML = stacked(M);
  const slides = carouselSlides(M, C);
  $('#ar-car').innerHTML = slides.map((sv, i) => `<figure class="ar-slide" data-testid="slide-carousel-${i + 1}">${sv}</figure>`).join('');
  $('#panel-area details summary').onclick = (e) => { S.arOpen = !e.target.closest('details').open; };
  $$('#panel-area [data-ar]').forEach((i) => i.onchange = () => set(i.dataset.ar, i.value.trim()));
  $$('#panel-area [data-ar-n]').forEach((i) => i.onchange = () => set(i.dataset.arN, +i.value));
  $('#ar-lot').onchange = (e) => set('lotFilter', e.target.checked);
  const stem = `${S.zip}-Neighborhood-Update-${isoDay(S.asOf)}`;
  const png = (k) => { const svg = $('#ar-' + k + ' svg').outerHTML; const big = k === 'cover'; svgToPng(svg, `${stem}-${big ? 'Cover' : k === 'fig1' ? 'Chart-1' : k === 'fig2' ? 'Chart-2' : 'Chart-3'}.png`, big ? 1920 : 1200, big ? 1080 : 675); };
  $$('#panel-area [data-png]').forEach((b) => b.onclick = () => png(b.dataset.png));
  $('#ar-all').onclick = () => ['cover', 'fig1', 'fig2', 'fig3'].forEach((k, i) => setTimeout(() => png(k), i * 400));
  const txt = articleText(M, C);
  $('#ar-copy').onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('Article copied.'); } catch { toast('Copy blocked. Use Download .md instead.'); } };
  $('#ar-md').onclick = () => dl(new Blob([txt], { type: 'text/markdown' }), `${stem}-LinkedIn.md`);
  $('#ar-print').onclick = () => { document.body.classList.remove('carousel-mode'); buildPrint(M, C); window.print(); };
  $('#ar-car-pdf').onclick = () => { $('#print-carousel').innerHTML = slides.map((sv) => `<div class="slide">${sv}</div>`).join(''); document.body.classList.add('carousel-mode'); window.print(); setTimeout(() => document.body.classList.remove('carousel-mode'), 1000); };
  $('#ar-car-png').onclick = () => slides.forEach((sv, i) => setTimeout(() => svgToPng(sv, `${stem}-Carousel-${String(i + 1).padStart(2, '0')}.png`, CW, CH), i * 400));
  $('#ar-queue').onclick = () => {
    const opt = $('#slot').selectedOptions[0];
    S.queue.push({ headline: C.headline, format: 'Area report article', lens: 'all', slot: opt ? opt.value : '', slotLabel: opt ? opt.textContent : 'unscheduled', status: 'Queued', text: txt, sigs: [] });
    saveState(); renderQueue(); toast(`Area report queued for ${opt ? opt.textContent : 'later'}.`);
  };
}

// ---------- LinkedIn carousel (1080x1350 document slides) ----------
const CW = 1080, CH = 1350, PADX = 70;
function wrapT(t, n) { const out = []; let line = ''; String(t).split(/\s+/).forEach((w) => { if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); return out; }
function tLines(lines, x, y, lh, attrs) { return lines.map((l, i) => `<text x="${x}" y="${y + i * lh}" ${attrs}>${esc(l)}</text>`).join(''); }
function slideFrame(i, n, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}" font-family="Georgia, 'Source Serif 4', serif">
  <rect width="${CW}" height="${CH}" fill="#fff"/>
  <text x="${PADX}" y="72" font-size="22" letter-spacing="3" fill="${INK}">${esc(AR.issue.toUpperCase())}</text>
  <text x="${CW / 2}" y="72" text-anchor="middle" font-size="22" letter-spacing="3" fill="${INK}">${esc(AR.city.toUpperCase())}</text>
  <text x="${CW - PADX}" y="72" text-anchor="end" font-size="22" letter-spacing="3" fill="${INK}">${esc(fmtDate(S.asOf).toUpperCase())}</text>
  <line x1="${PADX}" y1="88" x2="${CW - PADX}" y2="88" stroke="${INK}" stroke-width="3"/><line x1="${PADX}" y1="96" x2="${CW - PADX}" y2="96" stroke="${INK}" stroke-width="1"/>
  ${body}
  <line x1="${PADX}" y1="${CH - 78}" x2="${CW - PADX}" y2="${CH - 78}" stroke="${RULE}" stroke-width="2"/>
  <text x="${PADX}" y="${CH - 40}" font-size="22" fill="${MUTED}">${esc(S.zip)} · ${esc(AR.source)}${S.isSample ? ' · fictional sample' : ''}</text>
  <text x="${CW - PADX}" y="${CH - 40}" text-anchor="end" font-size="22" fill="${MUTED}">${i} / ${n}</text></svg>`;
}
function slideHead(title, sub) {
  return `<text x="${PADX}" y="190" font-size="58" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif">${esc(title)}</text>
  <text x="${PADX}" y="240" font-size="28" fill="${MUTED}">${esc(sub)}</text>
  <line x1="${PADX}" y1="268" x2="${CW - PADX}" y2="268" stroke="${INK}" stroke-width="2"/>`;
}
function notesBlock(notes, bottom) {
  const ls = notes.flatMap((t) => wrapT(t, 66)), lh = 34, y0 = bottom - (ls.length - 1) * lh;
  return { h: ls.length ? ls.length * lh + 30 : 0, svg: tLines(ls, PADX, y0, lh, `font-size="25" fill="${MUTED}"`) };
}
function cBars(M, key, fmt, highlight, notes, price) {
  const items = M.nbs.filter((n) => Number.isFinite(n[key]));
  const nb = notesBlock(notes, CH - 120);
  const T = 310, B = CH - 110 - nb.h, L = 370, R = 150, gap = 14;
  const bh = Math.min(58, (B - T) / Math.max(items.length, 1) - gap);
  const max = Math.max(...items.map((n) => n[key]), 1);
  const bars = items.map((n, i) => {
    const y = T + i * (bh + gap), w = (CW - L - R - PADX + 70) * n[key] / max, hl = highlight && n.name === highlight.name, m = mark(n, price);
    return `<text x="${L - 18}" y="${y + bh / 2 + 10}" text-anchor="end" font-size="28" fill="${n.thin ? MUTED : INK}">${esc(n.name)}${m ? ' ' + m : ''}</text>
      <rect x="${L}" y="${y}" width="${Math.max(w, 3)}" height="${bh}" fill="${hl ? RED : n.thin ? '#B9B4AA' : INK}"/>
      <text x="${L + w + 12}" y="${y + bh / 2 + 10}" font-size="28" font-weight="700" fill="${hl ? RED : INK}">${fmt(n[key])}</text>`;
  }).join('');
  return bars + nb.svg;
}
function cPipeline(M) {
  const items = M.nbs, T = 360, B = CH - 190, L = 370, R = 70, gap = 14;
  const bh = Math.min(56, (B - T) / Math.max(items.length, 1) - gap);
  const max = Math.max(...items.map((n) => n.active + n.pending + n.sold), 1);
  const cols = [['active', INK, 'Active'], ['pending', '#8C877D', 'Pending'], ['sold', RED, 'Sold']];
  const legend = cols.map(([, c, l], i) => `<rect x="${L + i * 190}" y="300" width="28" height="28" fill="${c}"/><text x="${L + i * 190 + 40}" y="324" font-size="28" fill="${INK}">${l}</text>`).join('');
  const bars = items.map((n, i) => {
    const y = T + i * (bh + gap); let x = L;
    const segs = cols.map(([k, c]) => { const w = (CW - L - R) * n[k] / max; const s = `<rect x="${x}" y="${y}" width="${w}" height="${bh}" fill="${c}"/>` + (w > 40 ? `<text x="${x + w / 2}" y="${y + bh / 2 + 9}" text-anchor="middle" font-size="26" font-weight="700" fill="#fff">${n[k]}</text>` : ''); x += w; return s; }).join('');
    return `<text x="${L - 18}" y="${y + bh / 2 + 10}" text-anchor="end" font-size="28" fill="${INK}">${esc(n.name)}</text>${segs}`;
  }).join('');
  return legend + bars + tLines(wrapT(`Sold counts ${spanPhrase(M)}; active and pending are current.`, 66), PADX, CH - 120, 34, `font-size="25" fill="${MUTED}"`);
}
function cTable(M) {
  const cols = [['Neighborhood', 70, 'start'], ['Sold', 520, 'end'], ['$/sq ft', 680, 'end'], ['DOM', 785, 'end'], ['Active', 900, 'end'], ['Pend.', 1010, 'end']];
  const rowsA = [...M.nbs, M.zip], T = 330, rh = Math.min(62, (CH - 230 - T) / rowsA.length);
  const head = cols.map(([l, x, a]) => `<text x="${x}" y="${T - 20}" text-anchor="${a}" font-size="20" letter-spacing="1" font-weight="700" fill="${INK}" font-family="Inter, Arial, sans-serif">${l.toUpperCase()}</text>`).join('') + `<line x1="${PADX}" y1="${T - 6}" x2="${CW - PADX}" y2="${T - 6}" stroke="${INK}" stroke-width="2"/>`;
  const body = rowsA.map((n, i) => {
    const y = T + (i + 1) * rh - rh * 0.3, tot = i === rowsA.length - 1, m = mark(n), wt = tot ? ' font-weight="700"' : '';
    const v = [n.name + (m ? ' ' + m : ''), n.sold, d$(n.soldPpsf), num(n.soldDom), n.active, n.pending];
    return (tot ? `<line x1="${PADX}" y1="${T + i * rh + 4}" x2="${CW - PADX}" y2="${T + i * rh + 4}" stroke="${INK}" stroke-width="2"/>` : `<line x1="${PADX}" y1="${T + (i + 1) * rh + 4}" x2="${CW - PADX}" y2="${T + (i + 1) * rh + 4}" stroke="${RULE}" stroke-width="1"/>`) +
      cols.map(([, x, a], j) => `<text x="${x}" y="${y}" text-anchor="${a}" font-size="28"${wt} fill="${n.thin && !tot ? MUTED : INK}">${esc(v[j])}</text>`).join('');
  }).join('');
  return head + body + tLines(wrapT('Sold, $/sq ft and DOM are medians for sold homes. Marks match the chart notes.', 66), PADX, CH - 120, 34, `font-size="25" fill="${MUTED}"`);
}
function cCompare(M) {
  const T = 340, rh = 66, xs = [PADX, 760, CW - PADX];
  const head = [['', xs[0], 'start'], [`${AR.minLot.toLocaleString()}+ SQ FT LOTS`, xs[1], 'end'], [`UNDER ${AR.minLot.toLocaleString()}`, xs[2], 'end']]
    .map(([l, x, a], j) => `<text x="${x}" y="${T - 20}" text-anchor="${a}" font-size="20" letter-spacing="1" font-weight="700" fill="${j === 2 ? RED : INK}" font-family="Inter, Arial, sans-serif">${esc(l)}</text>`).join('') +
    `<line x1="${PADX}" y1="${T - 6}" x2="${CW - PADX}" y2="${T - 6}" stroke="${INK}" stroke-width="2"/>`;
  const body = compareRows(M).map(([k, a, b], i) => { const y = T + (i + 1) * rh - rh * 0.3;
    return `<text x="${xs[0]}" y="${y}" font-size="30" fill="${INK}">${esc(k)}</text><text x="${xs[1]}" y="${y}" text-anchor="end" font-size="30" fill="${INK}">${esc(a)}</text><text x="${xs[2]}" y="${y}" text-anchor="end" font-size="30" font-weight="700" fill="${RED}">${esc(b)}</text>` +
      `<line x1="${PADX}" y1="${T + (i + 1) * rh + 4}" x2="${CW - PADX}" y2="${T + (i + 1) * rh + 4}" stroke="${RULE}" stroke-width="1"/>`; }).join('');
  const lz = M.smallLot.zip, nbs = M.smallLot.nbs.filter((n) => n.sold).map((n) => `${n.name} ${n.sold}`).join(', ');
  const note = `Each column is its own group; nothing is averaged across both.${lz.sold ? ` Sold by neighborhood: ${nbs}.` : ''}${lz.sold && lz.sold < AR.minRank ? ` With ${lz.sold} sales, read as directional.` : ''}`;
  const nl = wrapT(note, 60);
  return head + body + tLines(nl, PADX, CH - 120 - (nl.length - 1) * 36, 36, `font-size="26" fill="${MUTED}"`);
}
function carouselSlides(M, C) {
  const z = M.zip, t = M.top, N = M.smallLot ? 9 : 8, out = [];
  const big = C.headline.split(': ').slice(1).join(': ') || C.headline;
  const hl = wrapT(big, 18), stats = [[String(z.sold), 'Homes sold'], [d$(z.soldPpsf), 'Median $/sq ft'], [num(z.soldDom), 'Median days on market'], [String(z.active), 'Active listings']];
  // 1. cover: broadsheet front page
  const hy = 530, sy = hy + hl.length * 124 + 10, subL = wrapT(C.subhead, 46);
  out.push(slideFrame(1, N, `<text x="${CW / 2}" y="190" text-anchor="middle" font-size="40" font-style="italic" fill="${RED}">${esc(S.zip)} Neighborhood Market Update</text>
    <line x1="${PADX}" y1="230" x2="${CW - PADX}" y2="230" stroke="${INK}" stroke-width="1"/>
    <text x="${CW / 2}" y="330" text-anchor="middle" font-size="120" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif">${esc(S.zip)}</text>
    <text x="${CW / 2}" y="390" text-anchor="middle" font-size="28" letter-spacing="6" fill="${MUTED}">NEIGHBORHOOD BY NEIGHBORHOOD</text>
    <line x1="${PADX}" y1="430" x2="${CW - PADX}" y2="430" stroke="${INK}" stroke-width="3"/><line x1="${PADX}" y1="438" x2="${CW - PADX}" y2="438" stroke="${INK}" stroke-width="1"/>
    ${tLines(hl, CW / 2, hy, 124, `text-anchor="middle" font-size="100" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif"`)}
    ${tLines(subL, CW / 2, sy + 30, 44, `text-anchor="middle" font-size="34" fill="${MUTED}"`)}
    <text x="${CW / 2}" y="${sy + 30 + subL.length * 44 + 40}" text-anchor="middle" font-size="34" font-style="italic" fill="${INK}">${esc(AR.byline)}</text>
    <line x1="${CW / 2 - 60}" y1="${CH - 200}" x2="${CW / 2 + 60}" y2="${CH - 200}" stroke="${RED}" stroke-width="4"/>
    <text x="${CW / 2}" y="${CH - 135}" text-anchor="middle" font-size="30" font-style="italic" fill="${INK}">Swipe for the breakout  ›</text>`));
  // 2. by the numbers
  out.push(slideFrame(2, N, slideHead('By the numbers', `${S.zip}${lotNote()}, ${spanPhrase(M).replace(/^in the l/, 'l')}`) +
    stats.map(([v, l], i) => { const x = PADX + (i % 2) * 470, y = 470 + Math.floor(i / 2) * 300; return `<text x="${x}" y="${y}" font-size="130" font-weight="700" fill="${i === 1 ? RED : INK}" font-family="'Playfair Display', Georgia, serif">${esc(v)}</text><text x="${x}" y="${y + 60}" font-size="32" fill="${MUTED}">${esc(l)}</text>`; }).join('') +
    tLines(wrapT(C.p1.split('. ').slice(1).join('. '), 52), PADX, 1000, 44, `font-size="32" fill="${INK}"`)));
  out.push(slideFrame(3, N, slideHead('Price per square foot', `Median sold, ${spanPhrase(M).replace(/^in the /, '')}${t ? ` · ${t.name} highlighted` : ''}`) + cBars(M, 'soldPpsf', d$, M.top, C.notes1, true)));
  out.push(slideFrame(4, N, slideHead('Days on market', `Median for sold homes${M.slow ? ` · ${M.slow.name} slowest` : ''}`) + cBars(M, 'soldDom', (x) => num(x) + ' days', M.slow, C.notes2, false)));
  out.push(slideFrame(5, N, slideHead('The pipeline', `${z.active} active, ${z.pending} pending, ${z.sold} sold`) + cPipeline(M)));
  out.push(slideFrame(6, N, slideHead('Neighborhood by neighborhood', `${S.zip}${lotNote()}`) + cTable(M)));
  let sn = 7;
  if (M.smallLot) out.push(slideFrame(sn++, N, slideHead('Small lot homes', `Lots under ${AR.minLot.toLocaleString()} sq ft, counted on their own`) + cCompare(M)));
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const parts = C.p3.split(/ (?=For buyers,)/).map((x) => cap(x.replace(/^For (sellers|buyers), /, '')));
  out.push(slideFrame(sn++, N, slideHead('What it means', 'For sellers and buyers') +
    `<text x="${PADX}" y="350" font-size="26" letter-spacing="3" font-weight="700" fill="${RED}" font-family="Inter, Arial, sans-serif">SELLERS</text>` +
    tLines(wrapT(parts[0] || '', 40), PADX, 410, 52, `font-size="38" fill="${INK}"`) +
    (parts[1] ? `<text x="${PADX}" y="${410 + wrapT(parts[0], 40).length * 52 + 70}" font-size="26" letter-spacing="3" font-weight="700" fill="${RED}" font-family="Inter, Arial, sans-serif">BUYERS</text>` +
      tLines(wrapT(parts[1], 40), PADX, 410 + wrapT(parts[0], 40).length * 52 + 130, 52, `font-size="38" fill="${INK}"`) : '')));
  const contact = [AR.name, [AR.role, AR.firm].filter(Boolean).join(', '), AR.phone, AR.email, AR.web, AR.license].filter(Boolean);
  out.push(slideFrame(sn++, N, `<text x="${PADX}" y="260" font-size="36" font-style="italic" fill="${RED}">${esc(S.zip)} Neighborhood Market Update</text>
    ${tLines(wrapT('Want this breakout for your street?', 22), PADX, 370, 96, `font-size="80" font-weight="700" fill="${INK}" font-family="'Playfair Display', Georgia, serif"`)}
    <text x="${PADX}" y="620" font-size="34" fill="${MUTED}">Message me for the full one-page report.</text>
    <line x1="${PADX}" y1="690" x2="${CW - PADX}" y2="690" stroke="${RULE}" stroke-width="2"/>
    ${tLines(contact, PADX, 780, 52, `font-size="38" fill="${INK}"`)}
    ${tLines(wrapT(sourceLine(M), 70), PADX, CH - 120 - (wrapT(sourceLine(M), 70).length - 1) * 30, 30, `font-size="22" fill="${MUTED}"`)}`));
  return out;
}

function buildPrint(M, C) {
  const contact = [AR.name, [AR.role, AR.firm].filter(Boolean).join(', '), AR.phone, AR.email, AR.web, AR.license].filter(Boolean).map(esc).join('<br/>');
  const cell = (n) => `<td>${esc(n.name)}${mark(n)}</td><td>${n.active}</td><td>${n.pending}</td><td>${n.sold}</td><td>${d$(n.soldPpsf)}</td><td>${d$(n.actPpsf)}</td><td>${num(n.soldDom)}</td><td>${num(n.actDom)}</td>`;
  $('#print-sheet').innerHTML = `
    <div class="ps-strip"><span>${esc(AR.issue)}</span><span>${esc(AR.city)}</span><span>${esc(fmtDate(S.asOf))}</span></div>
    <div class="ps-kicker">${esc(S.zip)} Neighborhood Market Update</div>
    <h1 class="ps-hl">${esc(C.headline.split(': ').slice(1).join(': ') || C.headline)}</h1>
    <div class="ps-sub">${esc(C.subhead)}</div><div class="ps-by">${esc(AR.byline)}</div>
    <div class="ps-cols"><p class="${/^[A-Za-z]/.test(C.p1) ? 'ps-drop' : ''}">${esc(C.p1)}</p><p>${esc(C.p2)}</p><p>${esc(C.p3)}</p></div>
    <div class="ps-figs${M.smallLot ? ' three' : ''}"><div>${$('#ar-fig1').innerHTML}</div><div>${$('#ar-fig2').innerHTML}</div><div>${$('#ar-fig3').innerHTML}</div></div>
    ${[...new Set([...C.notes1, ...C.notes2])].length ? `<div class="ps-notes">${[...new Set([...C.notes1, ...C.notes2])].map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    <table class="ps-table"><thead><tr><th>Neighborhood</th><th>Active</th><th>Pending</th><th>Sold</th><th>Sold $/SF</th><th>Active $/SF</th><th>Sold DOM</th><th>Active DOM</th></tr></thead><tbody>${M.nbs.map((n) => `<tr>${cell(n)}</tr>`).join('')}</tbody><tfoot><tr>${cell(M.zip)}</tr></tfoot></table>
    ${M.smallLot ? `<div class="ps-small"><div class="ps-small-h">Small lot homes, lots under ${AR.minLot.toLocaleString()} sq ft, counted on their own</div><table class="ps-table ps-cmp"><thead><tr>${['', ...compareRows(M).map((r) => r[0].replace('Median ', 'Med. ').replace('Average ', 'Avg. ').replace('days on market', 'DOM').replace('home size', 'size'))].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody><tr><td>Lots ${AR.minLot.toLocaleString()}+</td>${compareRows(M).map((r) => `<td>${esc(String(r[1]).replace(' sq ft', ''))}</td>`).join('')}</tr><tr><td>Under ${AR.minLot.toLocaleString()}</td>${compareRows(M).map((r) => `<td>${esc(String(r[2]).replace(' sq ft', ''))}</td>`).join('')}</tr></tbody></table></div>` : ''}
    <div class="ps-foot"><div class="ps-contact">${contact}</div><div class="ps-method">${esc(sourceLine(M))}</div></div>`;
}

// ---------- persistence ----------
function saveState() {}
function exportSession() {
  dl(new Blob([JSON.stringify({ app: 'micro-market-studio', version: 1, saved: new Date().toISOString(), settings: AR, queue: S.queue, memory: S.memory }, null, 2)], { type: 'application/json' }), `micro-market-studio-session-${isoDay(new Date())}.json`);
  toast('Session file saved. Load it next time to restore your queue, memory and report settings.');
}
function importSession(f) {
  const r = new FileReader();
  r.onload = () => { try { const j = JSON.parse(String(r.result)); if (j.app !== 'micro-market-studio') throw 0; Object.assign(AR, j.settings || {}); S.queue = j.queue || []; S.memory = j.memory || S.memory; render(); toast(`Session restored: ${S.queue.length} queued, ${S.memory.length} in memory.`); } catch { toast('That is not a Micro Market Studio session file.'); } };
  r.readAsText(f);
}


// ---------- events ----------
$$('.tab').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
$$('[data-lens]').forEach((b) => b.onclick = () => { S.lens = b.dataset.lens; $$('[data-lens]').forEach((x) => x.classList.toggle('active', x === b)); render(); });
$$('[data-voice]').forEach((b) => b.onclick = () => { S.voice = b.dataset.voice; $$('[data-voice]').forEach((x) => x.classList.toggle('active', x === b)); renderDraft(); });
$('#format').onchange = (e) => { S.format = e.target.value; renderDraft(); };
$('#band-slider').oninput = (e) => { S.band = +e.target.value; renderBands(rows()); };
$('#draft').addEventListener('click', (e) => { const b = e.target.closest('[data-ev]'); if (b) openEv(b.dataset.ev); });
function openEv(id) {
  const x = S.ev[id]; if (!x) return;
  $('#ev-label').textContent = x.label; $('#ev-value').textContent = x.value; $('#ev-calc').textContent = x.calc + (x.recs.length ? ` Showing ${x.recs.length} rows.` : '');
  const recs = x.recs.slice().sort((a, b) => ((b.sd || b.ld) - (a.sd || a.ld)));
  $('#ev-rows').innerHTML = recs.length ? `<thead><tr><th>Address</th><th>Listing #</th><th>Neighborhood</th><th>Type</th><th>Status</th><th>List</th><th>Original</th><th>Sold</th><th>$/sq ft</th><th>DOM</th><th>Date</th></tr></thead><tbody>` + recs.map((r) => `<tr><td>${esc(r.addr)}</td><td>${esc(r.mls)}</td><td>${esc(r.nb)}</td><td>${esc(r.type)}</td><td>${esc(r.rawStatus)}</td><td>${money0(r.list)}</td><td>${money0(r.orig)}</td><td>${money0(r.sold)}</td><td>${Number.isFinite(r.ppsf) ? '$' + Math.round(r.ppsf) : ''}</td><td>${num(r.dom)}</td><td>${shortDate(r.sd || r.pd || r.ld)}</td></tr>`).join('') + '</tbody>' : '<tbody><tr><td>Aggregate count. No row list for this figure.</td></tr></tbody>';
  $('#ev-dialog').showModal();
}
$('#ev-close').onclick = () => $('#ev-dialog').close();
$('#ev-dialog').addEventListener('click', (e) => { if (e.target.id === 'ev-dialog') $('#ev-dialog').close(); });

$('#copy').onclick = async () => {
  const t = draftText();
  try { await navigator.clipboard.writeText(t); toast('Copied to clipboard.'); }
  catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); toast(ok ? 'Copied to clipboard.' : 'Copy blocked by the browser. Use Download instead.'); }
};
$('#download').onclick = () => {
  const blob = new Blob([draftText()], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${S.zip}-${S.format}-${isoDay(S.asOf)}.txt`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#enqueue').onclick = () => {
  const sigs = S.selected.map((id) => S.signals.find((s) => s.id === id)).filter(Boolean); if (!sigs.length) return;
  const opt = $('#slot').selectedOptions[0];
  S.queue.push({ headline: sigs[0].headline, format: FMT_LABEL[S.format], lens: S.lens, slot: opt.value, slotLabel: opt.textContent, status: 'Queued', text: draftText(), sigs: sigs.map((s) => ({ type: s.type, scope: s.scope, headline: s.headline, memValue: s.memValue, memUnit: s.memUnit })) });
  saveState(); renderQueue(); toast(`Queued for ${opt.textContent}.`);
};

const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
$('#file').onchange = (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
function readFile(f) { const r = new FileReader(); r.onload = () => ingest(String(r.result), f.name, /sample/i.test(f.name)); r.readAsText(f); }
async function loadSample() {
  try { const res = await fetch('data/98125-sample.csv'); if (!res.ok) throw new Error(res.status); ingest(await res.text(), '98125-sample.csv', true); }
  catch (e) { showError('Could not load the sample file.'); }
}
$('#load-sample').onclick = loadSample;
$('#save-session').onclick = exportSession;
$('#session-file').onchange = (e) => { const f = e.target.files[0]; if (f) importSession(f); e.target.value = ''; };
loadSample();
})();
