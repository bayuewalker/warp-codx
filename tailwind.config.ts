import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        warp: {
          // v2 palette — softer base + layered elevations.
          bg: "#0F1014",
          "bg-1": "#15171C",
          "bg-2": "#1B1E25",
          "bg-3": "#22262E",
          blue: "#5BA4FF",
          teal: "#3DDFA8",
          amber: "#F2B946",
          red: "#FF6155",
          purple: "#B886FF",
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
