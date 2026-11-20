/* Token Radar model, radar-comps-1. One file, run twice: main.ts requires it to write board.json, and the
 * page loads it to draw the board, so every figure on screen comes from the same functions.
 *
 * implied value = comps(TVL, category) x momentum(7d) x runway(days with no token) x family discount
 *   comps:    what tokens that already trade fetch per dollar of TVL, fitted on this snapshot's own
 *             token-bearing protocols: a size elasticity pooled within families, then a log mcap/TVL
 *             intercept per category shrunk toward its family and the market (see fitComparables).
 *   momentum: (1 + 7d change)^0.5, the change clamped to -50%..+100%: a damped, one-week signal.
 *   runway:   0.75 at day 0 rising to 1.15 at two years with no token: a longer record behind the launch.
 *   discount: x0.5 when DefiLlama names a parent (above the floor yet off the watchlist), x0.4 when a
 *             protocol of the same slug family already has a trading token.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'radar-comps-1';
  const DAY_MS = 86400000;
  const PARAMS = {
    shrink_category: 3, // pseudo-observations pulling a category's intercept toward its family
    shrink_family: 4, // ... and a family's toward the whole trading set
    ratio_min: 0.002, // mcap/TVL winsorised into this band before fitting
    ratio_max: 20,
    elasticity_min: 0.4,
    elasticity_max: 1,
    growth_floor: -50,
    growth_cap: 100,
    growth_power: 0.5,
    runway_start: 0.75,
    runway_end: 1.15,
    runway_days: 730,
    unknown_age_days: 365,
    child_discount: 0.5,
    sibling_discount: 0.4,
    community_share: 0.1, // share of the implied value a launch is assumed to hand its users
    capital_apr: 0.04, // what idle stablecoins earn elsewhere: the farm's opportunity cost
  };

  // The house watchlist rule, minus the TVL floor and the parent record the snapshot does not carry.
  const EXCLUDED = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPED = /\b(wrapped|staked|staking)\b/i;
  const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

  // Categories pooled into families, so a category with one or no trading token borrows strength.
  const FAMILIES = {
    Vaults: ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Farm', 'Leveraged Farming', 'Indexes', 'Governance Incentives', 'Token Locker'],
    Lending: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Collateral Management'],
    Stables: ['Basis Trading', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'CeDeFi', 'Stablecoin Issuer', 'Algo-Stables'],
    Trading: ['Dexs', 'Derivatives', 'Options', 'Prediction Market', 'Interest Rate Derivatives', 'OTC Marketplace', 'NFT Marketplace', 'Launchpad', 'Perpetuals'],
    RWA: ['RWA', 'RWA Lending', 'Crypto Card Issuer', 'Payments'],
    Infra: ['Chain', 'Restaking', 'Staking Pool', 'Anchor BTC', 'Decentralized BTC', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Insurance', 'Privacy', 'AI Agents', 'Decentralized AI', 'DOR', 'Oracle', 'CEX'],
  };
  const FAMILY_OF = {};
  for (const fam of Object.keys(FAMILIES)) for (const c of FAMILIES[fam]) FAMILY_OF[c] = fam;
  const familyOf = (category) => FAMILY_OF[category] || 'Other';

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const bySlug = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    const d = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listedAt + 'T00:00:00Z')) / DAY_MS);
    return Number.isFinite(d) ? Math.max(0, d) : null;
  }

  const recordsToken = (p) => p.gecko_id !== null || p.symbol !== null;

  /** Passes the watchlist's name and category rule (any TVL): a protocol whose own launch could come. */
  function isCandidate(p) {
    return !recordsToken(p) && !EXCLUDED.has(p.category) && !VERSIONED.test(p.name) && !WRAPPED.test(p.name) && !EXCHANGES.some((x) => p.name.startsWith(x));
  }

  /** The slug's first word: "gmx-solana" belongs to the "gmx" family. */
  const familyKey = (slug) => slug.split('-')[0];

  /** Comparables: log(mcap) = a[category] + e * log(TVL), fitted on the protocols whose token trades. */
  function fitComparables(protocols, forceE) {
    const lnMin = Math.log(PARAMS.ratio_min), lnMax = Math.log(PARAMS.ratio_max);
    const pts = protocols
      .filter((p) => recordsToken(p) && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
      .map((p) => {
        const x = Math.log(p.tvl_usd);
        return { p, cat: p.category || 'Uncategorised', fam: familyOf(p.category), x, y: x + clamp(Math.log(p.mcap_usd / p.tvl_usd), lnMin, lnMax) };
      });
    // Size elasticity pooled within families, so a family that trades rich does not pass for scale.
    const g = {};
    for (const t of pts) (g[t.fam] = g[t.fam] || []).push(t);
    let sxy = 0, sxx = 0;
    for (const list of Object.values(g)) {
      const mx = list.reduce((s, t) => s + t.x, 0) / list.length, my = list.reduce((s, t) => s + t.y, 0) / list.length;
      for (const t of list) { sxy += (t.x - mx) * (t.y - my); sxx += (t.x - mx) ** 2; }
    }
    const rawE = sxx > 0 ? sxy / sxx : 1;
    const e = forceE || clamp(rawE, PARAMS.elasticity_min, PARAMS.elasticity_max);
    const sums = { all: { s: 0, n: 0 }, fam: {}, cat: {} };
    for (const t of pts) {
      t.z = t.y - e * t.x;
      sums.all.s += t.z; sums.all.n++;
      const f = (sums.fam[t.fam] = sums.fam[t.fam] || { s: 0, n: 0 }); f.s += t.z; f.n++;
      const c = (sums.cat[t.cat] = sums.cat[t.cat] || { s: 0, n: 0, fam: t.fam }); c.s += t.z; c.n++;
    }
    const fit = { e, rawE, n: pts.length, sums, pts };
    // Residual spread per family: the band shown around each implied value.
    const sq = {};
    for (const t of pts) {
      const r = t.z - intercept(fit, t.cat, t.fam);
      (sq[t.fam] = sq[t.fam] || []).push(r * r);
    }
    const allSq = Object.values(sq).flat();
    fit.sdAll = Math.sqrt(allSq.reduce((s, v) => s + v, 0) / Math.max(1, allSq.length));
    fit.sd = {};
    for (const [fam, list] of Object.entries(sq)) fit.sd[fam] = Math.sqrt((list.reduce((s, v) => s + v, 0) + 3 * fit.sdAll ** 2) / (list.length + 3));
    return fit;
  }

  /** The shrunk intercept for a category; `drop` leaves one point out (the backtest's leave-one-out). */
  function intercept(fit, cat, fam, drop) {
    const take = (b, hit) => { const base = b || { s: 0, n: 0 }; return hit ? { s: base.s - drop.z, n: base.n - 1 } : base; };
    const all = take(fit.sums.all, !!drop);
    const G = all.s / all.n;
    const f = take(fit.sums.fam[fam], !!drop && drop.fam === fam);
    const F = (f.s + PARAMS.shrink_family * G) / (f.n + PARAMS.shrink_family);
    const c = take(fit.sums.cat[cat], !!drop && drop.cat === cat);
    return (c.s + PARAMS.shrink_category * F) / (c.n + PARAMS.shrink_category);
  }

  /** Every trading protocol priced by the others: how far the comps core lands from the market. */
  function backtest(fit) {
    const rows = fit.pts.map((t) => {
      const pred = Math.exp(intercept(fit, t.cat, t.fam, t) + fit.e * t.x);
      return { slug: t.p.slug, name: t.p.name, category: t.p.category, family: t.fam, symbol: t.p.symbol, tvl_usd: t.p.tvl_usd, mcap_usd: t.p.mcap_usd, change_7d: t.p.change_7d, model_usd: Math.round(pred), err: Math.log(pred / t.p.mcap_usd) };
    });
    const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
    const median = abs.length ? abs[Math.floor(abs.length / 2)] : 0;
    const within3 = rows.filter((r) => Math.abs(r.err) <= Math.log(3)).length / Math.max(1, rows.length);
    return { rows: rows.sort((a, b) => b.mcap_usd - a.mcap_usd || bySlug(a, b)), median_miss: Math.exp(median), within3, spearman: spearman(rows.map((r) => r.model_usd), rows.map((r) => r.mcap_usd)) };
  }

  function spearman(a, b) {
    const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = []; idx.forEach(([, i], k) => (r[i] = k)); return r; };
    const ra = rank(a), rb = rank(b), n = a.length;
    if (n < 3) return 0;
    const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0);
    return 1 - (6 * d2) / (n * (n * n - 1));
  }

  /** One pre-token protocol's implied value and the factors behind it. */
  function impliedValue(p, ctx) {
    const fam = familyOf(p.category);
    const a = intercept(ctx.fit, p.category || 'Uncategorised', fam);
    const comps = Math.exp(a + ctx.fit.e * Math.log(p.tvl_usd));
    const g = p.change_7d === null ? 0 : clamp(p.change_7d, PARAMS.growth_floor, PARAMS.growth_cap);
    const momentum = Math.pow(1 + g / 100, PARAMS.growth_power);
    const age = ageDays(ctx.asOf, p.listed_at);
    const runAge = age === null ? PARAMS.unknown_age_days : age;
    const runway = PARAMS.runway_start + (PARAMS.runway_end - PARAMS.runway_start) * Math.min(runAge, PARAMS.runway_days) / PARAMS.runway_days;
    const flags = [];
    let discount = 1;
    if (p.tvl_usd >= ctx.floor && !ctx.watch.has(p.slug)) { flags.push('child'); discount *= PARAMS.child_discount; }
    const sib = ctx.tokenFamilies[familyKey(p.slug)];
    if (sib && familyKey(p.slug).length >= 3) { flags.push('sibling'); discount *= PARAMS.sibling_discount; }
    const value = Math.max(1, Math.round(comps * momentum * runway * discount));
    const band = 0.6745 * (ctx.fit.sd[fam] || ctx.fit.sdAll); // the middle half of the family's misses
    return {
      family: fam, age_days: age, implied: value, low: Math.max(1, Math.round(value * Math.exp(-band))), high: Math.round(value * Math.exp(band)),
      factors: { multiple: comps / p.tvl_usd, comps: Math.round(comps), growth_pct: g, momentum, runway, discount, intercept: a },
      flags, sibling: sib || null,
    };
  }

  // ---- Farm plans: costs from the chain's fees, the protocol's size and age; never a list of names ----

  const GAS = { Ethereum: 2.5, Bitcoin: 1.5, Tron: 1.2, Solana: 0.01, Binance: 0.08, 'Hyperliquid L1': 0, Sui: 0.01, Aptos: 0.01, Stellar: 0.01, Algorand: 0.01, Ripple: 0.01, Cardano: 0.2, TON: 0.03, Near: 0.01 };
  const ROLLUPS = new Set(['Base', 'Arbitrum', 'Optimism', 'Ink', 'zkSync Era', 'Mantle', 'Linea', 'Scroll', 'Blast', 'Polygon', 'Unichain', 'Robinhood Chain', 'Sonic', 'Avalanche', 'Monad', 'Plasma', 'Berachain', 'Katana', 'Hyperliquid', 'Arc', 'Plume Mainnet', 'MegaETH', 'RISE', 'Flare', 'Sei', 'Mezo', 'BSquared', 'CORE']);
  const GAS_TOKEN = { Ethereum: 'ETH', Base: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Ink: 'ETH', Linea: 'ETH', Scroll: 'ETH', 'zkSync Era': 'ETH', Unichain: 'ETH', 'Robinhood Chain': 'ETH', Solana: 'SOL', Binance: 'BNB', Tron: 'TRX', Bitcoin: 'BTC', Sui: 'SUI', Stellar: 'XLM', Algorand: 'ALGO', Ripple: 'XRP', Avalanche: 'AVAX', Polygon: 'POL', Mantle: 'MNT', Monad: 'MON', Berachain: 'BERA', Flare: 'FLR', Plasma: 'XPL', Sonic: 'S', 'Hyperliquid L1': 'USDC (no gas)' };
  const gasOn = (chain) => (chain in GAS ? GAS[chain] : ROLLUPS.has(chain) ? 0.05 : 0.1);

  /** The chain to farm on: the cheapest of the first three it names. */
  function farmChain(p) {
    const list = p.chains.slice(0, 3);
    if (!list.length) return 'its main chain';
    return list.slice().sort((x, y) => gasOn(x) - gasOn(y) || list.indexOf(x) - list.indexOf(y))[0];
  }

  function bridgeTo(chain) {
    if (chain === 'Ethereum') return { fee: 0, minutes: 0, route: '' };
    if (chain === 'Bitcoin') return { fee: 3, minutes: 30, route: 'buying BTC on a venue you use and withdrawing on-chain' };
    if (ROLLUPS.has(chain)) return { fee: 1.5, minutes: 10, route: 'a canonical or intent bridge' };
    return { fee: 4, minutes: 20, route: 'a major cross-chain bridge or a direct exchange withdrawal' };
  }

  function money(n) {
    const a = Math.abs(n), s = n < 0 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e11 ? 0 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'k';
    if (a >= 10) return s + String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (a === 0) return '$0';
    return s + a.toFixed(2).replace(/\.00$/, '');
  }
  function span(min) {
    if (min >= 1440) { const d = Math.round(min / 1440); return d + (d === 1 ? ' day' : ' days'); }
    if (min >= 120) return Math.round(min / 60) + ' h';
    return Math.round(min) + ' min';
  }

  /** How a category is farmed: the core move, a second layer, and the weekly upkeep. */
  function playbook(p, cap, gas) {
    const n = p.name, c = p.category || '', A = money(cap);
    const lend = { core: [`Supply ${A} of USDC to ${n} as collateral.`, 2 * gas, 10], layer: [`Borrow 30% of it (${money(cap * 0.3)}) in ETH or a stablecoin and keep the health factor above 2: borrowers usually score more than suppliers.`, gas + cap * 0.3 * 0.06 / 4, 5, 'borrow interest at ~6% APR for a quarter'], weekly: ['repay and re-borrow a slice, or top up the supply', 2 * gas] };
    const vault = { core: [`Deposit ${A} into the largest stablecoin vault ${n} runs; choose the longest track record and lowest utilisation, not the top APY.`, 2 * gas, 10], layer: [`Move 20% (${money(cap * 0.2)}) into a second ${n} vault (ETH or BTC) so the wallet shows more than one strategy.`, 2 * gas, 10], weekly: ['claim or compound the vault rewards in one transaction', gas] };
    if (/Lending|Collateral|Uncollateralized/.test(c)) return lend;
    if (/CDP|Dual-Token/.test(c)) return { core: [`Lock ${A} of ETH or BTC in ${n} and mint its stablecoin at no more than 40% loan-to-value.`, 3 * gas, 15], layer: [`Put the minted stablecoin into ${n}'s savings or stability pool, so both sides of the protocol see the wallet.`, 2 * gas, 10], weekly: ['check the collateral ratio and add collateral if the loan-to-value passes 50%', gas] };
    if (/Basis|Stablecoin|CeDeFi/.test(c)) return { core: [`Mint ${A} of ${n}'s yield-bearing dollar with USDC (mint fee about 0.1%).`, 2 * gas + cap * 0.001, 10], layer: [`Put half into a DEX pool or lending market that lists it: protocols often count secondary use of their asset.`, 2 * gas, 10], weekly: ['check the peg and leave if it trades more than 1% under $1', 0] };
    if (c === 'Dexs') return { core: [`Add ${A} to ${n}'s deepest stable or major-pair pool with a wide range, so it stays in range without rebalancing.`, 3 * gas, 15], layer: [`Swap ${money(cap * 0.2)} through ${n} each way to register as a trader (about 0.3% in fees).`, 2 * gas + cap * 0.2 * 0.006, 5], weekly: [`swap ${money(cap * 0.25)} through a stable pair (fee near 0.05%)`, 2 * gas + cap * 0.25 * 0.001] };
    if (/Derivatives|Options|Perp/.test(c)) return { core: [`Deposit ${A} of USDC as margin on ${n}.`, 2 * gas, 10], layer: [`Open a 1x long on ${n} and an equal short where you already trade: the volume counts and the price risk cancels.`, gas + cap * 2 * 0.0005, 10, 'taker fees near 0.05% a side'], weekly: [`close and reopen the hedge (about ${money(cap * 2)} of volume)`, gas + cap * 2 * 0.0005 * 2] };
    if (c === 'Prediction Market') return { core: [`Fund ${A} on ${n} and keep it in its cash balance.`, gas, 10], layer: ['Place five $20 positions on liquid markets that settle within a month, near even odds.', 5 * gas + 2, 15, 'spread on $100 of positions'], weekly: ['place three small positions and redeem settled ones', 3 * gas + 1] };
    if (/RWA|Card|Payments/.test(c) && p.name !== 'Lightning Network') return { core: [`Finish ${n}'s onboarding (KYC if it asks; the review takes 1 to 3 days) and subscribe ${A} of its tokenised product.`, 2 * gas, 30, 'forms, then the subscription'], layer: [`Use a quarter of the token where ${n} lists an integration, a lending market or DEX pool.`, 2 * gas, 10], weekly: ['log the NAV and any distribution it pays', 0] };
    if (c === 'Chain') return { core: [`Bridge ${A} to ${n} through its canonical bridge and keep gas there.`, 2 * gas, 20], layer: [`In the first week use three of its biggest apps: one swap, one lending deposit, one mint.`, 6 * gas, 30], weekly: ['make three to five transactions across different apps', 4 * gas] };
    if (/Restaking|Staking|BTC/.test(c)) return { core: [`Stake or restake ${A} of the asset ${n} accepts (BTC or the chain's coin) and keep the receipt token.`, 2 * gas, 15], layer: ['Use the receipt token in one lending market or pool for a second layer of points.', 2 * gas, 10], weekly: ['check the operator set and claim accrued rewards', gas] };
    if (c === 'Insurance') return { core: [`Deposit ${A} into ${n}'s capital or cover pool.`, 2 * gas, 10], layer: [`Buy one small policy (about ${money(cap * 0.02)} of premium) to show as a buyer too.`, gas + cap * 0.02, 10], weekly: ['check the pool for claims and keep the deposit', 0] };
    if (p.name === 'Lightning Network') return { core: [`Open a channel of ${A} from a self-custodial Lightning wallet.`, 2 * gas, 30], layer: ['Route ten small payments through it to show it is used.', 0.1, 20], weekly: ['make a few payments and keep the channel open', 0.05] };
    return vault;
  }

  /** The plan: 7 steps, each an action with what it costs and how long it takes, plus its totals. */
  function farmPlan(p, iv) {
    const chain = farmChain(p), gas = gasOn(chain), br = bridgeTo(chain);
    let cap = p.tvl_usd >= 1e9 ? 2500 : p.tvl_usd >= 2.5e8 ? 1500 : p.tvl_usd >= 5e7 ? 1000 : p.tvl_usd >= 1.5e7 ? 500 : 250;
    if (iv.discount < 1) cap = Math.max(250, cap / 2);
    const age = iv.age_days;
    const hold = age === null ? 60 : age < 180 ? 120 : age < 365 ? 90 : age < 730 ? 60 : 45;
    const weeks = Math.round(hold / 7);
    const pb = playbook(p, cap, gas);
    const reserve = Math.max(1, Math.round(gas * 12));
    const tok = GAS_TOKEN[chain] || 'the chain\'s gas token';
    // Margin, a chain's gas float and prediction stakes sit idle; every other position earns its own yield.
    const earns = !/Derivatives|Options|Perp|Prediction|Chain/.test(p.category || '') && p.name !== 'Lightning Network';
    const opp = earns ? 0 : cap * PARAMS.capital_apr * hold / 365;
    const steps = [
      { k: 'Fund', text: `Fund a fresh wallet with ${money(cap)} of USDC on ${chain}${br.fee ? ' via ' + br.route : ''}, plus ${money(reserve)} of ${tok} for fees.`, cost: br.fee + gas, min: br.minutes + 5, note: br.fee ? 'bridge fee and one transfer' : 'one transfer' },
      { k: 'Test', text: `Run a $25 round trip on ${p.name} first: deposit, see it show, withdraw, and note any withdrawal delay or fee before sizing up.`, cost: 4 * gas, min: 20, note: 'four transactions' },
      { k: 'Enter', text: pb.core[0], cost: pb.core[1], min: pb.core[2], note: pb.core[3] || 'approvals and the deposit' },
      { k: 'Layer', text: pb.layer[0], cost: pb.layer[1], min: pb.layer[2], note: pb.layer[3] || 'fees' },
      { k: 'Repeat', text: `Once a week for ${weeks} weeks, ${pb.weekly[0]}.`, cost: weeks * pb.weekly[1], min: weeks * 10, note: `${money(pb.weekly[1])} a week` },
      { k: 'Hold', text: `Hold ${hold} days (${age === null ? 'age unknown' : age < 365 ? 'a young protocol counts activity over longer windows' : 'a mature protocol may snapshot sooner'}). Exit early if TVL falls under ${money(p.tvl_usd * 0.7)}, 30% below today's ${money(p.tvl_usd)}, or a week prints worse than -25%.`, cost: opp, min: hold * 1440, note: earns ? 'it keeps its own yield; the exit rule guards principal' : `${PARAMS.capital_apr * 100}% APR forgone on idle funds` },
      { k: 'Claim', text: `Check points only in ${p.name}'s own app and never sign a claim from a link sent to you. If ${PARAMS.community_share * 100}% of the implied value went pro-rata to today's TVL, this position would get about ${money(iv.implied * PARAMS.community_share * cap / p.tvl_usd)}.`, cost: 0, min: 10, note: 'free to check' },
    ];
    const cost = steps.reduce((s, x) => s + x.cost, 0);
    const drop = iv.implied * PARAMS.community_share * cap / p.tvl_usd;
    const active = steps.reduce((s, x) => s + (x.k === 'Hold' ? 0 : x.min), 0);
    return { chain, gas, capital: cap, hold_days: hold, steps, cost, drop, edge: drop / Math.max(1, cost), active_min: active };
  }

  const stepText = (s) => `${s.text} Cost: ${money(s.cost)} (${s.note}). Time: ${span(s.min)}.`;

  /** The whole radar from the snapshot: the ranked pre-token board, the trading set, and the fit. */
  function buildRadar(snap) {
    const fit = fitComparables(snap.protocols);
    const tokenFamilies = {};
    for (const p of snap.protocols) if (recordsToken(p)) tokenFamilies[familyKey(p.slug)] = tokenFamilies[familyKey(p.slug)] || p.symbol || p.name;
    const watch = new Set(snap.watchlist);
    const ctx = { fit, asOf: snap.as_of, floor: snap.floor_usd, watch, tokenFamilies };
    const scored = snap.protocols.filter((p) => isCandidate(p) || watch.has(p.slug)).map((p) => {
      const iv = impliedValue(p, ctx);
      const plan = farmPlan(p, { implied: iv.implied, age_days: iv.age_days, discount: iv.factors.discount });
      const scope = watch.has(p.slug) ? 'watchlist' : iv.flags.includes('child') ? 'child' : 'early';
      return { p, iv, plan, scope };
    });
    scored.sort((a, b) => b.iv.implied - a.iv.implied || bySlug(a.p, b.p));
    const rows = scored.map((s, i) => ({
      rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, family: s.iv.family, chains: s.p.chains,
      tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, listed_at: s.p.listed_at, age_days: s.iv.age_days,
      token_status: 'pre-token', scope: s.scope, flags: s.iv.flags, family_token: s.iv.sibling,
      implied_value_usd: s.iv.implied, value_low_usd: s.iv.low, value_high_usd: s.iv.high,
      model: { version: VERSION, comps_usd: s.iv.factors.comps, multiple: round(s.iv.factors.multiple, 4), growth_pct: round(s.iv.factors.growth_pct, 2), momentum: round(s.iv.factors.momentum, 4), runway: round(s.iv.factors.runway, 4), discount: s.iv.factors.discount },
      farm: { chain: s.plan.chain, capital_usd: s.plan.capital, hold_days: s.plan.hold_days, cost_usd: round(s.plan.cost, 2), drop_usd: round(s.plan.drop, 2), edge: round(s.plan.edge, 2), active_min: s.plan.active_min, steps: s.plan.steps.map((x) => ({ k: x.k, text: x.text, cost: round(x.cost, 2), note: x.note, min: x.min })) },
      farm_steps: s.plan.steps.map(stepText),
    }));
    // The naive rule, one flat TVL multiple per category (elasticity 1), priced the same way: the bar to beat.
    const naive = backtest(fitComparables(snap.protocols, 1));
    return { version: VERSION, params: PARAMS, as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd, protocols: snap.protocols.length, watchlist: snap.watchlist.slice(), rows, fit: summary(fit), backtest: backtest(fit), naive: { median_miss: naive.median_miss, within3: naive.within3, spearman: naive.spearman } };
  }

  function summary(fit) {
    const cats = Object.entries(fit.sums.cat).map(([cat, b]) => ({ category: cat, family: b.fam, n: b.n, multiple_at_100m: Math.exp(intercept(fit, cat, b.fam) + fit.e * Math.log(1e8)) / 1e8 }));
    cats.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
    const fams = Object.keys(FAMILIES).concat('Other').map((f) => ({ family: f, n: (fit.sums.fam[f] || { n: 0 }).n, multiple_at_100m: Math.exp(intercept(fit, '\u0000', f) + fit.e * Math.log(1e8)) / 1e8, sd: fit.sd[f] || fit.sdAll }));
    return { elasticity: fit.e, raw_elasticity: fit.rawE, n: fit.n, categories: cats, families: fams };
  }

  const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

  return { VERSION, PARAMS, FAMILIES, familyOf, isCandidate, ageDays, fitComparables, intercept, backtest, impliedValue, farmPlan, stepText, buildRadar, money, span };
});
