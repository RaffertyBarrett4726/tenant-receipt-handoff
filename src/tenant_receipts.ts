import { createHash } from "node:crypto";
import { infrai, InfraiError } from "./infrai.js";

export type FulfilledOrder = {
  tenantId: string;
  orderId: string;
  customer: { email: string };
  checkout: { currency: string; totalMinor: number };
  fulfillment: { carrier: string; trackingNumber: string };
};

export type CustomerOrderUpdate = {
  orderId: string;
  state: "fulfilled";
  recipient: string;
  trackingNumber: string;
  receiptUrl: string;
};

export function receiptLocation(tenantId: string, orderId: string) {
  const readable = tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "tenant";
  const tenantHash = createHash("sha256").update(tenantId).digest("hex").slice(0, 12);
  const safeOrderId = encodeURIComponent(orderId);
  return {
    bucket: `shop-${readable.slice(0, 30)}-${tenantHash}`,
    key: `receipts/${safeOrderId}.json`,
  };
}

async function ensureTenantBucket(bucket: string): Promise<void> {
  try {
    await infrai.storage.bucket.create({ name: bucket });
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 409) throw error;
  }
}

export async function recordFulfillment(order: FulfilledOrder): Promise<CustomerOrderUpdate> {
  const { bucket, key } = receiptLocation(order.tenantId, order.orderId);
  await ensureTenantBucket(bucket);

  const receipt = JSON.stringify({
    orderId: order.orderId,
    checkout: order.checkout,
    fulfillment: order.fulfillment,
  });
  const put = await infrai.storage.object.presign(bucket, key, {
    op: "put",
    expires_seconds: 300,
    content_type: "application/json",
    idempotency_key: `receipt-${order.tenantId}-${order.orderId}`,
  });
  const upload = await fetch(put.url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: receipt,
  });
  if (!upload.ok) throw new Error(`Receipt upload returned HTTP ${upload.status}`);

  const download = await infrai.storage.object.presign(bucket, key, {
    op: "get",
    expires_seconds: 900,
    response_disposition: `attachment; filename="receipt-${order.orderId}.json"`,
  });

  return {
    orderId: order.orderId,
    state: "fulfilled",
    recipient: order.customer.email,
    trackingNumber: order.fulfillment.trackingNumber,
    receiptUrl: download.url,
  };
}
