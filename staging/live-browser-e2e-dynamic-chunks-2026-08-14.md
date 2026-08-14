# Staging v3 dynamic-chunk live browser results — 2026-08-14

## Scope and identity

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Staging frontend/GAS source rollback point: `3df5843`
- Apps Script deployment: version 3, `Snapshot staging v3 dynamic chunks`
- Deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A` (unchanged)
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Dataset: 376 generated and deidentified orders
- Selected snapshot layout: 1 chunk; the writer automatically increases to 2 or 4 chunks only when a compressed chunk would exceed 500,000 bytes
- Production frontend, production Apps Script version 248, production Orders, and production Script Properties were not changed.

Before deployment, the local GAS boundary regression proved all four outcomes:

- 376-order fixture selects 1 chunk at the normal limit.
- Reduced test limits select 2 chunks and 4 chunks.
- Data that cannot fit safely in 4 chunks fails with `STAGING_SNAPSHOT_EXCEEDS_FOUR_CHUNKS`.

`seedStagingSyntheticSnapshot()` and `verifyStagingSyntheticSnapshot()` then completed successfully against the isolated Firestore and Drive staging copies.

## Authenticated cold-load acceptance run

The in-app browser completed the existing LINE Login flow first. Each numbered run then performed a full navigation with the authenticated staging session, forcing a fresh in-memory snapshot load. Times are milliseconds. `Parse` is envelope parse plus payload parse.

| Run | Result | Source | Attempts | Snapshot → paint | Network | Download | Decompress | Parse | Merge | Render |
|---:|:---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | pass | Firestore | 1 | 2264.8 | 2219.1 | 0.3 | 4.8 | 1.2 | 7.2 | 36.7 |
| 2 | pass | Firestore | 1 | 3060.4 | 3005.8 | 12.8 | 3.9 | 1.2 | 6.3 | 34.3 |
| 3 | pass | Firestore | 1 | 3887.6 | 3842.4 | 12.8 | 2.4 | 0.7 | 3.9 | 27.7 |
| 4 | pass | Firestore | 1 | 3919.1 | 3862.0 | 12.5 | 4.3 | 1.1 | 6.7 | 36.6 |
| 5 | pass | Firestore | 1 | 3623.7 | 3490.3 | 87.7 | 6.2 | 1.1 | 8.6 | 35.5 |
| 6 | pass | Firestore | 1 | 2225.5 | 2169.5 | 12.8 | 4.0 | 1.2 | 6.4 | 35.3 |
| 7 | pass | Firestore | 1 | 2838.2 | 2784.5 | 12.8 | 4.0 | 1.1 | 6.1 | 33.7 |
| 8 | pass | Firestore | 1 | 2182.3 | 2131.3 | 12.6 | 4.0 | 0.9 | 6.0 | 31.1 |
| 9 | pass | Firestore | 1 | 2820.8 | 2680.8 | 94.0 | 4.8 | 1.3 | 7.2 | 37.4 |
| 10 | pass | Firestore | 1 | 2686.8 | 2632.5 | 12.3 | 3.8 | 1.2 | 6.1 | 34.6 |
| 11 | pass | Firestore | 1 | 2656.8 | 2601.2 | 12.2 | 4.1 | 1.3 | 6.4 | 35.4 |
| 12 | pass | Firestore | 1 | 3368.1 | 3310.7 | 13.4 | 3.6 | 1.2 | 6.1 | 36.3 |
| 13 | pass | Firestore | 1 | 5507.4 | 5467.4 | 0.8 | 3.4 | 1.0 | 5.5 | 32.3 |
| 14 | pass | Firestore | 1 | 2706.5 | 2659.5 | 7.7 | 3.5 | 1.0 | 5.5 | 32.8 |
| 15 | pass | Firestore | 1 | 2823.5 | 2778.1 | 0.6 | 4.2 | 1.1 | 6.6 | 36.8 |
| 16 | pass | Firestore | 1 | 2835.9 | 2783.8 | 12.8 | 3.4 | 0.9 | 5.3 | 32.8 |
| 17 | pass | Firestore | 1 | 2944.5 | 2807.0 | 97.4 | 3.6 | 0.9 | 5.7 | 33.4 |
| 18 | pass | Firestore | 1 | 2498.3 | 2447.5 | 11.9 | 4.3 | 0.9 | 6.2 | 31.4 |
| 19 | pass | Firestore | 1 | 3143.0 | 3088.5 | 13.4 | 3.7 | 1.2 | 6.0 | 33.7 |
| 20 | pass | Firestore | 1 | 3534.6 | 3482.8 | 12.7 | 5.2 | 0.8 | 7.1 | 30.9 |

Nearest-rank percentiles are used for the acceptance decision.

| Metric | P50 | P95 | Maximum |
|:---|---:|---:|---:|
| Snapshot → paint | 2835.9 ms | 3919.1 ms | 5507.4 ms |
| Network/request | 2783.8 ms | 3862.0 ms | 5467.4 ms |
| Download | 12.7 ms | 94.0 ms | 97.4 ms |
| Decompress | 4.0 ms | 5.2 ms | 6.2 ms |
| Parse | 1.1 ms | 1.3 ms | 1.3 ms |
| Merge | 6.1 ms | 7.2 ms | 8.6 ms |
| Render | 33.7 ms | 36.8 ms | 37.4 ms |

Result: 20/20 successful, zero retries, Firestore source on every run, P50 2.836 seconds, and P95 3.919 seconds. The maximum was 5.507 seconds, so the percentile target passes even though the target does not mean every individual run is below five seconds.

An earlier 20-run stability set on the same version also completed 20/20, with P50 3.085 seconds, P95 4.474 seconds, maximum 10.904 seconds, and one run using the single permitted retry. It is retained as evidence of the remaining long-tail risk; the detailed run above is the acceptance dataset because it records every required browser phase.

## Drive fallback

`forceStagingFirestoreFailure()` was enabled only for one isolated staging load:

- Result: success, 376 orders
- Source: Drive, marked stale
- Attempts: 1
- Snapshot → paint: 2667.7 ms
- Backend Firestore failure detection: 34 ms
- Backend Drive read: 336 ms
- No login-failure message was displayed

`restoreStagingFirestorePrimary()` was run immediately afterward. A verification reload returned to Firestore in one attempt and painted in 2103.7 ms.

## Decision

The staging v3 read-path acceptance criteria pass:

- Existing LINE Login completed normally.
- 20 cold loads had zero failures.
- P50 is at most 4 seconds and P95 is at most 5 seconds.
- No run exceeded one retry.
- Drive fallback succeeded without being reported as an authentication failure.
- Local fixed regressions still prove that tabs, search, date, source, and pagination do not call the order backend.

This does **not** authorize or perform a production switch. Real production mutation consistency for add/edit/payment/cancel/schedule/sent actions must still be verified against Orders before declaring the complete system stable or saleable.
