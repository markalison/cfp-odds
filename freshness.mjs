// Reports how current each ratings source is, without building anything.
// Run: node freshness.mjs
import { readFileSync } from 'node:fs';
import { SOURCES } from './ratings.mjs';

const masThru = (readFileSync(new URL('./massey.tsv', import.meta.url), 'utf8').match(/thru (\S+)/) || [])[1];
console.log('Massey (massey.tsv)'.padEnd(28), masThru);
try {
  const r = await fetch('http://sagarin.com/sports/cfsend.htm', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const m = (await r.text()).match(/through results of (\w+) (\d+)/i);
  console.log('Sagarin (all five columns)'.padEnd(28), m ? m[1] + ' ' + m[2] : 'date not found');
} catch (e) { console.log('Sagarin'.padEnd(28), 'failed: ' + e.message); }
for (const s of SOURCES) {
  try {
    const { values, thru } = await s.load();
    console.log(s.label.padEnd(28), thru, '(' + Object.keys(values).length + ' teams)');
  } catch (e) { console.log(s.label.padEnd(28), 'failed: ' + e.message); }
}
