import { workerApiAuthorisationFailure } from "../../../../../lib/api-security";
import {
  validateWorkerLeaseRequest,
  workerLeaseResponse,
} from "@evavo/worker-protocol";
import {
  getWorkerObjectStoreRuntime,
} from "../../../../../lib/worker-object-store";
import {
  parseWorkerJson,
  requireWorkerRuntime,
  workerErrorResponse,
  workerJson,
} from "../../../../../lib/worker-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const authFailure = workerApiAuthorisationFailure(request);
  if (authFailure) return authFailure;
  try {
    const input = validateWorkerLeaseRequest(await parseWorkerJson(request));
    const required = await requireWorkerRuntime();
    if (required.response) return required.response;
    const leased = await required.runtime.controller!.acquireLease(input);
    if (!leased) {
      return new Response(null, {
        status: 204,
        headers: {
          "cache-control": "no-store, max-age=0",
          "x-content-type-options": "nosniff",
          "x-vector-worker-protocol": "1.0",
          vary: "authorization",
        },
      });
    }
    const objectRuntime = await getWorkerObjectStoreRuntime();
    return workerJson({
      ...workerLeaseResponse(leased),
      objectTransferAvailable: objectRuntime.objectTransferAvailable,
      objectTransferEndpoint: "/api/v1/worker/objects",
      remoteExecutionAvailable: false,
    });
  } catch (error) {
    return workerErrorResponse(error);
  }
}
