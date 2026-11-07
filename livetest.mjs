// Checks in-game odds: score and clock should move win probability and playoff odds.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const CFP = createRequire(import.meta.url)('./engine.js');
const { D } = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
const T = D.teams, mia = T.findIndex((t) => t.ab === 'MIA'), nd = T.findIndex((t) => t.ab === 'ND');
const g = D.games.find((x) => x.s !== 'post' && ((x.h === mia && x.a === nd) || (x.h === nd && x.a === mia)));
const run = (label) => {
  const r = CFP.runAll(D, 'blend', 20000, 777, 200), s = CFP.nextGames(CFP.prep(D, 'blend'))[mia][0];
  console.log(label.padEnd(30), 'MIA win', (s.p * 100).toFixed(1).padStart(5), ' MIA cfp', (r.teams[mia].cfp * 100).toFixed(1).padStart(5), ' ND win', (100 - s.p * 100).toFixed(1).padStart(5), ' ND cfp', (r.teams[nd].cfp * 100).toFixed(1).padStart(5), ' field', r.teams.reduce((a, x) => a + x.cfp, 0).toFixed(2));
};
const homeIsMia = g.h === mia, set = (m, n, frac) => { g.s = 'in'; g.hs = homeIsMia ? m : n; g.as = homeIsMia ? n : m; g.frac = frac; g.st = 'test'; };
g.s = 'pre'; run('pregame');
set(0, 0, 1); run('kickoff 0-0');
set(21, 7, 0.5); run('MIA up 21-7 at half');
set(7, 21, 0.5); run('ND up 21-7 at half');
set(28, 7, 0.08); run('MIA up 28-7, 5 min left');
// Status parsing
const ev = { id: '1', date: '2026-11-07T17:00Z', status: { clock: 332, period: 2, type: { state: 'in', name: 'STATUS_IN_PROGRESS', shortDetail: '5:32 - 2nd' } }, competitions: [{ neutralSite: false, conferenceCompetition: true, competitors: [{ id: '1', homeAway: 'home', score: '14', team: { id: '1', location: 'A', displayName: 'A A' } }, { id: '2', homeAway: 'away', score: '10', team: { id: '2', location: 'B', displayName: 'B B' } }] }] };
const p = CFP.parseEspn({ standings: { children: [] }, weeks: [{ events: [ev] }], rankings: { rankings: [] } }).games[0];
console.log('parsed', p.s, p.hs, p.as, 'frac', p.frac.toFixed(3), 'expected', ((2 * 900 + 332) / 3600).toFixed(3), p.st);
