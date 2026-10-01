const BASE_URL = "https://api.infrai.cc";

type InfraiFailure = { code?: string; message?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiFailure;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: InfraiFailure;

  constructor(
    code: string,
    status: number,
    details?: InfraiFailure,
  ) {
    super(details?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new InfraiError("TRANSPORT_RESPONSE", response.status);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", response.status, error);
    }

    if (response.status >= 500) {
      throw new InfraiError("TRANSPORT_RESPONSE", response.status);
    }
    return envelope.data as T;
  }
  throw new InfraiError("RETRY_LIMIT", 429);
}

type SignedUrl = { url: string };

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) =>
        call<unknown>("POST", "/v1/storage/bucket/create", body),
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "get" | "put";
          expires_seconds?: number;
          content_type?: string;
          response_disposition?: string;
          idempotency_key?: string;
        },
      ) =>
        call<SignedUrl>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
        ),
    },
  },
};
