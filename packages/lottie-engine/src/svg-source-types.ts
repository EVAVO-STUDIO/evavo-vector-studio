import type { LottiePathBounds as PathBounds } from "./path-data.js";

declare module "./svg-source.js" {
  export type LottiePathBounds = PathBounds;
}

export {};
