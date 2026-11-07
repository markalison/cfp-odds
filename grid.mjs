// Grid search of committee weights against the current CFP top 25 (Spearman, no anchor).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const CFP = createRequire(import.meta.url)('./engine.js');
const { D } = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
const T = D.teams, M = CFP.M;
function corr(mode) {
  const P = CFP.prep(D, mode);
  const order = [...Array(P.fbs).keys()].sort((a, b) => P.scoreNow[b] - P.scoreNow[a]);
  const rk = {}; order.forEach((t, i) => { rk[t] = i + 1; });
  const ranked = [...Array(P.fbs).keys()].filter((t) => T[t].rank);
  const m = ranked.map((t) => rk[t]), c = ranked.map((t) => T[t].rank);
  const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length, mm = avg(m), cm = avg(c);
  const r = m.reduce((s, v, i) => s + (v - mm) * (c[i] - cm), 0) / Math.sqrt(m.reduce((s, v) => s + (v - mm) ** 2, 0) * c.reduce((s, v) => s + (v - cm) ** 2, 0));
  const inTop12 = order.slice(0, 12).filter((t) => T[t].rank && T[t].rank <= 12).length;
  return { r, inTop12, top: order.slice(0, 12).map((t) => T[t].ab).join(' ') };
}
const res = [];
for (const wRating of [0.5, 0.65, 0.8, 1]) for (const wLoss of [3.5, 4.5, 5.5, 7]) for (const wSos of [0.15, 0.3, 0.5]) for (const wTop10 of [2.5, 4]) {
  Object.assign(M, { wRating, wLoss, wSos, wTop10, wTop25: wTop10 / 2 });
  const rs = ['massey', 'sagarin', 'predictor', 'blend'].map(corr);
  res.push({ wRating, wLoss, wSos, wTop10, mean: rs.reduce((s, x) => s + x.r, 0) / 4, top12: rs.reduce((s, x) => s + x.inTop12, 0) / 4, top: rs[0].top });
}
res.sort((a, b) => b.mean - a.mean);
res.slice(0, 8).forEach((x) => console.log(x.mean.toFixed(3), x.top12.toFixed(1), `rating ${x.wRating} loss ${x.wLoss} sos ${x.wSos} top10 ${x.wTop10}`, '|', x.top));
console.log('CFP top12:', T.filter((t) => t.rank && t.rank <= 12).sort((a, b) => a.rank - b.rank).map((t) => t.ab).join(' '));
