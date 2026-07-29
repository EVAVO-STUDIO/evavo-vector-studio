import { workerApiAuthorisationFailure } from "../../../../lib/api-security";
import {
  getHostedJobRuntime,
} from "../../../../lib/hosted-job-control";
import {
  workerJson,
  workerRuntimeView,
} from "../../../../lib/worker-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authFailure = workerApiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  const runtimeValue = await getHostedJobRuntime();
  return workerJson({
    service: "evavo-vector-studio-worker-control",
    contract: workerRuntimeView(runtimeValue),
  });
}
