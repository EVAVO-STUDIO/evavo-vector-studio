import { apiAuthorisationFailure, apiJson } from "../../../../../lib/api-security";
import {
  hostedJobErrorResponse,
  hostedJobView,
  requireHostedJobRuntime,
} from "../../../../../lib/hosted-job-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANCELLATION_BODY_BYTES = 4 * 1024;

function jobIdFrom(params: Readonly<{ jobId: string }>): string {
  return decodeURIComponent(params.jobId).trim();
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Readonly<{ jobId: string }> }>,
): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  const resolved = await requireHostedJobRuntime();
  if (resolved.response) return resolved.response;

  try {
    const record = await resolved.runtime.controller!.get(jobIdFrom(context.params));
    return apiJson({ job: hostedJobView(record) });
  } catch (error) {
    return hostedJobErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: Readonly<{ params: Readonly<{ jobId: string }> }>,
): Promise<Response> {
  const authFailure = apiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  const resolved = await requireHostedJobRuntime();
  if (resolved.response) return resolved.response;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CANCELLATION_BODY_BYTES
  ) {
    return apiJson(
      {
        error: "HOSTED_JOB_CANCELLATION_TOO_LARGE",
        maximumBytes: MAX_CANCELLATION_BODY_BYTES,
      },
      413,
    );
  }

  let options: Readonly<{ reason?: string; requestedBy?: string }> = {};
  try {
    const source = await request.text();
    if (source.trim()) {
      const parsed = JSON.parse(source) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return apiJson({ error: "HOSTED_JOB_CANCELLATION_INVALID" }, 422);
      }
      const value = parsed as Record<string, unknown>;
      const unknownKeys = Object.keys(value).filter(
        (key) => key !== "reason" && key !== "requestedBy",
      );
      if (unknownKeys.length > 0) {
        return apiJson(
          {
            error: "HOSTED_JOB_CANCELLATION_INVALID",
            unknownKeys,
          },
          422,
        );
      }
      if (value.reason !== undefined && typeof value.reason !== "string") {
        return apiJson({ error: "HOSTED_JOB_CANCELLATION_INVALID", field: "reason" }, 422);
      }
      if (
        value.requestedBy !== undefined &&
        typeof value.requestedBy !== "string"
      ) {
        return apiJson(
          { error: "HOSTED_JOB_CANCELLATION_INVALID", field: "requestedBy" },
          422,
        );
      }
      options = Object.freeze({
        ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
        ...(typeof value.requestedBy === "string"
          ? { requestedBy: value.requestedBy }
          : {}),
      });
    }
  } catch {
    return apiJson({ error: "HOSTED_JOB_CANCELLATION_INVALID_JSON" }, 400);
  }

  try {
    const record = await resolved.runtime.controller!.requestCancellation(
      jobIdFrom(context.params),
      options,
    );
    return apiJson(
      {
        cancellationRequested: record.status === "cancel-requested",
        cancelled: record.status === "cancelled",
        job: hostedJobView(record),
      },
      record.status === "cancel-requested" ? 202 : 200,
    );
  } catch (error) {
    return hostedJobErrorResponse(error);
  }
}
