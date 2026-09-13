import { noStoreHeaders } from "../../../../lib/api-security";
import { vectorRuntimeReadinessPublicView } from "../../../../lib/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const readiness = vectorRuntimeReadinessPublicView();
  return Response.json(readiness, {
    status: 200,
    headers: noStoreHeaders({
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-evavo-vector-readiness": readiness.interactive.ready
        ? "ready"
        : "blocked",
    }),
  });
}
