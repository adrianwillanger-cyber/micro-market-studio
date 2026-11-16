# Micro Market Studio

Static browser app that turns a Realty Toolkit / NWMLS CSV export into one-ZIP social market reports. Everything runs in the browser; no data leaves the page.

## Tabs
Signal board, What changed, Price bands, Area report, Queue

## Area report outputs
- Neighborhood table and three charts (price per sq ft, days on market, pipeline)
- Anomaly marks: `*` fewer than 6 sales, `**` home size moves the median 3% or more, `***` highest $/sq ft is 3x the lowest or more
- Small lot homes (lots under 3,000 sq ft) reported as their own group: side-by-side table of medians and averages, neighborhood table, article section, broadsheet row and carousel slide. Nothing is averaged across the two groups.
- LinkedIn article text, one-page broadsheet PDF, cover and chart PNGs
- LinkedIn carousel: 8 slides (9 with the small lot slide) at 1080x1350 (Print carousel PDF with margins set to None, or Download slides as PNG)

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `tools/merge_exports.py`: stack several exports into a longer sold window (newest copy of each listing wins)
- `data/98125-sample.csv`, `gen_sample.py`: sample data

## Run locally
```
python3 -m http.server 8765
```
Then open http://localhost:8765. Sessions are saved and loaded as a JSON file.
