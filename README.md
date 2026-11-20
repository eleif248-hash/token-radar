# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/eleif248-hash/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/eleif248-hash/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed DefiLlama snapshot and ranks the 198 protocols that record no token (and are not a wrapped, staked or bridged product, a versioned pool or an exchange) by what their launch would be worth. Every protocol gets a costed seven-step farm plan, and the whole thing ships as a static dashboard that needs no network.

**The value model** (`dashboard/model.js`, run by both `main.ts` and the page):

```
implied value = comps(TVL, category) x momentum(7d) x runway(days with no token) x family discount
```

- **comps** is fitted on the snapshot's own 119 protocols whose token trades. The fit is log market cap = a[category] + e x log TVL. The size elasticity e is pooled within six families (it lands at 0.51). Each category's intercept is shrunk toward its family, and each family's toward the whole set.
- **momentum** is (1 + 7-day TVL change)^0.5, with the change clamped to -50%..+100%.
- **runway** rises from 0.75 at day 0 to 1.15 after two years tracked with no token.
- **discount** is x0.5 for a child listing (above the floor but off the watchlist, so DefiLlama names a parent) and x0.4 when a protocol in the same slug family already trades a token.
- **backtest**: each trading token is priced by the other 118 (leave-one-out). The median miss is x3.28; a flat mcap/TVL multiple per category misses by x4.60.

**The dashboard** has three views:
- **Board**: sortable columns; filters by search, family, chain, TVL floor, scope, rising 7d and drop-vs-cost; an implied-value range bar on every row.
- **Detail** for every protocol: a value waterfall, the trading comparables, and the farm plan with each step's cost and time.
- **Already trading** and **Method**: the backtest scatter and the family multiples.

The view state lives in the URL hash.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
# then open out/dashboard/index.html
```

Node 22.18 or later, standard library only. The outputs are `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.

Implied values are this radar's own estimate from the snapshot's figures, not a forecast that a token will launch. DefiLlama recording no token does not mean none exists.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
