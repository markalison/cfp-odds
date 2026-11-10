// Calibration checks. Run after build.mjs: node diag.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const CFP = createRequire(import.meta.url)('./engine.js');
const { D } = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
const T = D.teams;

for (const mode of ['massey', 'sagarin', 'predictor', 'blend']) {
  const P = CFP.prep(D, mode), sim = new CFP.Sim(P, 99);
  // 1. Model vs committee before anchoring: rank correlation over the current top 25.
  const order = [...Array(P.fbs).keys()].sort((a, b) => P.scoreNow[b] - P.scoreNow[a]);
  const modelRank = {}; order.forEach((t, i) => { modelRank[t] = i + 1; });
  const ranked = [...Array(P.fbs).keys()].filter((t) => T[t].rank);
  const m = ranked.map((t) => modelRank[t]), c = ranked.map((t) => T[t].rank);
  const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length, mm = avg(m), cm = avg(c);
  const r = m.reduce((s, v, i) => s + (v - mm) * (c[i] - cm), 0) / Math.sqrt(m.reduce((s, v) => s + (v - mm) ** 2, 0) * c.reduce((s, v) => s + (v - cm) ** 2, 0));
  // 2. Selection rate by final record and conference tier.
  const b = {};
  let beyond = 0, g6in = 0, g6two = 0, N = 6000;
  for (let i = 0; i < N; i++) {
    const sd = sim.run(-1, 0), inF = new Set(sd);
    for (let t = 0; t < P.fbs; t++) {
      const tier = P.isP4[t] ? 'P4' : T[t].ab === 'ND' ? 'ND' : 'G6';
      const champ = sim.champ[t] ? 'C' : '-';
      const k = `${tier} ${sim.L[t]}L ${champ}`;
      (b[k] = b[k] || [0, 0])[0]++; if (inF.has(t)) b[k][1]++;
    }
    let g = 0; for (const t of sd) if (P.isG6[t]) g++;
    if (g) g6in++; if (g >= 2) g6two++;
    for (const t of sd) if (P.isP4[t] && sim.L[t] >= 4) beyond++;
  }
  console.log(`\n${mode}: model-vs-CFP top-25 correlation ${r.toFixed(3)}; G6 in field ${(g6in / N * 100).toFixed(1)}%, 2+ G6 ${(g6two / N * 100).toFixed(1)}%, P4 4-loss bids/sim ${(beyond / N).toFixed(3)}`);
  Object.keys(b).filter((k) => /^(P4|ND|G6) [0-3]L/.test(k)).sort().forEach((k) => { if (b[k][0] > 40) console.log(`  ${k.padEnd(10)} ${String(b[k][0]).padStart(7)} seasons  in ${(b[k][1] / b[k][0] * 100).toFixed(1)}%`); });
}
const P = CFP.prep(D, 'massey');
const wk = T.findIndex((t) => t.ab === 'WAKE'), g = P.nextGame[wk];
console.log('\nWAKE next', T[P.tH[g]].name, 'at', T[P.tA[g]].name, 'p', P.tP[g].toFixed(3), 'ratings', P.R[P.tH[g]].toFixed(1), P.R[P.tA[g]].toFixed(1));
const uc = T.filter((t) => t.conf === 'fcs').slice(0, 4).map((t) => t.name + ':' + t.r.massey.toFixed(1));
console.log('FCS sample', uc.join(', '));
console.log('In progress/remaining', D.games.filter((x) => x.s === 'in').length, D.games.filter((x) => x.s === 'pre').length, 'asOf', D.asOf);
