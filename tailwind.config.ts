import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        warp: {
          bg: "#0E0E0F",
          blue: "#378ADD",
          teal: "#1D9E75",
          amber: "#BA7517",
        },
      },
      fontFamily: {
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      borderWidth: {
        hair: "0.5px",
      },
    },
  },
  plugins: [],
};

export default config;
