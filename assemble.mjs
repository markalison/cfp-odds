// Inlines engine.js and data.json into page.src.html and writes cfp-odds.html.
import { readFileSync, writeFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const { D, results } = JSON.parse(rd('./data.json'));
const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
for (const res of Object.values(results)) {
  delete res.schedule;
  res.rating = res.rating.map((x) => Math.round(x * 100) / 100);
  res.teams.forEach((t) => { for (const k of ['cfp', 'bye', 'host', 'aq', 'champ', 'ccg', 'title', 'pNext', 'ifNext', 'ifLose']) t[k] = r4(t[k]); if (t.seed != null) t.seed = Math.round(t.seed * 100) / 100; });
}
const json = JSON.stringify({ D, results }).replace(/<\//g, '<\\/');
const html = rd('./page.src.html').replace('/*__ENGINE__*/', () => rd('./engine.js')).replace('"__DATA__"', () => json);
// Published copy: the viewer adds the document skeleton. Local copy: complete document, can call ESPN live.
writeFileSync(new URL('./artifact.html', import.meta.url), html);
const full = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style></head><body>' + html + '</body></html>';
writeFileSync(new URL('./cfp-odds.html', import.meta.url), full);
writeFileSync(new URL('./index.html', import.meta.url), full);
console.log('cfp-odds.html', (html.length / 1024).toFixed(0) + ' KB');
