// Token Radar: a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot (/input/snapshot.json, or --input <file|dir>), runs the model in
// dashboard/model.js, the same file the page runs, and writes to /output (or MAKEFUN_OUTPUT_DIR):
//   board.json    every pre-token candidate ranked by implied value, each with a 7-step farm plan
//   data.js       the snapshot as a script, read by the page beside it (no network, no fetch)
//   dashboard/    the static page, copied from this repository
//   screenshots/  the three captures, copied from this repository
//   dossier.json  what the judge reads, written last by vendor/makefun-board.ts
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const model = createRequire(import.meta.url)('./dashboard/model.js');

const FIELDS = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'] as const;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

interface Protocol { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null }
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }

/** The snapshot, checked for the shape the model reads, with only its ten fields per protocol. */
function readSnapshot(file: string): Snapshot {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) fail(`${file} is not a token-radar snapshot`);
  const protocols: Protocol[] = raw.protocols
    .filter((p: any) => p && typeof p.slug === 'string' && typeof p.name === 'string' && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0)
    .map((p: any) => {
      const o: any = {};
      for (const f of FIELDS) o[f] = p[f] === undefined ? null : p[f];
      if (!Array.isArray(o.chains)) o.chains = [];
      if (!Number.isFinite(o.change_7d)) o.change_7d = null;
      if (!Number.isFinite(o.mcap_usd)) o.mcap_usd = null;
      return o as Protocol;
    });
  return { as_of: String(raw.as_of), source: String(raw.source ?? ''), floor_usd: Number(raw.floor_usd) || 50_000_000, protocols, watchlist: raw.watchlist.filter((s: unknown) => typeof s === 'string') };
}

/** The gate's board rows, checked here before anything is written: a refused board never leaves. */
function boardIssue(rows: any[], snap: Snapshot): string | null {
  const known = new Set(snap.protocols.map((p) => p.slug));
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (!known.has(r.slug) || seen.has(r.slug)) return `slug ${r.slug} unknown or repeated`;
    seen.add(r.slug);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `${r.slug}: implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) return `${r.slug}: value rises with rank`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug}: a ${s.trim().length}-character step`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  return missing.length ? `watchlist not covered: ${missing.join(', ')}` : null;
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !statSync(join(from, name)).isFile()) continue;
    copyFileSync(join(from, name), join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = readSnapshot(inputFile);
const radar = model.buildRadar(snap);
const issue = boardIssue(radar.rows, snap);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
const board = { model: radar.version, as_of: radar.as_of, source: radar.source, value_rule: 'implied_value_usd = comps(TVL, category) x momentum(7d) x runway(days with no token) x family discount', fit: radar.fit, backtest: { median_miss: radar.backtest.median_miss, within3: radar.backtest.within3, spearman: radar.backtest.spearman, n: radar.backtest.rows.length }, rows: radar.rows };
writeFileSync(join(out, 'board.json'), `${JSON.stringify(board)}\n`);
writeFileSync(join(out, 'data.js'), `/* The sealed snapshot (${snap.as_of}), written by main.ts for the page. */\nwindow.SNAPSHOT = ${JSON.stringify(snap)};\n`);

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -`);

// Last: the scorer rebuilds the dossier from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const wl = radar.rows.filter((r: any) => r.scope === 'watchlist').length;
process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${radar.rows.length} pre-token rows ranked (${wl}/${snap.watchlist.length} watchlist), comps fit on ${radar.fit.n} trading tokens (elasticity ${radar.fit.elasticity.toFixed(3)}, median miss x${radar.backtest.median_miss.toFixed(2)})\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pages.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
