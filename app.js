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
  style: ['style code', 'style', 'architectural style code'],
  city: ['city'], stnum: ['street number'], stdir: ['street direction'], stname: ['street name'], stsuf: ['street suffix'], stpost: ['street post direction'], unit: ['unit'],
  addr: ['address', 'street address', 'full address'],
  mls: ['listing #', 'mls #', 'mls number', 'listing id', 'ml#', 'listing number'],
  lot: ['lot square footage', 'lot size', 'lot sqft', 'lot sq ft', 'lot size sqft', 'lot size (sq ft)', 'lot area'],
  bd: ['bedrooms', 'beds', 'br'], ba: ['bathrooms', 'baths', 'ba'], yb: ['year built', 'yr built'],
  la: ['listing agent full name', 'listing agent', 'list agent full name', 'list agent'], sa: ['selling agent full name', 'selling agent', 'buyer agent full name', 'buyer agent']
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
// NWMLS Style Code: 30, 31, 34 condo, 32 townhouse, 33 co-op; 10s and 20s are detached houses.
// Used when Property Type is blank, which it is in Realty Toolkit exports.
function styleType(s) {
  const v = String(s || '').toLowerCase().trim();
  if (!v) return null;
  if (/town/.test(v)) return 'Townhouse';
  if (/condo|co-?op/.test(v)) return 'Condo';
  const n = parseInt(v, 10);
  if (n === 32) return 'Townhouse';
  if (n >= 30 && n <= 39) return 'Condo';
  return 'Residential';
}
function normType(s, style) {
  const v = String(s || '').toLowerCase();
  if (!v.trim() && style) return styleType(style) || 'Residential';
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
  signals: [], held: [], ev: {}, queue: [], fixes: {},
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
      type: normType(get(r, 'type'), get(r, 'style')), style: String(get(r, 'style') || '').trim(), list: toNum(get(r, 'list')), orig: toNum(get(r, 'orig')), sold: toNum(get(r, 'sold')),
      ld: toDate(get(r, 'ld')), pd: toDate(get(r, 'pd')), sd: toDate(get(r, 'sd')), dom: toNum(get(r, 'dom')), sq,
      lot: toNum(get(r, 'lot')), bd: toNum(get(r, 'bd')), ba: toNum(get(r, 'ba')), yb: toNum(get(r, 'yb'))
    };
    if (!Number.isFinite(rec.orig)) rec.orig = rec.list;
    rec.sold0 = rec.sold; rec.sq0 = rec.sq; rec.nb0 = rec.nb; rec.zip0 = rec.zip;
    rec.ppsf = rec.status === 'Sold' && sq > 0 ? rec.sold / sq : NaN;
    rec.ratio = rec.status === 'Sold' && rec.list > 0 ? rec.sold / rec.list : NaN;
    rec.cut = rec.orig > rec.list * 1.001;
    recs.push(rec);
  });
  const zc = {}; recs.forEach((r) => { zc[r.zip] = (zc[r.zip] || 0) + 1; });
  S.zips = Object.entries(zc).sort((a, b) => b[1] - a[1]).map((e) => ({ zip: e[0], n: e[1] }));
  S.zip = S.zips[0] ? S.zips[0].zip : '';
  S.all = recs; S.hasLot = 'lot' in map; S.mapping = map; S.isSample = isSample; S.fileName = name; S.ignored = ignored;
  S.missingOptional = ['orig', 'pd', 'type', 'zip'].filter((k) => !(k in map) && !(k === 'type' && 'style' in map));
  S.typeFrom = recs.some((r) => r.style) && !grid.slice(1).some((r) => String(get(r, 'type') || '').trim()) ? 'style' : 'type';
  S.typesPresent = CATS.filter((t) => recs.some((r) => cat(r) === t));
  S.types = new Set(S.typesPresent); S.smallOff = false;
  S.agents = new Map();
  grid.slice(1).forEach((r) => ['la', 'sa'].forEach((k) => { const key = agentKey(get(r, k)); if (key) S.agents.set(key, (S.agents.get(key) || 0) + 1); }));
  S.selected = []; S.answers = {}; S.nb = null;
  S.fixes = S.fixes || {}; flagPrices(recs); flagData(recs); applyFixes();
  render();
  if (!isSample && !profileReady()) openProfile(null, 'New export loaded. Add your name and contact details so your reports carry your byline.');
}
// ---------- typo check ----------
// Price flags: a sold price far from its own list or original price is almost always a typo,
// so those sales stay out of every number until reviewed. Size flags (price per sq ft far from the ZIP
// median) usually mean a square footage error; they are shown for review but kept by default.
const TYPO = { lo: 0.75, hi: 1.35, ppsfLo: 0.4, ppsfHi: 2 };
function guessPrice(r) {
  const ok = (v) => v > 0 && v / r.list >= TYPO.lo && v / r.list <= TYPO.hi;
  const s = String(Math.round(r.sold0));
  const tries = [[r.sold0 / 10, 'looks like an extra zero'], [r.sold0 * 10, 'looks like a missing zero'], [Number(s.slice(1)), 'looks like an extra leading digit']];
  for (const [v, why] of tries) if (ok(v)) return { v: Math.round(v), why };
  return null;
}
function flagPrices(recs) {
  recs.forEach((r) => { r.flag = null; });
  const sold = recs.filter((r) => r.status === 'Sold' && r.sold0 > 0);
  sold.forEach((r) => {
    const rl = r.list > 0 ? r.sold0 / r.list : NaN, ro = r.orig > 0 ? r.sold0 / r.orig : NaN;
    const bad = (x) => Number.isFinite(x) && (x < TYPO.lo || x > TYPO.hi);
    if (bad(rl) || (bad(ro) && ro > TYPO.hi)) {
      const g = guessPrice(r);
      r.flag = { kind: 'price', ratio: rl, why: `Sold at ${pct(rl, 0)} of list price` + (g ? `; ${g.why} (${money0(g.v)}?)` : ''), guess: g };
    }
  });
  // compare each sale with the median for its own ZIP and property type (needs 10 sales, else the ZIP median)
  const byKey = {}, push = (k, v) => { (byKey[k] = byKey[k] || []).push(v); };
  sold.filter((r) => !r.flag && r.sq > 0).forEach((r) => { push(r.zip, r.sold0 / r.sq); push(r.zip + '|' + r.type, r.sold0 / r.sq); });
  const med = (r) => { const t = byKey[r.zip + '|' + r.type]; return t && t.length >= 10 ? [median(t), ({ Residential: 'house', Townhouse: 'townhouse', Condo: 'condo' })[r.type] || ''] : byKey[r.zip] ? [median(byKey[r.zip]), ''] : [NaN, '']; };
  sold.filter((r) => !r.flag && r.sq > 0).forEach((r) => {
    const [m, lab] = med(r); if (!Number.isFinite(m)) return;
    const x = r.sold0 / r.sq / m;
    if (x < TYPO.ppsfLo || x > TYPO.ppsfHi) r.flag = { kind: 'size', why: `$${Math.round(r.sold0 / r.sq).toLocaleString()} a sq ft on ${Math.round(r.sq).toLocaleString()} sq ft, vs a ${r.zip}${lab ? ' ' + lab : ''} median of $${Math.round(m)}. Check the square footage.` };
  });
}
const fixKey = (r) => r.mls + '|' + r.addr;
function applyFixes() {
  S.all.forEach((r) => {
    const f = S.fixes[fixKey(r)], c = S.fixes['c|' + fixKey(r)] || {};
    r.sq = c.action === 'size' && c.value > 0 ? c.value : r.sq0;
    r.nb = c.action === 'nb' && c.value ? c.value : r.nb0;
    r.zip = c.action === 'move' && c.value ? c.value : r.zip0;
    r.sold = f && f.action === 'fix' && f.value > 0 ? f.value : r.sold0;
    r.ppsf = r.status === 'Sold' && r.sq > 0 ? r.sold / r.sq : NaN;
    r.ratio = r.status === 'Sold' && r.list > 0 ? r.sold / r.list : NaN;
  });
}
// a sale is left out when the user chose Leave out, or when a price flag has not been reviewed yet
function excluded(r) {
  if ((S.fixes['c|' + fixKey(r)] || {}).action === 'drop') return true;
  const f = S.fixes[fixKey(r)];
  if (f) return f.action === 'drop';
  return !!(r.flag && r.flag.kind === 'price');
}
// ---------- data checks ----------
// Neighborhood names the MLS uses and the ZIPs they usually sit in (north and northeast Seattle).
// Only used to flag a listing for review, never to move or drop it automatically.
const NB_ZIPS = {
  'ravenna': ['98115', '98105'], 'roosevelt': ['98115', '98105'], 'bryant': ['98115', '98105'], 'view ridge': ['98115'], 'sand point': ['98115'],
  'laurelhurst': ['98105'], 'university district': ['98105'], 'windermere': ['98115'], 'hawthorne hills': ['98115'], 'wedgwood': ['98115', '98125'],
  'maple leaf': ['98115', '98125'], 'green lake': ['98103', '98115'], 'greenwood': ['98103', '98117', '98133'], 'bitter lake': ['98133'], 'broadview': ['98177', '98133'],
  'haller lake': ['98133', '98125'], 'northgate': ['98125', '98133'], 'lake city': ['98125'], 'pinehurst': ['98125'], 'olympic hills': ['98125'],
  'victory heights': ['98125'], 'cedar park': ['98125', '98155'], 'meadowbrook': ['98125', '98115'], 'matthews beach': ['98125', '98115'], 'jackson park': ['98125', '98155']
};
const homeZips = (nb) => NB_ZIPS[String(nb || '').toLowerCase()] || null;
// stray ZIP: a ZIP with under 5% of the file's rows (or a blank ZIP) is likely a typo or an edge listing
function strayZips(recs) {
  const c = {}; recs.forEach((r) => { c[r.zip0] = (c[r.zip0] || 0) + 1; });
  return new Set(Object.keys(c).filter((z) => z === 'n/a' || c[z] / recs.length < 0.05));
}
function flagData(recs) {
  const stray = strayZips(recs);
  recs.forEach((r) => {
    r.chk = null;
    if (stray.has(r.zip0) && recs.length > 20) r.chk = { kind: 'zip', why: r.zip0 === 'n/a' ? 'No ZIP code on this listing.' : `ZIP ${r.zip0} is only on ${recs.filter((x) => x.zip0 === r.zip0).length} row${recs.filter((x) => x.zip0 === r.zip0).length === 1 ? '' : 's'} in this file. Set aside unless you include it.` };
    else if (!(r.sq0 > 0)) r.chk = { kind: 'nosize', why: 'No square footage, so it is left out of price per square foot.' };
    else if (r.nb0 === 'Unassigned') r.chk = { kind: 'nonb', why: 'No neighborhood listed (blank or just the city name). Counted in ZIP totals but not in any neighborhood.' };
    else { const hz = homeZips(r.nb0); if (hz && !hz.includes(r.zip0)) r.chk = { kind: 'nbzip', why: `${r.nb0} is usually in ${hz.join(' or ')}, not ${r.zip0}. Check the neighborhood or the ZIP.` }; }
  });
}
const CHK_LABEL = { zip: 'Listings from other ZIPs', nosize: 'No square footage', nonb: 'No neighborhood listed', nbzip: 'Neighborhood usually in another ZIP' };
const CHK_NOTE = {
  zip: 'These rows are set aside by default. Include one in this ZIP if its ZIP code is a typo.',
  nosize: 'Kept in counts and prices, left out of price per square foot. Enter the size if you have it.',
  nonb: 'Kept in ZIP totals. Assign a neighborhood to include it in the neighborhood breakout.',
  nbzip: 'Kept as is unless you change it. The MLS neighborhood name and the ZIP disagree, which usually means one of them is off.'
};
function dataSummary(zip) {
  const mine = S.all.filter((r) => r.chk && (r.chk.kind === 'zip' ? r.zip0 !== zip : r.zip0 === zip));
  const by = {}; mine.forEach((r) => { (by[r.chk.kind] = by[r.chk.kind] || []).push(r); });
  const reviewed = mine.filter((r) => S.fixes['c|' + fixKey(r)]).length;
  return { all: mine, by, reviewed };
}
function typoSummary(zip) {
  const fl = S.all.filter((r) => r.flag && r.zip === zip);
  const price = fl.filter((r) => r.flag.kind === 'price'), size = fl.filter((r) => r.flag.kind === 'size');
  const st = (r) => (S.fixes[fixKey(r)] || {}).action;
  return { fl, price, size, open: price.filter((r) => !st(r)).length, fixed: fl.filter((r) => st(r) === 'fix').length, dropped: fl.filter((r) => excluded(r)).length };
}
function openFixes() {
  const t = typoSummary(S.zip), d = $('#fix-dlg');
  const row = (r) => {
    const f = S.fixes[fixKey(r)] || {}, isP = r.flag.kind === 'price';
    const act = f.action || (isP ? 'drop' : 'keep');
    return `<tr data-key="${esc(fixKey(r))}"><td>${r.i + 2}</td><td>${esc(r.addr)}<div class="muted">${esc(r.nb)} · #${esc(r.mls)}</div></td><td>${money0(r.list)}${r.orig && r.orig !== r.list ? `<div class="muted">orig ${money0(r.orig)}</div>` : ''}</td><td><b>${money0(r.sold0)}</b></td><td class="fix-why">${esc(r.flag.why)}</td>
      <td><select class="fix-act" data-testid="select-fix-${esc(r.mls)}">${isP ? '' : `<option value="keep" ${act === 'keep' ? 'selected' : ''}>Keep</option>`}<option value="fix" ${act === 'fix' ? 'selected' : ''}>Fix price</option><option value="drop" ${act === 'drop' ? 'selected' : ''}>Leave out</option>${isP ? `<option value="keep" ${act === 'keep' ? 'selected' : ''}>Keep, it is real</option>` : ''}</select>
      <input class="fix-val" inputmode="numeric" placeholder="${r.flag.guess ? 'Maybe ' + r.flag.guess.v.toLocaleString('en-US') : 'Corrected price'}" value="${f.value || ''}" ${act === 'fix' ? '' : 'hidden'} data-testid="input-fix-${esc(r.mls)}"/></td></tr>`;
  };
  const tbl = (rs) => `<div class="table-wrap"><table class="data fix-table"><thead><tr><th>Row</th><th>Address</th><th>List</th><th>Sold</th><th>Why flagged</th><th>Action</th></tr></thead><tbody>${rs.map(row).join('')}</tbody></table></div>`;
  $('#fix-body').innerHTML = (t.price.length ? `<h3 class="fix-h">Sold prices that look like typos (${t.price.length})</h3><p class="muted">These sales are left out of every number until you fix or confirm them. Row numbers match your spreadsheet.</p>${tbl(t.price)}` : '')
    + (t.size.length ? `<h3 class="fix-h">Unusual price per square foot (${t.size.length})</h3><p class="muted">Usually a square footage error, sometimes a real tiny home or teardown. Kept in the numbers unless you leave them out.</p>${tbl(t.size)}` : '')
    + dataSections();
  $$('#fix-body tr[data-key] select.fix-act').forEach((sel) => sel.onchange = () => { const i = sel.parentElement.querySelector('.fix-val'); i.hidden = sel.value !== 'fix'; if (!i.hidden) i.focus(); });
  $$('#fix-body tr[data-ckey] select.chk-act').forEach((sel) => sel.onchange = () => { const i = sel.parentElement.querySelector('.chk-val'); if (i) { i.hidden = !['size', 'nb', 'move'].includes(sel.value); if (!i.hidden) i.focus(); } });
  if (!t.price.length && !t.size.length && !dataSummary(S.zip).all.length) $('#fix-body').innerHTML = '<p>No typos or data problems found in this ZIP.</p>';
  $('#fix-err').textContent = '';
  d.showModal();
}
function saveFixes() {
  const next = {}; let err = '';
  $$('#fix-body tr[data-key]').forEach((tr) => {
    const a = tr.querySelector('select').value, v = Math.round(Number(String(tr.querySelector('.fix-val').value).replace(/[$,\s]/g, '')));
    if (a === 'fix' && !(v > 0)) err = 'Enter a corrected price for each row set to Fix price, or choose another action.';
    const r = S.all.find((x) => fixKey(x) === tr.dataset.key), isP = r && r.flag && r.flag.kind === 'price';
    if (a === 'fix') next[tr.dataset.key] = { action: 'fix', value: v };
    else if (a === 'drop') next[tr.dataset.key] = { action: 'drop' };
    else if (isP) next[tr.dataset.key] = { action: 'keep' };
  });
  $$('#fix-body tr[data-ckey]').forEach((tr) => {
    const a = tr.querySelector('select.chk-act').value, inp = tr.querySelector('.chk-val'), raw = inp ? String(inp.value).trim() : '';
    if (a === 'size') { const v = Math.round(Number(raw.replace(/[,\s]/g, ''))); if (!(v > 0)) err = 'Enter the square footage for each row set to Enter size.'; next[tr.dataset.ckey] = { action: 'size', value: v }; }
    else if (a === 'nb') { if (!raw) err = 'Pick a neighborhood for each row set to Assign neighborhood.'; next[tr.dataset.ckey] = { action: 'nb', value: raw }; }
    else if (a === 'move') next[tr.dataset.ckey] = { action: 'move', value: S.zip };
    else if (a === 'drop') next[tr.dataset.ckey] = { action: 'drop' };
    else if (a === 'keep') next[tr.dataset.ckey] = { action: 'keep' };
  });
  if (err) { $('#fix-err').textContent = err; return; }
  S.all.filter((r) => r.flag && r.zip === S.zip).forEach((r) => { delete S.fixes[fixKey(r)]; });
  dataSummary(S.zip).all.forEach((r) => { delete S.fixes['c|' + fixKey(r)]; });
  Object.assign(S.fixes, next); applyFixes(); $('#fix-dlg').close(); render();
  const t = typoSummary(S.zip), dd = dataSummary(S.zip); toast(`Saved. ${t.fixed} price${t.fixed === 1 ? '' : 's'} fixed, ${t.dropped} sale${t.dropped === 1 ? '' : 's'} left out, ${dd.reviewed} data check${dd.reviewed === 1 ? '' : 's'} reviewed.`);
}
function dataSections() {
  const d = dataSummary(S.zip);
  const nbs = [...new Set(S.all.filter((r) => r.zip0 === S.zip && r.nb0 !== 'Unassigned').map((r) => r.nb0))].sort();
  const price = (r) => r.status === 'Sold' ? money0(r.sold0) : money0(r.list);
  const row = (r) => {
    const k = 'c|' + fixKey(r), f = S.fixes[k] || {}, kind = r.chk.kind;
    const def = kind === 'zip' ? 'drop' : 'keep', act = f.action || def;
    const opt = (v, l) => `<option value="${v}" ${act === v ? 'selected' : ''}>${l}</option>`;
    let opts = '', input = '';
    if (kind === 'zip') { opts = opt('drop', 'Set aside') + opt('move', 'Include in ' + S.zip); }
    else if (kind === 'nosize') { opts = opt('keep', 'Keep') + opt('size', 'Enter size') + opt('drop', 'Leave out'); input = `<input class="chk-val" inputmode="numeric" placeholder="Square feet" value="${f.action === 'size' ? f.value : ''}" ${act === 'size' ? '' : 'hidden'} data-testid="input-chk-${esc(r.mls)}"/>`; }
    else { opts = opt('keep', kind === 'nonb' ? 'Keep unassigned' : 'Keep') + opt('nb', 'Assign neighborhood') + opt('drop', 'Leave out'); input = `<select class="chk-val" ${act === 'nb' ? '' : 'hidden'} data-testid="input-chk-${esc(r.mls)}"><option value="">Choose…</option>${nbs.filter((n) => n !== r.nb0).map((n) => `<option ${f.value === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; }
    return `<tr data-ckey="${esc(k)}"><td>${r.i + 2}</td><td>${esc(r.addr)}<div class="muted">${esc(r.nb0 === 'Unassigned' ? 'No neighborhood' : r.nb0)} · ${esc(r.zip0)} · #${esc(r.mls)}</div></td><td>${esc(r.status)}</td><td>${price(r)}</td><td class="fix-why">${esc(r.chk.why)}</td>
      <td><select class="chk-act" data-testid="select-chk-${esc(r.mls)}">${opts}</select>${input}</td></tr>`;
  };
  const tbl = (rs) => `<div class="table-wrap"><table class="data fix-table"><thead><tr><th>Row</th><th>Address</th><th>Status</th><th>Price</th><th>Why flagged</th><th>Action</th></tr></thead><tbody>${rs.map(row).join('')}</tbody></table></div>`;
  return ['zip', 'nbzip', 'nonb', 'nosize'].filter((k) => d.by[k]).map((k) => `<h3 class="fix-h">${CHK_LABEL[k]} (${d.by[k].length})</h3><p class="muted">${CHK_NOTE[k]}</p>${tbl(d.by[k])}`).join('');
}

function showError(msg) {
  $('#validation').innerHTML = `<span class="pill bad" data-testid="status-error">Upload problem</span><span>${esc(msg)}</span>`;
}

// working set
// small lot homes (lot under the area report's minimum, 3,000 sq ft by default) are their own group,
// detached (Residential) homes on those lots move to Small lot; townhouses and condos keep their type
const CATS = ['Residential', 'Townhouse', 'Condo', 'Small lot'];
const CAT_LABEL = { Residential: 'Residential', Townhouse: 'Townhouse', Condo: 'Condo', 'Small lot': 'Small lot homes' };
function smallOn() { return S.typesPresent.includes('Small lot') ? S.types.has('Small lot') : !S.smallOff; }
function isSmallLot(r) { return S.hasLot && r.type === 'Residential' && Number.isFinite(r.lot) && r.lot > 0 && r.lot < AR.minLot; }
function cat(r) { return isSmallLot(r) ? 'Small lot' : r.type; }
function rows() { return S.all.filter((r) => r.zip === S.zip && S.types.has(cat(r)) && !excluded(r)); }
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
  s.parts = { size: Math.round(s.mag * 100), confMult, nov, fit };
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
  renderValidation(rs); renderKPIs(rs); renderSignals(); renderDiff(rs); renderBands(rs); renderTrends(rs); renderQueue(); renderBuilder(); renderFoot(rs); renderArea(rs);
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
  const ty = typoSummary(S.zip);
  const dd = dataSummary(S.zip), ddOpen = dd.all.length - dd.reviewed;
  const ddTxt = Object.entries(dd.by).map(([k, v]) => `${v.length} ${({ zip: 'from other ZIPs', nosize: 'with no square footage', nonb: 'with no neighborhood', nbzip: 'with a neighborhood from another ZIP' })[k]}`).join(', ');
  const tyHtml = !ty.fl.length && !dd.all.length ? '' : !ty.fl.length ? `<span class="item" data-testid="status-typo"><span class="pill ${ddOpen ? 'warn' : 'ok'}">${ddOpen ? 'Data check' : 'Reviewed'}</span>${ddOpen ? `${ddOpen} listing${ddOpen === 1 ? '' : 's'} to review: ${ddTxt}.` : `Data check: ${dd.reviewed} reviewed.`} <button class="btn ghost sm" id="review-typos" data-testid="button-review-typos">Review</button></span>` : `<span class="item" data-testid="status-typo"><span class="pill ${ty.open ? 'bad' : ddOpen ? 'warn' : 'ok'}">${ty.open ? 'Typo check' : ddOpen ? 'Data check' : 'Reviewed'}</span>${ty.open ? `${ty.open} sold price${ty.open === 1 ? '' : 's'} look like typos, left out until reviewed.` : `Typo check: ${ty.fixed} fixed, ${ty.dropped} left out.`}${ty.size.length ? ` <span class="muted">${ty.size.length} unusual $/sq ft.</span>` : ''}${dd.all.length ? ` <span class="muted">${ddOpen ? `${ddOpen} data check${ddOpen === 1 ? '' : 's'} to review: ${ddTxt}.` : `${dd.reviewed} data checks reviewed.`}</span>` : ''} <button class="btn ghost sm" id="review-typos" data-testid="button-review-typos">Review</button></span>`;
  $('#validation').innerHTML = `
    <span class="item"><span class="pill ok" data-testid="status-parsed">Parsed</span>${esc(S.fileName)}: ${S.all.length} rows</span>
    <span class="item">ZIP <select id="zip-select" data-testid="select-zip">${S.zips.map((z) => `<option value="${esc(z.zip)}" ${z.zip === S.zip ? 'selected' : ''}>${esc(z.zip)} (${z.n})</option>`).join('')}</select>${others ? `<span class="muted">${others} other-ZIP rows set aside</span>` : ''}</span>
    <span class="item">${st.Active} active, ${st.Pending} pending, ${st.Sold} sold, ${st.Expired} expired</span>
    <span class="item muted">${fmtDate(minD)} to ${fmtDate(S.asOf)}</span>
    <span class="item"><span class="pill ${fresh[0]}" data-testid="status-freshness">${fresh[1]}</span></span>
    <span class="item types">${S.typesPresent.map((t) => `<label${t === 'Small lot' ? ` title="Lots under ${AR.minLot.toLocaleString()} sq ft, counted as their own group"` : ''}><input type="checkbox" data-type="${t}" ${S.types.has(t) ? 'checked' : ''} data-testid="checkbox-type-${t.toLowerCase().replace(/\s+/g, '-')}"/>${CAT_LABEL[t]}${t === 'Small lot' ? ` <span class="muted">(lots under ${AR.minLot.toLocaleString()} sq ft)</span>` : ''}</label>`).join('')}${S.typeFrom === 'style' ? (() => { const zr = S.all.filter((r) => r.zip === S.zip && !excluded(r)), c = (t) => zr.filter((r) => cat(r) === t).length; return `<span class="muted" data-testid="text-type-source" title="Property Type is blank in this export, so each listing is sorted by its NWMLS Style Code: 30, 31 and 34 are condos, 32 is a townhouse, the rest are detached houses.">Sorted by Style Code: ${c('Residential')} houses, ${c('Townhouse')} townhouses, ${c('Condo')} condos${c('Small lot') ? `, ${c('Small lot')} small lot` : ''}.</span>`; })() : ''}</span>
    ${tyHtml}${warns.map((w) => `<span class="item"><span class="pill warn">Check</span>${esc(w)}</span>`).join('')}`;
  if ($('#review-typos')) $('#review-typos').onclick = openFixes;
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

function scoreTip(s) {
  const p = s.parts || {}, aud = { seller: 'sellers', buyer: 'buyers', investor: 'investors' }[S.lens];
  const samp = { 1: 'Solid sample, 12 or more sales (x 1)', 0.72: 'Smaller sample, 6 to 11 sales (x 0.72)', 0.35: 'Too few sales, under 6 (x 0.35)' }[p.confMult] || '';
  return `<span class="score-tip" role="tooltip" id="tip-${esc(s.id)}"><b>How strong this is as a post, from 1 to 99.</b> Cards are ranked by it. 60 and up shows in red.
    <span class="tip-row"><span>Size of the difference</span><span>${p.size} of 100</span></span>
    <span class="tip-row"><span>${samp}</span><span></span></span>
    <span class="tip-row"><span>${p.nov === 1 ? 'Not posted in the last 4 weeks (x 1)' : 'Posted in the last 4 weeks (x 0.6)'}</span><span></span></span>
    <span class="tip-row"><span>Fit for ${aud}</span><span>x ${p.fit}</span></span>
    <span class="tip-foot">Change the audience lens and the scores change.</span></span>`;
}
function card(s, rank, held) {
  const sel = S.selected.includes(s.id);
  const memTag = s.memory ? `<span class="tag memory">Posted ${shortDate(new Date(s.memory.date + 'T12:00:00Z'))}</span>` : '';
  return `<article class="card ${sel ? 'selected' : ''}" data-testid="card-signal-${esc(s.id)}">
    <div class="card-top"><div><div class="rank">${held ? 'Watching' : '#' + rank} · ${esc(s.scope === 'ZIP' ? S.zip + ' overall' : s.scopeName)}</div><h3>${esc(s.headline)}</h3></div>
      <div class="score ${s.score >= 60 ? 'hot' : ''}" tabindex="0" aria-describedby="tip-${esc(s.id)}" data-testid="score-${esc(s.id)}"><span class="n" data-testid="text-score-${esc(s.id)}">${s.score}</span><span class="l">Story score <span class="q" aria-hidden="true">?</span></span>${scoreTip(s)}</div></div>
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

// ---------- trends: monthly sales, prices and the 30 year rate ----------
const RATES = (window.MMS_RATES && window.MMS_RATES.weeks || []).map(([d, v]) => ({ d: new Date(d + 'T12:00:00Z'), v }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rateAvg(a, b) { const w = RATES.filter((x) => x.d >= a && x.d < b); return w.length ? w.reduce((s, x) => s + x.v, 0) / w.length : NaN; }
function monthsOf(rs) {
  const sold = rs.filter((r) => r.status === 'Sold' && r.sd);
  if (!sold.length) return [];
  const first = new Date(Math.min(...sold.map((r) => r.sd.getTime())));
  const out = []; let y = first.getUTCFullYear(), m = first.getUTCMonth();
  const endY = S.asOf.getUTCFullYear(), endM = S.asOf.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const a = new Date(Date.UTC(y, m, 1)), b = new Date(Date.UTC(y, m + 1, 1));
    const s = sold.filter((r) => r.sd >= a && r.sd < b);
    out.push({ y, m, a, b, n: s.length, med: median(s.map((r) => r.sold)), rate: rateAvg(a, b), partial: y === endY && m === endM, recs: s });
    if (++m > 11) { m = 0; y++; }
  }
  // the first month is usually partial too (export window starts mid month)
  if (out.length && first.getUTCDate() > 3) out[0].partialStart = true;
  return out;
}
function yoyStats(rs, days) {
  const win = (a, b) => soldIn(rs, a, b);
  const cur = win(0, days), pri = win(365, 365 + days);
  const f = (s) => ({ n: s.length, med: median(s.map((r) => r.sold)), ppsf: median(s.map((r) => r.ppsf)), dom: median(s.map((r) => r.dom)), ratio: median(s.map((r) => r.ratio)), over: s.length ? s.filter((r) => r.ratio > 1.0001).length / s.length : NaN, recs: s });
  const to = new Date(S.asOf.getTime() + DAY), rate = (a) => rateAvg(new Date(to - (a + days) * DAY), new Date(to - a * DAY));
  return { cur: Object.assign(f(cur), { rate: rate(0) }), pri: Object.assign(f(pri), { rate: rate(365) }) };
}
// plain-language read of the Trends tab, written from the selected ZIP, property types and window
function trendSummary(rs, ms, y, W, span, lastRate) {
  const TL = { Residential: 'houses', Townhouse: 'townhouses', Condo: 'condos', 'Small lot': 'small lot homes' };
  const on = S.typesPresent.filter((t) => S.types.has(t)).map((t) => TL[t]);
  const what = on.length === S.typesPresent.length && on.length > 1 ? 'homes' : on.length === 1 ? on[0] : on.slice(0, -1).join(', ') + ' and ' + on[on.length - 1];
  const list = (a) => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const mixNote = on.length > 1 && on.length === S.typesPresent.length ? ` This counts ${list(on)} together.` : '';
  const per = W === 365 ? ['the last 12 months', 'the year before'] : ['the last 3 months', 'the same 3 months last year'];
  const P = (a, b) => (a - b) / b;
  const move = (d, unit) => !Number.isFinite(d) ? 'with no comparison' : Math.abs(d) < 0.01 ? 'about the same as a year ago' : `${d > 0 ? 'up' : 'down'} ${(Math.abs(d) * 100).toFixed(1)}%`;
  const out = [];
  if (!y) {
    const total = ms.reduce((a, m) => a + m.n, 0);
    out.push(`In ${S.zip}, ${total} ${what} closed in the ${Math.round(span)} days covered by this file.${mixNote}`);
    const full = ms.filter((m) => !m.partial && !m.partialStart);
    if (full.length >= 2) { const a = full[full.length - 2], b = full[full.length - 1]; out.push(`${MON[b.m]} had ${b.n} sales against ${a.n} in ${MON[a.m]}.`); }
    if (lastRate) out.push(`The 30 year rate is ${lastRate.v.toFixed(2)}%.`);
    out.push('Year over year needs a 730 day export.');
    return out.join(' ');
  }
  const c = y.cur, p = y.pri, dn = P(c.n, p.n);
  out.push(`In ${S.zip}, ${c.n} ${what} closed in ${per[0]}, ${Math.abs(dn) < 0.02 ? `about the same as ${W === 365 ? 'the year before' : 'a year earlier'} (${p.n})` : `${dn > 0 ? 'up' : 'down'} from ${p.n} ${W === 365 ? 'the year before' : 'in the same months last year'}`}.${mixNote}`);
  const dp = P(c.med, p.med), dq = P(c.ppsf, p.ppsf);
  if (Number.isFinite(dp)) out.push(`The median sold price is ${money0(c.med)}, ${move(dp)}, and price per square foot is ${move(dq)}.`);
  if (Number.isFinite(dp) && Number.isFinite(dq) && Math.abs(dp - dq) >= 0.03) out.push(`Price per square foot moved ${Math.abs(dq) < Math.abs(dp) ? 'less' : 'more'} than the median price, which points to a change in the mix of ${what} that sold, not only a change in value.`);
  const dd = c.dom - p.dom;
  const Cap = what[0].toUpperCase() + what.slice(1);
  if (Number.isFinite(dd)) out.push(Math.abs(dd) <= 1 ? `${Cap} are selling about as fast as a year ago, a median of ${num(c.dom)} days.` : `${Cap} are selling ${dd > 0 ? 'more slowly' : 'faster'}: a median of ${num(c.dom)} days, against ${num(p.dom)} a year ago.`);
  const dov = c.over - p.over;
  if (Number.isFinite(dov)) out.push(`${pct(c.over)} sold over asking, ${Math.abs(dov) < 0.02 ? 'about the same as' : dov > 0 ? 'up from' : 'down from'} ${pct(p.over)}.`);
  const last12 = ms.filter((m) => !m.partial && !m.partialStart).slice(-12);
  if (last12.length >= 6) { const top = last12.reduce((a, m) => (m.n > a.n ? m : a)); out.push(`The busiest of the last 12 months was ${MON[top.m]} ${top.y}, with ${top.n} sales.`); }
  if (Number.isFinite(c.rate)) {
    const dr = c.rate - p.rate;
    let t = `The 30 year rate averaged ${c.rate.toFixed(2)}%, ${Math.abs(dr) < 0.15 ? `close to ${p.rate.toFixed(2)}%` : `${dr > 0 ? 'up' : 'down'} from ${p.rate.toFixed(2)}%`} ${W === 365 ? 'the year before' : 'a year earlier'}`;
    if (lastRate) t += `, and was ${lastRate.v.toFixed(2)}% in the week of ${fmtDate(lastRate.d)}`;
    out.push(t + '.');
  }
  return out.join(' ');
}
function renderTrends(rs) {
  const el = $('#panel-trends'); if (!el) return;
  S.trendWin = S.trendWin || 365;
  const ms = monthsOf(rs);
  const soldDates = rs.filter((r) => r.status === 'Sold' && r.sd).map((r) => r.sd.getTime());
  const span = soldDates.length ? (S.asOf - Math.min(...soldDates)) / DAY : 0;
  const lastRate = RATES[RATES.length - 1];
  const src = `Sales: ${AR.source}${S.isSample ? ' (fictional sample data)' : ''}, ${S.zip}, property types checked above, typo and data check choices applied. Rates: 30 year fixed average, ${window.MMS_RATES ? window.MMS_RATES.source : 'not loaded'}${lastRate ? `, latest ${lastRate.v.toFixed(2)}% for the week of ${fmtDate(lastRate.d)}` : ''}. Monthly rate is the average of that month's weekly readings.`;
  // year over year scorecard
  const W = S.trendWin, canYoy = span >= 365 + W - 10;
  const y = canYoy ? yoyStats(rs, W) : null;
  const chg = (a, b, kind) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '<span class="muted">n/a</span>';
    let d, t;
    if (kind === 'pct') { d = (a - b) / b; t = (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%'; }
    else if (kind === 'pts') { d = a - b; t = (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pts'; }
    else if (kind === 'rate') { d = a - b; t = (d >= 0 ? '+' : '') + d.toFixed(2) + ' pts'; }
    else { d = a - b; t = (d >= 0 ? '+' : '') + Math.round(d) + ' days'; }
    return `<span class="${Math.abs(d) < 1e-9 ? '' : d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${t}</span>`;
  };
  const lbl = W === 365 ? ['Last 12 months', 'Prior 12 months'] : ['Last 3 months', 'Same 3 months last year'];
  const rowsY = y ? [
    ['Homes sold', y.cur.n, y.pri.n, String(y.cur.n), String(y.pri.n), 'pct'],
    ['Median sold price', y.cur.med, y.pri.med, money0(y.cur.med), money0(y.pri.med), 'pct'],
    ['Median $/sq ft', y.cur.ppsf, y.pri.ppsf, '$' + num(y.cur.ppsf), '$' + num(y.pri.ppsf), 'pct'],
    ['Median days on market', y.cur.dom, y.pri.dom, num(y.cur.dom) + ' days', num(y.pri.dom) + ' days', 'days'],
    ['Median sold-to-list', y.cur.ratio, y.pri.ratio, pct(y.cur.ratio, 1), pct(y.pri.ratio, 1), 'pts'],
    ['Share sold over asking', y.cur.over, y.pri.over, pct(y.cur.over), pct(y.pri.over), 'pts'],
    ['30 year rate, average', y.cur.rate, y.pri.rate, num(y.cur.rate, 2) + '%', num(y.pri.rate, 2) + '%', 'rate']
  ] : [];
  const fmtR = (d) => fmtDate(d);
  const range = (a) => `${fmtR(new Date(S.asOf - (a + W - 1) * DAY))} to ${fmtR(new Date(S.asOf - a * DAY))}`;
  const score = canYoy ? `<div class="table-wrap"><table class="data yoy" data-testid="table-yoy"><thead><tr><th></th><th>${lbl[0]}<div class="muted">${range(0)}</div></th><th>${lbl[1]}<div class="muted">${range(365)}</div></th><th>Change</th></tr></thead><tbody>${rowsY.map(([l, a, b, ta, tb, k]) => `<tr><td>${l}</td><td><b>${ta}</b></td><td>${tb}</td><td>${chg(a, b, k)}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="panel-note" data-testid="text-yoy-need">Year over year needs about ${Math.round((365 + W) / 30)} months of sold history. This file covers ${Math.round(span)} days. In Realty Toolkit, set the sold date range to 730 days for full year over year.</p>`;
  // chart 1: sales per month (bars) with the 30 year rate (red line)
  const Wd = 720, H = 240, L = 34, R = 40, T = 22, B = 34, n = ms.length;
  let c1 = '<p class="panel-note">No sold listings in this ZIP and property mix.</p>';
  if (n) {
    const bw = (Wd - L - R) / n, maxN = Math.max(...ms.map((x) => x.n), 1);
    const rv = ms.map((x) => x.rate).filter(Number.isFinite), rLo = Math.floor(Math.min(...rv, 6) - 0.25), rHi = Math.ceil(Math.max(...rv, 7) + 0.25);
    const yN = (v) => T + (H - T - B) * (1 - v / maxN), yR = (v) => T + (H - T - B) * (1 - (v - rLo) / (rHi - rLo));
    const bars = ms.map((x, i) => { const X = L + i * bw + 2, Y = yN(x.n); return `<rect x="${X.toFixed(1)}" y="${Y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(H - B - Y).toFixed(1)}" fill="${x.partial || x.partialStart ? '#b5b5b5' : 'var(--ink)'}"><title>${MON[x.m]} ${x.y}: ${x.n} sold${x.partial ? ' (month to date)' : x.partialStart ? ' (partial month)' : ''}, rate ${num(x.rate, 2)}%</title></rect>${n <= 26 ? `<text x="${(X + (bw - 4) / 2).toFixed(1)}" y="${(Y - 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--ink)">${x.n}</text>` : ''}`; }).join('');
    const pts = ms.map((x, i) => Number.isFinite(x.rate) ? `${(L + i * bw + bw / 2).toFixed(1)},${yR(x.rate).toFixed(1)}` : null).filter(Boolean).join(' ');
    const xl = ms.map((x, i) => (x.m % 3 === 0 || n <= 8) ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - B + 14}" font-size="10" text-anchor="middle" fill="var(--muted)">${MON[x.m]}</text>${x.m === 0 || i === 0 ? `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - B + 27}" font-size="10" text-anchor="middle" fill="var(--muted)">${x.y}</text>` : ''}` : '').join('');
    const ry = []; for (let v = rLo; v <= rHi + 1e-9; v += 0.5) ry.push(`<text x="${Wd - R + 6}" y="${(yR(v) + 3).toFixed(1)}" font-size="10" fill="var(--accent)">${v.toFixed(1)}%</text><line x1="${L}" x2="${Wd - R}" y1="${yR(v).toFixed(1)}" y2="${yR(v).toFixed(1)}" stroke="#eee"/>`);
    const last = ms.filter((x) => Number.isFinite(x.rate)).slice(-1)[0];
    c1 = `<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Homes sold per month with the 30 year mortgage rate" data-testid="chart-sales-rates">${ry.join('')}<text x="${L - 6}" y="${T - 8}" font-size="10" fill="var(--muted)" text-anchor="start">Homes sold</text><text x="${Wd - R + 6}" y="${T - 8}" font-size="10" fill="var(--accent)">Rate</text>${bars}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${last ? `<circle cx="${(L + ms.indexOf(last) * bw + bw / 2).toFixed(1)}" cy="${yR(last.rate).toFixed(1)}" r="3.5" fill="var(--accent)"/>` : ''}<line x1="${L}" x2="${Wd - R}" y1="${H - B}" y2="${H - B}" stroke="var(--ink)"/>${xl}</svg>`;
  }
  // chart 2: median sold price by month, this year vs last year
  let c2 = '';
  const last12 = ms.slice(-12);
  if (canYoy && last12.length === 12) {
    const prev = last12.map((x) => ms.find((p) => p.y === x.y - 1 && p.m === x.m));
    const all = [...last12.map((x) => x.med), ...prev.map((p) => p && p.med)].filter(Number.isFinite);
    const lo = Math.floor(Math.min(...all) / 50000) * 50000, hi = Math.ceil(Math.max(...all) / 50000) * 50000;
    const bw = (Wd - L - R - 20) / 12, Lp = L + 20, yP = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
    const line = (arr, col, dash) => { const p = arr.map((x, i) => x && Number.isFinite(x.med) ? `${(Lp + i * bw + bw / 2).toFixed(1)},${yP(x.med).toFixed(1)}` : null).filter(Boolean).join(' '); return `<polyline points="${p}" fill="none" stroke="${col}" stroke-width="2.5" ${dash ? 'stroke-dasharray="5 4"' : ''}/>` + arr.map((x, i) => x && Number.isFinite(x.med) ? `<circle cx="${(Lp + i * bw + bw / 2).toFixed(1)}" cy="${yP(x.med).toFixed(1)}" r="3" fill="${col}"><title>${MON[x.m]} ${x.y}: median ${money0(x.med)} on ${x.n} sales</title></circle>` : '').join(''); };
    const gy = []; const step = (hi - lo) / 4; for (let v = lo; v <= hi + 1; v += step) gy.push(`<text x="${Lp - 6}" y="${(yP(v) + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--muted)">${money(v)}</text><line x1="${Lp}" x2="${Wd - R}" y1="${yP(v).toFixed(1)}" y2="${yP(v).toFixed(1)}" stroke="#eee"/>`);
    const xl = last12.map((x, i) => `<text x="${(Lp + i * bw + bw / 2).toFixed(1)}" y="${H - B + 14}" font-size="10" text-anchor="middle" fill="var(--muted)">${MON[x.m]}</text>`).join('');
    c2 = `<div class="trend-card"><div class="label">Median sold price by month</div><div class="legend"><span><i class="sw ink"></i>Last 12 months</span><span><i class="sw gray"></i>Year before</span></div>
      <svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Median sold price by month, this year against last year" data-testid="chart-price-yoy">${gy.join('')}${line(prev, '#9a9a9a', true)}${line(last12, 'var(--ink)', false)}<line x1="${Lp}" x2="${Wd - R}" y1="${H - B}" y2="${H - B}" stroke="var(--ink)"/>${xl}</svg>
      <p class="muted small">Monthly medians swing with the mix of homes that closed, especially in months with fewer than 20 sales. Read the trend, not a single month.</p></div>`;
  }
  const summary = trendSummary(rs, ms, y, W, span, lastRate);
  el.innerHTML = `<div class="trend-head"><div><div class="label">Year over year</div><p class="panel-note">Closed sales, ${S.zip}, through ${fmtDate(S.asOf)}.</p></div>
    <div class="lens"><button class="seg ${W === 365 ? 'active' : ''}" data-trend="365" data-testid="button-trend-12m">12 months</button><button class="seg ${W === 90 ? 'active' : ''}" data-trend="90" data-testid="button-trend-3m">3 months</button></div></div>
    <p class="trend-summary" data-testid="text-trend-summary">${esc(summary)}</p>
    ${score}
    <div class="trend-card"><div class="label">Homes sold per month and the 30 year mortgage rate</div><div class="legend"><span><i class="sw ink"></i>Homes sold</span><span><i class="sw gray"></i>Partial month</span><span><i class="sw red"></i>30 year fixed rate</span></div>${c1}</div>
    ${c2}
    <p class="muted small" data-testid="text-trend-source">${esc(src)}</p>`;
  $$('#panel-trends [data-trend]').forEach((b) => b.onclick = () => { S.trendWin = Number(b.dataset.trend); renderTrends(rows()); });
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
  // two signals of the same kind share stock sentences; keep each sentence once
  const seen = new Set(); const once = (t) => String(t).split(/(?<=[.!?])\s+/).filter((x) => { const k = x.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).join(' ');
  for (let i = 0; i < reads.length; i++) reads[i] = once(reads[i]);
  for (let i = 0; i < strat.length; i++) strat[i] = once(strat[i]);
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
    const G = (n, t, svg) => `<div class="story-fig">${svg || ''}<p class="ph">Graph ${n}: ${esc(t)}</p></div>`;
    const graphs = data.flatMap((d, i) => [P(d), G(i + 1, graphFor(sigs[i]), sigs[i].chart ? miniChart(sigs[i].chart) : '')]);
    const sm = smallLotGraphs();
    const smHtml = sm.length ? [`<p class="sub">Small lot homes</p>`, P(esc(sm[0])), ...sm.slice(1).map((g, i) => G(sigs.length + i + 1, g.t, g.svg))] : [];
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
  const rs = S.all.filter((r) => r.zip === S.zip && isSmallLot(r) && !excluded(r));
  if (!rs.length) return [];
  const sold = rs.filter((r) => r.status === 'Sold' && ago(r.sd) < 90);
  const act = rs.filter((r) => r.status === 'Active').length, pen = rs.filter((r) => r.status === 'Pending').length;
  const m = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
  const lot = AR.minLot.toLocaleString();
  const line = sold.length
    ? `Homes on lots under ${lot} sq ft are counted on their own. ${sold.length} sold in the last 90 days at a median $${Math.round(m(sold.map((r) => r.ppsf)))} per sq ft and ${Math.round(m(sold.map((r) => r.dom)))} days on market, with ${act} active and ${pen} pending now.`
    : `Homes on lots under ${lot} sq ft are counted on their own. None sold in the last 90 days; ${act} are active and ${pen} pending.`;
  const std = S.all.filter((r) => r.zip === S.zip && S.types.has(cat(r)) && !excluded(r) && !isSmallLot(r) && !(Number.isFinite(r.lot) && r.lot > 0 && r.lot < AR.minLot) && r.status === 'Sold' && ago(r.sd) < 90);
  const pair = (fa, fb, fmt) => (Number.isFinite(fa) && Number.isFinite(fb) ? miniChart({ kind: 'vs', labels: ['Small lot', 'Standard lots'], values: [fb, fa], fmt, base: 0 }) : '');
  const ppsfA = m(std.map((r) => r.ppsf)), ppsfB = m(sold.map((r) => r.ppsf)), domA = m(std.map((r) => r.dom)), domB = m(sold.map((r) => r.dom));
  return [line,
    { t: `Small lot homes vs standard lots, median price per sq ft, last 90 days`, svg: pair(ppsfA, ppsfB, (v) => '$' + Math.round(v)) },
    { t: `Small lot homes vs standard lots, median days on market, last 90 days`, svg: pair(domA, domB, (v) => Math.round(v) + 'd') }];
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
  $('#print-story').hidden = S.format !== 'broadsheet';
  $('#print-story').disabled = !sigs.length;
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
  ['signals', 'diff', 'bands', 'trends', 'area', 'queue'].forEach((p) => { $('#panel-' + p).hidden = p !== t; });
}

// ---------- one-ZIP area report ----------
const AR = Object.assign({
  window: 90, minRank: 6, lotFilter: true, minLot: 3000, city: 'Seattle, WA', issue: 'No. 1', byline: '',
  name: '', role: '', firm: '', phone: '', email: '', web: '', license: '',
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
      if (r.lot < AR.minLot) { out.belowLot++; if (smallOn()) out.small.push(r); return; }
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
  const fig4 = lz && lz.sold ? `Fig. 4: Small lot homes against homes on lots ${AR.minLot.toLocaleString()} sq ft and up, median price per square foot and median days on market, ${WPc}.` : '';
  return { headline, subhead, p1, p2, p3, p4, fig1, fig2, fig3, fig4, red, notes1: priceNotes(M), notes2: domNotes(M) };
}

function lotNote() { return AR.lotFilter && S.hasLot ? `, lots ${AR.minLot.toLocaleString()} sq ft and up` : ''; }
function sourceLine(M) {
  return `Source: ${AR.source}${S.isSample ? ' (fictional sample data)' : ''}. ${S.zip}${lotNote()}. Sold listings closed ${M.audit.from ? fmtDate(M.audit.from) : ''} to ${fmtDate(S.asOf)}; active and pending as of ${fmtDate(S.asOf)}. Medians shown. Only neighborhoods with ${AR.minRank} or more sales are ranked; smaller counts are shown but not ranked.${M.smallLot ? ` Homes on lots under ${AR.minLot.toLocaleString()} sq ft are reported as their own group; medians and averages are figured separately for each group.` : ''}${(() => { const t = typoSummary(S.zip); const d = dataSummary(S.zip), ch = d.all.filter((r) => { const c = S.fixes['c|' + fixKey(r)]; return c && c.action !== 'keep' && !(r.chk.kind === 'zip' && c.action === 'drop'); }).length; return (t.fixed || t.dropped ? ` Typo check: ${t.fixed} sale price${t.fixed === 1 ? '' : 's'} corrected and ${t.dropped} sale${t.dropped === 1 ? '' : 's'} left out.` : '') + (ch ? ` Data check: ${ch} listing${ch === 1 ? '' : 's'} corrected or left out (size, neighborhood or ZIP).` : ''); })()}`;
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
  return [`Small lot homes (lots under ${AR.minLot.toLocaleString()} sq ft)`, C.p4, ...(C.fig4 ? [C.fig4] : []),
    ...compareRows(M).map(([k, a, b]) => `${k}: ${a} on ${lbl}; ${b} on lots ${sl}`),
    ...M.smallLot.nbs.map((n) => `${n.name}: ${n.sold} sold, ${n.active} active, ${n.pending} pending${Number.isFinite(n.soldPpsf) ? '; ' + d$(n.soldPpsf) + ' per sq ft sold' : ''}`)];
}
function articleText(M, C) {
  return [C.headline, C.subhead, `${AR.byline} | ${AR.city} | ${fmtDate(S.asOf)}`, C.p1, C.fig1, ...C.notes1, C.fig2, ...C.notes2, C.p2, C.fig3, C.p3,
    'Neighborhood by neighborhood', ...M.nbs.map(nbLine), nbLine(M.zip), ...smallLotText(M, C), sourceLine(M)].join('\n\n');
}

// ---- charts (SVG, locked broadsheet palette) ----
// row geometry: keeps labels from overlapping when a ZIP has many neighborhoods
function rowGeom(n, avail, maxBh) {
  const pitch = Math.min(avail / Math.max(n, 1), maxBh + 12), gap = Math.min(12, pitch * 0.3);
  return { pitch, bh: Math.min(maxBh, pitch - gap), fs: Math.max(11, Math.min(22, pitch * 0.74)) };
}
function hbar(M, key, title, fmt, highlight, notes = [], price = false, hOver = 0, wOver = 0) {
  const items = M.nbs.filter((n) => Number.isFinite(n[key]));
  const W = wOver || 1200, H = hOver || 675, L = W < 1000 ? 250 : 300, R = 120, T = 120, B = 50 + 26 * notes.length;
  const g = rowGeom(items.length, H - T - B, 56), bh = g.bh, fs = g.fs;
  const max = Math.max(...items.map((n) => n[key]), 1);
  const bars = items.map((n, i) => {
    const y = T + i * g.pitch, w = (W - L - R) * n[key] / max, hl = highlight && n.name === highlight.name;
    return `<text x="${L - 16}" y="${y + bh / 2 + fs * 0.34}" text-anchor="end" font-size="${fs.toFixed(1)}" fill="${n.thin ? MUTED : INK}">${esc(n.name)}${mark(n, price) ? ' ' + mark(n, price) : ''}</text>
      <rect x="${L}" y="${y}" width="${Math.max(w, 2)}" height="${bh}" fill="${hl ? RED : n.thin ? '#B9B4AA' : INK}"/>
      <text x="${L + w + 12}" y="${y + bh / 2 + fs * 0.36}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${hl ? RED : INK}">${fmt(n[key])}</text>`;
  }).join('');
  const nt = notes.map((t, i) => `<text class="ar-note" x="40" y="${H - 44 - 26 * (notes.length - 1 - i)}" font-size="17" fill="${MUTED}">${esc(t)}</text>`).join('');
  return svgWrap(W, H, title, bars + nt);
}
function stacked(M, hOver = 0, wOver = 0) {
  const items = M.nbs, W = wOver || 1200, H = hOver || 675, L = W < 1000 ? 250 : 300, R = 80, T = 150, B = 50;
  const g = rowGeom(items.length, H - T - B, 52), bh = g.bh, fs = g.fs, ifs = Math.min(20, bh * 0.82);
  const max = Math.max(...items.map((n) => n.active + n.pending + n.sold), 1);
  const cols = [['active', INK, 'Active'], ['pending', '#8C877D', 'Pending'], ['sold', RED, 'Sold']];
  const legend = cols.map(([, c, l], i) => `<rect x="${L + i * 170}" y="96" width="22" height="22" fill="${c}"/><text x="${L + i * 170 + 32}" y="115" font-size="22" fill="${INK}">${l}</text>`).join('');
  const bars = items.map((n, i) => {
    const y = T + i * g.pitch; let x = L;
    const segs = cols.map(([k, c]) => { const w = (W - L - R) * n[k] / max; const s = `<rect x="${x}" y="${y}" width="${w}" height="${bh}" fill="${c}"/>` + (w > ifs * 1.6 && ifs >= 11 ? `<text x="${x + w / 2}" y="${y + bh / 2 + ifs * 0.36}" text-anchor="middle" font-size="${ifs.toFixed(1)}" font-weight="700" fill="#fff">${n[k]}</text>` : ''); x += w; return s; }).join('');
    return `<text x="${L - 16}" y="${y + bh / 2 + fs * 0.34}" text-anchor="end" font-size="${fs.toFixed(1)}" fill="${INK}">${esc(n.name)}</text>${segs}`;
  }).join('');
  return svgWrap(W, H, `Active, pending and sold by neighborhood`, legend + bars);
}
// Fig. 4: small lot vs standard lot, two side-by-side panels (median $/sq ft, median days on market)
function smallLotChart(M) {
  const a = M.zip, b = M.smallLot.zip, W = 1200, H = 675;
  const lab = [`Lots ${AR.minLot.toLocaleString()}+ sq ft`, `Under ${AR.minLot.toLocaleString()} sq ft`];
  const panel = (x0, title, va, vb, fmt) => {
    const pw = 500, base = 560, top = 190, max = Math.max(va || 0, vb || 0, 1) * 1.1, bw = 150, gap = 70, bx = x0 + (pw - (bw * 2 + gap)) / 2;
    const bar = (v, i) => { if (!Number.isFinite(v)) return ''; const h = (base - top) * v / max, x = bx + i * (bw + gap), c = i ? RED : INK;
      return `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" fill="${c}"/><text x="${x + bw / 2}" y="${base - h - 14}" text-anchor="middle" font-size="30" font-weight="700" fill="${c}">${fmt(v)}</text><text x="${x + bw / 2}" y="${base + 34}" text-anchor="middle" font-size="20" fill="${INK}">${esc(lab[i])}</text>`; };
    return `<text x="${x0 + pw / 2}" y="140" text-anchor="middle" font-size="26" font-weight="700" fill="${INK}">${esc(title)}</text>${bar(va, 0)}${bar(vb, 1)}<line x1="${x0}" y1="${base}" x2="${x0 + pw}" y2="${base}" stroke="${RULE}" stroke-width="2"/>`;
  };
  const note = `${a.sold} standard lot sales and ${b.sold} small lot sales. Each group is figured on its own.${b.sold < AR.minRank ? ` With ${b.sold} small lot sales, read as directional.` : ''}`;
  return svgWrap(W, H, 'Small lot homes vs standard lots', panel(60, 'Median sold price per sq ft', a.soldPpsf, b.soldPpsf, d$) + panel(640, 'Median days on market', a.soldDom, b.soldDom, (x) => num(x) + ' days') +
    `<text x="40" y="${H - 44}" font-size="17" fill="${MUTED}">${esc(note)}</text>`);
}
// article preview: the copy text with each chart shown above its caption
function articlePreview(M, C) {
  const figs = { [C.fig1]: 'ar-fig1', [C.fig2]: 'ar-fig2', [C.fig3]: 'ar-fig3' }; if (C.fig4) figs[C.fig4] = 'ar-fig4';
  return articleText(M, C).split('\n\n').map((t) => (figs[t] && $('#' + figs[t]) ? `<div class="ar-inline-fig">${$('#' + figs[t]).innerHTML}</div>` : '') + `<p>${esc(t)}</p>`).join('');
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
  const set = (k, v) => { if (k === 'name' && (!AR.byline || AR.byline === 'By ' + AR.name)) AR.byline = v ? 'By ' + v : ''; AR[k] = v; arSave(); updateProfileChip(); renderArea(rows()); };
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
    ${S.hasLot && AR.lotFilter && S.all.some((r) => r.zip === S.zip && Number.isFinite(r.lot) && r.lot > 0 && r.lot < AR.minLot) ? `<div class="ar-filter"><label><input type="checkbox" id="ar-small" ${smallOn() ? 'checked' : ''} data-testid="checkbox-area-smalllot"/>Small lot homes <span class="muted">(lots under ${AR.minLot.toLocaleString()} sq ft, reported as their own group)</span></label></div>` : ''}
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
      ${[['cover', 'Cover 1920×1080'], ['fig1', 'Fig. 1 Price per sq ft'], ['fig2', 'Fig. 2 Days on market'], ['fig3', 'Fig. 3 Pipeline'], ...(C.fig4 ? [['fig4', 'Fig. 4 Small lot vs standard lots']] : [])].map(([k, l]) => `<figure class="ar-fig" data-testid="figure-area-${k}"><div class="ar-svg" id="ar-${k}"></div><figcaption><span>${l}</span><button class="btn ghost" data-png="${k}" data-testid="button-png-${k}">Download PNG</button></figcaption></figure>`).join('')}
    </div>
    <div class="ar-carousel" data-testid="section-area-carousel"><div class="ar-article-head"><h3 class="h3">LinkedIn carousel</h3>
      <div class="ar-actions"><button class="btn" id="ar-car-pdf" data-testid="button-carousel-pdf">Print carousel PDF</button><button class="btn ghost" id="ar-car-png" data-testid="button-carousel-png">Download slides (PNG)</button></div></div>
      <p class="panel-note">${M.smallLot ? 'Nine' : 'Eight'} 1080×1350 slides, starting with a cover. Upload the PDF to LinkedIn as a document post. Use Save as PDF with margins set to None.</p>
      <div class="ar-car-strip" id="ar-car"></div></div>
    <div class="ar-article">
      <div class="ar-article-head"><h3 class="h3">LinkedIn article text</h3>
        <div class="ar-actions"><button class="btn" id="ar-copy" data-testid="button-area-copy">Copy article</button><button class="btn ghost" id="ar-all" data-testid="button-area-all">Download all images</button><button class="btn ghost" id="ar-print" data-testid="button-area-print">Print broadsheet</button><button class="btn ghost" id="ar-web" data-testid="button-area-web">Download web page</button><button class="btn accent" id="ar-queue" data-testid="button-area-queue">Add to queue</button></div></div>
      <ul class="lint ar-lint">${wc}<li class="${dash ? 'warn' : 'ok'}"><span class="mk">${dash ? 'Check' : 'OK'}</span>${dash ? 'Dash found in copy' : 'No dashes'}</li><li class="${S.isSample ? 'warn' : 'ok'}"><span class="mk">${S.isSample ? 'Check' : 'OK'}</span>${S.isSample ? 'Sample data: do not publish' : 'Real export loaded'}</li><li class="ok"><span class="mk">OK</span>No street addresses or other agents' names</li><li class="${profileReady() ? 'ok' : 'warn'}" data-testid="lint-profile"><span class="mk">${profileReady() ? 'OK' : 'Check'}</span>${profileReady() ? `Byline: ${esc(AR.name)}, ${esc(AR.firm)}` : 'Add your details before exporting'}</li></ul>
      <div class="ar-text" id="ar-text" data-testid="text-area-article"></div>
    </div>`;
  $('#ar-cover').innerHTML = coverSvg(M, C);
  $('#ar-fig1').innerHTML = hbar(M, 'soldPpsf', 'Median sold price per square foot', d$, M.top, C.notes1, true);
  $('#ar-fig2').innerHTML = hbar(M, 'soldDom', 'Median days on market, sold homes', (x) => num(x) + ' days', M.slow, C.notes2);
  $('#ar-fig3').innerHTML = stacked(M);
  if (C.fig4) $('#ar-fig4').innerHTML = smallLotChart(M);
  $('#ar-text').innerHTML = articlePreview(M, C);
  const slides = carouselSlides(M, C);
  $('#ar-car').innerHTML = slides.map((sv, i) => `<figure class="ar-slide" data-testid="slide-carousel-${i + 1}">${sv}</figure>`).join('');
  $('#panel-area details summary').onclick = (e) => { S.arOpen = !e.target.closest('details').open; };
  $$('#panel-area [data-ar]').forEach((i) => i.onchange = () => set(i.dataset.ar, i.value.trim()));
  $$('#panel-area [data-ar-n]').forEach((i) => i.onchange = () => set(i.dataset.arN, +i.value));
  $('#ar-lot').onchange = (e) => set('lotFilter', e.target.checked);
  const sm = $('#ar-small');
  if (sm) sm.onchange = () => { S.smallOff = !sm.checked; if (S.typesPresent.includes('Small lot')) { if (sm.checked) S.types.add('Small lot'); else if (S.types.size > 1) S.types.delete('Small lot'); else { sm.checked = true; S.smallOff = false; return; } } render(); };
  const stem = `${S.zip}-Neighborhood-Update-${isoDay(S.asOf)}`;
  const png = (k) => { const svg = $('#ar-' + k + ' svg').outerHTML; const big = k === 'cover'; svgToPng(svg, `${stem}-${big ? 'Cover' : k === 'fig1' ? 'Chart-1' : k === 'fig2' ? 'Chart-2' : k === 'fig3' ? 'Chart-3' : 'Chart-4'}.png`, big ? 1920 : 1200, big ? 1080 : 675); };
  $$('#panel-area [data-png]').forEach((b) => b.onclick = () => png(b.dataset.png));
  $('#ar-all').onclick = () => ['cover', 'fig1', 'fig2', 'fig3', ...(C.fig4 ? ['fig4'] : [])].forEach((k, i) => setTimeout(() => png(k), i * 400));
  const txt = articleText(M, C);
  $('#ar-copy').onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('Article copied.'); } catch { toast('Copy blocked by the browser. Select the article text and copy it by hand.'); } };
  $('#ar-web').onclick = () => {
    dl(new Blob([buildWebPage(M, C)], { type: 'text/html' }), `${S.zip}-Neighborhood-Market-Update-${isoDay(S.asOf)}.html`);
    toast(S.isSample ? 'Web page saved. It is marked as fictional sample data.' : 'Web page saved. Open it in a browser, or upload it to your website.');
  };
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

// print charts: drawn narrower than the screen versions so labels print at a readable size,
// and taller when a ZIP has many neighborhoods so every row keeps its own line
function printCharts(M) {
  const n = M.nbs.length, many = n > 14, pitch = many ? 27 : 30;
  const hb = (top) => Math.round(top + 50 + Math.max(n, 6) * pitch);
  return {
    many,
    figs: [hbar(M, 'soldPpsf', 'Median sold price per square foot', d$, M.top, [], true, hb(120), 800),
      hbar(M, 'soldDom', 'Median days on market, sold homes', (x) => num(x) + ' days', M.slow, [], false, hb(120), 800),
      stacked(M, hb(150), 1200)],
  };
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
    ${(() => { const P = printCharts(M); return `<div class="ps-figs${P.many ? ' many' : ''}">${P.figs.map((sv) => `<div>${sv}</div>`).join('')}</div>
    <div class="${P.many ? 'ps-p2 many' : 'ps-p2'}">`; })()}
    ${[...new Set([...C.notes1, ...C.notes2])].length ? `<div class="ps-notes">${[...new Set([...C.notes1, ...C.notes2])].map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    <table class="ps-table"><thead><tr><th>Neighborhood</th><th>Active</th><th>Pending</th><th>Sold</th><th>Sold $/SF</th><th>Active $/SF</th><th>Sold DOM</th><th>Active DOM</th></tr></thead><tbody>${M.nbs.map((n) => `<tr>${cell(n)}</tr>`).join('')}</tbody><tfoot><tr>${cell(M.zip)}</tr></tfoot></table>
    ${M.smallLot ? `<div class="ps-small"><div class="ps-small-h">Small lot homes, lots under ${AR.minLot.toLocaleString()} sq ft, counted on their own</div><table class="ps-table ps-cmp"><thead><tr>${['', ...compareRows(M).map((r) => r[0].replace('Median ', 'Med. ').replace('Average ', 'Avg. ').replace('days on market', 'DOM').replace('home size', 'size'))].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody><tr><td>Lots ${AR.minLot.toLocaleString()}+</td>${compareRows(M).map((r) => `<td>${esc(String(r[1]).replace(' sq ft', ''))}</td>`).join('')}</tr><tr><td>Under ${AR.minLot.toLocaleString()}</td>${compareRows(M).map((r) => `<td>${esc(String(r[2]).replace(' sq ft', ''))}</td>`).join('')}</tr></tbody></table></div>` : ''}
    <div class="ps-foot"><div class="ps-contact">${contact}</div><div class="ps-method">${esc(sourceLine(M))}</div></div></div>`;
}

// ---------- standalone web page (one self-contained HTML file, charts inline) ----------
const WEB_CSS = ":root { --ink:#161512; --muted:#55524b; --rule:#cfcabf; --paper:#fbfaf7; --red:#8b1e1e; --wash:#f2efe8; }\n* { box-sizing:border-box; }\nhtml { -webkit-text-size-adjust:100%; }\nbody { margin:0; font-variant-numeric:lining-nums; background:var(--paper); color:var(--ink); font:400 18px/1.6 \"Source Serif 4\", Georgia, serif; }\n.wrap { max-width:860px; margin:0 auto; padding:0 24px; }\na { color:var(--ink); text-underline-offset:3px; }\n.dateline { display:flex; justify-content:space-between; gap:12px; padding:28px 0 10px; border-bottom:3px double var(--ink); font-size:13px; letter-spacing:.14em; text-transform:uppercase; }\n.kicker { margin:36px 0 8px; text-align:center; color:var(--red); font-style:italic; font-size:20px; }\nh1 { margin:0 auto; max-width:760px; text-align:center; font:700 clamp(34px,6vw,58px)/1.08 \"Playfair Display\", Georgia, serif; letter-spacing:-.01em; text-wrap:balance; }\n.dek { margin:16px auto 0; max-width:640px; text-align:center; color:var(--muted); font-size:19px; text-wrap:balance; }\n.byline { margin:14px 0 0; text-align:center; font-style:italic; }\n.figs { display:grid; grid-template-columns:repeat(4,1fr); margin:34px 0 8px; border-top:1px solid var(--rule); border-bottom:1px solid var(--rule); }\n.fig { padding:22px 10px; text-align:center; }\n.fig + .fig { border-left:1px solid var(--rule); }\n.fig b { display:block; font:700 clamp(30px,4.6vw,44px)/1.1 \"Playfair Display\", Georgia, serif; font-variant-numeric:lining-nums tabular-nums; }\n.fig span { display:block; margin-top:6px; color:var(--muted); font-size:15px; line-height:1.3; }\n.fig.red b { color:var(--red); }\narticle p { margin:0 0 1.05em; }\n.lead::first-letter { float:left; font:700 64px/0.85 \"Playfair Display\", Georgia, serif; padding:6px 10px 0 0; }\nh2 { margin:44px 0 12px; padding-top:12px; border-top:2px solid var(--ink); font:700 26px/1.2 \"Playfair Display\", Georgia, serif; }\nfigure { margin:28px 0; }\nfigure img, figure svg { display:block; width:100%; height:auto; border:1px solid var(--rule); background:#fff; }\nfigcaption { margin-top:8px; color:var(--muted); font-size:15px; line-height:1.45; }\n.tablewrap { overflow-x:auto; margin:12px 0 8px; -webkit-overflow-scrolling:touch; }\ntable { width:100%; border-collapse:collapse; font-size:16px; font-variant-numeric:lining-nums tabular-nums; }\nth, td { padding:8px 10px; border-bottom:1px solid var(--rule); text-align:right; white-space:nowrap; }\nth:first-child, td:first-child { text-align:left; }\nthead th { border-bottom:2px solid var(--ink); font-weight:600; font-size:13px; letter-spacing:.06em; text-transform:uppercase; }\ntr.dim td { color:var(--muted); }\ntr.total td { border-top:2px solid var(--ink); border-bottom:none; font-weight:700; }\n.note { color:var(--muted); font-size:15px; line-height:1.45; }\n.split { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:8px; }\n.split h3 { margin:0 0 6px; font:700 19px/1.3 \"Source Serif 4\", Georgia, serif; text-transform:uppercase; letter-spacing:.08em; font-size:14px; }\n.box { margin:44px 0 0; padding:26px 28px; border:2px solid var(--ink); background:#fff; display:flex; gap:24px; align-items:center; justify-content:space-between; flex-wrap:wrap; }\n.box h2 { margin:0 0 6px; padding:0; border:0; font-size:24px; }\n.box p { margin:0; }\n.btn { display:inline-block; padding:12px 18px; background:var(--ink); color:#fff; text-decoration:none; font-weight:600; font-size:16px; }\n.btn:hover, .btn:focus-visible { background:var(--red); }\n.contact { margin:26px 0 0; padding:22px 0 0; border-top:1px solid var(--rule); }\n.contact .name { font:700 22px/1.2 \"Playfair Display\", Georgia, serif; }\n.reach { display:flex; flex-wrap:wrap; gap:6px 28px; margin-top:10px; font-weight:600; }\n.reach a { text-decoration:underline; text-decoration-color:var(--red); }\n.reach a:hover, .reach a:focus-visible { color:var(--red); }\nfooter .studio-link { margin:12px 0 0; font-size:13px; }\nfooter .studio-link a { color:var(--muted); }\nfooter { margin:44px 0 0; padding:18px 0 40px; border-top:3px double var(--ink); color:var(--muted); font-size:14px; line-height:1.5; }\n@media (max-width:640px) {\n  body { font-size:17px; }\n  .wrap { padding:0 18px; }\n  .dateline span:first-child { display:none; }\n  .figs { grid-template-columns:1fr 1fr; }\n  .fig:nth-child(3) { border-left:none; }\n  .fig:nth-child(n+3) { border-top:1px solid var(--rule); }\n  .split { grid-template-columns:1fr; gap:16px; }\n  th, td { padding:7px 8px; font-size:15px; }\n  .box { padding:20px; }\n}\n.sample { margin:18px 0 0; padding:10px 14px; border:2px solid var(--red); color:var(--red); font-weight:600; text-align:center; }\n@media print { .box { display:none; } body { background:#fff; } }";
function buildWebPage(M, C) {
  const z = M.zip, Z = S.zip, WP = spanPhrase(M), date = fmtDate(S.asOf);
  const hl = C.headline.split(': ').slice(1).join(': ') || C.headline;
  const svg = (k) => { const el = $('#ar-' + k + ' svg'); return el ? el.outerHTML.replace(/ width="\d+" height="\d+"/, '') : ''; };
  const fig = (k, cap, notes) => svg(k) ? `<figure>${svg(k)}<figcaption>${esc(cap)}${notes && notes.length ? ' ' + notes.map(esc).join(' ') : ''}</figcaption></figure>` : '';
  const row = (n, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(n.name)}${mark(n) ? ' ' + mark(n) : ''}</td><td>${n.sold}</td><td>${n.active}</td><td>${n.pending}</td><td>${d$(n.soldPpsf)}</td><td>${num(n.soldDom)}</td></tr>`;
  const notes = [...new Set([...C.notes1, ...C.notes2])];
  const telHref = (p) => { const d = String(p).replace(/[^\d+]/g, ''); return d.length === 10 ? '+1' + d : d; };
  const webHref = (w) => /^https?:\/\//i.test(w) ? w : 'https://' + w;
  const reach = [AR.phone ? `<a href="tel:${esc(telHref(AR.phone))}">${esc(AR.phone)}</a>` : '', AR.email ? `<a href="mailto:${esc(AR.email)}">${esc(AR.email)}</a>` : '', AR.web ? `<a href="${esc(webHref(AR.web))}">${esc(AR.web.replace(/^https?:\/\//i, ''))}</a>` : ''].filter(Boolean).join('');
  const L = M.smallLot;
  const small = L ? `<h2>Small lot homes</h2><p>${esc(C.p4)}</p>${C.fig4 ? fig('fig4', C.fig4) : ''}
    <div class="tablewrap"><table><thead><tr><th></th><th>Lots ${AR.minLot.toLocaleString()}+ sq ft</th><th>Lots under ${AR.minLot.toLocaleString()} sq ft</th></tr></thead><tbody>${compareRows(M).map(([k, a, b]) => `<tr><td>${esc(k)}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">Each group's medians and averages are figured separately; nothing is averaged across the two.</p>` : '';
  const desc = `${C.subhead}. Price per square foot, days on market and listings, neighborhood by neighborhood.`;
  const by = [AR.role, AR.firm].filter(Boolean).join(', ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(Z)} Neighborhood Market Update, ${esc(S.asOf.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))} | ${esc(AR.name)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(hl)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta name="author" content="${esc(AR.name)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet" />
<style>
${WEB_CSS}
</style>
</head>
<body>
<div class="wrap">
  <div class="dateline"><span>Neighborhood Market Update</span><span>${esc(AR.city)}</span><span>${esc(date)}</span></div>
  ${S.isSample ? '<p class="sample">Fictional sample data. Not for publication.</p>' : ''}
  <header>
    <p class="kicker">${esc(Z)} Neighborhood Market Update</p>
    <h1>${esc(hl)}</h1>
    <p class="dek">${esc(C.subhead)}</p>
    ${AR.byline ? `<p class="byline">${esc(AR.byline)}${by && AR.byline === 'By ' + AR.name ? ', ' + esc(by) : ''}</p>` : ''}
  </header>
  <section class="figs" aria-label="Key figures">
    <div class="fig"><b>${z.sold}</b><span>Homes sold ${esc(WP)}</span></div>
    <div class="fig"><b>${d$(z.soldPpsf)}</b><span>Median sold price per sq ft</span></div>
    <div class="fig"><b>${num(z.soldDom)}</b><span>Median days on market</span></div>
    <div class="fig red"><b>${z.active}</b><span>Active listings, ${z.pending} pending</span></div>
  </section>
  <article>
    <p class="${/^[A-Za-z]/.test(C.p1) ? 'lead' : ''}">${esc(C.p1)}</p>
    ${fig('fig1', C.fig1)}
    ${fig('fig2', C.fig2)}
    <p>${esc(C.p2)}</p>
    ${fig('fig3', C.fig3)}
    <h2>What it means for you</h2>
    <p>${esc(C.p3)}</p>
    <h2>Neighborhood by neighborhood</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Neighborhood</th><th>Sold</th><th>Active</th><th>Pending</th><th>$/sq ft</th><th>Days on market</th></tr></thead>
      <tbody>${M.nbs.map((n) => row(n, n.thin ? 'dim' : '')).join('')}${row(M.zip, 'total')}</tbody>
    </table></div>
    ${notes.length ? `<p class="note">Medians shown. ${notes.map(esc).join(' ')}</p>` : '<p class="note">Medians shown.</p>'}
    ${small}
    <div class="contact">
      <div class="name">${esc(AR.name)}</div>
      ${by ? `<div>${esc(by)}</div>` : ''}
      ${reach ? `<div class="reach">${reach}</div>` : ''}
      ${AR.license ? `<p class="note" style="margin-top:6px">${esc(AR.license)}</p>` : ''}
      <p class="note" style="margin-top:8px">Want to know what these numbers mean for your home or your search? Reach out and I will walk you through your neighborhood.</p>
    </div>
  </article>
  <footer>${esc(sourceLine(M))} Information deemed reliable but not guaranteed.</footer>
</div>
</body>
</html>
`;
}

// broadsheet story as a one-page print sheet, charts included, unanswered-question notes left out
function buildStoryPrint() {
  const el = document.createElement('div'); el.innerHTML = buildDraft().html;
  $$('.gap, .cc', el).forEach((x) => x.remove());
  $$('button.ev', el).forEach((x) => x.replaceWith(document.createTextNode(x.textContent)));
  const take = (sel) => { const x = $(sel, el); if (x) x.remove(); return x; };
  const hl = take('.hl'); take('.kicker');
  const dek = el.firstElementChild && el.firstElementChild.querySelector('em') ? el.firstElementChild : null; if (dek) dek.remove();
  const meth = $$('p', el).filter((p) => p.querySelector('.muted')).pop(); if (meth) meth.remove();
  const first = el.querySelector(':scope > p'); if (first && /^[A-Za-z]/.test(first.textContent.trim())) first.classList.add('ps-drop');
  const contact = [AR.name, [AR.role, AR.firm].filter(Boolean).join(', '), AR.phone, AR.email, AR.web, AR.license].filter(Boolean).map(esc).join('<br/>');
  $('#print-sheet').innerHTML = `
    <div class="ps-strip"><span>${esc(AR.issue)}</span><span>${esc(AR.city)}</span><span>${esc(fmtDate(S.asOf))}</span></div>
    <div class="ps-kicker">${esc(S.zip)} Market Update</div>
    <h1 class="ps-hl">${hl ? esc(hl.textContent) : ''}</h1>
    <div class="ps-sub">${dek ? esc(dek.textContent) : ''}</div><div class="ps-by">${esc(AR.byline)}</div>
    <div class="ps-story">${el.innerHTML}</div>
    <div class="ps-foot"><div class="ps-contact">${contact}</div><div class="ps-method">${meth ? esc(meth.textContent) : ''}</div></div>`;
}
$('#print-story').onclick = () => { document.body.classList.remove('carousel-mode'); buildStoryPrint(); window.print(); };

// ---------- persistence ----------
function saveState() {}
function exportSession() {
  dl(new Blob([JSON.stringify({ app: 'micro-market-studio', version: 1, saved: new Date().toISOString(), settings: AR, queue: S.queue, memory: S.memory, fixes: S.fixes }, null, 2)], { type: 'application/json' }), `micro-market-studio-session-${isoDay(new Date())}.json`);
  toast('Session file saved. Load it next time to restore your queue, memory and report settings.');
}
// Session files are checked field by field before anything is applied.
// Only known settings are kept, numbers must be in range, text is trimmed and capped,
// and anything unexpected is skipped rather than loaded.
const SESSION_MAX_BYTES = 5 * 1024 * 1024;
function cleanSession(j) {
  let skipped = 0;
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const txt = (v, max = 200) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : null;
  const day = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const settings = {};
  if (isObj(j.settings)) {
    const st = j.settings;
    const pick = (k, v) => { if (v === null || v === undefined) { if (k in st) skipped++; } else settings[k] = v; };
    pick('window', [60, 90, 120].includes(st.window) ? st.window : null);
    pick('minRank', [3, 5, 6, 8].includes(st.minRank) ? st.minRank : null);
    pick('lotFilter', typeof st.lotFilter === 'boolean' ? st.lotFilter : null);
    pick('minLot', num(st.minLot, 500, 20000));
    for (const k of ['city', 'issue', 'byline', 'name', 'role', 'firm', 'license', 'source']) pick(k, txt(st[k], k === 'byline' || k === 'source' ? 200 : 120));
    pick('phone', (() => { const v = txt(st.phone, 40); return v !== null && /^[\d\s()+.\-x]*$/i.test(v) ? v : null; })());
    pick('email', (() => { const v = txt(st.email, 120); return v !== null && (v === '' || /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v)) ? v : null; })());
    pick('web', (() => { const v = txt(st.web, 200); if (v === null) return null; if (v === '') return ''; const w = /^https?:\/\//i.test(v) ? v : /^[a-z0-9][^\s:<>"']*$/i.test(v) ? 'https://' + v : null; try { return w && new URL(w).protocol.startsWith('http') ? v : null; } catch { return null; } })());
  }
  const queue = [];
  for (const q of (Array.isArray(j.queue) ? j.queue : []).slice(0, 500)) {
    if (!isObj(q) || !txt(q.headline)) { skipped++; continue; }
    queue.push({ headline: txt(q.headline, 300), format: txt(q.format, 60) || '', lens: txt(q.lens, 20) || 'all', slot: day(q.slot) || '', slotLabel: txt(q.slotLabel, 60) || 'unscheduled',
      status: q.status === 'Published' ? 'Published' : 'Queued', text: txt(q.text, 20000) || '',
      sigs: (Array.isArray(q.sigs) ? q.sigs : []).slice(0, 10).filter(isObj).map((x) => ({ type: txt(x.type, 40) || '', scope: txt(x.scope, 80) || '', headline: txt(x.headline, 300) || '', memValue: num(x.memValue, -1e9, 1e9), memUnit: txt(x.memUnit, 20) || '' })) });
  }
  let memory = null;
  if (Array.isArray(j.memory)) {
    memory = [];
    for (const m of j.memory.slice(0, 1000)) {
      if (!isObj(m) || !day(m.date) || !txt(m.type) || !txt(m.headline)) { skipped++; continue; }
      memory.push({ date: m.date, type: txt(m.type, 40), scope: txt(m.scope, 80) || 'ZIP', headline: txt(m.headline, 300), value: num(m.value, -1e9, 1e9), unit: txt(m.unit, 20) || '', format: txt(m.format, 60) || '' });
    }
  }
  let fixes = null;
  if (isObj(j.fixes)) {
    fixes = {};
    for (const [k, f] of Object.entries(j.fixes).slice(0, 5000)) {
      const a = isObj(f) ? f.action : null;
      if (typeof k !== 'string' || k.length > 200) { skipped++; continue; }
      if (a === 'keep' || a === 'drop') fixes[k] = { action: a };
      else if (a === 'fix' && num(f.value, 1000, 1e9) !== null) fixes[k] = { action: a, value: f.value };
      else if (a === 'size' && num(f.value, 50, 100000) !== null) fixes[k] = { action: a, value: Math.round(f.value) };
      else if (a === 'nb' && txt(f.value, 80)) fixes[k] = { action: a, value: txt(f.value, 80) };
      else if (a === 'move' && typeof f.value === 'string' && /^\d{5}$/.test(f.value)) fixes[k] = { action: a, value: f.value };
      else skipped++;
    }
  }
  return { settings, queue, memory, fixes, skipped };
}
function importSession(f) {
  if (f.size > SESSION_MAX_BYTES) { toast('That session file is too large to be a Micro Market Studio session.'); return; }
  const r = new FileReader();
  r.onload = () => { try { const j = JSON.parse(String(r.result)); if (!j || j.app !== 'micro-market-studio') throw 0; const c = cleanSession(j); Object.assign(AR, c.settings); updateProfileChip(); S.queue = c.queue; if (c.memory) S.memory = c.memory; if (c.fixes) { S.fixes = c.fixes; if (S.all) applyFixes(); } render(); toast(`Session restored: ${S.queue.length} queued, ${S.memory.length} in memory.${c.skipped ? ` ${c.skipped} unreadable ${c.skipped === 1 ? 'entry was' : 'entries were'} skipped.` : ''}`); } catch { toast('That is not a Micro Market Studio session file.'); } };
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
const CSV_WARN_BYTES = 25 * 1024 * 1024;
function readFile(f) {
  if (f.size > CSV_WARN_BYTES && !confirm(`This file is ${(f.size / 1048576).toFixed(0)} MB. Large exports can slow down or freeze the page. A Realty Toolkit export for one ZIP over 730 days is usually under 5 MB. Load it anyway?`)) return;
  const r = new FileReader(); r.onload = () => ingest(String(r.result), f.name, /^98125-sample( ?\(\d+\))?\.csv$/i.test(f.name)); r.readAsText(f); }
async function loadSample() {
  try { const res = await fetch('data/98125-sample.csv'); if (!res.ok) throw new Error(res.status); ingest(await res.text(), '98125-sample.csv', true); }
  catch (e) { showError('Could not load the sample file.'); }
}

// ---------- your details (byline and contact on every report) ----------
const GATED = '#print-story, #ar-print, #ar-web, #ar-car-pdf, #ar-car-png, #ar-copy, #ar-all, #ar-queue, [data-png]';
function profileReady() { const t = (k) => String(AR[k] || '').trim(); return !!(t('name') && t('firm') && (t('phone') || t('email'))); }
function agentKey(n) {
  const t = String(n || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(jr|sr|ii|iii|iv)$/.test(w));
  return t.length ? t[0] + ' ' + t[t.length - 1] : '';
}
function updateProfileChip() {
  const b = $('#profile-chip'); if (!b) return;
  const ok = profileReady();
  b.textContent = ok ? `Reports by ${AR.name}` : 'Add your details';
  b.title = ok ? 'Edit the name and contact details on your reports' : 'Your name and contact details go on every report';
  b.classList.toggle('ready', ok); b.classList.toggle('accent', !ok);
}
function profileMatch(name) {
  const el = $('#profile-match'); const key = agentKey(name);
  if (!key || !S.agents || !S.agents.size || S.isSample) { el.textContent = ''; el.className = 'profile-match'; return; }
  const n = S.agents.get(key);
  el.className = 'profile-match' + (n ? ' ok' : '');
  el.textContent = n ? `Matches your MLS export: this name appears as a listing or selling agent on ${n} ${n === 1 ? 'row' : 'rows'}.` : 'This name is not among the listing or selling agents in this export. That is fine if you did not list or sell these homes.';
}
let profileThen = null;
function openProfile(then, msg) {
  profileThen = then || null;
  const map = { name: 'pf-name', role: 'pf-role', firm: 'pf-firm', phone: 'pf-phone', email: 'pf-email', web: 'pf-web', license: 'pf-license' };
  Object.entries(map).forEach(([k, id]) => { const i = $('#' + id); i.value = AR[k] || ''; i.removeAttribute('aria-invalid'); });
  $('#profile-err').textContent = msg || '';
  profileMatch(AR.name);
  const d = $('#profile-dlg'); if (!d.open) d.showModal();
  setTimeout(() => $('#pf-name').focus(), 0);
}
$('#pf-name').addEventListener('input', (e) => profileMatch(e.target.value));
$('#profile-cancel').onclick = () => { profileThen = null; $('#profile-dlg').close(); };
$('#profile-chip').onclick = () => openProfile(null);
$('#profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id) => $('#' + id).value.trim();
  const name = v('pf-name'), firm = v('pf-firm'), phone = v('pf-phone'), email = v('pf-email');
  const bad = [];
  if (!name) bad.push('pf-name');
  if (!firm) bad.push('pf-firm');
  if (!phone && !email) bad.push('pf-phone', 'pf-email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push('pf-email');
  ['pf-name', 'pf-firm', 'pf-phone', 'pf-email'].forEach((id) => $('#' + id).setAttribute('aria-invalid', bad.includes(id) ? 'true' : 'false'));
  if (bad.length) {
    $('#profile-err').textContent = !name || !firm ? 'Add your full name and brokerage.' : !phone && !email ? 'Add a phone number or an email.' : 'Check the email address.';
    $('#' + bad[0]).focus(); return;
  }
  if (!AR.byline || AR.byline === 'By ' + AR.name) AR.byline = 'By ' + name;
  Object.assign(AR, { name, firm, phone, email, role: v('pf-role'), web: v('pf-web'), license: v('pf-license') });
  $('#profile-dlg').close(); updateProfileChip(); render();
  toast(`Saved. Reports now carry ${name}, ${firm}. Save a session file to keep these details next time.`);
  const then = profileThen; profileThen = null;
  if (then) setTimeout(() => { const el = $(then); if (el) el.click(); }, 60);
});
// any report export waits for the details form first
document.addEventListener('click', (e) => {
  const b = e.target.closest(GATED); if (!b || profileReady()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const tid = b.getAttribute('data-testid');
  openProfile(tid ? `[data-testid="${tid}"]` : null, 'Add your name and contact details first. They go on every report you export.');
}, true);
updateProfileChip();
$('#load-sample').onclick = loadSample;
$('#save-session').onclick = exportSession;
$('#fix-save').onclick = saveFixes;
$('#fix-cancel').onclick = () => $('#fix-dlg').close();
$('#session-file').onchange = (e) => { const f = e.target.files[0]; if (f) importSession(f); e.target.value = ''; };
loadSample();
})();
