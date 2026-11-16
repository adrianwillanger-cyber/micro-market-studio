import random, csv, datetime as dt
random.seed(98125)
AS_OF = dt.date(2026,11,15)
D = lambda n: AS_OF - dt.timedelta(days=n)
# name: ($/sqft base, weight, type mix [Residential, Townhouse, Condo], streets)
NB = {
 "Lake City":       (515, 1.5, [.45,.40,.15], ["NE 125th St","Lake City Way NE","30th Ave NE","NE 130th St","28th Ave NE"]),
 "Meadowbrook":     (560, 1.1, [.85,.15,0],   ["35th Ave NE","NE 105th St","39th Ave NE","NE 110th St"]),
 "Victory Heights": (585, 0.9, [.80,.20,0],   ["17th Ave NE","NE 107th St","20th Ave NE","NE 113th St"]),
 "Cedar Park":      (610, 0.7, [.95,.05,0],   ["37th Ave NE","NE 135th St","40th Ave NE"]),
 "Matthews Beach":  (690, 0.7, [1,0,0],       ["NE 93rd St","47th Ave NE","Sand Point Way NE","NE 98th St"]),
 "Olympic Hills":   (540, 0.35,[.9,.1,0],     ["NE 140th St","25th Ave NE","NE 143rd St"]),
 "Pinehurst":       (530, 0.8, [.7,.3,0],     ["15th Ave NE","NE 120th St","12th Ave NE"]),
 "Maple Leaf":      (650, 0.8, [.9,.1,0],     ["NE 98th St","Roosevelt Way NE","8th Ave NE","NE 100th St"]),
 "Northgate":       (495, 1.0, [.35,.25,.40], ["5th Ave NE","NE Northgate Way","1st Ave NE","NE 103rd St"]),
}
TYPES=["Residential","Townhouse","Condo"]
rows=[]; used=set(); mls=[2410000]
def addr(nb):
    while True:
        a=f"{random.randint(1,149)*100+random.randint(1,99)} {random.choice(NB[nb][3])}"
        if a not in used: used.add(a); return a
def home(nb, typ):
    if typ=="Residential": sq=random.randint(1150,3100); bd=random.choice([2,3,3,3,4,4,5]); ba=random.choice([1.0,1.75,2.0,2.25,2.5,3.0]); lot=random.randint(4800,9800); yb=random.choice(range(1926,2021))
    elif typ=="Townhouse": sq=random.randint(1100,1750); bd=random.choice([2,3,3]); ba=random.choice([2.0,2.25,2.5,3.25]); lot=random.randint(900,1600); yb=random.choice([2019,2021,2023,2025,2026])
    else: sq=random.randint(600,1150); bd=random.choice([1,1,2,2]); ba=random.choice([1.0,1.0,2.0]); lot=0; yb=random.choice(range(1968,2020))
    return sq,bd,ba,lot,yb
def ppsf(nb,typ,when_days):
    b=NB[nb][0]*(1.0 if typ=="Residential" else .93 if typ=="Townhouse" else .80)
    return b*random.uniform(.88,1.12)
def nextmls(): mls[0]+=random.randint(3,40); return f"S-{mls[0]}"
def pick_nb(): return random.choices(list(NB),[v[1] for v in NB.values()])[0]
def pick_type(nb): return random.choices(TYPES,NB[nb][2])[0]

def sold(nb=None, sold_ago=None, typ=None):
    nb=nb or pick_nb(); typ=typ or pick_type(nb)
    sq,bd,ba,lot,yb=home(nb,typ)
    sold_ago = sold_ago if sold_ago is not None else random.randint(0,119)
    recent = sold_ago<=30
    # market character: earlier period hotter overall, recent cools slightly
    if nb=="Meadowbrook": dom=random.choice([3,4,5,5,6,6,7,8,9]) if sold_ago<=60 else random.choice([5,7,9,12,15])
    elif nb=="Matthews Beach": dom=random.choice([4,5,6,8,10])
    elif nb=="Northgate": dom=random.choice([12,18,25,31,40,52])
    else: dom=random.choice([5,6,8,9,12,15,21,28,35]) if not recent else random.choice([7,9,12,15,19,24,33,41])
    p=ppsf(nb,typ,sold_ago)
    if nb=="Olympic Hills" and sold_ago<=60: p*=1.17
    list_p=round(p*sq/5000)*5000
    if nb=="Matthews Beach" and sold_ago<=60: ratio=random.uniform(1.02,1.09)
    elif nb=="Meadowbrook": ratio=random.uniform(1.0,1.06)
    elif nb=="Northgate": ratio=random.uniform(.95,1.0)
    else: ratio=random.uniform(.97,1.05) if not recent else random.uniform(.955,1.025)
    orig=list_p
    if dom>20 and random.random()<.55: orig=round(list_p*random.uniform(1.03,1.08)/5000)*5000
    sp=round(list_p*ratio/1000)*1000
    sd=D(sold_ago); pend=sd-dt.timedelta(days=random.randint(14,32)); ld=pend-dt.timedelta(days=dom)
    rows.append(dict(mls=nextmls(),status="Sold",address=addr(nb),zip="98125",community=nb,ptype=typ,list=list_p,orig=orig,sold=sp,ld=ld,pd=pend,sd=sd,dom=dom,bd=bd,ba=ba,sq=sq,lot=lot,yb=yb))

def active(nb=None, listed_ago=None, typ=None, band=None):
    nb=nb or pick_nb(); typ=typ or pick_type(nb)
    sq,bd,ba,lot,yb=home(nb,typ)
    dom=listed_ago if listed_ago is not None else random.choice([1,3,5,8,12,16,22,30,41,55,70])
    p=ppsf(nb,typ,0); list_p=round(p*sq/5000)*5000
    if band: list_p=random.randrange(band[0],band[1],5000); sq=int(list_p/ (NB[nb][0]*random.uniform(.95,1.05)))
    orig=list_p
    cut_prob = .65 if 900000<=list_p<1100000 else .22
    if dom>=14 and random.random()<cut_prob:
        orig=round(list_p*random.uniform(1.03,1.09)/5000)*5000
    rows.append(dict(mls=nextmls(),status="Active",address=addr(nb),zip="98125",community=nb,ptype=typ,list=list_p,orig=orig,sold="",ld=D(dom),pd="",sd="",dom=dom,bd=bd,ba=ba,sq=sq,lot=lot,yb=yb))

def pending(nb=None, status="Pending"):
    nb=nb or pick_nb(); typ=pick_type(nb); sq,bd,ba,lot,yb=home(nb,typ)
    dom=random.choice([4,6,7,9,12,18,26]); pago=random.randint(1,25)
    p=ppsf(nb,typ,0); list_p=round(p*sq/5000)*5000
    rows.append(dict(mls=nextmls(),status=status,address=addr(nb),zip="98125",community=nb,ptype=typ,list=list_p,orig=list_p,sold="",ld=D(pago+dom),pd=D(pago),sd="",dom=dom,bd=bd,ba=ba,sq=sq,lot=lot,yb=yb))

for _ in range(215): sold()
for _ in range(8): sold("Meadowbrook", random.randint(0,58))
for _ in range(6): sold("Matthews Beach", random.randint(0,58))
for _ in range(70): active()
for _ in range(10): active(nb=random.choice(list(NB)), band=(900000,1100000), typ="Residential", listed_ago=random.choice([15,20,26,33,40,48]))
# Lake City townhouse surge: new listings last 14 days
for i in range(9): active("Lake City", random.randint(0,13), "Townhouse")
for _ in range(26): pending(random.choice(list(NB)))
for _ in range(9): pending("Victory Heights")
for _ in range(10): pending(status="Pending Inspection")
for _ in range(14):
    nb=pick_nb(); typ=pick_type(nb); sq,bd,ba,lot,yb=home(nb,typ); p=ppsf(nb,typ,0)*1.08; lp=round(p*sq/5000)*5000; ago=random.randint(1,60); dom=random.randint(60,120)
    rows.append(dict(mls=nextmls(),status="Expired",address=addr(nb),zip="98125",community=nb,ptype=typ,list=lp,orig=round(lp*1.05/5000)*5000,sold="",ld=D(ago+dom),pd="",sd="",dom=dom,bd=bd,ba=ba,sq=sq,lot=lot,yb=yb))
# a few other-zip rows to exercise ZIP filter
for _ in range(5):
    sold(); rows[-1]["zip"]="98115"; rows[-1]["community"]="Wedgwood"
for _ in range(3): sold("Olympic Hills", random.randint(65,115), "Residential")
random.shuffle(rows)
f=lambda d: d.strftime("%m/%d/%Y") if d else ""
with open("data/98125-sample.csv","w",newline="") as fh:
    w=csv.writer(fh)
    w.writerow(["Listing #","Status","Address","Zip Code","Community","Property Type","List Price","Original List Price","Sold Price","Listing Date","Pending Date","Selling Date","DOM","Bedrooms","Bathrooms","Square Footage","Lot Square Footage","Year Built"])
    for r in rows:
        w.writerow([r["mls"],r["status"],r["address"],r["zip"],r["community"],r["ptype"],r["list"],r["orig"],r["sold"],f(r["ld"]),f(r["pd"]) if r["pd"] else "",f(r["sd"]) if r["sd"] else "",r["dom"],r["bd"],r["ba"],r["sq"],r["lot"],r["yb"]])
print(len(rows))
