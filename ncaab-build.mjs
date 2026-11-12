// Builds the men's college basketball odds: fetches Division I teams and conferences, every day's games
// (D-I against anyone), and the ratings models, simulates the season and the NCAA tournament for each model
// and writes ncaab-data.json. Usage: node ncaab-build.mjs [sims]
import { writeFileSync } from 'node:fs';
import { byDate, centered, REGRESS, priorFit, loadSnaps, addSnap } from './hist.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('./ncaab-engine.js');

const SIMS = +process.argv[2] || 20000;
// ESPN names a season by the year it ends: the 2026-27 season is 2027.
const now = new Date(), SEASON = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
// Major national networks only (as on the other score pages).
const NATIONAL = ['ESPN', 'ESPN2', 'ESPNU', 'ABC', 'CBS', 'FOX', 'Fox', 'FS1', 'TNT', 'truTV', 'TBS', 'NBC', 'Peacock', 'Prime Video', 'BTN', 'SEC Network', 'SECN', 'ACC Network', 'ACCN', 'CBSSN', 'USA Net', 'CW', 'The CW'];
function networks(list) {
  const name = (b) => (b.media && b.media.shortName) || (b.names && b.names[0]) || '';
  return [...new Set(list.flatMap((b) => (b.names && b.names.length ? b.names : [name(b)])).filter((n) => NATIONAL.includes(n)))].slice(0, 2);
}

async function get(url) {
  for (let tries = 1; ; tries++) {
    try { const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return await r.json(); }
    catch (e) { if (tries >= 3) throw e; await new Promise((ok) => setTimeout(ok, 800 * tries)); }
  }
}
async function text(url) { const r = await fetch(url, { headers: { 'user-agent': 'cfp-odds-board' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); }
const center = (arr) => { const m = arr.reduce((s, v) => s + v, 0) / arr.length; return arr.map((v) => v - m); };

// ---------- Teams and conferences (ESPN standings) ----------
const sj = await get(`https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?group=50&season=${SEASON}`);
const confs = [], teams = [];
for (const c of sj.children) {
  const k = String(c.abbreviation || c.name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const short = c.name.replace(/ (Conference|League|Athletic Association)$/i, '').replace(/^The /, '');
  confs.push({ k, name: c.name, short });
  for (const e of c.standings.entries || []) {
    const t = e.team, logo = (rel) => ((t.logos || []).find((l) => rel.every((r) => l.rel.includes(r)) && l.rel.length === rel.length) || {}).href;
    teams.push({ espn: t.id, ab: t.abbreviation, name: t.location, full: t.displayName, short: t.shortDisplayName, nick: t.name, conf: k,
      logo: logo(['full', 'default']) || (t.logos && t.logos[0] && t.logos[0].href), logoDark: logo(['full', 'dark']) });
  }
}
teams.sort((a, b) => a.conf.localeCompare(b.conf) || a.name.localeCompare(b.name));
const nD1 = teams.length;
if (nD1 < 340) throw new Error('Only ' + nD1 + ' D-I teams');
const idx = {};
teams.forEach((t, i) => { idx[t.espn] = i; });

// ---------- Every day's games, November to the end of the regular season ----------
const dates = [];
for (let d = new Date(`${SEASON - 1}-11-01T12:00Z`); d <= new Date(`${SEASON}-03-16T12:00Z`); d = new Date(+d + 864e5)) dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
const games = new Map(), apSeen = {};
let di = 0;
async function dayWorker() {
  while (di < dates.length) {
    const d = dates[di++], sb = await get(`${SITE}/scoreboard?dates=${d}&groups=50&limit=500`);
    for (const e of sb.events || []) {
      const c = e.competitions[0], st = c.status || e.status;
      if (/CANCEL|POSTPONE|FORFEIT/.test(st.type.name)) continue;
      // Conference tournaments (and anything after them) are simulated, not read: skip March tournament games.
      const note = (c.notes || []).map((x) => x.headline).join(' ');
      if (d >= `${SEASON}0301` && /tournament|championship/i.test(note)) continue;
      if (e.season && e.season.type === 3) continue;
      const h = c.competitors.find((x) => x.homeAway === 'home'), a = c.competitors.find((x) => x.homeAway === 'away');
      if (!h || !a) continue;
      for (const x of [h, a]) {
        if (idx[x.team.id] != null) continue;
        idx[x.team.id] = teams.length;
        teams.push({ espn: x.team.id, ab: x.team.abbreviation, name: x.team.location || x.team.shortDisplayName, full: x.team.displayName, short: x.team.shortDisplayName, nonD1: true, logo: x.team.logo || null });
      }
      if (idx[h.team.id] >= nD1 && idx[a.team.id] >= nD1) continue;
      // AP poll rank, from the game nearest to today (ESPN shows each team's current rank on its games).
      for (const x of [h, a]) {
        const r = x.curatedRank && x.curatedRank.current, gap = Math.abs(Date.parse(e.date) - Date.now()), i = idx[x.team.id];
        if (i < nD1 && (!apSeen[i] || gap < apSeen[i].gap)) apSeen[i] = { gap, r: r >= 1 && r <= 25 ? r : null };
      }
      const done = st.type.completed;
      const sc = (x) => +(x.score && (x.score.value != null ? x.score.value : x.score)) || 0;
      const g = { id: e.id, d: e.date, h: idx[h.team.id], a: idx[a.team.id], s: done ? 'post' : st.type.state === 'in' ? 'in' : 'pre' };
      if (c.neutralSite) g.n = 1;
      if (c.conferenceCompetition) g.c = 1;
      if (done) { g.hs = sc(h); g.as = sc(a); if (g.hs === g.as) continue; }
      const tv = networks(c.broadcasts || []);
      if (tv.length) g.tv = tv;
      games.set(e.id, g);
    }
  }
}
await Promise.all([1, 2, 3, 4, 5, 6].map(dayWorker));
for (let i = 0; i < nD1; i++) if (apSeen[i] && apSeen[i].r) teams[i].rank = apSeen[i].r;
const G = [...games.values()].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.id < y.id ? -1 : 1));
if (G.length < 4000) throw new Error('Only ' + G.length + ' games found');

// ---------- Ratings ----------
const sources = {};
// Names from other sites matched to ESPN's. Both sides are normalized: accents and punctuation dropped,
// "State", "St." and "Saint" all as "st", and other sites' short forms spelled out ("N Texas", "Coastal Car").
const WORDS = { n: 'north', s: 'south', e: 'east', w: 'west', nw: 'northwestern', se: 'southeastern', mt: 'mount', tenn: 'tennessee', car: 'carolina',
  so: 'southern', intl: 'international', abl: 'abilene', chi: 'chicago', mymt: 'marymount', edward: 'edwardsville', cs: 'cal state', f: 'fairleigh',
  j: 'james', ga: 'georgia', fla: 'florida', ky: 'kentucky', mich: 'michigan', ill: 'illinois', wash: 'washington', miss: 'mississippi', ala: 'alabama',
  ark: 'arkansas', okla: 'oklahoma', colo: 'colorado', conn: 'connecticut', u: 'u', chrstn: 'christian', mass: 'massachusetts', ind: 'indiana' };
const norm = (s, expand) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/'/g, '').toLowerCase()
  .replace(/[a-z]+/g, (w) => (expand && WORDS[w] ? WORDS[w] : w))
  .replace(/\bstate\b|\bsaint\b|\bst\b\.?/g, 'st').replace(/\buniversity\b|\bof\b|\bthe\b/g, ' ').replace(/[^a-z0-9]/g, '');
// Remaining differences, other site's name (normalized) to ESPN's (normalized).
const ALIAS = {
  connecticut: 'uconn', mississippi: 'olemiss', illinoischicago: 'uic', samhoustonst: 'samhouston', appalachianst: 'appst', neworleans: 'lsuneworleans',
  southeasternlouisiana: 'selouisiana', tennesseemartin: 'utmartin', gramblingst: 'grambling', texasamcorpuschris: 'texasamcorpuschristi', texasamcorpuschristi: 'texasamcorpuschristi',
  floridainternational: 'floridainternational', fiu: 'floridainternational', siuedwardsville: 'siuedwardsville', southillinoisedwardsville: 'siuedwardsville',
  loyolachicago: 'loyolachicago', loyolamarymount: 'loyolamarymount', loyolamd: 'loyolamaryland', mountstmarys: 'mountstmarys', hawaii: 'hawaii',
  calstnorthridge: 'calstnorthridge', csunorthridge: 'calstnorthridge', calstbakersfield: 'calstbakersfield', calstfullerton: 'calstfullerton',
  arkansaspinebluff: 'arkansaspinebluff', arkpinebluff: 'arkansaspinebluff', utrgv: 'utriograndevalley', texasriograndevalley: 'utriograndevalley', utriograndevalley: 'utriograndevalley',
  albany: 'ualbany', albanyny: 'ualbany', stephenfaustin: 'stephenfaustin', sfaustin: 'stephenfaustin', centralconnecticutst: 'centralconnecticut', centralconnst: 'centralconnecticut',
  detroit: 'detroitmercy', miamifl: 'miami', miamiflorida: 'miami', miamioh: 'miamioh', miamiohio: 'miamioh', queens: 'queensuniversity', queensnc: 'queensuniversity',
  liu: 'longisland', liubrooklyn: 'longisland', iupui: 'iuindianapolis', iuindy: 'iuindianapolis', umkc: 'kansascity', missourikc: 'kansascity',
  nebraskaomaha: 'omaha', purduefw: 'purduefortwayne', fortwayne: 'purduefortwayne', stthomasmn: 'stthomas', stthomasminnesota: 'stthomas', nicholls: 'nicholls', nichollsst: 'nicholls', mcneesest: 'mcneese',
  marylandeasternshore: 'marylandeasternshore', mdeasternshore: 'marylandeasternshore', bethunecookman: 'bethunecookman', prairieview: 'prairieviewam', ualittlerock: 'littlerock', arkansaslittlerock: 'littlerock',
  southernmississippi: 'southernmiss', collegecharleston: 'charleston', charlestonsc: 'charleston', gardnerwebb: 'gardnerwebb', stfrancispa: 'stfrancis', stfrancispennsylvania: 'stfrancis',
  texasamcommerce: 'easttexasam', etexasam: 'easttexasam', calbaptist: 'californiabaptist', usc: 'usc', southerncalifornia: 'usc', southernmethodist: 'smu', brighamyoung: 'byu', texaschristian: 'tcu',
  louisianast: 'lsu', centralflorida: 'ucf', virginiacommonwealth: 'vcu', nevadalasvegas: 'unlv', texaselpaso: 'utep', texassanantonio: 'utsa', alabamabirmingham: 'uab', pittsburgh: 'pittsburgh',
  ncst: 'ncst', northcarolinast: 'ncst', massachusettslowell: 'umasslowell', ulmonroe: 'ulmonroe', louisianamonroe: 'ulmonroe', louisianalafayette: 'louisiana', marylandbaltimorecounty: 'umbc',
  tarletonst: 'tarletonst', utahtech: 'utahtech', seattle: 'seattleu', abilenechristian: 'abilenechristian', middletennessee: 'middletennessee', middletennesseest: 'middletennessee',
  northwesternst: 'northwesternst', westgeorgia: 'westgeorgia', southcarolinast: 'southcarolinast', texassouthern: 'texassouthern', fairleighdickinson: 'fairleighdickinson', saintmarys: 'stmarys',
  southcarolinaupstate: 'southcarolinaupstate', uscupstate: 'southcarolinaupstate', ncgreensboro: 'uncgreensboro', ncwilmington: 'uncwilmington', ncasheville: 'uncasheville', ncat: 'northcarolinaat', ncatst: 'northcarolinaat',
  northcarolinacentral: 'northcarolinacentral', nccentral: 'northcarolinacentral', grandcanyon: 'grandcanyon', sanjosest: 'sanjosest', southeastmissourist: 'southeastmissourist', semissourist: 'southeastmissourist',
  incarnateword: 'incarnateword', ucsb: 'ucsantabarbara', ucsd: 'ucsandiego', westkentucky: 'westernkentucky', northiowa: 'northerniowa', southutah: 'southernutah',
  southeasternmissourist: 'southeastmissourist', marylandes: 'marylandeasternshore', marylandeastshore: 'marylandeasternshore', houstonbaptist: 'houstonchristian', alabamaam: 'alabamaam', floridaam: 'floridaam', mississippivalleyst: 'mississippivalleyst', alcornst: 'alcornst', jacksonst: 'jacksonst'
};
const byNorm = {};
for (let i = 0; i < nD1; i++) {
  const t = teams[i];
  for (const nm of [t.name, t.short, t.full, t.full.replace(new RegExp('\\s+' + (t.nick || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '')]) {
    const k = norm(nm);
    if (k && byNorm[k] == null) byNorm[k] = i;
  }
}
function findTeam(raw) {
  // As written first, then with other sites' short forms spelled out ("N Iowa" as "north iowa").
  for (const k of [norm(raw), norm(raw, true)]) {
    if (byNorm[k] != null) return byNorm[k];
    if (ALIAS[k] && byNorm[ALIAS[k]] != null) return byNorm[ALIAS[k]];
  }
  return null;
}
function fill(v, label) {
  const miss = teams.slice(0, nD1).filter((_, i) => v[i] == null).map((t) => t.name);
  if (miss.length > 8) throw new Error(label + ': ' + miss.length + ' teams unmatched, e.g. ' + miss.slice(0, 12).join(', '));
  if (miss.length) console.warn(label + ': no rating for ' + miss.join(', ') + ' (set to the lowest rating)');
  const lo = Math.min(...v.filter((x) => x != null));
  return center(v.map((x) => (x == null ? lo : x)));
}

// ESPN's BPI: points better than an average team on a neutral floor.
try {
  const bj = await get(`https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?limit=500&season=${SEASON}`);
  const v = new Array(nD1).fill(null);
  for (const it of bj.teams) {
    const cat = it.categories.find((c) => c.name === 'bpi'), i = idx[it.team.id];
    if (cat && i != null && i < nD1) v[i] = +cat.values[0];
  }
  sources.bpi = { rating: fill(v, 'BPI') };
} catch (e) { console.warn('BPI unavailable:', e.message); }

// Bart Torvik's T-Rank (the public results file): adjusted offense minus defense per 100 possessions, times
// the team's adjusted tempo, as points per game.
try {
  const rows = await get(`https://barttorvik.com/${SEASON}_team_results.json`);
  const v = new Array(nD1).fill(null), unk = [];
  for (const r of rows) {
    const i = findTeam(r[1]);
    if (i == null) { unk.push(r[1]); continue; }
    v[i] = (r[4] - r[6]) * r[r.length - 1] / 100;
  }
  if (unk.length) console.warn('T-Rank names not matched:', unk.join(', '));
  sources.torvik = { rating: fill(v, 'T-Rank') };
} catch (e) { console.warn('T-Rank unavailable:', e.message); }

// TeamRankings: Predictive and Last 5 Games, by school name with the record after it.
async function teamRankings(path, label) {
  const html = await text('https://www.teamrankings.com/ncaa-basketball/ranking/' + path);
  const v = new Array(nD1).fill(null), unk = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (c.length < 3 || !/^\d+$/.test(c[0])) continue;
    const nm = c[1].replace(/\s*\(\d+-\d+\)\s*$/, ''), i = findTeam(nm);
    if (i == null) { unk.push(nm); continue; }
    v[i] = parseFloat(c[2]);
  }
  if (unk.length) console.warn(label + ' names not matched:', unk.join(', '));
  return fill(v, label);
}
try { sources.tr = { rating: await teamRankings('predictive-by-other', 'TeamRankings Predictive') }; } catch (e) { console.warn('TeamRankings Predictive unavailable:', e.message); }
try { sources.trlast5 = { rating: await teamRankings('last-5-games-by-other', 'TeamRankings Last 5') }; } catch (e) { console.warn('TeamRankings Last 5 unavailable:', e.message); }

const D = { season: SEASON, asOf: new Date().toISOString(), nD1, confs, teams, games: G };
const simD = { ...D, games: G.map((g) => (g.s === 'in' ? { ...g, s: 'pre' } : g)) };
sources.points = { rating: SIM.pointsRating(simD) };
const AVG = ['bpi', 'torvik', 'tr', 'points'].filter((k) => sources[k]);
sources.all = { rating: teams.slice(0, nD1).map((_, i) => AVG.reduce((s, k) => s + sources[k].rating[i], 0) / AVG.length) };

const MODELS = [
  { k: 'all', label: 'All models average', group: 'Averages' },
  { k: 'bpi', label: 'ESPN BPI', group: 'Point-based' },
  { k: 'torvik', label: 'Bart Torvik T-Rank', group: 'Point-based' },
  { k: 'tr', label: 'TeamRankings Predictive', group: 'Point-based' },
  { k: 'points', label: 'Points rating (this site)', group: 'Point-based' },
  { k: 'trlast5', label: 'TeamRankings Last 5 Games', group: 'Recent form' }
].filter((m) => sources[m.k]);
const AVG_LABELS = AVG.map((k) => MODELS.find((m) => m.k === k).label);

const t0 = Date.now(), results = {};
for (const m of MODELS) results[m.k] = SIM.simulate(simD, SIMS, undefined, undefined, sources[m.k].rating);
const played = G.filter((g) => g.s === 'post').length;
console.log(`NCAAB ${SEASON}: ${nD1} D-I teams in ${confs.length} conferences (${confs.map((c) => c.k).join(' ')}); ${played}/${G.length} games played; models ${MODELS.map((m) => m.k).join(', ')}; ${SIMS} seasons each in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// Playoff odds over time for the team panels: this refresh's odds are saved to a snapshot file kept in the repo,
// and the chart uses saved odds where it has them, otherwise the season re-run with the ratings of that time.
{
  const t0 = Date.now();
// Preseason: last season's final BPI, pulled a third of the way to average.
  let pre = null;
  try {
    const bj = await get(`https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?limit=500&season=${SEASON - 1}`);
    const v = new Array(nD1).fill(null);
    for (const it of bj.teams) {
      const cat = it.categories.find((c) => c.name === 'bpi'), i = idx[it.team.id];
      if (cat && i != null && i < nD1) v[i] = +cat.values[0];
    }
    const have = v.filter((x) => x != null).length;
    if (have < nD1 - 15) throw new Error('only ' + have + ' teams');
    const known = centered(v.map((x, i) => (x == null ? sources.all.rating[i] : x)));
    const rating = known.map((x) => x * REGRESS);
    pre = { rating, run: (games) => SIM.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams, note: "last season's final BPI, pulled a third of the way to average" };
  } catch (e) { console.warn('Last season BPI unavailable:', e.message); }
  const sim = (games, rating) => SIM.simulate({ ...D, games }, 4000, undefined, undefined, rating).teams;
  if (!pre) pre = { rating: sources.all.rating, run: (games) => sim(games, sources.all.rating), note: "today's ratings (last season's were unavailable)" };
  const HF = new URL('./ncaab-hist.json', import.meta.url), store = loadSnaps(HF), ids = D.teams.map((t) => t.espn);
  addSnap(HF, store, D.asOf, ids, results.all.teams.map((t) => t.make));
  // Ratings as of a past time: the preseason ratings, updated with the results played by then (8 games' worth of pull back toward preseason).
  const nR = pre.rating.length;
  const past = (t, games) => sim(games, priorFit(nR, D.games.filter((g) => g.s === 'post' && Date.parse(g.d) < t).map((g) => ({ h: g.h, a: g.a, m: Math.max(-SIM.M.capMargin, Math.min(SIM.M.capMargin, g.hs - g.as)) - (g.n ? 0 : SIM.M.hfa) })), pre.rating, 8, SIM.M.nonD1));
  D.hist = byDate(D, { ids, store, value: (t) => t.make, nowTeams: results.all.teams, pre, past, note: 'the preseason ratings updated with the results played by then' });
  console.log('NCAAB odds history:', D.hist.labels.map((l, k) => l + (D.hist.src[k] === 'saved' ? '*' : '')).join(' '), '(* saved), snapshots', store.snaps.length, 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
writeFileSync(new URL('./ncaab-data.json', import.meta.url), JSON.stringify({ D, models: MODELS, results,
  ratings: Object.fromEntries(MODELS.map((m) => [m.k, sources[m.k].rating.map((v) => Math.round(v * 100) / 100)])), sims: SIMS, avg: AVG_LABELS }));
