import "./styles.css";

export const metadata = {
  title: "EVAVO Vector Studio",
  description: "Professional raster-to-vector, SVG motion and Lottie production workspace."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
