# CFP Odds Board

Monte Carlo odds of making the 12-team College Football Playoff. `index.html` is a self-contained page: on every visit it pulls schedules, scores and CFP rankings from ESPN, then simulates the rest of the season in the browser.

ESPN's API is unofficial and can change. If a call fails, the page shows the data saved in the file.

Massey and Sagarin ratings are stored in the page, so they need refreshing by hand:

1. Update `massey.tsv` from masseyratings.com/cf/fbs/ratings, including the `thru` date on line 1.
2. Run `node build.mjs 40000`, then `node assemble.mjs`.
3. Commit and push `index.html`.

Ratings are from [Massey Ratings](https://masseyratings.com/cf/fbs/ratings) and [Jeff Sagarin](http://sagarin.com/sports/cfsend.htm). The simulated committee is a model and has not been tested on past seasons.
