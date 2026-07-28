# Static raster input safety

EVAVO Vector Studio currently performs one static raster reconstruction per trace. It does not silently choose a frame from an animation or a page from a multi-image document.

## Accepted input classes

The bounded raster preflight supports:

- static PNG;
- ordinary single-image JPEG;
- static WebP;
- single-frame GIF;
- BMP;
- single-page classic TIFF.

Support means that the encoded header can be inspected safely and the configured native decoder is expected to decode one RGBA image. It does not mean every damaged, proprietary or unusual encoding variant will be accepted.

## Multi-image containers rejected before decoding

The preflight parser rejects known multi-image containers with `RASTER_MULTI_IMAGE_UNSUPPORTED`:

- APNG with more than one declared frame;
- GIF with more than one image descriptor;
- WebP with animation flags, animation control or animation-frame chunks;
- classic TIFF with a chained next image-file directory;
- JPEG MPO files carrying an MPF application segment.

The error includes the detected format, container class, known frame or page count when available, and the policy `one-static-image-per-trace`.

This prevents a decoder's first-frame or first-page behaviour from being mistaken for complete conversion.

## Other pre-decode limits

Before native decoding, the engine also rejects:

- empty input;
- unknown signatures;
- incomplete or malformed headers and chunk structures;
- encoded files above 25 MiB by default;
- canvases above 40 million decoded pixels by default;
- unsafe or invalid configured limits.

Header dimensions are checked again against the native decoded width, height and RGBA byte length after decoding.

## Why animations are not traced as one image

Animated GIF, APNG and WebP are temporal assets. Converting only one frame loses timing, frame disposal, motion, holds and loop intent. Converting every frame independently without correspondence can create unstable paths that flicker and cannot morph cleanly.

A future animation-ingest workflow must therefore:

1. expose frame count, duration and loop metadata;
2. require an explicit frame policy;
3. align layers and geometry across frames;
4. measure temporal path stability;
5. preserve or deliberately rebuild timing;
6. produce animated SVG or Lottie only within supported feature contracts.

Until that workflow exists, rejecting animation is more honest than silently flattening it.

## TIFF scope

Only classic TIFF byte-order markers and scalar first-IFD width and height tags are handled by the bounded preflight parser. BigTIFF and chained multi-page TIFF are rejected. Embedded sub-IFDs, exotic compression and vendor-specific metadata remain subject to native decode rejection.

## Deployment limits

The application limits are not guaranteed to be the final hosting limits. Reverse proxies, serverless platforms and edge providers may impose smaller request-body, memory or execution limits. Deployment readiness must verify the actual host and surface the lower effective limit in the UI and API contract.
