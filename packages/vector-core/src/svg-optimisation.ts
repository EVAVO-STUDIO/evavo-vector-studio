import {
  optimiseSvg as optimiseSvgCanonical,
  type SvgDeliveryProfile,
  type SvgOptimisationOptions,
  type SvgOptimisationResult,
} from "./svg.js";

export type SvgOptimisationRequestOptions = SvgOptimisationOptions & Readonly<{
  deliveryProfile?: SvgDeliveryProfile;
}>;

export function optimiseSvg(
  source: string,
  options: SvgOptimisationRequestOptions = {},
): SvgOptimisationResult {
  if (
    options.profile !== undefined &&
    options.deliveryProfile !== undefined &&
    options.profile !== options.deliveryProfile
  ) {
    throw new Error("SVG_DELIVERY_PROFILE_CONFLICT");
  }
  return optimiseSvgCanonical(source, {
    profile: options.profile ?? options.deliveryProfile,
    stableIdPrefix: options.stableIdPrefix,
  });
}
