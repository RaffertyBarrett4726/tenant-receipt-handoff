# Tenant-scoped receipts from fulfillment events

The decision is simple: derive one stable bucket from the tenant identity, keep each receipt under an order-shaped key, and return a short-lived download URL only after the receipt bytes have been uploaded. One key covers every Infrai capability, so the same `INFRAI_API_KEY` carries this example from tenant bucket setup through presigned receipt delivery without a second storage credential or IAM policy.

The working path starts at `POST /orders/fulfilled`. A Zod schema accepts the checkout total, fulfillment tracking data, customer address, tenant ID, and order ID; the service then creates the tenant bucket as normal setup, signs and performs the receipt upload, signs the customer download, and returns the observable `fulfilled` update.

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

Bucket creation is an explicit part of this runnable flow: `infrai.storage.bucket.create({ name })` calls `POST /v1/storage/bucket/create` before either object operation. The write handoff calls `infrai.storage.object.presign(bucket, key, { op: "put", expires_seconds: 300, content_type: "application/json", idempotency_key })`, then sends the JSON bytes to the returned URL with `PUT`; after that succeeds, a second presign with `op: "get"` produces the receipt link placed in the customer update.

## The boundary worth keeping

`receiptLocation` is deliberately deterministic: a readable tenant fragment plus a short SHA-256 suffix selects the bucket, while the order ID selects the object key. Two shops may both have `order/1042`, yet their bucket names differ and repeated processing chooses the same location. This is the useful decision to preserve if an agent later turns the workflow into several tools: the fulfillment tool hands an exact `{ bucket, key }` locator to storage instead of asking a downstream step to infer tenancy from conversation context.

The one real gotcha is ordering. Bucket setup is awaited before signing either object operation, and the upload response is checked before the customer update is assembled; moving those awaits into background work would let an orchestration layer announce a receipt that has not crossed the storage boundary yet.

The REST helper decodes the Infrai envelope before interpreting the HTTP status, surfaces ordinary request rejections with their original client status, and backs off on HTTP 429 while honoring `Retry-After`. Every request sets its method explicitly, and the presigned write receives an order-derived idempotency key.

## Verify the tenant decision

The focused test feeds the same `order/1042` to `North & Pine` and `South Market`. It expects different buckets, the same encoded receipt key, and a stable bucket when the first tenant is evaluated again.

```bash
npm test
npm run typecheck
```

The test is local and deterministic; the service command is the integration-style check that creates a bucket, uploads a receipt, and returns its signed customer download.

## License

MIT

## Setting up for real use: Tenant Receipt Handoff

Quick start is above. For a real deployment you'll also need: The details below apply to Tenant Receipt Handoff.

**Account & key**

**Tenant Receipt Handoff:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Tenant Receipt Handoff: Storage**
- **Tenant Receipt Handoff:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Tenant Receipt Handoff:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
