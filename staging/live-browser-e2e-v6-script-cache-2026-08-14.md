# Staging v6 guarded script-cache verification

Date: 2026-08-14 (Asia/Taipei)

## Scope and identity

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Frontend repository/revision: `zoesuau/milkpear-admin-staging` at `f0dd177`
- Backend source revision: `4c0ad05`
- Apps Script: `Sanheyuan Admin Snapshot Staging`
- Script ID: `1PS12OSMlZVXLZ3ml-hnaCRnAcSpBnmT8Qc8gyDwi93IgdncNz8u51oI_`
- Web app deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A`
- Deployed version: 6
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Snapshot version: `20260814180441104-staging-seed`
- Dataset: 379 generated, deidentified orders
- Production frontend, production GAS version 248, Orders, and the production
  snapshot flag were not changed.

## Implementation gate

The handler validates the existing admin session before touching the cache.
For a one-document inline snapshot it then checks a script-wide, 300-second
cache entry containing the compressed manifest and payload. A Script Property
holds the expected snapshot version; a missing, malformed, oversized, or
version-mismatched entry is treated as a cache miss and falls through to the
authoritative Firestore root document. Snapshot writes publish the new version,
invalidate the old entry, write Firestore, and then prime the matching entry.

The serialized cache entry is limited to 90,000 bytes, below Apps Script's
100 KB per-key limit. Cache persistence is explicitly best-effort: eviction or
service failure is a normal miss and cannot change the returned snapshot.
Forced Firestore-failure mode is checked before cache lookup so the Drive
fallback remains testable and cannot be masked by a warm cache. The external
response keeps `source=firestore` for compatibility and adds
`snapshotTier=cache|firestore` plus `cacheMs` and `cacheHit` diagnostics.

Local regressions passed for missing session, cache hit, version mismatch,
malformed JSON, simulated cache outage, 90,000-byte guard, writer priming,
forced Drive fallback, inline checksum, exact inline limit, 2/4 chunk fallback,
batchGet response ordering, frontend provider behavior, and the production
mutation-handler bridge. The notification-transport assertion was narrowed to
actual transport identifiers so the existing `canLineNotify` data field does
not create a false positive.

## 20 cold/full loads

All 20 browser reloads loaded and painted 379 orders on the first attempt.
All 20 used `snapshotTier=cache`; `manifestMs=0`, `firestoreMs=0`, and no chunk
document request was required. Times are milliseconds.

| Run | Snapshot→paint | Network | Handler | Session | Cache | Gap | Download | Decompress | Parse | Merge | Render |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1999.5 | 1931.0 | 608 | 110 | 160 | 1323.0 | 8.5 | 2.9 | 1.1 | 4.7 | 55.0 |
| 2 | 1877.7 | 1770.5 | 499 | 103 | 95 | 1271.5 | 11.0 | 4.4 | 1.1 | 6.6 | 88.9 |
| 3 | 1603.0 | 1478.9 | 233 | 58 | 54 | 1245.9 | 12.5 | 3.3 | 2.1 | 7.5 | 102.9 |
| 4 | 1480.0 | 1383.1 | 322 | 69 | 62 | 1061.1 | 11.9 | 2.3 | 1.4 | 5.2 | 79.1 |
| 5 | 1681.5 | 1568.5 | 356 | 59 | 80 | 1212.5 | 12.3 | 4.1 | 1.3 | 7.3 | 92.5 |
| 6 | 1630.3 | 1552.1 | 448 | 96 | 110 | 1104.1 | 4.1 | 3.9 | 0.9 | 5.9 | 67.7 |
| 7 | 1534.0 | 1434.3 | 432 | 80 | 97 | 1002.3 | 7.8 | 3.5 | 1.1 | 5.7 | 85.6 |
| 8 | 1361.6 | 1291.2 | 398 | 102 | 76 | 893.2 | 13.5 | 2.3 | 0.8 | 3.7 | 52.6 |
| 9 | 1851.1 | 1717.9 | 771 | 144 | 191 | 946.9 | 19.1 | 2.6 | 1.0 | 5.3 | 108.0 |
| 10 | 1652.5 | 1569.7 | 529 | 136 | 112 | 1040.7 | 10.9 | 4.6 | 1.3 | 7.0 | 64.4 |
| 11 | 1493.0 | 1366.5 | 419 | 88 | 89 | 947.5 | 4.7 | 13.4 | 1.4 | 15.8 | 105.4 |
| 12 | 1389.6 | 1296.2 | 408 | 93 | 109 | 888.2 | 10.4 | 2.3 | 1.4 | 5.7 | 76.6 |
| 13 | 1456.4 | 1386.0 | 477 | 98 | 125 | 909.0 | 13.0 | 3.0 | 0.9 | 4.5 | 52.3 |
| 14 | 2125.0 | 2009.7 | 766 | 185 | 230 | 1243.7 | 13.1 | 5.6 | 1.0 | 7.8 | 93.6 |
| 15 | 1452.2 | 1340.4 | 412 | 88 | 77 | 928.4 | 3.2 | 12.6 | 1.1 | 15.2 | 92.8 |
| 16 | 1510.2 | 1436.1 | 402 | 88 | 64 | 1034.1 | 12.8 | 2.5 | 1.2 | 4.7 | 56.1 |
| 17 | 1668.1 | 1557.6 | 665 | 85 | 151 | 892.6 | 12.0 | 4.5 | 0.9 | 6.5 | 91.4 |
| 18 | 1401.2 | 1312.1 | 394 | 86 | 74 | 918.1 | 10.5 | 2.7 | 2.4 | 6.6 | 71.5 |
| 19 | 1664.0 | 1559.2 | 506 | 122 | 97 | 1053.2 | 4.3 | 4.5 | 1.0 | 6.7 | 93.3 |
| 20 | 1428.0 | 1288.9 | 458 | 89 | 93 | 830.9 | 0.8 | 3.9 | 1.1 | 6.2 | 131.6 |

## Summary

| Metric | P50 | P95 | Maximum |
|---|---:|---:|---:|
| Snapshot to first paint | 1569 ms | 2006 ms | 2125 ms |
| Network | 1458 ms | 1935 ms | 2010 ms |
| GAS handler | 440 ms | 766 ms | 771 ms |
| Session | 91 ms | 146 ms | 185 ms |
| Script cache | 96 ms | 193 ms | 230 ms |
| Firestore | 0 ms | 0 ms | 0 ms |
| Platform/network gap | 1018 ms | 1274 ms | 1323 ms |
| Download | 11 ms | 14 ms | 19 ms |
| Decompress | 4 ms | 13 ms | 13 ms |
| Payload parse | 1 ms | 2 ms | 2 ms |
| Merge | 6 ms | 15 ms | 16 ms |
| Render | 87 ms | 109 ms | 132 ms |

Acceptance result: 20/20 success, zero retries, P50 below 4 seconds,
P95 below 5 seconds, maximum below 5 seconds, and 20/20 cache hits.

## Miss, fallback, restore, and local-interaction gates

- Explicit cache clear: the next full load treated the cache as a miss, read
  Firestore once, primed the cache, and painted in 3676 ms; one attempt,
  `snapshotTier=firestore`, `cacheHit=false`, `manifestMs=1309`,
  `firestoreMs=1309`.
- Immediate next reload: cache hit and paint in 2015 ms; one attempt,
  `snapshotTier=cache`, `firestoreMs=0`.
- Forced Firestore failure: cache was deliberately bypassed, Drive returned
  and painted all 379 orders in 1986 ms; one attempt, `source=drive`,
  `driveMs=452`; the UI did not report a login failure.
- Firestore primary was immediately restored. The next reload returned through
  cache in 1914 ms, one attempt, `source=firestore`.
- Status-tab and search interactions preserved the exact snapshot diagnostic
  run ID, proving they did not start another snapshot read.
- The v6 `doGet` health route and identity configuration were unchanged from
  v5. A new direct command-line health fetch was attempted but the client-side
  connection did not complete and was stopped; no configuration or data was
  changed by that read-only attempt.

## Decision and rollback

The isolated staging read path passes the latency, retry, cache-miss,
Firestore-failure, Drive-fallback, restore, and local-interaction gates.
Staging rollback targets are GAS version 5 and frontend revision `81364bb`.

This result does not authorize a production cutover by itself. A production
release still requires a separately approved, cache-enabled production GAS
candidate, exact frontend/backend compatibility checks, real Orders mutation
and maintenance-trigger verification, a one-load hard gate, and an immediate
rollback to production GAS version 248 and the stable production frontend if
the first load exceeds five seconds or LINE Login changes.
