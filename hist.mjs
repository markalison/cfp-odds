// Playoff odds over time, for the team panels' chart.
//
// Every refresh saves that moment's odds (default ratings) to a snapshot file kept in the repo, so from then on
// the chart shows the odds as the site actually had them. Points from before the first snapshot are rebuilt:
// the season is re-run as it stood then, with the ratings as they stood then (ESPN's FPI for that week where
// ESPN keeps it, otherwise preseason ratings updated with the results played by then). Odds are whole tenths of
// a percent (0-1000).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const per = (x) => Math.round(x * 1000);
export const REGRESS = 2 / 3; // last season's ratings pulled a third of the way back to average
export function centered(v) { const m = v.reduce((s, x) => s + x, 0) / v.length; return v.map((x) => x - m); }

// Games played after the cutoff become unplayed (and live games unplayed too).
export function asOf(games, played) {
  return games.map((g) => (played(g) ? (g.s === 'in' ? { ...g, s: 'pre' } : g) : { ...g, s: 'pre', hs: 0, as: 0, w: undefined, ot: undefined }));
}

// A rating from results, pulled toward a prior (preseason) rating by `weight` games' worth of evidence.
// games: [{ h, a, m }] with m the home margin less home edge; a team index of n or more is fixed at `fixed`.
export function priorFit(n, games, prior, weight, fixed = 0) {
  const A = [], b = prior.map((p) => p * weight);
  for (let i = 0; i < n; i++) { A.push(new Float64Array(n)); A[i][i] = weight; }
  for (const g of games) {
    const hD = g.h < n, aD = g.a < n;
    if (hD && aD) { A[g.h][g.h] += 1; A[g.a][g.a] += 1; A[g.h][g.a] -= 1; A[g.a][g.h] -= 1; b[g.h] += g.m; b[g.a] -= g.m; }
    else if (hD) { A[g.h][g.h] += 1; b[g.h] += g.m + fixed; }
    else if (aD) { A[g.a][g.a] += 1; b[g.a] += -g.m + fixed; }
  }
  for (let c = 0; c < n; c++) for (let r = c + 1; r < n; r++) {
    const f = A[r][c] / A[c][c];
    if (!f) continue;
    for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
    b[r] -= f * b[c];
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

// ---------- Snapshots ----------
// file: { ids: [team ids], snaps: [{ t: ISO time, v: [odds per id, in ids order] }] }. One per refresh.
export function loadSnaps(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { ids: [], snaps: [] }; } catch (e) { return { ids: [], snaps: [] }; }
}
export function addSnap(file, store, t, ids, values) {
  const pos = {};
  store.ids.forEach((id, k) => { pos[id] = k; });
  ids.forEach((id) => { if (pos[id] == null) { pos[id] = store.ids.length; store.ids.push(id); } });
  const v = new Array(store.ids.length).fill(null);
  ids.forEach((id, i) => { v[pos[id]] = values[i] == null ? null : per(values[i]); });
  store.snaps = store.snaps.filter((s) => s.t !== t).concat({ t, v }).sort((a, b) => (a.t < b.t ? -1 : 1));
  writeFileSync(file, JSON.stringify(store));
}
// The latest snapshot taken in [from, to), as odds per team index (ids gives each team's id).
function snapIn(store, from, to, ids) {
  const s = store.snaps.filter((x) => { const t = Date.parse(x.t); return t >= from && t < to; }).pop();
  if (!s) return null;
  const pos = {};
  store.ids.forEach((id, k) => { pos[id] = k; });
  return ids.map((id) => (pos[id] == null || s.v[pos[id]] == null ? null : s.v[pos[id]]));
}

// ---------- The chart's points ----------
// o: { ids, store, value (team result -> chance), nowTeams, pre: { run, note }, past(k or time, games) -> teams,
//      note } ; each point is a snapshot when one fits, otherwise a rebuilt run.
function rebuilt(teams, value) { return teams.map((t) => (t ? per(value(t)) : null)); }

// By week (NFL, college football): Pre, after each finished week, then the current odds.
export function weekly(D, o) {
  const post = D.games.filter((g) => g.s === 'post' && g.wk != null);
  const lastWk = post.length ? Math.max(...post.map((g) => g.wk)) : 0;
  const wkGames = (k) => D.games.filter((g) => g.wk === k);
  const done = (k) => wkGames(k).length && wkGames(k).every((g) => g.s === 'post');
  const labels = ['Pre'], cols = [rebuilt(o.pre.run(asOf(D.games, () => false)), o.value)], src = ['pre'];
  for (let k = 1; k < lastWk; k++) {
    if (!done(k)) continue;
    // After week k: from its last kickoff + 4 hours to the next week's first kickoff.
    const from = Math.max(...wkGames(k).map((g) => Date.parse(g.d))) + 4 * 3600e3;
    const next = D.games.filter((g) => g.wk > k).map((g) => Date.parse(g.d));
    const to = next.length ? Math.min(...next) : Infinity;
    const snap = snapIn(o.store, from, to, o.ids);
    labels.push(String(k));
    if (snap) { cols.push(snap); src.push('saved'); }
    else { cols.push(rebuilt(o.past(k, asOf(D.games, (g) => g.s === 'post' && g.wk <= k)), o.value)); src.push('rebuilt'); }
  }
  labels.push(done(lastWk) && lastWk ? String(lastWk) : 'Now'); cols.push(rebuilt(o.nowTeams, o.value)); src.push('now');
  return pack(labels, cols, src, o);
}

// By date (NBA, NHL, college basketball): Pre, each Sunday night (Monday 10:00 UTC), then the current odds.
export function byDate(D, o) {
  const post = D.games.filter((g) => g.s === 'post');
  const labels = ['Pre'], cols = [rebuilt(o.pre.run(asOf(D.games, () => false)), o.value)], src = ['pre'];
  if (post.length) {
    const first = new Date(Math.min(...post.map((g) => Date.parse(g.d))));
    const cut = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate(), 10));
    while (cut.getUTCDay() !== 1) cut.setUTCDate(cut.getUTCDate() + 1);
    const now = Date.now();
    for (; cut.getTime() < now - 36 * 3600e3; cut.setUTCDate(cut.getUTCDate() + 7)) {
      const t = cut.getTime(), sun = new Date(t - 86400e3);
      labels.push(sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
      // A snapshot from the Monday-morning refresh (before Monday's games) stands for Sunday night.
      const snap = snapIn(o.store, t, t + 12 * 3600e3, o.ids);
      if (snap) { cols.push(snap); src.push('saved'); }
      else { cols.push(rebuilt(o.past(t, asOf(D.games, (g) => g.s === 'post' && Date.parse(g.d) < t)), o.value)); src.push('rebuilt'); }
    }
  }
  labels.push('Now'); cols.push(rebuilt(o.nowTeams, o.value)); src.push('now');
  return pack(labels, cols, src, o);
}

function pack(labels, cols, src, o) {
  const n = cols[cols.length - 1].length, v = [];
  for (let i = 0; i < n; i++) v.push(cols.map((c) => (c[i] == null ? null : c[i])));
  return { labels, v, src, pre: o.pre.note, past: o.note };
}
