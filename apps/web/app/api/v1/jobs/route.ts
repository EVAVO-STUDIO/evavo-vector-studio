import { apiAuthorisationFailure, apiJson } from "../../../../lib/api-security";
import {
  HOSTED_JOB_REQUEST_MAX_BYTES,
  hostedJobErrorResponse,
  hostedJobRuntimeView,
  hostedJobView,
  requireHostedJobRuntime,
} from "../../../../lib/hosted-job-api";
import { getHostedJobRuntime } from "../../../../lib/hosted-job-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  return apiJson({
    service: "evavo-vector-studio",
    version: "v1",
    execution: "hosted-job-control-plane",
    contract: hostedJobRuntimeView(await getHostedJobRuntime()),
  });
}

export async function POST(request: Request): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request);
  if (authFailure) return authFailure;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > HOSTED_JOB_REQUEST_MAX_BYTES
  ) {
    return apiJson(
      {
        error: "HOSTED_JOB_REQUEST_TOO_LARGE",
        maximumBytes: HOSTED_JOB_REQUEST_MAX_BYTES,
      },
      413,
    );
  }

  const resolved = await requireHostedJobRuntime();
  if (resolved.response) return resolved.response;
  const controller = resolved.runtime.controller!;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiJson({ error: "HOSTED_JOB_INVALID_JSON" }, 400);
  }

  try {
    const created = await controller.create(input);
    return apiJson(
      {
        created: !created.reused,
        idempotentReplay: created.reused,
        executionScheduled: false,
        remoteExecutionAvailable: false,
        message: created.reused
          ? "The existing hosted job record was returned for this idempotency key."
          : "The hosted job record was created. No remote worker is deployed, so execution has not been scheduled.",
        job: hostedJobView(created.record),
      },
      created.reused ? 200 : 201,
      { location: `/api/v1/jobs/${encodeURIComponent(created.record.id)}` },
    );
  } catch (error) {
    return hostedJobErrorResponse(error);
  }
}
