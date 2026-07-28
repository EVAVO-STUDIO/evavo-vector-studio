"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then((module) => module.DotLottieReact),
  {
    ssr: false,
    loading: () => <p>Loading the local Lottie player…</p>,
  },
);

type DotLottieEventSource = Readonly<{
  addEventListener: (name: string, listener: (event?: unknown) => void) => void;
  removeEventListener: (name: string, listener: (event?: unknown) => void) => void;
}>;

function isEventSource(value: unknown): value is DotLottieEventSource {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DotLottieEventSource>;
  return (
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

export type LottiePreviewProps = Readonly<{
  data: string | ArrayBuffer;
  autoplay: boolean;
  loop: boolean;
  revision: number;
  ariaLabel?: string;
  onLoad?: () => void;
  onLoadError?: (message: string) => void;
}>;

export default function LottiePreview({
  data,
  autoplay,
  loop,
  revision,
  ariaLabel = "Generated Lottie animation preview",
  onLoad,
  onLoadError,
}: LottiePreviewProps) {
  const [player, setPlayer] = useState<DotLottieEventSource | null>(null);

  const dotLottieRefCallback = useCallback((value: unknown) => {
    setPlayer(isEventSource(value) ? value : null);
  }, []);

  useEffect(() => {
    if (!player) return;
    const loaded = () => onLoad?.();
    const failed = (event?: unknown) => {
      const message = event instanceof Error
        ? event.message
        : event && typeof event === "object" && "error" in event
          ? String((event as { error?: unknown }).error ?? "The player could not load the animation.")
          : "The player could not load the animation.";
      onLoadError?.(message);
    };
    player.addEventListener("load", loaded);
    player.addEventListener("loadError", failed);
    return () => {
      player.removeEventListener("load", loaded);
      player.removeEventListener("loadError", failed);
    };
  }, [onLoad, onLoadError, player, revision]);

  return (
    <div key={revision} aria-label="Official LottieFiles player preview">
      <DotLottieReact
        data={data}
        autoplay={autoplay}
        loop={loop}
        backgroundColor="#00000000"
        layout={{ fit: "contain", align: [0.5, 0.5] }}
        renderConfig={{ autoResize: true }}
        useFrameInterpolation
        dotLottieRefCallback={dotLottieRefCallback}
        aria-label={ariaLabel}
      />
    </div>
  );
}
