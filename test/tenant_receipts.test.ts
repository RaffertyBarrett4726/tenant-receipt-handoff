import assert from "node:assert/strict";
import test from "node:test";
import { receiptLocation } from "../src/tenant_receipts.js";

test("the same order number stays isolated between tenants", () => {
  const north = receiptLocation("North & Pine", "order/1042");
  const south = receiptLocation("South Market", "order/1042");

  assert.notEqual(north.bucket, south.bucket);
  assert.equal(north.key, "receipts/order%2F1042.json");
  assert.equal(south.key, north.key);
  assert.equal(receiptLocation("North & Pine", "order/1042").bucket, north.bucket);
});
