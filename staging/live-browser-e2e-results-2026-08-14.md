# Staging live browser E2E results — 2026-08-14

## Identity and scope

- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Frontend commit: `e9534ccb7a97e0810382bd83bc6f12c4592512d7`
- GAS deployment: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A`
- Dataset: 376 generated, deidentified orders in 32 chunks
- Production data and production deployments were not used or changed.

## Cold/full snapshot loads

Each run reloaded the staging page in the same authenticated browser tab. This
cleared the page's in-memory snapshot version and chunks, so every run requested
the full 32-chunk Firestore snapshot again.

| Run | Result | Attempts | Source | Snapshot to paint | Wall time |
|---:|:---:|---:|:---:|---:|---:|
| 1 | pass | 1 | Firestore | 7.792 s | 8.652 s |
| 2 | pass | 1 | Firestore | 7.839 s | 7.969 s |
| 3 | **fail** | 2 | — | — | 16.862 s |
| 4 | pass | 1 | Firestore | 7.576 s | 7.635 s |
| 5 | pass | 1 | Firestore | 7.971 s | 8.078 s |
| 6 | pass | 1 | Firestore | 6.369 s | 6.490 s |
| 7 | pass | 2 | Firestore | 15.714 s | 15.772 s |
| 8 | pass | 2 | Firestore | 14.765 s | 14.877 s |
| 9 | pass | 1 | Firestore | 6.645 s | 6.717 s |
| 10 | **fail** | 2 | — | — | 16.971 s |
| 11 | pass | 1 | Firestore | 6.062 s | 6.118 s |
| 12 | pass | 1 | Firestore | 4.894 s | 4.957 s |
| 13 | pass | 2 | Firestore | 15.316 s | 15.420 s |
| 14 | pass | 1 | Firestore | 7.034 s | 7.146 s |
| 15 | pass | 2 | Firestore | 14.937 s | 15.040 s |
| 16 | pass | 1 | Firestore | 6.660 s | 6.769 s |
| 17 | pass | 1 | Firestore | 6.527 s | 6.644 s |
| 18 | pass | 1 | Firestore | 6.901 s | 6.982 s |
| 19 | pass | 2 | Firestore | 13.514 s | 13.613 s |
| 20 | pass | 2 | Firestore | 14.632 s | 14.760 s |

- Success: 18/20 (90%)
- Failed after the allowed retry: 2/20
- Runs that required a retry: 8/20
- Successful snapshot-to-paint P50: 7.684 s
- Successful snapshot-to-paint P95: 15.375 s
- Longest successful snapshot-to-paint: 15.714 s
- Failure reason: frontend 8-second request timeout (`signal is aborted without reason`)

Successful final-attempt timing (P50 / P95):

- Network: 6.490 / 7.760 s
- GAS handler: 5.319 / 6.650 s
- Backend Firestore total: 4.979 / 6.279 s
- Firestore chunk reads: 4.457 / 5.151 s
- Browser download: 0.044 / 0.106 s
- Browser gzip decompression: 0.020 / 0.023 s
- Browser JSON parse: 0.001 / 0.002 s
- Browser merge: 0.022 / 0.025 s
- Browser render: 0.026 / 0.028 s

The dominant bottleneck is the GAS/Firestore full 32-chunk read. Browser
download, decompression, parsing, merge, and render are not material bottlenecks.

## Authenticated same-version refreshes

Twenty consecutive refreshes with the same snapshot version all returned the
Firestore `unchanged` response without downloading chunks.

- Success: 20/20
- Retry: 0/20
- Source: Firestore 20/20
- UI-complete P50: 1.935 s
- UI-complete P95: 3.123 s
- Longest: 3.300 s

## Forced Drive fallback

The staging-only Firestore failure flag was enabled for one read and then
restored immediately.

- Result: pass on the first attempt
- Source: Drive
- UI-complete time: 2.386 s
- Drive backend time: 0.409 s
- Orders displayed: 376
- Login failure shown: no
- After restoring the flag, the next read used Firestore in 2.176 s and the
  Drive warning disappeared.

## Acceptance decision

**Not accepted for production switching.**

The same-version refresh and Drive fallback paths pass, but the required cold
snapshot target does not:

- Required: 20/20 success; observed: 18/20
- Required P50 <= 4 s; observed: 7.684 s
- Required P95 <= 5 s; observed: 15.375 s
- Required at most one retry: pass, but 8/20 runs needed that retry

No production frontend, production GAS, or production data was changed during
this test.
