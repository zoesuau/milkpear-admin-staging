# Staging synthetic mutation consistency — 2026-08-14

## Boundary

- Apps Script project: `Sanheyuan Admin Snapshot Staging`
- Script ID: `1PS12OSMlZVXLZ3ml-hnaCRnAcSpBnmT8Qc8gyDwi93IgdncNz8u51oI_`
- Source rollback point: `09c15ea`
- Data: 376 generated and deidentified orders only
- Firestore root: `adminOrderSnapshots/sanheyuan-staging`
- Drive fallback: staging-only file in `三合院訂單快照備援 STAGING`
- Public staging deployment remained GAS version 3; the test ran from the saved but undeployed editor head.
- Production frontend, production GAS version 248, production Orders, production Firestore/Drive snapshot, notifications, inventory, payment, and Script Properties were not changed.

The staging backend remains read-only from the web: it has no Google Sheets scope and exposes no order-mutation endpoint. `testStagingSyntheticMutationConsistency()` is an editor-only test function guarded by the staging identity.

## Procedure

The test treated an in-memory 376-order generated dataset as the isolated authoritative Orders fixture. It applied these scenarios sequentially:

1. Add one administrator-created order.
2. Fully edit recipient, address, item summary, amount, and administrator note.
3. Change payment method/state/status to paid bank transfer.
4. Schedule an expected shipping date and shipping batch.
5. Cancel a separate order.
6. Mark a separate order shipped with actual date and tracking number.
7. Record a successful shipment notification result.

After every scenario the test:

- wrote a new versioned snapshot using the same compressed-size 1/2/4-chunk planner;
- read Firestore back and compared every order with the authoritative fixture;
- read the Drive fallback back and compared every order with the authoritative fixture;
- confirmed the browser-equivalent reconstructed snapshot matched the authoritative fixture;
- confirmed the expected total was 377 after the add and remained 377 for updates.

The function uses `finally` to restore the original 376 generated orders even when a scenario throws.

## Result

- Local staging GAS mutation regressions: pass.
- Existing snapshot-provider and auth isolation regressions: pass.
- Live Apps Script execution: completed normally in approximately 29 seconds.
- Scenarios completed: add, edit, payment, schedule, cancel, shipped, notification.
- Post-test `verifyStagingSyntheticSnapshot()`: completed normally.
- Restored count: 376 in Firestore and Drive.
- Real customer messages sent: 0.
- Real Orders rows created or modified: 0.

## Decision

The isolated snapshot projection now passes the required mutation shapes. This proves the Firestore/Drive projection can represent and reconcile the changed fields, but it does not yet prove that production GAS handlers enqueue every real Orders mutation correctly.

Before production switching, the next controlled gate must verify the real handler-to-projection bridge for add/edit/payment/cancel/schedule/shipped actions without sending customer notifications. Production must remain on frontend `c8257bc` and GAS version 248 until that gate, rollback rehearsal, and explicit cutover authorization pass.
