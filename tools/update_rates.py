"""Refresh data/rates.js from FRED series MORTGAGE30US (Freddie Mac PMMS, 30 year fixed, weekly).
Run weekly after Freddie Mac publishes on Thursday:  python3 tools/update_rates.py"""
import csv, io, json, urllib.request, pathlib
URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US&cosd=2020-01-01'
rows = list(csv.reader(io.StringIO(urllib.request.urlopen(URL, timeout=30).read().decode())))[1:]
weeks = [[d, float(v)] for d, v in rows if v not in ('', '.')]
out = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'rates.js'
out.write_text('/* 30 year fixed mortgage rate, weekly average. Freddie Mac PMMS via FRED (MORTGAGE30US). Refresh with tools/update_rates.py */\n'
               'window.MMS_RATES = ' + json.dumps({'series': 'MORTGAGE30US', 'source': 'Freddie Mac Primary Mortgage Market Survey via FRED',
               'url': 'https://fred.stlouisfed.org/series/MORTGAGE30US', 'weeks': weeks}, separators=(',', ':')) + ';\n')
print(len(weeks), 'weeks, latest', weeks[-1])
