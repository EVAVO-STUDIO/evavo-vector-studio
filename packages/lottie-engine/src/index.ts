export * from "./errors.js";
export * from "./generator.js";
export * from "./inspection.js";
export * from "./path-data.js";
export * from "./types.js";

// Deliberately avoid `export * from "./svg-source.js"`: path-data owns
// LottiePathBounds, while the source module only publishes its own facade.
export { prepareSvgSourceForLottie } from "./svg-source.js";
export type {
  ExtractedSvgPath,
  LottiePathStyle,
  LottieSolidPaint,
  PreparedLottieSvgSource,
  SvgRenderUnit,
} from "./svg-source.js";
