# Staging v4 379-order cold-start diagnostics — 2026-08-14

## Scope and identity

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Source revision: `660cb73`
- Apps Script project: `Sanheyuan Admin Snapshot Staging`
- Apps Script version: 4, `Snapshot staging v4 379-order cold-start diagnostics`
- Deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A` (unchanged)
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Dataset: 379 generated, deidentified orders in one gzip chunk
- Drive folder: `三合院訂單快照備援 STAGING`
- Production frontend, production GAS version 248, production Orders, and production snapshot flag were not changed.

The staging backend regression and frontend snapshot-provider regression passed before deployment. `seedStagingSyntheticSnapshot()` and `verifyStagingSyntheticSnapshot()` completed successfully after deployment.

## First request after deployment and LINE authentication

The first full snapshot after deploying version 4 succeeded on the first attempt:

- Snapshot to paint: 3,427 ms
- Network/request: 3,219 ms
- GAS handler: 2,029 ms
- Session: 102 ms
- Firestore manifest: 364 ms
- Firestore chunk: 1,290 ms
- Firestore total: 1,701 ms
- Browser decompress / parse / merge: 5 / 1 / 8 ms
- Render: 198 ms

The browser wall time from clicking LINE Login through callback and the completed order view was 7,839 ms. That wall time includes the LINE authorization round trip and is not used as the snapshot acceptance metric.

## Authenticated cold-load acceptance run

Each numbered run performed a full navigation in the same authenticated tab. This cleared the in-memory snapshot while preserving the staging admin session. Times are milliseconds; `Parse` is envelope parse plus payload parse.

| Run | Result | Source | Attempts | Paint | Network | Handler | Session | Manifest | Chunks | Firestore | Download | Decompress | Parse | Merge | Render |
|---:|:---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | pass | firestore | 1 | 3381 | 3256 | 1942 | 68 | 1212 | 380 | 1643 | 1 | 3 | 1 | 7 | 115 |
| 2 | pass | firestore | 1 | 3135 | 2945 | 2139 | 108 | 1213 | 519 | 1789 | 1 | 5 | 1 | 7 | 180 |
| 3 | pass | firestore | 1 | 2157 | 1999 | 1117 | 63 | 546 | 328 | 907 | 13 | 4 | 2 | 7 | 136 |
| 4 | pass | firestore | 1 | 2099 | 1881 | 1051 | 90 | 366 | 351 | 763 | 12 | 5 | 2 | 10 | 194 |
| 5 | pass | firestore | 1 | 4191 | 3983 | 3002 | 208 | 1234 | 1274 | 2557 | 10 | 5 | 1 | 8 | 188 |
| 6 | pass | firestore | 1 | 4032 | 3859 | 2739 | 167 | 1505 | 508 | 2108 | 1 | 5 | 1 | 8 | 163 |
| 7 | pass | firestore | 1 | 2127 | 1939 | 1037 | 76 | 350 | 370 | 775 | 10 | 5 | 2 | 8 | 167 |
| 8 | pass | firestore | 1 | 2122 | 1894 | 975 | 86 | 348 | 356 | 745 | 10 | 6 | 2 | 14 | 203 |
| 9 | pass | firestore | 1 | 3102 | 2888 | 1948 | 76 | 322 | 1265 | 1630 | 11 | 5 | 1 | 8 | 191 |
| 10 | pass | firestore | 1 | 2659 | 2477 | 1559 | 160 | 487 | 500 | 1085 | 10 | 4 | 1 | 8 | 162 |
| 11 | pass | firestore | 1 | 3744 | 3586 | 2567 | 212 | 509 | 1440 | 2054 | 0 | 5 | 1 | 7 | 148 |
| 12 | pass | firestore | 1 | 2889 | 2678 | 1903 | 86 | 1235 | 364 | 1639 | 13 | 4 | 1 | 6 | 190 |
| 13 | pass | firestore | 1 | 2158 | 2000 | 1192 | 89 | 506 | 344 | 896 | 13 | 6 | 1 | 8 | 135 |
| 14 | pass | firestore | 1 | 3715 | 3533 | 2609 | 156 | 1108 | 963 | 2119 | 13 | 3 | 2 | 6 | 162 |
| 15 | pass | firestore | 1 | 3032 | 2848 | 1921 | 144 | 1002 | 456 | 1515 | 12 | 5 | 2 | 8 | 162 |
| 16 | pass | firestore | 1 | 2116 | 1913 | 1012 | 61 | 359 | 362 | 769 | 12 | 7 | 1 | 9 | 181 |
| 17 | pass | firestore | 1 | 4015 | 3859 | 3018 | 94 | 1317 | 1312 | 2675 | 12 | 5 | 1 | 7 | 135 |
| 18 | pass | firestore | 1 | 2189 | 2095 | 1099 | 114 | 347 | 366 | 754 | 12 | 4 | 1 | 7 | 74 |
| 19 | pass | firestore | 1 | 3958 | 3755 | 2952 | 79 | 1296 | 1278 | 2620 | 14 | 5 | 1 | 7 | 181 |
| 20 | pass | firestore | 1 | 1673 | 1599 | 898 | 64 | 332 | 334 | 703 | 11 | 2 | 1 | 4 | 58 |

Nearest-rank percentiles are used; P95 is the 19th sorted value.

| Metric | P50 | P95 | Maximum |
|:---|---:|---:|---:|
| Snapshot to paint | 2,889 ms | 4,032 ms | 4,191 ms |
| Network/request | 2,678 ms | 3,859 ms | 3,983 ms |
| GAS handler | 1,903 ms | 3,002 ms | 3,018 ms |
| Session | 89 ms | 208 ms | 212 ms |
| Firestore manifest | 509 ms | 1,317 ms | 1,505 ms |
| Firestore chunks | 380 ms | 1,312 ms | 1,440 ms |
| Firestore total | 1,515 ms | 2,620 ms | 2,675 ms |
| Platform/network gap (`network - handler`) | 902 ms | 1,120 ms | 1,314 ms |
| Download | 11 ms | 13 ms | 14 ms |
| Decompress | 5 ms | 6 ms | 7 ms |
| Parse | 1 ms | 2 ms | 2 ms |
| Merge | 7 ms | 10 ms | 14 ms |
| Render | 162 ms | 194 ms | 203 ms |

Result: 20/20 successful, Firestore source on every run, and zero retries. The 379-order shape passes P50 <= 4 seconds and P95 <= 5 seconds.

## Drive fallback and restore

After enabling the staging-only forced Firestore failure flag, one full load succeeded on the first attempt:

- Source: Drive, stale snapshot
- Orders: 379
- Snapshot to paint: 2,530 ms
- Firestore failure detection: 53 ms
- GAS handler: 678 ms
- No login-failure message

The flag was immediately restored. The verification load returned to Firestore on the first attempt, displayed 379 orders, and painted in 2,514 ms.

## Diagnosis and decision

The browser phases are not the production long-tail source: download, decompression, parsing, merging, and rendering together remain a small fraction of total time. The meaningful variable costs are Firestore (P95 2.620 seconds) and the platform/network gap (P95 1.120 seconds).

The 13–23 second production sample is not reproduced by the same 379-order shape, the same GCP project, or a newly deployed staging GAS version. It should therefore be treated as a production Apps Script/platform/network long-tail sample until an authenticated production diagnostic captures its handler and phase timings. This staging pass does not authorize another production switch by itself.
