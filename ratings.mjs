// Fetches the extra ratings models and returns each one as { name -> raw value }.
// A source that fails is skipped, so one broken site can't stop a build.
const UA = { 'User-Agent': 'Mozilla/5.0' };
const text = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.text(); };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const clean = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const rows = (html) => (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1])));
const iso = (d) => d.toISOString().slice(0, 10);
// Most ratings pages update after Saturday's games, so this is the last day they include.
const lastSaturday = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 1) % 7)); return iso(x); };
const usDate = (s) => iso(new Date(s + ' 12:00 UTC'));

export const norm = (s) => decode(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[.'’`()_-]/g, ' ').replace(/\bst\b/g, 'state').replace(/\s+/g, ' ').trim();

// Each site's spelling (after norm) -> ESPN's team name.
const NAMES = {
  'miami fl': 'Miami', 'miami florida': 'Miami', 'miami ohio': 'Miami (OH)', mississippi: 'Ole Miss', 'brigham young': 'BYU',
  'southern cal': 'USC', 'southern california': 'USC', 'southern methodist': 'SMU', 'texas christian': 'TCU', 'louisiana state': 'LSU',
  'central florida': 'UCF', 'north carolina state': 'NC State', connecticut: 'UConn', 'appalachian state': 'App State', 'ohio u': 'Ohio',
  'middle tennessee state': 'Middle Tennessee', 'middle tenn': 'Middle Tennessee', 'southern mississippi': 'Southern Miss', 'unc charlotte': 'Charlotte',
  'sam houston state': 'Sam Houston', 'louisiana monroe': 'UL Monroe', 'louisiana lafayette': 'Louisiana', 'texas san antonio': 'UTSA', 'texas el paso': 'UTEP',
  'nevada las vegas': 'UNLV', 'alabama birmingham': 'UAB', 'texas state san marcos': 'Texas State', 'florida int l': 'Florida International', 'florida intl': 'Florida International',
  hawaii: "Hawai'i", 'j madison': 'James Madison', 'n texas': 'North Texas', 's florida': 'South Florida', 'georgia so': 'Georgia Southern', 'w michigan': 'Western Michigan',
  'e carolina': 'East Carolina', 'coastal car': 'Coastal Carolina', 's alabama': 'South Alabama', 'c michigan': 'Central Michigan', 'w kentucky': 'Western Kentucky',
  'e michigan': 'Eastern Michigan', 'n illinois': 'Northern Illinois', umass: 'Massachusetts'
};
export const canonical = (name) => { const n = norm(name); return NAMES[n] ? norm(NAMES[n]) : n; };

// A date (YYYY-MM-DD) gives the ratings as they stood that morning; TeamRankings keeps every past day.
export async function teamRankings(path, date) {
  const html = await text('https://www.teamrankings.com/college-football/ranking/' + path + (date ? '?date=' + date : ''));
  const values = {};
  rows(html).forEach((c) => { if (c.length > 2 && /^\d+$/.test(c[0])) values[c[1].replace(/\s*\(\d+-\d+(-\d+)?\)\s*$/, '')] = parseFloat(c[2]); });
  // The page shows no date. It updates daily, so it includes results through yesterday.
  return { values, thru: iso(new Date(Date.now() - 864e5)) };
}
async function fei() {
  const html = await text('https://www.bcftoys.com/2026-fei/');
  const values = {};
  rows(html).forEach((c) => { if (c.length > 6 && /^\d+$/.test(c[0])) values[c[1]] = parseFloat(c[4]); });
  return { values, thru: lastSaturday(new Date(+html.match(/updated-on="(\d+)"/)[1])) };
}
async function talisman() {
  const html = await text('https://talismanred.com/ratings/cf/rating.shtml');
  const values = {};
  rows(html).forEach((c) => { if (c.length > 6 && /^\d+$/.test(c[0])) values[c[1]] = parseFloat(c[5]); });
  const home = await text('https://talismanred.com/ratings/cf/');
  const m = clean(home).match(/Last updated: (\d{2})-([A-Za-z]{3})-(\d{4})/);
  return { values, thru: lastSaturday(new Date(`${m[2]} ${m[1]}, ${m[3]} 12:00 UTC`)) };
}
async function howell() {
  const html = await text('https://jhowell.net/cf/cf2026.htm');
  const values = {};
  // Power ratings are 0-1 win shares, so logit puts them on a straight-line scale before fitting to points.
  rows(html).forEach((c) => { if (c.length > 10 && /^\d+$/.test(c[0])) { const p = parseFloat(c[2]); if (p > 0 && p < 1) values[c[1]] = Math.log(p / (1 - p)); } });
  const m = clean(html).match(/through the games of (\d+)-(\d+)-(\d+)/);
  return { values, thru: `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
}
async function laz() {
  const html = await text('https://www.lazindex.com/college-rankings');
  const values = {};
  rows(html).forEach((c) => { if (c.length > 7 && /^FBS/.test(c[2])) values[c[1]] = parseFloat(c[7]); });
  return { values, thru: lastSaturday(new Date(clean(html).match(/Updated ([A-Z][a-z]+ \d+, \d{4})/)[1] + ' 12:00 UTC')) };
}
async function wolfe() {
  const html = await text('https://wolferatings.com/ratings.htm');
  const values = {};
  for (const m of html.replace(/<[^>]+>/g, '').matchAll(/^\s*\d+\s+(.+?)\s+FBS\s+\d+\s+\d+\s+\d+\s+\d+\s+(-?[\d.]+)/gm)) values[m[1]] = +m[2];
  const t = clean(html).match(/through ([A-Z][a-z]+) (\d+), (\d{4})/);
  return { values, thru: usDate(`${t[1]} ${t[2]}, ${t[3]}`) };
}
async function rothman() {
  const txt = await text('https://wolferatings.com/rothman.txt');
  const values = {};
  for (const m of txt.matchAll(/^\s*\d+\s+(.+?)\s+FBS\s+(-?[\d.]+)\s/gm)) values[m[1]] = +m[2];
  const t = txt.match(/THROUGH (\d+)\/(\d+)\/(\d+)/);
  return { values, thru: `20${t[3]}-${t[1].padStart(2, '0')}-${t[2].padStart(2, '0')}` };
}

// scale: 'points' keeps the model's own point gaps. 'fit' also matches the spread of Massey's ratings.
// average: true counts the model once in the All models average. Variants and results-only models stay out.
export const SOURCES = [
  { k: 'fei', label: 'FEI', group: 'Point-based', scale: 'fit', average: true, url: 'https://www.bcftoys.com/2026-fei/', load: fei },
  { k: 'tr', label: 'TeamRankings Predictive', group: 'Point-based', scale: 'points', average: true, url: 'https://www.teamrankings.com/college-football/ranking/predictive-by-other', load: () => teamRankings('predictive-by-other') },
  { k: 'talisman', label: 'Talisman Red', group: 'Point-based', scale: 'points', average: true, hfa: 3, url: 'https://talismanred.com/ratings/cf/', load: talisman },
  // Left out of the average: converting its 0-1 ratings to points is rougher, and it's the outlier of this group.
  { k: 'howell', label: 'Jeff Howell', group: 'Point-based', scale: 'fit', url: 'https://jhowell.net/cf/cfindex.htm', load: howell },
  { k: 'laz', label: 'Laz Index', group: 'Point-based', scale: 'fit', average: true, url: 'https://www.lazindex.com/college-rankings', load: laz },
  { k: 'trlast5', label: 'TeamRankings Last 5 Games', group: 'Recent form', scale: 'points', url: 'https://www.teamrankings.com/college-football/ranking/last-5-games-by-other', load: () => teamRankings('last-5-games-by-other') },
  { k: 'wolfe', label: 'Wolfe', group: 'Results only', scale: 'fit', url: 'https://wolferatings.com/ratings.htm', load: wolfe },
  { k: 'rothman', label: 'Rothman', group: 'Results only', scale: 'fit', url: 'https://wolferatings.com/rothman.txt', load: rothman }
];
