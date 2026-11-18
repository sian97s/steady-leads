# Sources — live audit 2026-11-16

Both pipelines were run live on 2026-11-16 (logs: `../_live_audit/py_run.log`, `../_live_audit/node_run.log`).
Decision: **Python engine kept, Node importers retired.** Contractor match samples: `MATCH_REPORT.txt`.

| Source | Python scrapers (kept) | Node importers (retired) | Status |
|---|---|---|---|
| Vancouver | 52,199 · last Nov 13 | 1,133 since Aug · last Nov 13 | works |
| Maple Ridge | 67,602 (58.9k are electrical/gas/plumbing, flagged `trade`) · last Nov 17 | 104 building · 41 undated | works |
| Surrey | 2,189 · last Nov 7 | 687 · none geocoded | works |
| Burnaby | 1,482 · last Nov 14 · demolition permits were dropped (fixed) | 359 · 16 dated in the future · no demolition · none geocoded | works |
| Richmond | 3,283 · last Nov 13 · 22 old-layout weekly PDFs unreadable (same permits arrive via monthly report) | 456 · 227 undated | works |
| New Westminster | 1,430 · last Nov 13 (half are plumbing, flagged) | 175 · none geocoded | works |
| Coquitlam | 77 · last Oct 30 · monthly, only permits over $200k | 40 · no addresses | works (weak) |
| North Vancouver (City) | 468 · last Oct 30 · monthly | last Sep 29: misses the October report (city misspelled the file name) | works |
| Mission | 1,299 · last Oct 29 · May 2026 and all 2021 reports unreadable | 73 · contractor column contains addresses | works (gaps) |
| Chilliwack | 363 · last Nov 6 · scanned weeks skipped (3 of 13 this run), no contractor names | 120 | works (weak) |
| Delta | 116 · last Nov 6 · weekly PDF · 40% of addresses were lost (fixed) | ArcGIS layer: 1,918 rows, 88% undated, no value or builder | works |
| Port Coquitlam | 24 · last Nov 13 · current week only, no values | 5 | works (thin) |
| Squamish | 1,392 · last Oct 29 · monthly refresh, no contractor | 0 rows | works (slow) |
| Port Moody | 2,946 · **last Mar 5 2026** — the city's feed stopped updating | 0 rows | STALE at source |
| Victoria, Prince George, Kamloops, Pemberton, CSRD | not in Python build | alive: 178 / 340 / 1,044 / 21 / 1,862 rows; Kamloops, CSRD, Pemberton mostly undated | ported to engine config, **not yet run live** |
| Abbotsford, Langley Township, White Rock (development applications) | not in Python build | 786 (all undated) / 41 / 0 | ported, **not yet run live** |

Not available anywhere (unchanged): District of North Vancouver, West Vancouver, Langley City (scanned), Pitt Meadows,
Abbotsford building permits, Township of Langley building permits.
