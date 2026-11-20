/* Token Radar page. Everything on screen comes from RadarModel.buildRadar(window.SNAPSHOT), the same
 * call main.ts makes to write board.json, so the board, the detail view and the files agree row for row.
 * The view lives in the URL hash (tab, filters, sort, open protocol, pins, sandbox), so any view can be linked.
 * The sandbox edits the model's own constants and re-runs buildRadar here; board.json keeps the shipped ones. */
(function () {
  'use strict';
  const M = window.RadarModel;
  const view = document.getElementById('view');
  const detail = document.getElementById('detail');
  const scrim = document.getElementById('scrim');
  const money = M.money;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pct = (x) => (x === null || x === undefined ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
  const trend = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const ageText = (d) => (d === null ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d');
  const times = (x) => '×' + x.toFixed(x >= 10 ? 0 : 2);

  // ---- sandbox: [constant, label, min, max, step] of M.PARAMS the reader may move ----
  const SB = [['growth_power', 'Momentum power', 0, 1, 0.05], ['runway_end', 'Runway at 2 years', 0.75, 1.6, 0.05], ['child_discount', 'Child-listing discount', 0.1, 1, 0.05], ['sibling_discount', 'Family-token discount', 0.1, 1, 0.05], ['community_share', 'Share dropped to users', 0.02, 0.3, 0.01]];
  const SHIPPED = Object.assign({}, M.PARAMS);
  let R, rowBySlug, lnLo, lnHi, builtFor = null, baseRank;
  try {
    baseRank = new Map(M.buildRadar(window.SNAPSHOT).rows.map((r) => [r.slug, r.rank]));
  } catch (err) {
    view.innerHTML = '<p class="empty">The radar could not be built from data.js: ' + esc(err.message) + '</p>';
    return;
  }
  /** The radar under the sandbox's constants (the shipped ones when sb is empty), rebuilt only on change. */
  function build(sb) {
    if (sb === builtFor) return;
    const v = sb ? sb.split(',').map(Number) : [];
    SB.forEach(([k, , lo, hi], i) => (M.PARAMS[k] = Number.isFinite(v[i]) ? Math.min(hi, Math.max(lo, v[i])) : SHIPPED[k]));
    R = M.buildRadar(window.SNAPSHOT);
    rowBySlug = new Map(R.rows.map((r) => [r.slug, r]));
    lnLo = Math.log(Math.min(...R.rows.map((r) => r.value_low_usd)));
    lnHi = Math.log(Math.max(...R.rows.map((r) => r.value_high_usd)));
    builtFor = sb;
    renderKpis();
  }
  const xOf = (v) => (100 * (Math.log(v) - lnLo)) / (lnHi - lnLo);
  const fmtP = (k, v) => (k === 'community_share' ? Math.round(v * 100) + '%' : v.toFixed(2));

  // ---- state in the hash; pins also persist in this browser ----
  const DEFAULTS = { tab: 'board', q: '', fam: '', chain: '', scope: 'all', rising: '', worth: '', min: '0', sort: 'rank', dir: 'asc', p: '', pins: '', sb: '' };
  const savedPins = () => { try { return localStorage.getItem('radar-pins') || ''; } catch (e) { return ''; } };
  let state = readState();
  function readState() {
    const s = Object.assign({}, DEFAULTS);
    const h = location.hash.replace(/^#/, '');
    for (const part of h.split('&')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i) in s) s[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
    }
    if (!/(^|&)pins=/.test(h)) s.pins = savedPins();
    return s;
  }
  const pinsOf = (s) => s.pins.split(',').filter((x) => rowBySlug.has(x));
  function togglePin(slug) {
    const p = pinsOf(state), i = p.indexOf(slug);
    if (i >= 0) p.splice(i, 1); else p.push(slug);
    try { localStorage.setItem('radar-pins', p.join(',')); } catch (e) { /* a private window keeps pins in the link only */ }
    go({ pins: p.join(',') });
  }
  function go(patch) {
    const s = Object.assign({}, state, patch);
    const parts = Object.keys(DEFAULTS).filter((k) => s[k] !== DEFAULTS[k]).map((k) => k + '=' + encodeURIComponent(s[k]));
    location.hash = parts.length ? parts.join('&') : 'tab=board';
  }

  // ---- headline ----
  function renderKpis() {
  document.getElementById('sub').textContent = `DefiLlama snapshot ${R.as_of} · ${R.protocols} protocols · watchlist floor ${money(R.floor_usd)} · model ${R.version}`;
  const wlCovered = R.rows.filter((r) => r.scope === 'watchlist').length;
  const top10 = R.rows.slice(0, 10).reduce((s, r) => s + r.implied_value_usd, 0);
  document.getElementById('kpis').innerHTML = [
    ['Pre-token board', R.rows.length, 'ranked rows'],
    ['Watchlist covered', `${wlCovered}/${R.watchlist.length}`, 'every slug'],
    ['Top-10 implied value', money(top10), 'sum'],
    ['Comps fit', `${R.fit.n} tokens`, `size elasticity ${R.fit.elasticity.toFixed(2)}`],
    ['Backtest miss', times(R.backtest.median_miss), `flat multiple ${times(R.naive.median_miss)}`],
  ].map(([k, v, s]) => `<div class="kpi"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
  }

  // ---- board ----
  const SCOPES = [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Below floor'], ['child', 'Child listings'], ['flagged', 'Flagged'], ['pinned', '★ Pinned']];
  const MINS = [['0', 'Any'], ['10000000', '$10M+'], ['50000000', '$50M+'], ['250000000', '$250M+']];
  const SORTS = {
    rank: (r) => r.rank, tvl: (r) => r.tvl_usd, chg: (r) => (r.change_7d === null ? -1e9 : r.change_7d), age: (r) => (r.age_days === null ? -1 : r.age_days),
    value: (r) => r.implied_value_usd, mult: (r) => r.model.multiple, edge: (r) => r.farm.edge,
  };
  const COLS = [
    [null, '★', 'pin'], ['rank', '#', 'num'], ['name', 'Protocol', ''], [null, 'Chains', 'c-chains'], ['tvl', 'TVL', 'num'], ['chg', '7d', 'num'],
    ['age', 'No token for', 'num'], ['value', 'Implied value · range', 'num'], ['mult', 'Value / TVL', 'num'], ['edge', 'Est. drop vs cost', 'num'],
  ];

  function filtered(s) {
    const q = s.q.trim().toLowerCase();
    const min = Number(s.min) || 0;
    const pins = new Set(pinsOf(s));
    const rows = R.rows.filter((r) =>
      (s.scope !== 'pinned' || pins.has(r.slug)) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category || '').toLowerCase().includes(q)) &&
      (!s.fam || r.family === s.fam) && (!s.chain || r.chains.includes(s.chain)) &&
      (s.scope === 'all' || s.scope === 'pinned' || (s.scope === 'flagged' ? r.flags.length > 0 : r.scope === s.scope)) &&
      (!s.rising || (r.change_7d || 0) > 0) && (!s.worth || r.farm.edge >= 1) && r.tvl_usd >= min);
    const dir = s.dir === 'desc' ? -1 : 1;
    const key = SORTS[s.sort];
    return rows.sort((a, b) => (s.sort === 'name' ? a.name.localeCompare(b.name) : key ? key(a) - key(b) : 0) * dir || a.rank - b.rank);
  }

  function options(list, current) {
    return list.map(([v, label]) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function badges(r) {
    let h = r.scope === 'watchlist' ? '<span class="badge b-wl" title="On the house watchlist">Watchlist</span>' : '';
    if (r.flags.includes('child')) h += '<span class="badge b-child" title="Above the floor but off the watchlist: DefiLlama names a parent protocol">Child</span>';
    if (r.flags.includes('sibling')) h += `<span class="badge b-sib" title="A protocol of the same slug family trades a token">Family token ${esc(r.family_token)}</span>`;
    return h;
  }

  /** How far the sandbox moved a row from its shipped rank. */
  function delta(r) {
    const d = baseRank.get(r.slug) - r.rank;
    return !state.sb || !d ? '' : `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</small>`;
  }
  const pinBtn = (r, on) => `<button type="button" class="pinb${on ? ' on' : ''}" data-pin="${esc(r.slug)}" aria-pressed="${on}" title="${on ? 'Unpin' : 'Pin to compare'}">${on ? '★' : '☆'}</button>`;

  function rowHtml(r, pins) {
    const lo = xOf(r.value_low_usd), hi = xOf(r.value_high_usd), at = xOf(r.implied_value_usd);
    const ch = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ` +${r.chains.length - 2}` : '');
    return `<tr tabindex="0" data-slug="${esc(r.slug)}">
<td class="pin">${pinBtn(r, pins.has(r.slug))}</td><td class="num rank">${r.rank}${delta(r)}</td>
<td class="proto"><b>${esc(r.name)}</b>${badges(r)}<br><span class="cat">${esc(r.category || 'Uncategorised')} · ${r.family}</span></td>
<td class="chains c-chains">${esc(ch)}</td>
<td class="num">${money(r.tvl_usd)}</td>
<td class="num ${trend(r.change_7d)}">${pct(r.change_7d)}</td>
<td class="num">${ageText(r.age_days)}</td>
<td class="val"><div class="vcell"><div class="vbar" title="${money(r.value_low_usd)} to ${money(r.value_high_usd)}"><i style="left:${lo.toFixed(1)}%;width:${(hi - lo).toFixed(1)}%"></i><b style="left:${at.toFixed(1)}%"></b></div><span class="num">${money(r.implied_value_usd)}</span></div></td>
<td class="num">${(r.model.multiple * 100).toFixed(1)}%</td>
<td class="num farm ${r.farm.edge >= 1 ? 'up' : ''}">${money(r.farm.drop_usd)}<small>vs ${money(r.farm.cost_usd)} on ${money(r.farm.capital_usd)}</small></td></tr>`;
  }

  function renderBoard(s) {
    const rows = filtered(s);
    const fams = [...new Set(R.rows.map((r) => r.family))].sort();
    const chainN = {};
    for (const r of R.rows) for (const c of r.chains) chainN[c] = (chainN[c] || 0) + 1;
    const chains = Object.keys(chainN).sort((a, b) => chainN[b] - chainN[a] || a.localeCompare(b)).slice(0, 18);
    const active = Object.keys(DEFAULTS).some((k) => !['tab', 'sort', 'dir', 'p', 'pins', 'sb'].includes(k) && s[k] !== DEFAULTS[k]);
    const pins = new Set(pinsOf(s));
    view.innerHTML = `<div class="bar">
<label><span>Search</span><input type="search" id="f-q" value="${esc(s.q)}" placeholder="Protocol, slug or category"></label>
<label><span>Family</span><select id="f-fam">${options([['', 'All families']].concat(fams.map((f) => [f, f])), s.fam)}</select></label>
<label><span>Chain</span><select id="f-chain">${options([['', 'All chains']].concat(chains.map((c) => [c, `${c} (${chainN[c]})`])), s.chain)}</select></label>
<label><span>Min TVL</span><select id="f-min">${options(MINS, s.min)}</select></label>
<div><span class="seg" role="group" aria-label="Scope">${SCOPES.map(([v, l]) => `<button type="button" data-scope="${v}" class="${s.scope === v ? 'on' : ''}" aria-pressed="${s.scope === v}">${l}</button>`).join('')}</span></div>
<label class="chk"><input type="checkbox" id="f-rising"${s.rising ? ' checked' : ''}> Rising 7d</label>
<label class="chk"><input type="checkbox" id="f-worth"${s.worth ? ' checked' : ''}> Drop ≥ cost</label>
</div>
<p class="count"><span>Showing <b>${rows.length}</b> of ${R.rows.length} pre-token protocols, sorted by ${s.sort === 'rank' ? 'rank (implied value)' : (COLS.find((c) => c[0] === s.sort) || COLS[0])[1].toLowerCase()} ${s.dir === 'desc' ? '↓' : '↑'}</span>${active ? '<button class="linkish" id="f-reset" type="button">Clear filters</button>' : ''}${s.sb ? '<span class="sbtag">Sandbox constants: ▲▼ shows the move from the shipped rank · <a href="#tab=method">edit</a></span>' : ''}</p>
<table class="board"><thead><tr>${COLS.map(([k, label, cls]) => `<th class="${cls}${k === s.sort ? ' sorted' : ''}" ${k ? `aria-sort="${k === s.sort ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"` : ''}>${k ? `<button type="button" data-sort="${k}">${label}${k === s.sort ? (s.dir === 'desc' ? ' ↓' : ' ↑') : ''}</button>` : `<button type="button" disabled>${label}</button>`}</th>`).join('')}</tr></thead>
<tbody>${rows.length ? rows.map((r) => rowHtml(r, pins)).join('') : `<tr><td colspan="10" class="empty">${s.scope === 'pinned' ? 'Nothing pinned yet: tap ☆ on a row.' : 'No protocol matches these filters.'}</td></tr>`}</tbody></table>`;

    let timer = 0;
    const q = document.getElementById('f-q');
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => go({ q: q.value }), 180); });
    for (const k of ['fam', 'chain', 'min']) document.getElementById('f-' + k).addEventListener('change', (e) => go({ [k]: e.target.value }));
    for (const k of ['rising', 'worth']) document.getElementById('f-' + k).addEventListener('change', (e) => go({ [k]: e.target.checked ? '1' : '' }));
    view.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => go({ scope: b.dataset.scope })));
    view.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      go({ sort: k, dir: k === s.sort ? (s.dir === 'asc' ? 'desc' : 'asc') : k === 'rank' || k === 'name' ? 'asc' : 'desc' });
    }));
    const reset = document.getElementById('f-reset');
    if (reset) reset.addEventListener('click', () => go({ q: '', fam: '', chain: '', scope: 'all', rising: '', worth: '', min: '0' }));
    view.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
      tr.addEventListener('click', (e) => (e.target.closest('[data-pin]') ? togglePin(tr.dataset.slug) : go({ p: tr.dataset.slug })));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go({ p: tr.dataset.slug }); });
    });
  }

  // ---- detail ----
  function comparables(r) {
    const same = R.backtest.rows.filter((t) => t.category === r.category);
    const pool = same.length >= 3 ? same : R.backtest.rows.filter((t) => t.family === r.family);
    return pool.slice().sort((a, b) => Math.abs(Math.log(a.tvl_usd / r.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / r.tvl_usd))).slice(0, 4);
  }

  /** One plain sentence on why the row sits where it does, from its own figures against the board's. */
  function reading(r) {
    const tvlRank = 1 + R.rows.filter((x) => x.tvl_usd > r.tvl_usd).length;
    const mults = R.rows.map((x) => x.model.multiple).sort((a, b) => a - b);
    const med = mults[Math.floor(mults.length / 2)];
    const rel = r.model.multiple / med;
    const parts = [`TVL is #${tvlRank} of ${R.rows.length} on the board`, `its ${r.category || 'uncategorised'} comps price TVL at ${(r.model.multiple * 100).toFixed(1)}%, ${rel >= 1 ? (rel).toFixed(1) + '× the board median' : (1 / rel).toFixed(1) + '× under the board median'}`];
    if (Math.abs(r.model.momentum - 1) >= 0.03) parts.push(`last week's ${pct(r.change_7d)} ${r.model.momentum > 1 ? 'lifts' : 'cuts'} it ${Math.abs((r.model.momentum - 1) * 100).toFixed(0)}%`);
    parts.push(r.age_days === null ? 'its tracking date is unknown, so runway takes a year' : r.age_days < 180 ? `${r.age_days} days with no token is a short record, so runway trims it` : `${ageText(r.age_days)} with no token earns a runway premium`);
    if (r.flags.length) parts.push('a family discount applies because ' + (r.flags.includes('child') ? 'DefiLlama files it under a parent' : `${r.family_token} already trades in its family`));
    return 'Rank #' + r.rank + ': ' + parts.join('; ') + '.';
  }

  function renderDetail(s) {
    const r = rowBySlug.get(s.p);
    detail.hidden = scrim.hidden = !r;
    if (!r) return;
    const m = r.model;
    const why = [];
    if (r.flags.includes('child')) why.push('child listing ×0.5');
    if (r.flags.includes('sibling')) why.push(`family token ${r.family_token} trades ×0.4`);
    const steps = [
      ['TVL', 'the snapshot', r.tvl_usd, money(r.tvl_usd)],
      ['Comps value', `${(m.multiple * 100).toFixed(1)}% of TVL, ${r.category || 'uncategorised'} trading set`, m.comps_usd, money(m.comps_usd)],
      ['× momentum', `7d ${pct(r.change_7d)} → ×${m.momentum.toFixed(3)}`, m.comps_usd * m.momentum, '×' + m.momentum.toFixed(3)],
      ['× runway', `${ageText(r.age_days)} with no token → ×${m.runway.toFixed(3)}`, m.comps_usd * m.momentum * m.runway, '×' + m.runway.toFixed(3)],
      ['× family discount', why.length ? why.join(', ') : 'none applies', r.implied_value_usd, '×' + m.discount.toFixed(2)],
    ];
    const top = Math.max(...steps.slice(1).map((x) => x[2]));
    const comps = comparables(r);
    const f = r.farm;
    const pinned = pinsOf(s).includes(r.slug);
    detail.innerHTML = `<button class="close" type="button" id="d-close">Close ✕</button><button class="close" style="right:110px" type="button" id="d-pin">${pinned ? '★ Pinned' : '☆ Pin to compare'}</button>
<div class="meta">Rank #${r.rank} of ${R.rows.length} · ${esc(r.category || 'Uncategorised')} · ${r.family} family</div>
<h2>${esc(r.name)}${badges(r)}</h2>
<div class="meta">${esc(r.chains.join(' · ') || 'no chain listed')} · tracked since ${esc(r.listed_at || 'unknown')} · DefiLlama records no token</div>
<div class="hero"><div><span>Implied value</span><b>${money(r.implied_value_usd)}</b></div><div class="alt"><span>Middle-half range</span><b>${money(r.value_low_usd)} – ${money(r.value_high_usd)}</b></div><div class="alt"><span>TVL · 7d</span><b>${money(r.tvl_usd)} <span class="${trend(r.change_7d)}" style="display:inline">${pct(r.change_7d)}</span></b></div><div class="alt"><span>Est. drop on ${money(f.capital_usd)} · vs cost</span><b class="${f.edge >= 1 ? 'up' : 'down'}">${money(f.drop_usd)} · ${f.edge.toFixed(1)}×</b></div></div>
<p class="meta" style="margin:12px 0 0">${esc(reading(r))}</p>
<div class="dgrid"><section>
<h3>How the value is built</h3>
<div class="wf">${steps.map(([l, sub, v, fig], i) => `<div class="lbl">${l}<small>${esc(sub)}</small></div><div class="track">${i ? `<i class="${i === steps.length - 1 ? 'v' : ''}" style="width:${Math.max(1, (100 * v) / top).toFixed(1)}%"></i>` : ''}</div><div class="fig">${fig}</div>`).join('')}
<div class="lbl"><b style="color:var(--text)">= Implied value</b></div><div></div><div class="fig" style="color:var(--amber);font-weight:700">${money(r.implied_value_usd)}</div></div>
<h3>Comparables that trade · what the multiple is fitted on</h3>
<table class="comps"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>${comps.map((t) => `<tr><td>${esc(t.name)} <span class="cat">${esc(t.symbol || '')}</span></td><td class="num">${money(t.tvl_usd)}</td><td class="num">${money(t.mcap_usd)}</td><td class="num">${((100 * t.mcap_usd) / t.tvl_usd).toFixed(1)}%</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No trading comparable in this family: the market-wide intercept applies.</td></tr>'}</tbody></table>
<p class="note">Est. drop assumes ${R.params.community_share * 100}% of the implied value goes to users pro-rata to today's TVL. It is a sizing aid, not a promise that a token will launch.</p>
</section><section>
<h3>Farm plan on ${esc(f.chain)} · ${money(f.capital_usd)} working capital</h3>
<ol class="steps">${f.steps.map((x) => `<li><span class="k">${x.k}</span>${esc(x.text)}<div class="chips"><span class="chip c">${money(x.cost)} · ${esc(x.note)}</span><span class="chip">${M.span(x.min)}</span></div></li>`).join('')}</ol>
<div class="tot"><div><span>Out-of-pocket cost</span><b>${money(f.cost_usd)}</b></div><div><span>Hands-on time · hold</span><b>${M.span(f.active_min)} · ${f.hold_days} d</b></div><div><span>Est. drop · drop/cost</span><b class="${f.edge >= 1 ? 'up' : 'down'}">${money(f.drop_usd)} · ${f.edge.toFixed(1)}×</b></div></div>
</section></div>`;
    document.getElementById('d-close').addEventListener('click', () => go({ p: '' }));
    document.getElementById('d-pin').addEventListener('click', () => togglePin(r.slug));
  }

  // ---- already trading ----
  function missClass(err) { const a = Math.abs(err); return a <= Math.log(2) ? 'miss-ok' : a <= Math.log(4) ? 'miss-mid' : 'miss-bad'; }
  function renderTrading() {
    const b = R.backtest;
    view.innerHTML = `<div class="card" style="margin-bottom:12px"><h2>Protocols whose token already trades: kept off the board, used to price it</h2>
<p>Each of the ${b.rows.length} is priced by the comps model fitted on the other ${b.rows.length - 1}: median miss <b>${times(b.median_miss)}</b>, ${(b.within3 * 100).toFixed(0)}% within 3×, rank correlation ${b.spearman.toFixed(2)}; a flat mcap/TVL multiple misses by ${times(R.naive.median_miss)}.</p></div>
<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">Model (left out)</th><th class="num">Miss</th></tr></thead><tbody>
${b.rows.map((t) => `<tr><td><b>${esc(t.name)}</b> <span class="cat">${esc(t.symbol || '')}</span></td><td class="cat">${esc(t.category || '')}</td><td class="num">${money(t.tvl_usd)}</td><td class="num ${trend(t.change_7d)}">${pct(t.change_7d)}</td><td class="num">${money(t.mcap_usd)}</td><td class="num">${((100 * t.mcap_usd) / t.tvl_usd).toFixed(1)}%</td><td class="num">${money(t.model_usd)}</td><td class="num ${missClass(t.err)}">${t.err >= 0 ? '+' : '−'}${times(Math.exp(Math.abs(t.err)))}</td></tr>`).join('')}</tbody></table>`;
  }

  // ---- method ----
  function scatter() {
    const pts = R.backtest.rows.map((t) => [Math.log10(t.model_usd), Math.log10(t.mcap_usd)]);
    const all = pts.flat(), lo = Math.floor(Math.min(...all)), hi = Math.ceil(Math.max(...all));
    const W = 540, H = 340, P = 62, sx = (v) => P + ((v - lo) / (hi - lo)) * (W - P - 36), sy = (v) => H - P - ((v - lo) / (hi - lo)) * (H - P - 10);
    const l3 = Math.log10(3);
    const ticks = [];
    for (let v = lo; v <= hi; v++) ticks.push(`<text x="${sx(v)}" y="${H - P + 16}" text-anchor="middle">${money(10 ** v)}</text><text x="${P - 6}" y="${sy(v) + 4}" text-anchor="end">${money(10 ** v)}</text>`);
    return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Model value against market cap for every trading protocol">
<polygon class="band" points="${sx(lo)},${sy(lo + l3)} ${sx(hi - l3)},${sy(hi)} ${sx(hi)},${sy(hi)} ${sx(hi)},${sy(hi - l3)} ${sx(lo + l3)},${sy(lo)} ${sx(lo)},${sy(lo)}"/>
<line class="axis" x1="${P}" y1="${H - P}" x2="${W - 10}" y2="${H - P}"/><line class="axis" x1="${P}" y1="10" x2="${P}" y2="${H - P}"/>
<line class="diag" x1="${sx(lo)}" y1="${sy(lo)}" x2="${sx(hi)}" y2="${sy(hi)}"/>${ticks.join('')}
${pts.map(([x, y]) => `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="3.2"/>`).join('')}
<text x="${W - 12}" y="${H - P - 6}" text-anchor="end">model value (left out) →</text><text x="${P + 6}" y="20">↑ market cap</text></svg>`;
  }
  function renderMethod() {
    const p = R.params, fit = R.fit;
    view.innerHTML = `<div class="cards"><div class="card"><h2>The value rule</h2>
<div class="formula">implied = comps(TVL, category) × momentum(7d) × runway(age) × discount</div>
<ul>
<li><b>Comps</b>: log market cap = a<sub>category</sub> + ${fit.elasticity.toFixed(3)} × log TVL, fitted on the ${fit.n} protocols whose token trades; the elasticity is pooled within families (small protocols trade at higher multiples), each category's intercept shrunk toward its family (${p.shrink_category}) and each family toward the set (${p.shrink_family}).</li>
<li><b>Momentum</b>: (1 + 7d change)<sup>${p.growth_power}</sup>, the change clamped to ${p.growth_floor}%…+${p.growth_cap}%: one noisy week moves value ${((Math.pow(1 + p.growth_floor / 100, p.growth_power) - 1) * 100).toFixed(0)}% to +${((Math.pow(1 + p.growth_cap / 100, p.growth_power) - 1) * 100).toFixed(0)}%.</li>
<li><b>Runway</b>: ${p.runway_start} at day 0 to ${p.runway_end} after ${p.runway_days} days with no token: a longer record behind the launch.</li>
<li><b>Discount</b>: ×${p.child_discount} for a child listing (DefiLlama names a parent), ×${p.sibling_discount} when its slug family already trades a token.</li>
<li><b>Range</b>: the middle half of the family's backtest misses.</li></ul>
<p>The board takes every protocol that records no token and passes the watchlist's own category and name rule at any TVL: ${R.rows.filter((r) => r.scope === 'watchlist').length} watchlist slugs, ${R.rows.filter((r) => r.scope === 'early').length} below the floor and ${R.rows.filter((r) => r.scope === 'child').length} child listings.</p>
<h2>Sandbox: move a constant, the whole board re-ranks</h2>
<div class="sb">${SB.map(([k, label, lo, hi, st], i) => `<label><span>${label}</span><input type="range" data-sb="${i}" min="${lo}" max="${hi}" step="${st}" value="${M.PARAMS[k]}"><output>${fmtP(k, M.PARAMS[k])}</output><small>shipped ${fmtP(k, SHIPPED[k])}</small></label>`).join('')}</div>
<p>${state.sb ? `${R.rows.filter((r) => baseRank.get(r.slug) !== r.rank).length} of ${R.rows.length} ranks moved; ${R.rows.slice(0, 10).filter((r) => baseRank.get(r.slug) <= 10).length} of the shipped top 10 stay in it. <button class="linkish" id="sb-reset" type="button">Restore shipped constants</button>` : 'Board, detail and Compare re-run buildRadar with these values; board.json keeps the shipped ones.'}</p></div>
<div class="card"><h2>Backtest: every trading token priced by the others</h2>${scatter()}
<p>Median miss ${times(R.backtest.median_miss)} · ${(R.backtest.within3 * 100).toFixed(0)}% within 3× (shaded) · rank correlation ${R.backtest.spearman.toFixed(2)} · flat multiple ${times(R.naive.median_miss)}.</p></div></div>
<table style="margin-top:14px"><thead><tr><th>Family</th><th class="num">Trading tokens</th><th class="num">Value / TVL at $100M TVL</th><th class="num">Spread (log sd)</th><th class="num">Pre-token rows</th><th>Categories in the board</th></tr></thead><tbody>
${fit.families.map((f) => `<tr><td><b>${f.family}</b></td><td class="num">${f.n}</td><td class="num">${(f.multiple_at_100m * 100).toFixed(1)}%</td><td class="num">${f.sd.toFixed(2)}</td><td class="num">${R.rows.filter((r) => r.family === f.family).length}</td><td class="cat">${esc([...new Set(R.rows.filter((r) => r.family === f.family).map((r) => r.category))].join(', '))}</td></tr>`).join('')}</tbody></table>`;
    const inputs = [...view.querySelectorAll('[data-sb]')];
    inputs.forEach((el) => {
      const k = SB[+el.dataset.sb][0];
      el.addEventListener('input', () => (el.nextElementSibling.textContent = fmtP(k, +el.value)));
      el.addEventListener('change', () => go({ sb: inputs.every((x) => +x.value === SHIPPED[SB[+x.dataset.sb][0]]) ? '' : inputs.map((x) => x.value).join(',') }));
    });
    const reset = document.getElementById('sb-reset');
    if (reset) reset.addEventListener('click', () => go({ sb: '' }));
  }

  // ---- compare: the pinned protocols side by side, the best of each figure marked ----
  const METRICS = [
    ['Implied value', (r) => r.implied_value_usd, money, 1], ['TVL', (r) => r.tvl_usd, money, 1], ['7d change', (r) => r.change_7d || 0, pct, 1],
    ['No token for', (r) => r.age_days || 0, ageText, 1], ['Value / TVL', (r) => r.model.multiple, (v) => (v * 100).toFixed(1) + '%', 1],
    ['Momentum ×', (r) => r.model.momentum, (v) => v.toFixed(3), 1], ['Runway ×', (r) => r.model.runway, (v) => v.toFixed(3), 1], ['Discount ×', (r) => r.model.discount, (v) => v.toFixed(2), 1],
    ['Farm cost', (r) => r.farm.cost_usd, money, -1], ['Est. drop', (r) => r.farm.drop_usd, money, 1], ['Drop / cost', (r) => r.farm.edge, (v) => v.toFixed(1) + '×', 1],
    ['Hands-on time', (r) => r.farm.active_min, M.span, -1], ['Hold', (r) => r.farm.hold_days, (v) => v + ' d', -1],
  ];
  function renderCompare(s) {
    const rows = pinsOf(s).map((x) => rowBySlug.get(x)).slice(0, 4);
    if (!rows.length) { view.innerHTML = '<p class="empty">Pin up to four protocols with ☆ on the board or in a detail view, and they line up here.</p>'; return; }
    view.innerHTML = `<table class="cmp"><thead><tr><th>Figure</th>${rows.map((r) => `<th><button type="button" class="linkish" data-open="${esc(r.slug)}">#${r.rank} ${esc(r.name)}</button>${pinBtn(r, true)}<br><span class="cat">${esc(r.category || '')} · ${esc(r.farm.chain)}</span></th>`).join('')}</tr></thead><tbody>
${METRICS.map(([label, get, fmt, better]) => {
      const vals = rows.map(get), best = better > 0 ? Math.max(...vals) : Math.min(...vals), top = Math.max(...vals.map(Math.abs)) || 1;
      return `<tr><td class="cat">${label}</td>${vals.map((v) => `<td class="num${rows.length > 1 && v === best ? ' best' : ''}">${fmt(v)}<i class="cbar" style="width:${((100 * Math.abs(v)) / top).toFixed(0)}%"></i></td>`).join('')}</tr>`;
    }).join('')}
<tr><td class="cat">First farm step</td>${rows.map((r) => `<td class="cat">${esc(r.farm.steps[2].text)}</td>`).join('')}</tr></tbody></table>${pinsOf(s).length > 4 ? '<p class="note">Showing the first four pins.</p>' : ''}`;
    view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go({ p: b.dataset.open })));
    view.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => togglePin(b.dataset.pin)));
  }

  // ---- render ----
  function render() {
    state = readState();
    build(state.sb);
    const hadFocus = document.activeElement && document.activeElement.id === 'f-q' ? document.activeElement.selectionStart : null;
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === state.tab));
    document.querySelector('[data-tab=compare]').textContent = `Compare · ${pinsOf(state).length}`;
    if (state.tab === 'trading') renderTrading();
    else if (state.tab === 'method') renderMethod();
    else if (state.tab === 'compare') renderCompare(state);
    else renderBoard(state);
    renderDetail(state);
    if (hadFocus !== null) { const q = document.getElementById('f-q'); if (q) { q.focus(); q.setSelectionRange(hadFocus, hadFocus); } }
  }
  scrim.addEventListener('click', () => go({ p: '' }));
  // Tabs and the brand keep pins, filters and the sandbox: only the tab changes.
  document.querySelectorAll('.tabs a, .brand').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go({ tab: a.dataset.tab || 'board', p: '' }); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.p) go({ p: '' }); });
  window.addEventListener('hashchange', render);
  render();
})();
