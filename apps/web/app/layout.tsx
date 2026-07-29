import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "EVAVO Vector Studio",
  description: "Professional raster-to-vector, SVG motion and Lottie production workspace.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
