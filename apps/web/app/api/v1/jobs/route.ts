import { validateVectorJobRequest, type VectorJobRequest } from "@evavo/vector-core";

export const runtime = "nodejs";

const headers = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  let input: VectorJobRequest;
  try {
    input = (await request.json()) as VectorJobRequest;
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400, headers });
  }

  const errors = validateVectorJobRequest(input);
  if (errors.length > 0) {
    return Response.json({ error: "VECTOR_JOB_INVALID", details: errors }, { status: 422, headers });
  }

  return Response.json(
    {
      error: "VECTOR_DURABLE_QUEUE_NOT_AVAILABLE",
      message: "No persistent or resumable worker queue is deployed. Use POST /api/v1/trace with multipart/form-data for bounded synchronous SVG tracing.",
      requestAccepted: false,
      durableExecutionAvailable: false,
      links: {
        trace: "/api/v1/trace",
        documentation: "/docs/API.md",
      },
    },
    { status: 501, headers },
  );
}

export function GET(): Response {
  return Response.json(
    {
      service: "evavo-vector-studio",
      version: "v1",
      durableQueueAvailable: false,
      boundedSynchronousTraceAvailable: true,
      links: { trace: "/api/v1/trace" },
    },
    { headers },
  );
}
