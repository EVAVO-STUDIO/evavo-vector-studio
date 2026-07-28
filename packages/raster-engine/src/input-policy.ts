export const RASTER_INPUT_POLICY = Object.freeze({
  mode: "one-static-image-per-trace" as const,
  accepted: Object.freeze([
    "static-png",
    "single-image-jpeg",
    "static-webp",
    "single-frame-gif",
    "bmp",
    "single-page-classic-tiff",
  ] as const),
  rejectedBeforeNativeDecode: Object.freeze([
    "multi-frame-apng",
    "animated-gif",
    "animated-webp",
    "jpeg-mpo",
    "multi-page-tiff",
    "bigtiff",
  ] as const),
  rationale: "A static trace must not silently discard animation frames, pages, timing or loop intent.",
});

export type RasterInputPolicy = typeof RASTER_INPUT_POLICY;
