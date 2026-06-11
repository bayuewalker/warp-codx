import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        warp: {
          // v3 palette — calmer/muted reference tones (kept in sync with
          // the CSS custom properties in src/app/globals.css :root).
          bg: "#0E0E0F",
          "bg-1": "#161618",
          "bg-2": "#1E1E21",
          "bg-3": "#26262A",
          blue: "#378ADD",
          teal: "#1D9E75",
          amber: "#BA7517",
          red: "#C0392B",
          purple: "#7B61FF",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderWidth: {
        hair: "0.5px",
      },
    },
  },
  plugins: [],
};

export default config;
