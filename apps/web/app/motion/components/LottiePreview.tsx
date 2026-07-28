"use client";

import dynamic from "next/dynamic";

const DotLottieReact = dynamic(
  () => import("@lottiefiles/dotlottie-react").then((module) => module.DotLottieReact),
  {
    ssr: false,
    loading: () => <p>Loading the local Lottie player…</p>,
  },
);

export type LottiePreviewProps = Readonly<{
  data: string;
  autoplay: boolean;
  loop: boolean;
  revision: number;
}>;

export default function LottiePreview({
  data,
  autoplay,
  loop,
  revision,
}: LottiePreviewProps) {
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
        aria-label="Generated Lottie animation preview"
      />
    </div>
  );
}
