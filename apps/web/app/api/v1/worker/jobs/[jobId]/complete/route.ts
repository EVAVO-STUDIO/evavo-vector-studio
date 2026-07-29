import { workerApiAuthorisationFailure } from "../../../../../../../lib/api-security";
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
    const record = await required.runtime.controller!.succeed(
      context.params.jobId,
      input.leaseToken,
      { outputs: input.outputs, evidence: input.evidence },
    );
    return workerJson({
      record: workerRecordView(record),
      generatedBodiesAccepted: false,
      approval: "human-review-required",
    });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
