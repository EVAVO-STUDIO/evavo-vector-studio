import { workerApiAuthorisationFailure } from "../../../../../../../lib/api-security";
import {
  completeHostedJobIdempotently,
} from "@evavo/job-control";
import { validateWorkerCompleteRequest } from "@evavo/worker-protocol";
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
    const input = validateWorkerCompleteRequest(await parseWorkerJson(request));
    const required = await requireWorkerRuntime();
    if (required.response) return required.response;
    const completed = await completeHostedJobIdempotently(
      required.runtime.controller!,
      required.runtime.store!,
      context.params.jobId,
      input.leaseToken,
      { outputs: input.outputs, evidence: input.evidence },
    );
    return workerJson({
      record: workerRecordView(completed.record),
      idempotentReplay: completed.replayed,
      generatedBodiesAccepted: false,
      approval: "human-review-required",
    });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
