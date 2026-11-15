// One-off: fetches every head coach's seasons from CollegeFootballData.com and writes cfb-coaches.json, the
// coaching tenures per team that the History tab's summaries name. Re-run it after a coaching change.
// Needs the API key in .cfbd-key (not committed) or CFBD_KEY. Usage: node elo-seed-coaches.mjs
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const keyFile = new URL('./.cfbd-key', import.meta.url);
const KEY = process.env.CFBD_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!KEY) throw new Error('No CollegeFootballData key: put it in .cfbd-key or CFBD_KEY');
const r = await fetch('https://api.collegefootballdata.com/coaches?minYear=1869&maxYear=2100', { headers: { authorization: 'Bearer ' + KEY, 'user-agent': 'cfp-odds-board' } });
if (!r.ok) throw new Error('coaches ' + r.status);
const coaches = await r.json();

// Team ids by CollegeFootballData's school name (the same names the games file uses).
const cache = JSON.parse(readFileSync(new URL('./cfb-elo-games.json', import.meta.url), 'utf8'));
const idOf = new Map(Object.entries(cache.teams).map(([id, t]) => [t.n, id]));

// One coach per team-season: whoever coached the most games that year (a season not yet played goes to the
// coach listed for it).
const bySeason = {};
for (const c of coaches) {
  const name = (c.firstName + ' ' + c.lastName).trim();
  for (const s of c.seasons) {
    const id = idOf.get(s.school);
    if (!id) continue;
    const k = id + '|' + s.year, cur = bySeason[k];
    if (!cur || (s.games || 0) > cur.games) bySeason[k] = { id, year: s.year, name, games: s.games || 0 };
  }
}
// Tenures: [name, first season, last season], joining back-to-back seasons under the same coach.
const out = {};
Object.values(bySeason).sort((a, b) => (a.id === b.id ? a.year - b.year : a.id < b.id ? -1 : 1)).forEach((s) => {
  const list = out[s.id] || (out[s.id] = []), last = list[list.length - 1];
  if (last && last[0] === s.name && s.year - last[2] <= 1) last[2] = s.year; else list.push([s.name, s.year, s.year]);
});
writeFileSync(new URL('./cfb-coaches.json', import.meta.url), JSON.stringify(out));
const show = (n) => (out[idOf.get(n)] || []).slice(-4).map((t) => t[0] + ' ' + t[1] + '-' + t[2]).join(', ');
console.log('cfb-coaches.json:', Object.keys(out).length, 'teams,', Object.values(out).reduce((n, l) => n + l.length, 0), 'tenures');
console.log('Indiana:', show('Indiana'));
console.log('Alabama:', show('Alabama'));
