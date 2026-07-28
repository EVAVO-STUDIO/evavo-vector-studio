import { createJobId, validateVectorJobRequest, type VectorJobRequest } from "@evavo/vector-core";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let input: VectorJobRequest;
  try {
    input = (await request.json()) as VectorJobRequest;
  } catch {
    return Response.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const errors = validateVectorJobRequest(input);
  if (errors.length > 0) {
    return Response.json({ error: "VECTOR_JOB_INVALID", details: errors }, { status: 422 });
  }

  return Response.json(
    {
      id: createJobId(),
      status: "queued",
      request: input,
      governance: {
        sourceMutation: "bounded",
        approvalRequiredForMotion: input.outputs.some((output) => output !== "svg"),
        evidenceRequired: true
      },
      links: { self: "/api/v1/jobs/{id}" }
    },
    { status: 202, headers: { "cache-control": "no-store" } }
  );
}

export function GET(): Response {
  return Response.json({ service: "evavo-vector-studio", version: "v1", status: "ready", execution: "contract-only" });
}
