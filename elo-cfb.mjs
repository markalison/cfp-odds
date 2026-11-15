// Builds cfb-elo.json, every major-college team's Elo rating after each game since 1869, for the History tab.
// Past seasons come from cfb-elo-games.json (see elo-seed-cfb.mjs); the current season from data.js.
// Usage: node elo-cfb.mjs          (after build.mjs + assemble.mjs, which write data.js)
//        node elo-cfb.mjs --tune   (prints how well each setting predicted past games)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// The method, in the style of FiveThirtyEight's NFL Elo:
//  - every team has a rating; an average FBS team is 1500
//  - the home team gets HFA points; the favourite's win chance is 1 / (1 + 10^(-diff / 400))
//  - after a game the winner takes K x (margin multiplier) x (how unexpected the result was) from the loser;
//    the multiplier grows with the log of the margin and shrinks when the favourite was the one who won big
//  - between seasons each rating moves REVERT of the way back to the average of its own level
export const P = { k: 35, hfa: 55, revert: 0.25, base: 1500, lower: 1250 };

const cache = JSON.parse(readFileSync(new URL('./cfb-elo-games.json', import.meta.url), 'utf8'));
global.window = {};
require('./data.js');
const D = global.window.CFP_DATA.D;

// Seasons in order: the cached ones, then the current one from the regular build.
const seasons = Object.keys(cache.seasons).map(Number).filter((y) => y < D.season).sort((a, b) => a - b)
  .map((y) => ({ y, games: cache.seasons[y] }));
seasons.push({ y: D.season, games: D.games.filter((g) => g.s === 'post' && g.hs != null && g.as != null)
  .map((g) => [g.d.slice(0, 10), +D.teams[g.h].id, +D.teams[g.a].id, g.hs, g.as, g.n ? 1 : 0, 0, 0, '', g.h < D.fbs ? 1 : 0, g.a < D.fbs ? 1 : 0])
  .sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)) });
const meta = { ...cache.teams };
D.teams.forEach((t) => { meta[t.id] = { n: t.name, ab: t.ab, c: t.color || (meta[t.id] && meta[t.id].c) || null }; });

// The major-college (FBS and its forerunners) teams of a season, from each game's own classification.
function fbsIn(s) {
  const set = new Set();
  s.games.forEach((g) => { if (g[9]) set.add(g[1]); if (g[10]) set.add(g[2]); });
  return set;
}

// Runs the whole history. onGame(season, game, homeBefore, awayBefore, homeAfter, awayAfter, pHome).
export function run(p, onGame, onSeason) {
  const R = {};
  let prevFbs = null;
  for (const s of seasons) {
    const fbs = fbsIn(s, p);
    const ids = new Set(); s.games.forEach((g) => { ids.add(g[1]); ids.add(g[2]); });
    for (const id of ids) {
      const level = fbs.has(id) ? p.base : p.lower;
      if (R[id] == null) R[id] = level;
      else R[id] += (level - R[id]) * p.revert;
    }
    // A rating also reverts for a team that sat out the scoreboard for a year: handled above on its return.
    if (onSeason) onSeason(s, fbs, R);
    for (const g of s.games) {
      const [, h, a, hs, as, neutral] = g;
      const diff = R[h] - R[a] + (neutral ? 0 : p.hfa), ph = 1 / (1 + Math.pow(10, -diff / 400));
      const res = hs > as ? 1 : hs < as ? 0 : 0.5, margin = Math.abs(hs - as);
      const winDiff = res === 1 ? diff : res === 0 ? -diff : 0;
      const mult = Math.log(margin + 1) * 2.2 / (winDiff * 0.001 + 2.2);
      const d = p.k * mult * (res - ph), hb = R[h], ab = R[a];
      R[h] += d; R[a] -= d;
      if (onGame) onGame(s, g, hb, ab, R[h], R[a], ph, fbs);
    }
    prevFbs = fbs;
  }
  return R;
}

if (process.argv.includes('--tune')) {
  // Log loss and accuracy on FBS-vs-FBS games from 2005 on (the first seasons only settle the ratings).
  const rows = [];
  for (const k of [20, 25, 30, 35, 40]) for (const hfa of [45, 55, 65, 75]) for (const revert of [0.25, 0.35, 0.45, 0.55]) {
    const p = { ...P, k, hfa, revert };
    let ll = 0, n = 0, hit = 0;
    run(p, (s, g, hb, ab, ha, aa, ph, fbs) => {
      if (s.y < 2005 || !fbs.has(g[1]) || !fbs.has(g[2]) || g[3] === g[4]) return;
      const won = g[3] > g[4]; ll -= Math.log(won ? ph : 1 - ph); n++; if ((ph > 0.5) === won) hit++;
    });
    rows.push({ k, hfa, revert, ll: ll / n, acc: hit / n, n });
  }
  rows.sort((a, b) => a.ll - b.ll);
  rows.slice(0, 8).forEach((r) => console.log(`k ${r.k} hfa ${r.hfa} revert ${r.revert}  log loss ${r.ll.toFixed(4)}  picked ${(r.acc * 100).toFixed(1)}%  (${r.n} games)`));
  const cur = rows.find((r) => r.k === P.k && r.hfa === P.hfa && r.revert === P.revert);
  if (cur) console.log('current setting:', cur.ll.toFixed(4), (cur.acc * 100).toFixed(1) + '%');
  process.exit(0);
}

// ---------- the files for the page ----------
// cfb-elo.json: every team's rating after each game, packed small (days as steps from the one before).
// elo/cfb/<id>.json: one team's games (opponent, score, site), fetched when that team is chosen.
const DAY0 = Date.UTC(1869, 0, 1);
const day = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - DAY0) / 86400000);
const everFbs = new Set();
seasons.forEach((s) => fbsIn(s).forEach((id) => everFbs.add(id)));
const list = [...everFbs].filter((id) => meta[id]).sort((a, b) => meta[a].n.localeCompare(meta[b].n));
const at = new Map(list.map((id, i) => [id, i]));
const curFbs = fbsIn(seasons[seasons.length - 1]);
// Per team: d = day of each point, e = rating, s = index of each season's first point (its starting rating),
// y = that season's year. detail = the games behind the points (null for a season's starting point).
const teams = list.map((id) => ({ id: String(id), n: meta[id].n, ab: meta[id].ab, c: meta[id].c, now: curFbs.has(id) ? 1 : 0, d: [], e: [], s: [], y: [] }));
const detail = list.map(() => []);
// The carried rating each season a team was NOT at the top level, for the dashed FCS bridge.
const bridgeRaw = list.map(() => []);
const name = (id) => (meta[id] ? meta[id].n : 'Unknown');

// National champions: the title game's winner where one is marked; before that, and where it isn't, the
// Associated Press's final No. 1 (from 1936).
const AP = { 1936: 'Minnesota', 1937: 'Pittsburgh', 1938: 'TCU', 1939: 'Texas A&M', 1940: 'Minnesota', 1941: 'Minnesota', 1942: 'Ohio State', 1943: 'Notre Dame', 1944: 'Army', 1945: 'Army',
  1946: 'Notre Dame', 1947: 'Notre Dame', 1948: 'Michigan', 1949: 'Notre Dame', 1950: 'Oklahoma', 1951: 'Tennessee', 1952: 'Michigan State', 1953: 'Maryland', 1954: 'Ohio State', 1955: 'Oklahoma',
  1956: 'Oklahoma', 1957: 'Auburn', 1958: 'LSU', 1959: 'Syracuse', 1960: 'Minnesota', 1961: 'Alabama', 1962: 'USC', 1963: 'Texas', 1964: 'Alabama', 1965: 'Alabama', 1966: 'Notre Dame', 1967: 'USC',
  1968: 'Ohio State', 1969: 'Texas', 1970: 'Nebraska', 1971: 'Nebraska', 1972: 'USC', 1973: 'Notre Dame', 1974: 'Oklahoma', 1975: 'Oklahoma', 1976: 'Pittsburgh', 1977: 'Notre Dame', 1978: 'Alabama',
  1979: 'Alabama', 1980: 'Georgia', 1981: 'Clemson', 1982: 'Penn State', 1983: 'Miami', 1984: 'BYU', 1985: 'Oklahoma', 1986: 'Penn State', 1987: 'Miami', 1988: 'Notre Dame', 1989: 'Miami',
  1990: 'Colorado', 1991: 'Miami', 1992: 'Alabama', 1993: 'Florida State', 1994: 'Nebraska', 1995: 'Nebraska', 1996: 'Florida', 1997: 'Michigan', 1998: 'Tennessee', 1999: 'Florida State',
  2000: 'Oklahoma', 2001: 'Miami', 2002: 'Ohio State', 2003: 'USC', 2004: 'USC', 2005: 'Texas', 2007: 'LSU' };
const byName = new Map(teams.map((t, i) => [t.n, i]));
const champs = {};
for (const y in AP) { if (!byName.has(AP[y])) throw new Error('champion not found: ' + AP[y]); champs[y] = byName.get(AP[y]); }

const push = (i, d, e, row, yr) => { const t = teams[i]; if (yr != null) { t.s.push(t.d.length); t.y.push(yr); } t.d.push(d); t.e.push(Math.round(e)); detail[i].push(row); };
// Detail rows: [opponent, points for, points against, site (0 home, 1 away, 2 neutral), postseason note or 0]
// A team's line covers only its seasons at the top level (its rating still carries over the years between).
run(P, (s, g, hb, ab, ha, aa, ph, fbs) => {
  const [d, h, a, hs, as, neutral, post, title, note] = g;
  if (at.has(h) && fbs.has(h)) push(at.get(h), day(d), ha, [name(a), hs, as, neutral ? 2 : 0, post ? note || 'Postseason' : 0]);
  if (at.has(a) && fbs.has(a)) push(at.get(a), day(d), aa, [name(h), as, hs, neutral ? 2 : 1, post ? note || 'Postseason' : 0]);
  if (title) champs[s.y] = at.get(hs > as ? h : a);
}, (s, fbs, R) => {
  const d0 = day(s.y + '-08-15');
  fbs.forEach((id) => { if (at.has(id)) push(at.get(id), d0, R[id], null, s.y); });
  list.forEach((id) => { if (!fbs.has(id) && R[id] != null) bridgeRaw[at.get(id)].push([s.y, Math.round(R[id])]); });
});
// A team's years between top-level stints: its carried rating, for the dashed bridge on the chart.
teams.forEach((t, i) => { if (!t.y.length) return; const a = t.y[0], z = t.y[t.y.length - 1], have = new Set(t.y); const br = bridgeRaw[i].filter(([y]) => y >= 1978 && y > a && y < z && !have.has(y)); if (br.length) t.br = br; });
// Days as steps from the previous point keeps the file small.
teams.forEach((t) => { let prev = 0; t.d = t.d.map((d) => { const step = d - prev; prev = d; return step; }); });
const out = { asOf: D.asOf, first: seasons[0].y, last: D.season, day0: '1869-01-01', p: { k: P.k, hfa: P.hfa, revert: P.revert }, champs, teams };
writeFileSync(new URL('./cfb-elo.json', import.meta.url), JSON.stringify(out));
mkdirSync(new URL('./elo/cfb/', import.meta.url), { recursive: true });
// Each team file: g = its games (one per rating point), c = its head coaches as [name, first season, last season].
const coachFile = new URL('./cfb-coaches.json', import.meta.url);
const coaches = existsSync(coachFile) ? JSON.parse(readFileSync(coachFile, 'utf8')) : {};
// National championships by selector (see elo-seed-champs.mjs): t = [[season, [selectors]], ...] in each team
// file; in the main file, w = the seasons a major selector (AP, coaches, FWAA, NFF, BCS, CFP) named the team,
// which the chart marks.
const champFile = new URL('./cfb-champs.json', import.meta.url);
const champData = existsSync(champFile) ? JSON.parse(readFileSync(champFile, 'utf8')) : {};
const MAJOR = /^(AP|UP|UPI|USAT|FWAA|NFF|BCS|CFP)(\/|$)/;
teams.forEach((t) => { t.w = (champData[t.id] || []).filter((x) => x[2].some((s) => MAJOR.test(s))).map((x) => x[0]); });
writeFileSync(new URL('./cfb-elo.json', import.meta.url), JSON.stringify(out));
teams.forEach((t, i) => writeFileSync(new URL('./elo/cfb/' + t.id + '.json', import.meta.url), JSON.stringify({ g: detail[i], c: coaches[t.id] || [], t: (champData[t.id] || []).map((x) => [x[0], x[2]]) })));
const last = (t) => t.e[t.e.length - 1];
const top = teams.filter((t) => t.now).sort((a, b) => last(b) - last(a)).slice(0, 8);
let peak = { e: 0 };
teams.forEach((t) => t.e.forEach((e, k) => { if (e > peak.e) peak = { e, n: t.n, k, t }; }));
console.log('cfb-elo.json:', teams.length, 'teams,', teams.reduce((n, t) => n + t.e.length, 0), 'points,', (JSON.stringify(out).length / 1024).toFixed(0), 'KB;', teams.filter((t) => t.now).length, 'current');
console.log('top now:', top.map((t) => t.n + ' ' + last(t)).join(', '));
console.log('highest ever:', peak.n, peak.e);
console.log('champions marked:', Object.keys(champs).length, '(', Object.keys(champs)[0], 'to', Object.keys(champs).pop(), ')');
