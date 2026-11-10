// Fetches ESPN and Sagarin, reads massey.tsv, runs the simulations and writes data.json.
// Usage: node build.mjs [sims]   Then: node assemble.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CFP = require('./engine.js');
import { SOURCES, canonical } from './ratings.mjs';

const SIMS = +process.argv[2] || 40000;
const SEASON = 2026;
const API = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const UA = { 'User-Agent': 'Mozilla/5.0' };
const j = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };

const weeks = [];
for (let w = 1; w <= 15; w++) weeks.push(await j(`${API}/scoreboard?groups=80&limit=400&week=${w}&seasontype=2&dates=${SEASON}`));
const rankings = await CFP.withCfp(await j(`${API}/rankings`), SEASON, j);
const standings = await j(`https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?group=80&season=${SEASON}&level=3`);
const parsed = CFP.parseEspn({ weeks, rankings, standings });

// ---------- Sagarin ----------
const sagTxt = (await (await fetch('http://sagarin.com/sports/cfsend.htm', { headers: UA })).text()).replace(/<[^>]+>/g, '');
const months = { JANUARY: '01', FEBRUARY: '02', MARCH: '03', APRIL: '04', MAY: '05', JUNE: '06', JULY: '07', AUGUST: '08', SEPTEMBER: '09', OCTOBER: '10', NOVEMBER: '11', DECEMBER: '12' };
const thruM = sagTxt.match(/through results of (\w+) (\d+)/i);
const sagThru = thruM ? `${SEASON}-${months[thruM[1].toUpperCase()]}-${thruM[2].padStart(2, '0')}` : null;
const hfaM = sagTxt.match(/HOME ADVANTAGE=\[\s*([\d.]+)\]/);
const sag = [];
for (const line of sagTxt.split('\n')) {
  const m = line.match(/^\s*(\d+)\s+(.+?)\s+([A-Z]{1,2})\s+=\s+([\d.]+)\s+(\d+)\s+(\d+)\s+([\d.]+)\(\s*(\d+)\).*?\|.*?\|\s+([\d.]+)\s+\d+\s+\|\s+([\d.]+)\s+\d+\s+\|\s+([\d.]+)\s+\d+\s+\|\s+([\d.]+)\s+\d+/);
  if (m) { const r = +m[1]; if (!sag.find((s) => s.name === m[2].trim())) sag.push({ name: m[2].trim(), rating: +m[4], predictor: +m[9], golden: +m[10], recent: +m[11], strong: +m[12], rank: r }); }
}

// ---------- Name matching ----------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/['’.()-]/g, ' ')
  .replace(/\bst\b/g, 'state').replace(/\s+/g, ' ').trim();
const ALIAS = {
  // ESPN location -> Massey and Sagarin spellings
  'miami': ['miami fl', 'miami florida'], 'miami (oh)': ['miami oh', 'miami ohio'], 'ole miss': ['mississippi', 'ole miss'],
  'ut san antonio': ['ut san antonio', 'utsa', 'texas san antonio'], 'utsa': ['ut san antonio', 'utsa'], 'south florida': ['south florida', 'usf'], 'central florida': ['ucf'],
  'florida atlantic': ['fl atlantic', 'florida atlantic'], 'florida international': ['florida intl', 'fiu', 'fla international'], 'fiu': ['florida intl', 'fiu', 'fla international'],
  'western michigan': ['w michigan', 'western michigan'], 'central michigan': ['c michigan', 'central michigan'], 'eastern michigan': ['e michigan', 'eastern michigan'], 'northern illinois': ['n illinois', 'northern illinois'],
  'north dakota state': ['n dakota state', 'north dakota state'], 'georgia southern': ['ga southern', 'georgia southern'], 'coastal carolina': ['coastal car', 'coastal carolina'],
  'western kentucky': ['wku', 'western kentucky'], 'middle tennessee': ['mtsu', 'middle tennessee', 'middle tennessee state'], 'louisiana monroe': ['ulm', 'louisiana monroe', 'ul monroe'], 'ul monroe': ['ulm', 'louisiana monroe'],
  'sacramento state': ['cs sacramento', 'sacramento state'], 'massachusetts': ['massachusetts', 'umass'], 'umass': ['massachusetts', 'umass'], 'uconn': ['connecticut', 'uconn'], 'connecticut': ['connecticut'],
  'kennesaw state': ['kennesaw', 'kennesaw state'], 'kent state': ['kent', 'kent state'], 'hawaii': ['hawaii'], 'hawai i': ['hawaii'], 'san jose state': ['san jose state'], 'nc state': ['nc state', 'north carolina state'],
  'sam houston': ['sam houston state', 'sam houston'], 'southern mississippi': ['southern miss'], 'southern miss': ['southern miss'], 'app state': ['appalachian state'], 'appalachian state': ['appalachian state'],
  'pittsburgh': ['pittsburgh', 'pitt'], 'pitt': ['pittsburgh'], 'louisiana': ['louisiana', 'louisiana lafayette'], 'southern california': ['usc'], 'california': ['california', 'cal'], 'smu': ['smu', 'southern methodist'], 'tcu': ['tcu'], 'byu': ['byu', 'brigham young'],
  'lsu': ['lsu'], 'ucla': ['ucla'], 'usc': ['usc', 'southern california'], 'ucf': ['ucf', 'central florida'], 'uab': ['uab'], 'unlv': ['unlv'], 'utep': ['utep'], 'army': ['army', 'army west point'],
  'liberty': ['liberty'], 'delaware': ['delaware'], 'missouri state': ['missouri state'], 'jacksonville state': ['jacksonville state'], 'florida state': ['florida state'],
  'texas state': ['texas state'], 'old dominion': ['old dominion'], 'james madison': ['james madison'], 'louisiana tech': ['louisiana tech'], 'new mexico state': ['new mexico state']
};
const masTxt = readFileSync(new URL('./massey.tsv', import.meta.url), 'utf8').split('\n');
const masThru = (masTxt[0].match(/thru (\S+)/) || [])[1];
const massey = {}, hfas = [];
masTxt.slice(1).filter(Boolean).forEach((l) => { const [nm, , pw, h] = l.split('|'); massey[norm(nm)] = +pw; hfas.push(+h); });
const sagBy = {};
sag.forEach((s) => {
  sagBy[norm(s.name)] = s;
  const paren = s.name.match(/^(.*?)\((.+)\)$/);
  if (paren) { sagBy[norm(paren[1])] = s; sagBy[norm(paren[2])] = s; }
});

function lookup(team, table) {
  const keys = [team.name, ...(ALIAS[norm(team.name)] || []), ...(ALIAS[team.name.toLowerCase()] || []), team.full.replace(/\s\S+$/, '')].map(norm);
  for (const k of keys) if (table[k] != null) return table[k];
  return null;
}
const misses = [];
parsed.teams.forEach((t, i) => {
  const mv = lookup(t, massey), sv = lookup(t, sagBy);
  t.r = { massey: mv, sagarin: sv ? sv.rating : null, predictor: sv ? sv.predictor : null, golden: sv ? sv.golden : null, recent: sv ? sv.recent : null, strong: sv ? sv.strong : null };
  if (i < parsed.fbs && (mv == null || sv == null)) misses.push(`${t.name} massey=${mv} sagarin=${sv ? sv.rating : null}`);
});
if (misses.length) { console.error('UNMATCHED FBS:\n' + misses.join('\n')); }

// Fit Sagarin -> Massey so FCS opponents and blends share one scale.
let sx = 0, sy = 0, sxx = 0, sxy = 0, N = 0;
parsed.teams.slice(0, parsed.fbs).forEach((t) => { if (t.r.massey != null && t.r.sagarin != null) { sx += t.r.sagarin; sy += t.r.massey; sxx += t.r.sagarin ** 2; sxy += t.r.sagarin * t.r.massey; N++; } });
const b = (N * sxy - sx * sy) / (N * sxx - sx * sx), a = (sy - b * sx) / N;
const align = (sx - sy) / N;
console.log(`rating fit massey = ${a.toFixed(2)} + ${b.toFixed(3)} * sagarin, mean offset ${align.toFixed(2)}, teams ${N}`);
parsed.teams.forEach((t, i) => {
  if (t.r.sagarin == null) { t.r.sagarin = 45; t.r.predictor = 45; t.r.golden = 45; t.r.recent = 45; t.r.strong = 45; }
  if (t.r.massey == null) t.r.massey = a + b * t.r.sagarin;
  void i;
});

// ---------- AP poll history ----------
// Every AP Top 25 of the season (preseason, then each week's poll until ESPN has no more), for the team panel's
// chart: ap.polls is the poll labels in order, ap.rank[ESPN team id] that team's rank in each (null = unranked).
const CORE = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${SEASON}`;
const apUrls = [[`${CORE}/types/1/weeks/1/rankings/1`, 'Pre']].concat(Array.from({ length: 15 }, (_, k) => [`${CORE}/types/2/weeks/${k + 2}/rankings/1`, String(k + 2)]));
const apPolls = (await Promise.all(apUrls.map(([u, label]) => j(u).then((x) => ({ label, x })).catch(() => null)))).filter((p) => p && p.x.ranks && p.x.ranks.length);
const ap = { polls: apPolls.map((p) => p.label), rank: {} };
apPolls.forEach((p, k) => p.x.ranks.forEach((r) => {
  const id = ((r.team && r.team.$ref) || '').match(/teams\/(\d+)/);
  if (!id) return;
  (ap.rank[id[1]] = ap.rank[id[1]] || new Array(apPolls.length).fill(null))[k] = r.current;
}));
console.log(`AP polls: ${ap.polls.join(' ')}, ${Object.keys(ap.rank).length} teams ranked at some point`);

const D = {
  ...parsed,
  season: SEASON,
  ap,
  asOf: new Date().toISOString(),
  sources: {
    massey: { thru: masThru }, sagarin: { thru: sagThru },
    hfa: { massey: +(hfas.reduce((x, y) => x + y, 0) / hfas.length).toFixed(2), sagarin: +hfaM[1], predictor: +hfaM[1], golden: +hfaM[1], recent: +hfaM[1], strong: +hfaM[1], blend: 2.5, all: 2.5 },
    align: +align.toFixed(3),
    thru: { massey: masThru, sagarin: sagThru, predictor: sagThru, golden: sagThru, recent: sagThru, strong: sagThru }
  }
};

// ---------- Extra models, all placed on Massey's scale ----------
const SAG = 'http://sagarin.com/sports/cfsend.htm';
const models = [
  { k: 'massey', label: 'Massey Power', group: 'Point-based', url: 'https://masseyratings.com/cf/fbs/ratings' },
  { k: 'fpi', label: 'ESPN FPI', group: 'Point-based', url: 'https://www.espn.com/college-football/fpi' }
];
const fbsTeams = D.teams.slice(0, D.fbs);
const stats = (v) => { const m = v.reduce((x, y) => x + y, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length) }; };
const corrWith = (idx, v) => { const a = idx.map((i) => D.teams[i].r.massey), sa = stats(a), sb = stats(v); return a.reduce((s, x, i) => s + (x - sa.m) * (v[i] - sb.m), 0) / (a.length * sa.sd * sb.sd); };
const fpiJson = await j(`https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=${SEASON}&limit=200&region=us&lang=en`);
CFP.applyFpi(D, fpiJson);
const nameIndex = new Map(fbsTeams.map((t, i) => [canonical(t.name), i]));
for (const s of SOURCES) {
  try {
    const { values, thru } = await s.load();
    const idx = [], raw = [];
    for (const [name, v] of Object.entries(values)) { const i = nameIndex.get(canonical(name)); if (i != null && !isNaN(v)) { idx.push(i); raw.push(v); } }
    const seen = new Set(idx);
    const missing = fbsTeams.filter((_, i) => !seen.has(i)).map((t) => t.name);
    if (idx.length < D.fbs - 8) { console.error(`SKIPPED ${s.label}: only ${idx.length} teams matched. Missing: ${missing.join(', ')}`); continue; }
    const ms = stats(idx.map((i) => D.teams[i].r.massey)), vs = stats(raw), slope = s.scale === 'fit' ? ms.sd / vs.sd : 1;
    D.teams.forEach((t) => { t.r[s.k] = null; });
    idx.forEach((i, n) => { D.teams[i].r[s.k] = +(ms.m + (raw[n] - vs.m) * slope).toFixed(2); });
    D.sources.thru[s.k] = thru;
    if (s.hfa) D.sources.hfa[s.k] = s.hfa;
    models.push({ k: s.k, label: s.label, group: s.group, url: s.url, average: !!s.average });
    console.log(`${s.label}: ${idx.length} teams, through ${thru}, correlation with Massey ${corrWith(idx, raw).toFixed(3)}, raw SD ${vs.sd.toFixed(2)}, Massey SD ${ms.sd.toFixed(2)}${missing.length ? ', missing ' + missing.join(', ') : ''}`);
  } catch (e) { console.error(`SKIPPED ${s.label}: ${e.message}`); }
}
models.push(
  { k: 'predictor', label: 'Sagarin Predictor', group: 'Point-based', url: SAG },
  { k: 'sagarin', label: 'Sagarin Rating', group: 'Point-based', url: SAG },
  { k: 'golden', label: 'Sagarin Golden Mean', group: 'Point-based', url: SAG },
  { k: 'recent', label: 'Sagarin Recent', group: 'Recent form', url: SAG },
  { k: 'strong', label: 'Sagarin Strong Recent', group: 'Recent form', url: SAG }
);
D.sources.models = models;
// One rating per source, so a source with several variants doesn't count more than once.
D.sources.consensus = ['massey', 'predictor', 'fpi'].concat(models.filter((m) => m.average).map((m) => m.k));
console.log('All models average uses:', D.sources.consensus.join(', '));

const results = {};
const T0 = (i) => D.teams[i].ab;
for (const mode of ['blend', 'all'].concat(models.map((m) => m.k))) {
  const t0 = Date.now();
  results[mode] = CFP.runAll(D, mode, SIMS, CFP.seedFor(mode), 1000);
  const field = results[mode].teams.reduce((s, x) => s + x.cfp, 0);
  const top = results[mode].teams.map((x, i) => [T0(i), x.cfp]).sort((p, q) => q[1] - p[1]).slice(0, 6).map((p) => `${p[0]} ${(p[1] * 100).toFixed(0)}`).join(', ');
  console.log(mode.padEnd(10), ((Date.now() - t0) / 1000).toFixed(1) + 's', 'field', field.toFixed(2), '|', top);
}
// Playoff impact for this week's and next week's games under the default ratings, measured here so the
// Scores page has its final order as soon as it loads. Same method and seed as the page (5,000 seasons).
{
  const t0 = Date.now(), now = Date.now();
  const started = D.games.filter((g) => g.wk != null && Date.parse(g.d) <= now).map((g) => g.wk);
  const wkNow = started.length ? Math.max(...started) : Math.min(...D.games.map((g) => g.wk || 99));
  let n = 0;
  for (const wk of [wkNow, wkNow + 1]) {
    const ids = D.games.filter((g) => g.wk === wk && (g.h < D.fbs || g.a < D.fbs)).map((g) => g.id);
    if (!ids.length) continue;
    const sw = CFP.measureSwings(D, 'blend', CFP.seedFor('blend'), 5000, ids);
    D.games.forEach((g) => { if (sw[g.id] != null) { g.sw = sw[g.id]; g.swS = g.s; n++; } });
  }
  D.swMode = 'blend';
  console.log('playoff impact measured for', n, 'games in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify({ D, results }));
const R = results.massey, T = D.teams;
const rows = R.teams.map((x, i) => ({ i, ...x })).sort((p, q) => q.cfp - p.cfp).slice(0, 34);
console.log('team rank | cfp next bye champ title seed');
rows.forEach((x) => console.log(T[x.i].ab.padEnd(5), String(T[x.i].rank || '-').padStart(3), (x.cfp * 100).toFixed(1).padStart(6), (x.ifNext * 100).toFixed(1).padStart(6), (x.bye * 100).toFixed(1).padStart(6), (x.champ * 100).toFixed(1).padStart(6), (x.title * 100).toFixed(1).padStart(6), x.seed ? x.seed.toFixed(1) : '-'));
const sum = R.teams.reduce((s, x) => s + x.cfp, 0);
console.log('field total', sum.toFixed(2), 'games', D.games.length, 'played', D.games.filter((g) => g.s === 'post').length, 'titles', D.titles.length, 'fbs', D.fbs, 'total teams', T.length, 'sag', sag.length);
void existsSync;
