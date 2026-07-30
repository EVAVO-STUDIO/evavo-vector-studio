import { vectorDeploymentPublicView } from "../../../lib/deployment-profile";
import { vectorHubRuntimePublicView } from "../../../lib/hub-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      service: "evavo-vector-studio",
      version: "0.4.0",
      status: "ok",
      privateApplication: true,
      hub: {
        integrationContract: "1.1",
        promotionStatus: "staged",
        clientReleaseEligible: false,
        routes: {
          access: "/access",
          launchRedemption: "/launch",
          health: "/api/health",
          workspace: "/",
        },
        runtime: vectorHubRuntimePublicView(),
      },
      deployment: {
        contractVersion: "1.0",
        promotionStatus: "staged",
        clientReleaseEligible: false,
        profile: vectorDeploymentPublicView(),
      },
      approval: "human-review-required",
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/json; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
