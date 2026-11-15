// One-off: fetches every major-college football game since 1869 from CollegeFootballData.com and writes
// cfb-elo-games.json, the past seasons that elo-cfb.mjs builds the Elo history from. The current season comes
// from the regular build, so this only needs re-running to add a finished season.
// Needs a free API key in .cfbd-key (not committed) or the CFBD_KEY environment variable.
// Usage: node elo-seed-cfb.mjs [firstSeason] [lastSeason]
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const FIRST = +process.argv[2] || 1869, LAST = +process.argv[3] || 2025;
const keyFile = new URL('./.cfbd-key', import.meta.url);
const KEY = process.env.CFBD_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!KEY) throw new Error('No CollegeFootballData key: put it in .cfbd-key or CFBD_KEY');
const API = 'https://api.collegefootballdata.com';
const file = new URL('./cfb-elo-games.json', import.meta.url);
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const out = prior && prior.source === 'cfbd' ? prior : { source: 'cfbd', teams: {}, seasons: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path) => {
  for (let k = 0; k < 4; k++) {
    const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + KEY, 'user-agent': 'cfp-odds-board' } });
    if (r.ok) return r.json();
    if (r.status === 401 || r.status === 403) throw new Error('key refused: ' + r.status);
    await sleep(2000 * (k + 1));
  }
  throw new Error('failed ' + path);
};
// Old games carry a date only (midnight UTC); modern ones a kickoff time, read in Eastern time.
const dayOf = (iso) => (/T00:00:00/.test(iso) ? iso.slice(0, 10) : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));

// Names, abbreviations and colours (ids match ESPN's).
if (!Object.keys(out.teams).length || process.argv.includes('--teams')) {
  for (const t of await get('/teams')) out.teams[t.id] = { n: t.school, ab: t.abbreviation || '', c: t.color ? t.color.replace('#', '') : null };
  console.log('teams', Object.keys(out.teams).length);
}

// Game rows: [date, home id, away id, home points, away points, neutral, postseason, title game, note, home is major, away is major]
for (let y = FIRST; y <= LAST; y++) {
  const games = [];
  for (const g of await get(`/games?year=${y}&seasonType=both`)) {
    const hm = g.homeClassification === 'fbs', am = g.awayClassification === 'fbs';
    if (!g.completed || g.homePoints == null || g.awayPoints == null || (!hm && !am)) continue;
    for (const [id, name] of [[g.homeId, g.homeTeam], [g.awayId, g.awayTeam]]) if (!out.teams[id]) out.teams[id] = { n: name, ab: '', c: null };
    const post = g.seasonType === 'postseason' ? 1 : 0, note = g.notes || '';
    const title = post && /national championship/i.test(note) && !/semifinal|quarterfinal|first round/i.test(note) ? 1 : 0;
    games.push([dayOf(g.startDate), g.homeId, g.awayId, g.homePoints, g.awayPoints, g.neutralSite ? 1 : 0, post, title, post ? note : '', hm ? 1 : 0, am ? 1 : 0]);
  }
  games.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0));
  out.seasons[y] = games;
  if (y % 10 === 0 || y >= 1998) console.log(y, games.length, 'games,', games.filter((g) => g[6]).length, 'postseason; title:', games.filter((g) => g[7]).map((g) => out.teams[g[3] > g[4] ? g[1] : g[2]].n).join(' | ') || 'none flagged');
  if (y % 20 === 0 || y === LAST) writeFileSync(file, JSON.stringify(out));
  await sleep(250);
}
writeFileSync(file, JSON.stringify(out));
const n = Object.values(out.seasons).reduce((a, s) => a + s.length, 0);
console.log('total', n, 'games in', Object.keys(out.seasons).length, 'seasons');
