# Staging batchGet v2 live browser results — 2026-08-14

## Identity and change

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Source commit: `63ea36a`
- Apps Script project: `Sanheyuan Admin Snapshot Staging`
- GAS deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A`
- GAS deployment version: 2
- Dataset: 376 generated, deidentified orders in 32 chunks
- Change: replace 32 parallel document GET requests with one Firestore
  `documents:batchGet` request; restore responses to manifest order.

LINE Login, the frontend snapshot envelope, Firestore schema, Drive fallback,
and the 32-chunk update layout were not changed.

## Cold/full snapshot loads

Each run reloaded the staging page in the same authenticated browser tab. Every
run therefore started with empty in-memory version/chunk state and requested the
complete 32-chunk Firestore snapshot.

| Run | Result | Attempts | Snapshot to paint | Wall time | batchGet chunk time |
|---:|:---:|---:|---:|---:|---:|
| 1 | pass | 1 | 6.473 s | 6.569 s | 3.978 s |
| 2 | pass | 1 | 5.948 s | 6.023 s | 4.061 s |
| 3 | pass | 1 | 6.030 s | 6.132 s | 4.167 s |
| 4 | pass | 1 | 5.908 s | 6.009 s | 4.310 s |
| 5 | pass | 1 | 6.412 s | 6.505 s | 4.147 s |
| 6 | pass | 1 | 6.684 s | 6.810 s | 4.792 s |
| 7 | pass | 1 | 6.771 s | 6.902 s | 4.142 s |
| 8 | pass | 1 | 7.649 s | 7.722 s | 5.443 s |
| 9 | pass | 1 | 7.856 s | 7.944 s | 5.316 s |
| 10 | pass | 1 | 7.188 s | 7.268 s | 4.625 s |
| 11 | pass | 1 | 6.405 s | 6.471 s | 4.034 s |
| 12 | pass | 1 | 5.681 s | 5.768 s | 3.908 s |
| 13 | pass | 1 | 6.393 s | 6.455 s | 4.591 s |
| 14 | pass | 1 | 7.844 s | 7.900 s | 5.075 s |
| 15 | pass | 1 | 6.334 s | 6.392 s | 4.508 s |
| 16 | pass | 1 | 5.561 s | 5.676 s | 3.877 s |
| 17 | pass | 1 | 4.710 s | 4.764 s | 3.059 s |
| 18 | pass | 1 | 6.970 s | 7.024 s | 5.184 s |
| 19 | pass | 2 | 15.638 s | 15.763 s | 4.130 s (final attempt) |
| 20 | pass | 1 | 5.606 s | 5.670 s | 3.941 s |

Summary:

- Success: 20/20
- Failed: 0/20
- Runs requiring the allowed retry: 1/20
- Source: Firestore 20/20
- Snapshot-to-paint P50: 6.408 s
- Snapshot-to-paint P95: 8.245 s
- Longest: 15.638 s

Successful final-attempt timing (P50 / P95):

- Browser network: 6.341 / 7.758 s
- GAS handler: 5.238 / 6.729 s
- Backend Firestore total: 5.008 / 6.362 s
- Firestore batchGet chunk read: 4.157 / 5.322 s
- Browser download: 0.037 / 0.040 s
- Browser gzip decompression: 0.019 / 0.022 s
- Browser JSON parse: 0.001 / 0.002 s
- Browser merge: 0.022 / 0.024 s
- Browser render: 0.026 / 0.028 s

## Drive fallback regression

The staging-only Firestore failure flag was enabled for one read and restored
immediately afterward.

- Drive fallback: pass on first attempt
- UI-complete time: 2.190 s
- Drive backend time: 0.449 s
- Orders displayed: 376
- Login failure shown: no
- Restored Firestore read: pass in 3.810 s
- Drive warning after restore: no

## Comparison with v1

| Metric | v1: 32 individual GETs | v2: one batchGet |
|---|---:|---:|
| Success | 18/20 | 20/20 |
| Retried runs | 8/20 | 1/20 |
| Snapshot-to-paint P50 | 7.684 s | 6.408 s |
| Snapshot-to-paint P95 | 15.375 s | 8.245 s |

`batchGet` materially improves stability and latency, but reading 32 Firestore
documents in one batch still dominates the request.

## Acceptance decision

**Not accepted for production switching.**

- Required success: 20/20; observed: 20/20 — pass
- Required P50 <= 4 s; observed: 6.408 s — fail
- Required P95 <= 5 s; observed: 8.245 s — fail
- Required at most one retry: pass

The next isolated experiment should reduce the physical chunk count from 32 to
a size-based 1–4 chunks while retaining `batchGet` and the same frontend
envelope. No production frontend, production GAS, or production data was
changed during this test.
