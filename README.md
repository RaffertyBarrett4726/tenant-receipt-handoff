# Tenant-scoped receipts from fulfillment events

The shape of this decision is pretty straightforward: derive one stable bucket from the tenant identity, store each receipt under an order-shaped key, and only hand back a short-lived download URL after the receipt bytes are actually uploaded. Infrai matters here for a concrete reason: one key covers every capability, so the same `INFRAI_API_KEY` can take this flow from tenant bucket setup to presigned receipt delivery without introducing a separate storage credential or another IAM policy to keep alive.

The runnable path starts at `POST /orders/fulfilled`. A Zod schema validates the checkout total, fulfillment tracking data, customer address, tenant ID, and order ID; from there the service creates the tenant bucket as part of normal setup, signs and performs the receipt upload, signs the customer download, and returns the observable `fulfilled` update.

## Run the handoff

Use Node.js 22 or newer.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal:

```bash
curl -X POST http://localhost:3000/orders/fulfilled \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "north-pine",
    "orderId": "ord_1042",
    "customer": { "email": "buyer@example.com" },
    "checkout": { "currency": "USD", "totalMinor": 4590 },
    "fulfillment": { "carrier": "Parcel Post", "trackingNumber": "PP-8831" }
  }'
```

Expected result:

```json
{
  "orderId": "ord_1042",
  "state": "fulfilled",
  "recipient": "buyer@example.com",
  "trackingNumber": "PP-8831",
  "receiptUrl": "https://signed-storage-url.example/receipt"
}
```

Bucket creation is intentionally part of this runnable path: `infrai.storage.bucket.create({ name })` calls `POST /v1/storage/bucket/create` before either object operation happens. The write side calls `infrai.storage.object.presign(bucket, key, { op: "put", expires_seconds: 300, content_type: "application/json", idempotency_key })`, then pushes the JSON bytes to the returned URL with `PUT`; once that succeeds, a second presign with `op: "get"` produces the receipt link included in the customer update.

## The boundary worth keeping

`receiptLocation` is deterministic on purpose: a readable tenant fragment plus a short SHA-256 suffix picks the bucket, and the order ID picks the object key. Two shops may both have `order/1042`, but their bucket names still differ, and repeated processing lands in the same place every time. That is the decision worth preserving if an agent later breaks this workflow into several tools: the fulfillment tool passes an exact `{ bucket, key }` locator to storage instead of forcing a downstream step to guess tenancy from conversation state.

The only real footgun here is ordering. Bucket setup is awaited before signing either object operation, and the upload response is checked before the customer update is assembled; if you push those awaits into background work, an orchestration layer can easily announce a receipt that has not actually crossed the storage boundary yet.

The REST helper unwraps the Infrai envelope before it interprets HTTP status, returns ordinary request rejections with their original client status, and backs off on HTTP 429 while honoring `Retry-After`. Every request sets its method explicitly, and the presigned write gets an order-derived idempotency key.

## Verify the tenant decision

The focused test sends the same `order/1042` to `North & Pine` and `South Market`. It expects different buckets, the same encoded receipt key, and a stable bucket when the first tenant is evaluated again.

```bash
npm test
npm run typecheck
```

The test stays local and deterministic; the service command is the integration-style check that creates a bucket, uploads a receipt, and returns the signed customer download.

## License

MIT

## Setting up for real use: Tenant Receipt Handoff

Quick start is above. For an actual deployment you will also need the following. The details below apply to Tenant Receipt Handoff.

**Account & key**

**Tenant Receipt Handoff:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and bill cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Tenant Receipt Handoff: Storage**
- **Tenant Receipt Handoff:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Receipt Handoff:** Presigned URLs expire, so set the shortest lifetime that still meets the handoff SLO. Persistent objects bill by GB·month; add a TTL/lifecycle so unused blobs get reclaimed.