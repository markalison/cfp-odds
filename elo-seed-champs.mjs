// One-off: reads the yearly "national championship selections from major selectors" table (the NCAA records
// book's list, as kept on Wikipedia) and writes cfb-champs.json: for each team, each season it was named
// champion and by whom. Re-run it after a season ends. Usage: node elo-seed-champs.mjs
import { writeFileSync, readFileSync } from 'node:fs';

const PAGE = 'https://en.wikipedia.org/w/index.php?title=College_football_national_championships_in_NCAA_Division_I_FBS&action=raw';
const r = await fetch(PAGE, { headers: { 'user-agent': 'cfp-odds-board' } });
if (!r.ok) throw new Error('page ' + r.status);
const wiki = await r.text();
const a = wiki.indexOf('===Yearly national championship selections from major selectors==='), b = wiki.indexOf('\n===', a + 10);
if (a < 0 || b < 0) throw new Error('table not found');
const table = wiki.slice(wiki.indexOf('{|', a), b);

const cache = JSON.parse(readFileSync(new URL('./cfb-elo-games.json', import.meta.url), 'utf8'));
const idOf = new Map(Object.entries(cache.teams).map(([id, t]) => [t.n, id]));
// The table's names where they differ from CollegeFootballData's.
const ALIAS = { 'Miami (FL)': 'Miami', 'Penn': 'Pennsylvania', 'Pitt': 'Pittsburgh', 'Southern California': 'USC', 'Washington & Jefferson': 'Washington & Jefferson', 'Detroit': 'Detroit Mercy', 'Southern Methodist': 'SMU', 'Texas Christian': 'TCU', 'Brigham Young': 'BYU', 'Central Florida': 'UCF', 'Oklahoma A&M': 'Oklahoma State' };

const strip = (s) => s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<sup>[\s\S]*?<\/sup>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const out = {}, missing = new Set();
let year = null, n = 0;
for (const raw of table.split(/\n\|-/)) {
  const row = strip(raw).replace(/\n/g, ' ').trim();
  if (!row.startsWith('|')) continue;
  const cells = row.replace(/^\|+\s*/, '').split('||').map((c) => c.trim());
  // A row opens with the season unless an earlier row's cell spans it.
  const ym = cells[0].match(/\[\[\d{4}[^\]|]*\|(\d{4})\]\]/);
  if (ym) { year = +ym[1]; cells.shift(); }
  if (!year || cells.length < 2) continue;
  const teamCell = cells[0], tm = teamCell.match(/\[\[[^\]|]*\|([^\]]+)\]\]/);
  if (!tm) continue; // "None", "Vacated"
  const name = ALIAS[tm[1]] || tm[1], id = idOf.get(name);
  const consensus = /'''/.test(teamCell) ? 1 : 0;
  const sel = cells[cells.length - 1].replace(/'{2,}/g, '').replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').split(',').map((x) => x.trim()).filter((x) => /^[A-Z][A-Za-z&()\/]{0,11}$/.test(x));
  if (!id) { missing.add(tm[1]); continue; }
  (out[id] = out[id] || []).push([year, consensus, sel]);
  n++;
}
writeFileSync(new URL('./cfb-champs.json', import.meta.url), JSON.stringify(out));
const codes = {};
Object.values(out).forEach((l) => l.forEach((x) => x[2].forEach((c) => { codes[c] = (codes[c] || 0) + 1; })));
console.log('cfb-champs.json:', n, 'selections for', Object.keys(out).length, 'teams; seasons', Math.min(...Object.values(out).flat().map((x) => x[0])), 'to', Math.max(...Object.values(out).flat().map((x) => x[0])));
console.log('not matched:', [...missing].join(', ') || 'none');
console.log('selectors:', Object.entries(codes).sort((p, q) => q[1] - p[1]).map((x) => x[0] + ' ' + x[1]).join(', '));
const show = (name) => (out[idOf.get(name)] || []).map((x) => x[0] + (x[1] ? '*' : '') + ' [' + x[2].join(' ') + ']').join('; ');
console.log('Indiana:', show('Indiana'));
console.log('LSU:', show('LSU').slice(-400));
