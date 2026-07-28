import {
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_PIXELS,
  RASTER_INPUT_POLICY,
} from "@evavo/raster-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      service: "evavo-vector-studio",
      contractVersion: "1.4",
      policy: RASTER_INPUT_POLICY,
      applicationLimits: {
        maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
        maxDecodedPixels: DEFAULT_MAX_PIXELS,
      },
      errorCode: "RASTER_MULTI_IMAGE_UNSUPPORTED",
      documentation: "/docs/INPUT-SAFETY.md",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
