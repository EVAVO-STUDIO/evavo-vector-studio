import { workerApiAuthorisationFailure } from "../../../../../../../lib/api-security";
import { validateWorkerFailRequest } from "@evavo/worker-protocol";
import {
  parseWorkerJson,
  requireWorkerRuntime,
  workerErrorResponse,
  workerJson,
  workerRecordView,
} from "../../../../../../../lib/worker-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Readonly<{ jobId: string }> }>;

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const authFailure = workerApiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  try {
    const input = validateWorkerFailRequest(await parseWorkerJson(request));
    const required = await requireWorkerRuntime();
    if (required.response) return required.response;
    const record = await required.runtime.controller!.fail(
      context.params.jobId,
      input.leaseToken,
      {
        code: input.code,
        message: input.message,
        retryable: input.retryable,
        details: input.details,
      },
    );
    return workerJson({ record: workerRecordView(record) });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
