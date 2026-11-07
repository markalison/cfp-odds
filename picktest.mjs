// Checks that a picked game is decided the same way in every simulation.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const CFP = createRequire(import.meta.url)('./engine.js');
const { D } = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
const T = D.teams, ix = (ab) => T.findIndex((t) => t.ab === ab), N = 20000;
const mia = ix('MIA'), nd = ix('ND');
const g = D.games.find((x) => x.s !== 'post' && [x.h, x.a].includes(mia) && [x.h, x.a].includes(nd));
const show = (label, picks) => {
  const r = CFP.runAll(D, 'blend', N, 4242, 300, picks), m = r.teams[mia], n = r.teams[nd];
  const f = (v) => v == null ? '-' : (v * 100).toFixed(1).padStart(5);
  console.log(label.padEnd(24), 'MIA pNext', f(m.pNext), 'cfp', f(m.cfp), '| ND pNext', f(n.pNext), 'cfp', f(n.cfp), '| field', r.teams.reduce((s, x) => s + x.cfp, 0).toFixed(3), 'title', r.teams.reduce((s, x) => s + x.title, 0).toFixed(3));
  return r;
};
const base = show('no picks', null);
const a = show('Miami picked', { [g.id]: T[mia].id });
const b = show('Notre Dame picked', { [g.id]: T[nd].id });
const pm = base.teams[mia].pNext;
console.log('Miami cfp reconciles:', (pm * a.teams[mia].cfp + (1 - pm) * b.teams[mia].cfp).toFixed(3), 'vs', base.teams[mia].cfp.toFixed(3));
console.log('ND cfp reconciles:   ', (pm * a.teams[nd].cfp + (1 - pm) * b.teams[nd].cfp).toFixed(3), 'vs', base.teams[nd].cfp.toFixed(3));
// Rivals should gain when Miami and Notre Dame lose, and a stale pick should do nothing.
const stale = show('pick for unknown game', { nope: T[mia].id });
console.log('stale pick changes nothing:', stale.teams[mia].cfp === base.teams[mia].cfp);
const movers = base.teams.map((x, i) => ({ ab: T[i].ab, d: b.teams[i].cfp - a.teams[i].cfp })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 6);
console.log('biggest swing, ND win vs Miami win:', movers.map((x) => `${x.ab} ${(x.d * 100).toFixed(1)}`).join(', '));
