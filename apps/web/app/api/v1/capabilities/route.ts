import {
  DEFAULT_DIFFERENCE_MAX_DIMENSION,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_PIXELS,
  MAX_DIFFERENCE_DIMENSION,
} from "@evavo/raster-engine";
import { MOTION_CONTRACT_VERSION } from "@evavo/motion-engine";
import {
  DEFAULT_LOTTIE_FRAME_RATE,
  DEFAULT_LOTTIE_PRECISION,
  DOTLOTTIE_CONTRACT_VERSION,
  DOTLOTTIE_MANIFEST_VERSION,
  LOTTIE_CONTRACT_VERSION,
  MAX_DOTLOTTIE_ARCHIVE_BYTES,
  MAX_LOTTIE_FRAME_RATE,
  MAX_LOTTIE_PRECISION,
  MIN_LOTTIE_FRAME_RATE,
} from "@evavo/lottie-engine";
import {
  VECTOR_WORKER_CONTRACT_VERSION,
  VECTOR_WORKER_SUPPORTED_OPERATIONS,
} from "@evavo/worker-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VECTOR_STUDIO_VERSION = "0.4.0" as const;
const CAPABILITIES_CONTRACT_VERSION = "1.0" as const;
const MCP_CONTRACT_VERSION = "1.5" as const;
const BATCH_CONTRACT_VERSION = "1.0" as const;
const MAX_BATCH_ITEMS = 1_000;
const MCP_MAX_BATCH_ITEMS = 100;

function noStoreHeaders(): Headers {
  const headers = new Headers();
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "authorization, cookie, origin");
  return headers;
}

export function GET(): Response {
  return Response.json(
    {
      service: Object.freeze({
        name: "evavo-vector-studio",
        version: VECTOR_STUDIO_VERSION,
        capabilitiesContractVersion: CAPABILITIES_CONTRACT_VERSION,
      }),
      discovery: Object.freeze({
        endpoint: "/api/v1/capabilities",
        authentication: "public non-sensitive capability metadata",
        cache: "no-store",
        generatedBodiesIncluded: false,
        sensitiveValuesIncluded: false,
      }),
      interfaces: Object.freeze({
        browser: Object.freeze({
          traceWorkspace: "/",
          motionDirector: "/motion",
        }),
        api: Object.freeze({
          trace: "/api/v1/trace",
          animatedSvg: "/api/v1/motion/svg",
          lottie: "/api/v1/motion/lottie",
          dotLottie: "/api/v1/motion/dotlottie",
          jobs: "/api/v1/jobs",
          workerControl: "/api/v1/worker",
          workerObjects: "/api/v1/worker/objects",
        }),
        cli: Object.freeze({
          singleFile: "evavo-vector",
          durableBatch: "evavo-vector-batch",
          localWorker: "evavo-vector-worker",
          httpWorker: "evavo-vector-http-worker",
        }),
        mcp: Object.freeze({
          transport: "stdio",
          contractVersion: MCP_CONTRACT_VERSION,
          toolCount: 15,
          generatedBodiesInModelContext: false,
        }),
      }),
      raster: Object.freeze({
        contractVersion: "1.4",
        inputPolicy: "one-static-image-per-trace",
        formats: Object.freeze(["png", "jpeg", "webp", "gif", "bmp", "classic-tiff"]),
        rejectedContainers: Object.freeze([
          "multi-frame-apng",
          "animated-gif",
          "animated-webp",
          "jpeg-mpo",
          "multi-page-tiff",
          "bigtiff",
        ]),
        profiles: Object.freeze(["auto", "logo", "icon", "line-art", "illustration", "photo"]),
        candidateModes: Object.freeze(["adaptive", "single"]),
        deliveryProfiles: Object.freeze(["editable", "web", "motion", "print"]),
        defaultDeliveryProfile: "editable",
        stableIdProfiles: Object.freeze(["editable", "motion"]),
        alphaAwareAnalysis: true,
        visibleContentBounds: true,
        safetyRollbackEvidence: true,
        renderComparison: "alpha-aware-multi-scale",
        limits: Object.freeze({
          maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
          maxDecodedPixels: DEFAULT_MAX_PIXELS,
          defaultDifferenceMaximumDimension: DEFAULT_DIFFERENCE_MAX_DIMENSION,
          maximumDifferenceDimension: MAX_DIFFERENCE_DIMENSION,
        }),
      }),
      motion: Object.freeze({
        contractVersion: MOTION_CONTRACT_VERSION,
        output: "script-free-css-animated-svg",
        properties: Object.freeze(["opacity", "translateX", "translateY", "scale", "rotateDeg"]),
        reducedMotionFallbackRequired: true,
        existingAnimationRejected: true,
      }),
      lottie: Object.freeze({
        contractVersion: LOTTIE_CONTRACT_VERSION,
        shapeLayersOnly: true,
        pathGeometry: true,
        solidFillAndStroke: true,
        defaultFrameRate: DEFAULT_LOTTIE_FRAME_RATE,
        frameRateRange: Object.freeze([MIN_LOTTIE_FRAME_RATE, MAX_LOTTIE_FRAME_RATE]),
        defaultPrecision: DEFAULT_LOTTIE_PRECISION,
        maximumPrecision: MAX_LOTTIE_PRECISION,
        playerRenderValidationAvailable: false,
      }),
      dotLottie: Object.freeze({
        contractVersion: DOTLOTTIE_CONTRACT_VERSION,
        manifestVersion: DOTLOTTIE_MANIFEST_VERSION,
        deterministicArchive: true,
        maximumArchiveBytes: MAX_DOTLOTTIE_ARCHIVE_BYTES,
        browserArchiveLoadValidationAvailable: true,
        playerRenderValidationAvailable: false,
      }),
      automation: Object.freeze({
        durableBatch: Object.freeze({
          contractVersion: BATCH_CONTRACT_VERSION,
          maximumLocalItems: MAX_BATCH_ITEMS,
          maximumMcpItems: MCP_MAX_BATCH_ITEMS,
          persistentState: true,
          resumable: true,
          appendOnlyEvents: true,
          immutableManifestRevision: true,
          completedOutputReverification: true,
          existingOutputsOverwritten: false,
          deliveryProfiles: Object.freeze(["editable", "web", "motion", "print"]),
        }),
        worker: Object.freeze({
          contractVersion: VECTOR_WORKER_CONTRACT_VERSION,
          operations: VECTOR_WORKER_SUPPORTED_OPERATIONS,
          immutableSourceHashVerification: true,
          atomicObjectTransactions: true,
          deliveryProfiles: Object.freeze(["editable", "web", "motion", "print"]),
          generatedBodiesInControlResponses: false,
        }),
      }),
      deploymentBoundaries: Object.freeze({
        synchronousProductionRoutes: true,
        hostedRecordControlPlane: "configured-runtime-dependent",
        workerObjectTransfer: "configured-runtime-dependent",
        localWorkerExecution: true,
        httpCoordinatedWorkerExecution: true,
        providerQueueDelivery: false,
        managedRemoteExecution: false,
        distributedAutoscaling: false,
        signedHubLaunch: "deployment-and-configuration-dependent",
      }),
      approval: Object.freeze({
        machineCompletionIsProductionApproval: false,
        productionAutoApprovalAvailable: false,
        state: "human-review-required",
      }),
    },
    {
      status: 200,
      headers: noStoreHeaders(),
    },
  );
}
