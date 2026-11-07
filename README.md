# CFP Odds Board

Monte Carlo odds of making the 12-team College Football Playoff, live at https://markalison.github.io/cfp-odds/. On every visit the page pulls schedules, scores and CFP rankings from ESPN, then simulates the rest of the season in the browser.

## Files

- `src/index.html`, `src/about.html`: page templates. The build fills in the shared head, footer and About text.
- `css/styles.css`: styles for every page.
- `js/theme.js`: light and dark theme, on every page.
- `js/app.js`: the Odds and Scoreboard views.
- `engine.js`: the simulator, shared by the browser and the Node build.
- `ratings.mjs`: scrapers for the extra ratings models.
- `build.mjs`: fetches ESPN and ratings, simulates, writes `data.json`.
- `assemble.mjs`: writes `index.html`, `about.html` and `data.js` from the templates and `data.json`.

## Refreshing ratings

ESPN's API is unofficial and can change. If a call fails, the page shows the saved data. FPI updates on each visit; the other ratings update when the site is rebuilt:

1. Update `massey.tsv` from masseyratings.com/cf/fbs/ratings, including the `thru` date on line 1.
2. Run `node build.mjs 40000`, then `node assemble.mjs`.
3. Commit and push `index.html`, `about.html` and `data.js`.

The simulated committee is a model and has not been tested on past seasons.
