"""Contractor match rate against permits, with samples. python engine/match_report.py [since=YYYY-MM-DD]"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import db
con = db.connect(); q = lambda s, *a: con.execute(s, a).fetchall()
since = sys.argv[1] if len(sys.argv) > 1 else q("select date(max(issued_date),'-365 days') from permits")[0][0]
con.execute("create temp table ck as select name_key k, min(id) cid from contractors where name_key!='' group by name_key")
con.execute("create unique index temp.ixck on ck(k)")
M = "(exists(select 1 from ck where k=contractor_key) or exists(select 1 from ck where k=applicant_key))"
print(f"contractor list: {q('select count(*) from contractors')[0][0]} rows, {q('select count(*) from ck')[0][0]} distinct names")
for label, w in [("all permits, all years", "1=1"), ("building permits, all years", "kind='building'"),
                 (f"building permits since {since}", f"kind='building' and issued_date>='{since}'")]:
    t, n, m = q(f"select count(*), sum(contractor_key is not null or applicant_key is not null), sum({M}) from permits where {w}")[0]
    print(f"{label}: {t} permits, {n} name a company/person, {m} matched = {100*m/max(n,1):.1f}% of named, {100*m/max(t,1):.1f}% of all")
print("\nby source (building permits since %s): source, permits, with contractor name, matched" % since)
for r in q(f"select source,count(*),sum(contractor_key is not null or applicant_key is not null),sum({M}) from permits where kind='building' and issued_date>='{since}' group by 1 order by 2 desc"):
    print("  %-22s %6d %6d %6d" % tuple(r))
print("\n20 SAMPLE MATCHES (permit name -> list entry)")
for r in q(f"""select p.source, coalesce(p.contractor,p.applicant), c.name, c.phone, c.status from permits p join ck on ck.k=coalesce(p.contractor_key,p.applicant_key)
  join contractors c on c.id=ck.cid where p.kind='building' and p.issued_date>='{since}' group by ck.k order by random() limit 20"""):
    print("  [%s] %s  ->  %s | %s | %s" % tuple(r))
print("\n20 MISSES (most active unmatched contractor names)")
for r in q(f"""select contractor,count(*) n,group_concat(distinct source) from permits where kind='building' and issued_date>='{since}'
  and contractor_key is not null and not exists(select 1 from ck where k=contractor_key) group by contractor_key order by n desc limit 20"""):
    print("  %s  (%d permits; %s)" % tuple(r))
