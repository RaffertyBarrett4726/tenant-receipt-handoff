import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError } from "./infrai.js";
import { recordFulfillment } from "./tenant_receipts.js";

const fulfilledOrderSchema = z.object({
  tenantId: z.string().min(1).max(80),
  orderId: z.string().min(1).max(100),
  customer: z.object({ email: z.string().email() }),
  checkout: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    totalMinor: z.number().int().nonnegative(),
  }),
  fulfillment: z.object({
    carrier: z.string().min(1),
    trackingNumber: z.string().min(1),
  }),
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/orders/fulfilled") {
    json(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const order = fulfilledOrderSchema.parse(await readJson(request));
    const update = await recordFulfillment(order);
    json(response, 201, update);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "Invalid fulfillment event" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { error: error.code, message: error.message });
      return;
    }
    console.error(error);
    json(response, 500, { error: "Fulfillment could not be recorded" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Fulfillment service listening at http://localhost:${port}`);
});
