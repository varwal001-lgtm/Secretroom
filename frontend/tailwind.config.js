/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f14",
        panel: "#111827",
        panelSoft: "#1f2937",
        accent: "#22d3ee",
        accentSoft: "#0e7490",
        text: "#e5eef8",
        textDim: "#9aa9bf",
      },
      boxShadow: {
        glow: "0 0 24px rgba(110,231,255,0.25)",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
