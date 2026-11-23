(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // ---------- reveal on scroll ----------
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---------- stakeholder lens ----------
  var LENS = {
    seller: {
      q: 'Is now the right time, and what is my home worth in this pocket?',
      out: 'A seller lens post or broadsheet story, a neighborhood report with price per square foot by pocket, and a price band read for their range.',
      kpis: [['Median $/sq ft', 1], ['Sold to list', 1], ['Median days on market', 1], ['Months of supply', 0], ['Price cuts by band', 0], ['New listings', 0]]
    },
    buyer: {
      q: 'Where do I have room to negotiate, and how fast do I need to move?',
      out: 'A buyer lens post, the price band view around their budget, and the neighborhoods where homes are sitting longer than the ZIP.',
      kpis: [['Median days on market', 1], ['Price cuts by band', 1], ['Months of supply', 1], ['Share sold over asking', 0], ['New listings', 0], ['Year over year', 0]]
    },
    investor: {
      q: 'Which pockets are moving on price per square foot, and where is supply building?',
      out: 'An analyst voice draft, neighborhood price per square foot change, absorption and the 12 month trend beside the national 30 year rate.',
      kpis: [['$/sq ft change, 60 days', 1], ['Pending per active', 1], ['Year over year', 1], ['New listings', 0], ['Months of supply', 0], ['Median sold price', 0]]
    },
    broker: {
      q: 'What should I post this week that is true, new and useful to my clients?',
      out: 'A ranked signal board, Story Scores that drop for stories you already told, a draft in your voice and a Queue to plan when it goes out.',
      kpis: [['Story Score', 1], ['Sample label', 1], ['Content memory', 1], ['Export freshness', 0], ['Rows held for review', 0], ['Queue', 0]]
    },
    brokerage: {
      q: 'Can I trust what my agents are saying about the market in public?',
      out: 'The same written rules for every agent, a byline and methodology note on every export, and source rows behind every claim.',
      kpis: [['Byline on every export', 1], ['Sample labels', 1], ['Source rows', 1], ['Data check choices', 0], ['Footnote marks', 0], ['Methodology note', 0]]
    }
  };
  var lensTabs = document.querySelectorAll('.lens-tabs [role=tab]');
  var lensPanel = document.getElementById('lens-panel');
  function setLens(k) {
    var d = LENS[k]; if (!d) return;
    lensTabs.forEach(function (b) { b.setAttribute('aria-selected', b.dataset.k === k ? 'true' : 'false'); b.tabIndex = b.dataset.k === k ? 0 : -1; });
    document.getElementById('lens-q').textContent = d.q;
    document.getElementById('lens-out').textContent = d.out;
    var ul = document.getElementById('lens-kpis'); ul.innerHTML = '';
    d.kpis.forEach(function (p) { var li = document.createElement('li'); li.textContent = p[0]; if (p[1]) li.className = 'key'; ul.appendChild(li); });
    lensPanel.classList.remove('swap'); void lensPanel.offsetWidth; lensPanel.classList.add('swap');
  }
  lensTabs.forEach(function (b, i) {
    b.addEventListener('click', function () { setLens(b.dataset.k); });
    b.addEventListener('keydown', function (e) {
      var n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!n) return;
      var t = lensTabs[(i + n + lensTabs.length) % lensTabs.length]; t.focus(); setLens(t.dataset.k);
    });
  });
  setLens('seller');

  // ---------- evidence demo (fictional sample rows from the studio) ----------
  var EV = {
    a: { title: 'Northgate median days on market, last 60 days', big: '36', desc: 'Median days on market for 14 Northgate sales closed in the last 60 days. First 5 of 14 rows.',
      rows: [['12818 NE 103rd St', 'Townhouse', '$725,000', '$714,000', 18], ['361 1st Ave NE', 'Condo', '$480,000', '$473,000', 31], ['3348 NE Northgate Way', 'Townhouse', '$770,000', '$757,000', 18], ['14931 NE Northgate Way', 'Condo', '$350,000', '$342,000', 40], ['3347 5th Ave NE', 'Residential', '$905,000', '$868,000', 40]] },
    b: { title: '98125 median days on market, same window', big: '12', desc: 'Median days on market for all 121 98125 sales in the same window. First 5 of 121 rows.',
      rows: [['13272 NE 120th St', 'Townhouse', '$650,000', '$636,000', 15], ['12818 NE 103rd St', 'Townhouse', '$725,000', '$714,000', 18], ['3681 12th Ave NE', 'Residential', '$845,000', '$848,000', 33], ['12468 39th Ave NE', 'Residential', '$750,000', '$764,000', 5], ['11866 35th Ave NE', 'Residential', '$880,000', '$888,000', 7]] }
  };
  var evBtns = document.querySelectorAll('.evn');
  function showEv(k) {
    var d = EV[k];
    evBtns.forEach(function (b) { b.classList.toggle('on', b.dataset.ev === k); b.setAttribute('aria-pressed', b.dataset.ev === k ? 'true' : 'false'); });
    document.getElementById('ev-title').textContent = d.title;
    var desc = document.getElementById('ev-desc'); desc.innerHTML = '';
    var big = document.createElement('p'); big.className = 'ev-big'; big.textContent = d.big;
    var t = document.createElement('span'); t.textContent = d.desc;
    desc.appendChild(big); desc.appendChild(t);
    var h = '<table><thead><tr><th>Address</th><th>Type</th><th class="r">List</th><th class="r">Sold</th><th class="r">DOM</th></tr></thead><tbody>';
    d.rows.forEach(function (r, i) {
      h += '<tr style="animation-delay:' + (i * 50) + 'ms"><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="r">' + r[2] + '</td><td class="r">' + r[3] + '</td><td class="r">' + r[4] + '</td></tr>';
    });
    document.getElementById('ev-rows').innerHTML = h + '</tbody></table>';
  }
  evBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function () { showEv(b.dataset.ev); }); });

  // ---------- Story Score calculator (same formula as app.js) ----------
  var size = document.getElementById('c-size'), n = document.getElementById('c-n'), nov = document.getElementById('c-nov');
  var fitBtns = document.querySelectorAll('.seg [role=radio]');
  var fit = 1.2, aud = 'seller';
  function calc() {
    var sz = +size.value, nn = +n.value;
    var conf = nn >= 12 ? 1 : nn >= 6 ? 0.72 : 0.35;
    var label = nn >= 12 ? 'Solid' : nn >= 6 ? 'Directional' : 'Held back';
    var nv = nov.checked ? 0.6 : 1;
    var sc = Math.max(1, Math.min(99, Math.round((sz / 100) * 90 * conf * nv * fit)));
    document.getElementById('o-size').textContent = sz;
    document.getElementById('o-n').textContent = nn;
    var num = document.getElementById('sc-num'); num.textContent = sc; num.classList.toggle('hot', sc >= 60);
    var tag = document.getElementById('sc-tag'); tag.textContent = label + ', n=' + nn;
    tag.className = 'tag' + (conf === 0.72 ? ' dir' : conf === 0.35 ? ' hold' : '');
    document.getElementById('formula').textContent = 'Size ' + sz + ' x sample ' + conf + ' x novelty ' + nv + ' x ' + aud + ' fit ' + fit.toFixed(1);
  }
  [size, n, nov].forEach(function (el) { el.addEventListener('input', calc); el.addEventListener('change', calc); });
  fitBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      fitBtns.forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      fit = +b.dataset.fit; aud = b.dataset.a; calc();
    });
  });
  calc();

  // ---------- studio tab showcase ----------
  var CAPS = {
    'what-changed': ['The last 30 days against the 30 before, neighborhood by neighborhood, so you can see where the ZIP average is hiding a split.', 'What changed tab: neighborhood table comparing the last 30 days to the prior 30.', 1089],
    'price-bands': ['Enter a budget and see the band within 10% of it: 90 day sales, active supply and months of supply, read as tight, balanced or loose.', 'Price bands tab: sales, supply and months of supply for the band around a budget.', 984],
    'trends': ['Year over year closed sales, 12 against 12 or 3 against 3, beside the national 30 year rate. A 730 day export unlocks the full comparison.', 'Trends tab: homes sold per month with the 30 year mortgage rate line.', 1101],
    'area-report': ['The whole ZIP as a neighborhood table, with small lot homes reported as their own group and footnote marks on thin samples.', 'Area report tab: neighborhood table with active, pending, sold, price per square foot and days on market.', 1036]
  };
  var tsBtns = document.querySelectorAll('.ts-tabs [role=tab]');
  var tsImg = document.getElementById('ts-img'), tsCap = document.getElementById('ts-cap');
  tsBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.img, c = CAPS[k];
      tsBtns.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      tsImg.classList.add('fade');
      setTimeout(function () {
        tsImg.src = 'assets/platform/' + k + '.webp'; tsImg.alt = c[1]; tsImg.height = c[2];
        tsCap.textContent = c[0]; tsImg.classList.remove('fade');
      }, 180);
    });
  });
})();
