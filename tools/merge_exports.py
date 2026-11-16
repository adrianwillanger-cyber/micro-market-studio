"""Stack several Realty Toolkit exports into one file covering a longer sold window.

Usage: python3 tools/merge_exports.py newest.csv older1.csv [older2.csv ...] -o merged.csv
Active, Pending and First Look rows come from the newest export only.
Sold rows come from every export, deduplicated by Listing Number (newest copy wins),
and dropped if the listing is live again in the newest export.
"""
import argparse, pandas as pd
ap = argparse.ArgumentParser(); ap.add_argument('files', nargs='+'); ap.add_argument('-o', required=True)
a = ap.parse_args()
ds = [pd.read_csv(f, dtype=str, encoding='latin1', keep_default_na=False) for f in a.files]
cur = ds[0]; live = cur[cur['Status'] != 'Sold']
sold = pd.concat([d[d['Status'] == 'Sold'] for d in ds]).drop_duplicates('Listing Number', keep='first')
sold = sold[~sold['Listing Number'].isin(live['Listing Number'])]
pd.concat([live, sold])[cur.columns].to_csv(a.o, index=False)
print(f'{len(live)} live rows + {len(sold)} unique sold rows -> {a.o}')
