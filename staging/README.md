# Snapshot provider v2 local staging

This harness exercises the candidate admin frontend without a production URL,
production GAS deployment, real LINE session, or real order data.

Run from the repository root:

```bash
node staging/mock-snapshot-server.mjs 4173
```

Open one of these local-only entry points:

- Firestore path: `http://127.0.0.1:4173/__seed-session?scenario=firestore`
- Drive fallback: `http://127.0.0.1:4173/__seed-session?scenario=drive`
- Both unavailable: `http://127.0.0.1:4173/__seed-session?scenario=unavailable`
- No session: `http://127.0.0.1:4173/`

The mock contains 376 generated, deidentified orders in 32 buckets. The event
log at `/events` stores only action names and timestamps. It is used to prove
that tab, search, date, source, and pagination operations do not call the order
backend, while the shipping-print data is still loaded on demand.

`local-browser-e2e-results.json` records the 2026-08-14 browser run. These are
localhost mock timings and must not be used as evidence that Google, Firestore,
Drive, GAS, or LINE meets the production latency acceptance target.

## Isolated Google staging deployment (2026-08-14)

- Apps Script project: `Sanheyuan Admin Snapshot Staging`
- Script ID: `1PS12OSMlZVXLZ3ml-hnaCRnAcSpBnmT8Qc8gyDwi93IgdncNz8u51oI_`
- Standard GCP project number: `261143837915`
- Web app deployment ID: `AKfycbxxbaWN-hi8_L2DBkXYIJ3Goq-exNepfImswYDe54VRFG4wxGpi7Rl5FUdO-pWpaBgQ7A`
- Frontend: `https://zoesuau.github.io/milkpear-admin-staging/`
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Drive folder: `三合院訂單快照備援 STAGING`
- Dataset: exactly 379 generated, deidentified orders; the gzip payload is
  stored in the root manifest document when it is at most 500,000 compressed
  bytes, automatically falling back to 2 or 4 chunk documents when required

The project has no Google Sheets scope and no order mutation endpoint. Script
properties contain one staging admin allowlist entry and the LINE channel
secret, but neither value is stored in this repository or exposed by the health
endpoint. `seedStagingSyntheticSnapshot()` and
`verifyStagingSyntheticSnapshot()` both completed successfully; the health
endpoint reported the staging environment, one allowed admin, and configured
Drive folder/file without returning order data.

Rollback is isolated: point `customer-config.js` back to the prior staging GAS
URL (or the placeholder) and redeploy only the staging repository. Production
Pages, production Apps Script version 248, and production data are not part of
this deployment.

The authenticated live browser results are recorded in
[`live-browser-e2e-results-2026-08-14.md`](live-browser-e2e-results-2026-08-14.md).
The cold/full snapshot path did not meet the production-switching acceptance
target, so this staging version remains test-only.

The follow-up `batchGet` v2 results are recorded in
[`live-browser-e2e-batchget-2026-08-14.md`](live-browser-e2e-batchget-2026-08-14.md).
Version 2 improved cold-load success from 18/20 to 20/20 and reduced P50/P95,
but it still exceeded the 4/5-second latency targets and remains test-only.

The dynamic-chunk v3 results are recorded in
[`live-browser-e2e-dynamic-chunks-2026-08-14.md`](live-browser-e2e-dynamic-chunks-2026-08-14.md).
Its fully instrumented 20-run set completed 20/20 with P50 2.836 seconds and
P95 3.919 seconds, and the forced Drive fallback also passed. The isolated read
path therefore meets its latency acceptance target, but production remains
unchanged until real order-mutation consistency is separately verified.

The isolated mutation-shape results are recorded in
[`mutation-consistency-2026-08-14.md`](mutation-consistency-2026-08-14.md).
Seven synthetic scenarios reconciled against Firestore and Drive and the
376-order baseline was restored. This passes projection consistency only; it
does not replace a later controlled verification of the real production GAS
handler-to-snapshot bridge.

The production-candidate handler bridge gate is recorded in
[`production-handler-bridge-gate-2026-08-14.md`](production-handler-bridge-gate-2026-08-14.md).
It executes the real candidate queue/flush functions with isolated adapters,
verifies seven write handlers enter the bridge, proves failed manifest writes
retain their queue items, and makes zero notification transport calls. The
pre-cutover engineering gate passes; production deployment remains a separate,
explicitly authorized operation.

The 379-order cold-start diagnostics are recorded in
[`live-browser-e2e-v4-379-2026-08-14.md`](live-browser-e2e-v4-379-2026-08-14.md).
Version 4 completed 20/20 Firestore cold loads with P50 2.889 seconds and P95
4.032 seconds, plus a successful Drive fallback and Firestore restore. The
browser phases remain negligible; Firestore and the Apps Script/platform
network gap dominate. This staging pass does not by itself authorize another
production switch.

The single-document v5 results are recorded in
[`live-browser-e2e-v5-single-document-2026-08-14.md`](live-browser-e2e-v5-single-document-2026-08-14.md).
Version 5 completed 20/20 Firestore cold loads with zero retries, P50 2.554
seconds, P95 3.142 seconds, and maximum 3.438 seconds. Forced Drive fallback
and Firestore restore also passed. This remains an isolated staging result and
does not authorize a production cutover.
