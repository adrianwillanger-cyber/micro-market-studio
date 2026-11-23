# Micro Market Studio

Static browser app that turns a Realty Toolkit / NWMLS CSV export into one-ZIP social market reports. Everything runs in the browser; no data leaves the page.

## Tabs
Signal board, What changed, Price bands, Area report, Queue

## Filters
- Residential, Townhouse, Condo, and Small lot homes (detached homes on lots under 3,000 sq ft, shown when the export has a lot size column). Each home falls in one group only. The Area report has its own Small lot homes checkbox, kept in sync with the top one; unticking it drops the small lot section from the table, article, broadsheet and carousel.

## Broadsheet story
- Graph placeholders after each signal, for example `[Graph 1: Cedar Park median days on market vs 98125, last 60 days]`
- A Small lot homes paragraph with two graph placeholders when that filter is on

## Area report outputs
- Neighborhood table and three charts (price per sq ft, days on market, pipeline)
- Anomaly marks: `*` fewer than 6 sales, `**` home size moves the median 3% or more, `***` highest $/sq ft is 3x the lowest or more
- Small lot homes (lots under 3,000 sq ft) reported as their own group: side-by-side table of medians and averages, neighborhood table, article section, broadsheet row and carousel slide. Nothing is averaged across the two groups.
- LinkedIn article text, one-page broadsheet PDF, cover and chart PNGs
- LinkedIn carousel: 8 slides (9 with the small lot slide) at 1080x1350 (Print carousel PDF with margins set to None, or Download slides as PNG)

## Files
- `index.html`: client-facing 98125 market update page (the GitHub Pages home page)
- `reports/98125-2026-11/`: charts, share image and one-page PDF used by that page
- `studio.html`, `styles.css`, `app.js`: the app
- `tools/merge_exports.py`: stack several exports into a longer sold window (newest copy of each listing wins)
- `data/98125-sample.csv`, `gen_sample.py`: sample data

## Run locally
```
python3 -m http.server 8765
```
Then open http://localhost:8765/studio.html. Sessions are saved and loaded as a JSON file.

## Charts in reports

- Area report: the LinkedIn article preview shows each chart above its Fig. caption. Copied text stays free of chart placeholders.
- Fig. 4, Small lot homes vs standard lots (median $/sq ft and median days on market), appears when small lot homes sold. It has its own PNG download and is part of Download all images.
- Broadsheet story format: each signal paragraph is followed by a small chart with its Graph caption, and the small lot section has two comparison charts covering the last 90 days.

## Sharing work between people

The studio runs in each person's browser, so any number of people can use it at once; data and drafts stay on their own machine. There is no shared workspace. To hand work off, save a session file (queue, content memory, report settings) and send it; the other person loads the same CSV, then loads the session file. The CSV is not part of the session file.

## Your details on every report

The studio no longer ships with a built-in byline. When someone loads their own MLS export, a short form asks for their full name, brokerage, title, and a phone or email (website and license line are optional). Those details go on the byline and contact block of the broadsheet, story PDF, carousel, cover and LinkedIn article. Every report export button waits until the form is complete. The name is checked against the export's Listing Agent and Selling Agent columns as a courtesy note only. Details stay in the browser tab and in the saved session file; nothing is sent to a server. Edit them any time with the button in the top right corner.

## Download web page

The Area report's Download web page button saves one self-contained HTML file in the style of the client report page: dateline, headline, key figures, article text, inline charts, neighborhood table, small lot section, the user's contact block and the source line. Charts are embedded as SVG, so the file has no image dependencies; only the web fonts load from Google Fonts, with Georgia as the fallback. Upload it to any website or GitHub Pages, or open it straight from the computer. Like every report export, it waits for the user's details first.

## Product page

`platform.html` is the Micro Market Studio landing page: how the studio turns one ZIP of MLS data into sourced value reports, the KPIs it tracks for each stakeholder, the human review steps, and the beta call for five brokers. Live at https://adrianwillanger-cyber.github.io/micro-market-studio/platform.html
