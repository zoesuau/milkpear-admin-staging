# Staging v5 single-document Firestore cold-load verification

Date: 2026-08-14 (Asia/Taipei)

## Scope and identity

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Repository/revision: `zoesuau/milkpear-admin-staging` at `81364bb`
- Apps Script: `Sanheyuan Admin Snapshot Staging`
- Script ID: `1PS12OSMlZVXLZ3ml-hnaCRnAcSpBnmT8Qc8gyDwi93IgdncNz8u51oI_`
- Web app deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A`
- Deployed version: 5
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Dataset: 379 generated, deidentified orders
- Snapshot version: `20260814165716772-staging-seed`
- Production frontend, production GAS version 248, Orders, and production snapshot flag were not changed.

## Implementation gate

The 379-order gzip payload is stored in the Firestore root document together
with its manifest. The browser response contract remains `manifest + chunks`,
but the GAS handler constructs the single returned chunk from the root GET and
does not issue `documents:batchGet`. If the compressed payload exceeds the
500,000-byte conservative inline limit, the planner automatically falls back
to the existing 2- or 4-chunk layout. Exact-limit, one-byte-over-limit, 2/4
chunk, checksum mismatch, response ordering, frontend provider, and production
handler-bridge regressions passed locally.

## 20 cold/full loads

All 20 runs loaded 379 orders from Firestore, succeeded on the first attempt,
and painted the first page. Times are milliseconds.

| Run | Snapshot→paint | Network | Handler | Session | Root GET | Chunks | Firestore | Download | Decompress | Parse | Merge | Render |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1886.4 | 1773.3 | 446 | 24 | 371 | 0 | 381 | 35.0 | 3.9 | 1.0 | 7.2 | 69.7 |
| 2 | 2918.2 | 2767.9 | 1574 | 85 | 1302 | 0 | 1334 | 12.6 | 4.2 | 1.1 | 6.5 | 130.4 |
| 3 | 3437.6 | 3343.9 | 2044 | 172 | 1440 | 0 | 1496 | 14.3 | 4.0 | 1.0 | 6.1 | 72.5 |
| 4 | 2539.4 | 2469.3 | 1266 | 38 | 1133 | 1 | 1144 | 12.8 | 2.4 | 0.6 | 3.6 | 53.3 |
| 5 | 2031.4 | 1911.7 | 831 | 118 | 396 | 0 | 449 | 11.0 | 5.6 | 1.3 | 7.9 | 99.8 |
| 6 | 2698.9 | 2548.6 | 1556 | 68 | 1306 | 0 | 1323 | 12.7 | 2.8 | 1.7 | 6.0 | 130.7 |
| 7 | 2039.1 | 1949.2 | 772 | 105 | 402 | 1 | 446 | 12.5 | 5.8 | 1.0 | 7.8 | 68.8 |
| 8 | 2230.2 | 2106.1 | 982 | 116 | 435 | 1 | 541 | 11.9 | 4.0 | 1.1 | 6.2 | 105.4 |
| 9 | 2984.7 | 2826.0 | 1726 | 97 | 1290 | 0 | 1354 | 12.0 | 3.8 | 1.0 | 5.9 | 140.2 |
| 10 | 2891.2 | 2807.1 | 1762 | 77 | 1335 | 1 | 1382 | 12.2 | 3.9 | 1.9 | 8.1 | 62.9 |
| 11 | 2794.1 | 2636.6 | 1581 | 70 | 1251 | 0 | 1304 | 13.0 | 2.5 | 1.0 | 4.7 | 138.5 |
| 12 | 3035.0 | 2967.7 | 1931 | 146 | 1413 | 0 | 1484 | 6.4 | 3.1 | 0.7 | 4.5 | 55.9 |
| 13 | 3126.8 | 2963.3 | 1895 | 96 | 1414 | 0 | 1463 | 12.2 | 4.4 | 1.4 | 6.9 | 143.6 |
| 14 | 2205.1 | 2084.8 | 1067 | 94 | 581 | 0 | 641 | 11.3 | 4.1 | 1.0 | 6.6 | 101.7 |
| 15 | 1681.6 | 1519.8 | 592 | 16 | 523 | 1 | 532 | 93.4 | 3.9 | 1.2 | 6.0 | 61.7 |
| 16 | 2569.5 | 2375.9 | 1061 | 128 | 578 | 0 | 641 | 130.2 | 4.6 | 1.0 | 6.8 | 55.9 |
| 17 | 1731.1 | 1599.6 | 649 | 70 | 378 | 0 | 413 | 14.2 | 4.0 | 1.3 | 6.5 | 110.0 |
| 18 | 1789.4 | 1703.1 | 653 | 75 | 346 | 0 | 384 | 9.9 | 4.1 | 1.5 | 6.6 | 68.7 |
| 19 | 2668.7 | 2532.3 | 1537 | 80 | 1242 | 0 | 1280 | 73.6 | 2.6 | 1.0 | 5.0 | 57.2 |
| 20 | 1651.8 | 1566.6 | 644 | 69 | 327 | 0 | 376 | 14.9 | 9.3 | 1.1 | 11.8 | 57.6 |

## Summary

| Metric | P50 | P95 | Maximum |
|---|---:|---:|---:|
| Snapshot to first paint | 2554 ms | 3142 ms | 3438 ms |
| Network | 2423 ms | 2987 ms | 3344 ms |
| GAS handler | 1167 ms | 1937 ms | 2044 ms |
| Session | 83 ms | 147 ms | 172 ms |
| Root Firestore GET | 857 ms | 1415 ms | 1440 ms |
| Chunk phase | 0 ms | 1 ms | 1 ms |
| Firestore total | 893 ms | 1485 ms | 1496 ms |
| Platform/network gap | 1062 ms | 1316 ms | 1327 ms |
| Download | 13 ms | 95 ms | 130 ms |
| Decompress | 4 ms | 6 ms | 9 ms |
| Payload parse | 1 ms | 2 ms | 2 ms |
| Merge | 7 ms | 8 ms | 12 ms |
| Render | 71 ms | 140 ms | 144 ms |

Acceptance result: 20/20 success, zero retries, P50 below 4 seconds,
P95 below 5 seconds, and maximum below 5 seconds.

## Failure and local-interaction gates

- Forced Firestore failure: Drive returned and painted 379 orders in 2222 ms,
  one attempt, `source=drive`, `firestoreMs=60`, `driveMs=449`; no login failure.
- Firestore was immediately restored; the next cold load returned from
  Firestore in 2891 ms with `chunksMs=0`.
- Status-tab and search interactions kept the same snapshot diagnostic run ID,
  proving they did not trigger another order snapshot read.
- Health endpoint returned `environment=staging`, one allowed admin, LINE
  secret configured, Drive folder/file configured, and
  `containsOrderData=false`.

This passes the isolated staging read-path gate. It does not authorize or prove
a production cutover, real Orders mutation consistency, trigger installation,
or a claim that the production system is stable or sale-ready.
