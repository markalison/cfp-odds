// One-off: fills the odds snapshot files (*-hist.json) with every set of odds the site has published, read
// from the data files in this repo's git history. Usage: node seed-hist.mjs
import { execSync } from 'node:child_process';
import { loadSnaps, addSnap } from './hist.mjs';

const SPORTS = [
  { file: 'data.js', name: 'CFP_DATA', hist: 'cfp-hist.json', mode: 'blend', value: 'cfp', ids: (D) => D.teams.slice(0, D.fbs).map((t) => t.id) },
  { file: 'nfl-data.js', name: 'NFL_DATA', hist: 'nfl-hist.json', mode: 'all', value: 'playoff', ids: (D) => D.teams.map((t) => t.espn) },
  { file: 'nba-data.js', name: 'NBA_DATA', hist: 'nba-hist.json', mode: 'all', value: 'playoff', ids: (D) => D.teams.map((t) => t.espn) },
  { file: 'nhl-data.js', name: 'NHL_DATA', hist: 'nhl-hist.json', mode: 'all', value: 'playoff', ids: (D) => D.teams.map((t) => t.espn) },
  { file: 'ncaab-data.js', name: 'NCAAB_DATA', hist: 'ncaab-hist.json', mode: 'all', value: 'make', ids: (D) => D.teams.map((t) => t.espn) }
];
const sh = (cmd) => execSync(cmd, { maxBuffer: 1 << 28, encoding: 'utf8' });

for (const s of SPORTS) {
  const file = new URL('./' + s.hist, import.meta.url), store = loadSnaps(file);
  const commits = sh(`git log --format=%H -- ${s.file}`).trim().split('\n').filter(Boolean);
  let added = 0;
  for (const c of commits) {
    let js;
    try { js = sh(`git show ${c}:${s.file}`); } catch (e) { continue; }
    const at = js.indexOf('window.' + s.name + ' = ');
    if (at < 0) continue;
    let data;
    try { data = JSON.parse(js.slice(at + s.name.length + 10).trim().replace(/;\s*$/, '')); } catch (e) { continue; }
    const r = data.results && data.results[s.mode];
    if (!r || !r.teams || !data.D || !data.D.asOf) continue;
    const ids = s.ids(data.D);
    addSnap(file, store, data.D.asOf, ids, ids.map((_, i) => (r.teams[i] ? r.teams[i][s.value] : null)));
    added++;
  }
  console.log(s.hist, 'snapshots', store.snaps.length, '(from', added, 'commits)', store.snaps.length ? store.snaps[0].t + ' .. ' + store.snaps[store.snaps.length - 1].t : '');
}
