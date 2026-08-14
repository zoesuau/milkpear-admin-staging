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
