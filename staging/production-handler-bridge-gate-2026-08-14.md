# Production-handler to snapshot bridge gate — 2026-08-14

## Scope

This is the final pre-cutover engineering gate for the snapshot mutation bridge. It executes the bridge and queue/flush code taken directly from the production GAS candidate source `0707.gs`, while all Orders and external notification transports remain isolated.

- Production GAS candidate source SHA-256: `b982a16c07fa8d30a2fda783ff64c055f992f6f48254cae1fdf455e898593338`
- Executable regression: `staging/test_production_snapshot_handler_bridge.mjs`
- Production Orders mutations: 0
- Real notification transport calls: 0
- Production deployments: 0
- Public staging GAS deployment remained version 3.

## Handler mapping

The test reads the actual candidate source and fails if an action no longer dispatches to the expected handler or if the handler success path no longer enters `syncAdminOrderSnapshotResponse_()` / `syncAdminOrderSnapshotAfterMutation_()`.

| Mutation | Production action | Handler | Bridge present |
|:---|:---|:---|:---:|
| Add | `adminCreateOrder` | `handleAdminCreateOrderRequest_` | pass |
| Full edit | `adminUpdateOrderContent` | `handleAdminUpdateOrderContentRequest_` | pass |
| Administrator note | `adminUpdateOrderAdminNote` | `handleAdminUpdateOrderAdminNoteRequest_` | pass |
| Payment / schedule | `adminUpdateOrderWorkflow` | `handleAdminUpdateOrderWorkflowRequest_` | pass |
| Cancel | `adminCancelOrder` | `handleAdminCancelOrderRequest_` | pass |
| Actual shipping date | `adminUpdateActualShippingDate` | `handleAdminUpdateActualShippingDateRequest_` | pass |
| Shipped | `adminMarkOrderShipped` | `handleAdminMarkOrderShippedRequest_` | pass |

## Runtime bridge verification

The actual candidate implementations of `syncAdminOrderSnapshotAfterMutation_()`, `syncAdminOrderSnapshotResponse_()`, and `flushAdminOrderSnapshotMutationQueue_()` ran against isolated in-memory Script Properties and Firestore adapters.

Verified outcomes:

- Six complete mutation shapes queued successfully: add, edit, payment, schedule, cancel, shipped.
- Only the snapshot field allowlist entered the queue; internal tokens and notification history were excluded.
- Repeated updates to one order overwrote the same queue key with the latest state.
- A failed business response did not queue an order.
- With the snapshot feature disabled, no Script Property was touched.
- Queue flush updated existing orders and added new orders in only the affected buckets.
- The next manifest retained the unchanged buckets and reconciled the correct total count.
- Queue keys were deleted only after the new manifest was published successfully.
- A forced manifest publication failure returned `SNAPSHOT_FLUSH_FAILED` and retained the queue item for retry.
- The bridge source contained no notification transport and the test made zero notification calls.

## Regression results

- Production snapshot handler bridge regression: pass.
- Staging GAS backend regression: pass.
- Snapshot provider v2 regression: pass.
- Seventeen non-deployment-identity fixed regressions: 17/17 pass, including payment/inventory rules, note/content writes, mark-shipped-without-notification, create-order network recovery, auth resilience, local workspace, and versioned snapshots.
- Full suite deployment identity gate: correctly blocked because the active deployment directory is deliberately configured for `sanheyuan/staging`, while that test requires `sanheyuan/production`. No configuration was changed to bypass it.

## Decision and rollback

The handler-to-snapshot bridge pre-cutover gate passes. The forced manifest failure demonstrates the required rollback/retry invariant: Orders remain authoritative and the queued latest order is preserved until a future successful manifest publication.

This result authorizes preparing a production cutover plan; it does not itself authorize or perform the production deployment. The production switch must still keep frontend `c8257bc` and GAS version 248 as immediate rollback points, create and verify the first production snapshot before enabling the frontend, run one safe live transaction with notifications disabled, and revert immediately if login, count reconciliation, mutation reconciliation, or latency fails.
