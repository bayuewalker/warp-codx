import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "WARP CodX",
  description:
    "Mobile-first command interface for orchestrating AI agents in WalkerMind OS.",
};

export const viewport: Viewport = {
  themeColor: "#0E0E0F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Inline VisualViewport listener for mobile browsers that don't expose
  // env(keyboard-inset-height) (most iOS Safari and Android Chrome). Sets
  // --warp-kb-h on <html> so .kb-inset can pad above the keyboard.
  const kbScript = `
    (function () {
      if (typeof window === "undefined" || !window.visualViewport) return;
      var vv = window.visualViewport;
      var root = document.documentElement;
      function update() {
        var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty("--warp-kb-h", kb + "px");
      }
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
      update();
    })();
  `;

  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
    >
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: kbScript }} />
      </body>
    </html>
  );
}
