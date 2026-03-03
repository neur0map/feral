import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ['"SF Mono"', "Menlo", "Monaco", "monospace"],
        sans: [
          '"SF Pro Display"',
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
      },
      colors: {
        feral: {
          bg: "var(--bg-base)",
          surface: "var(--bg-surface)",
          elevated: "var(--bg-elevated)",
          overlay: "var(--bg-overlay)",
          accent: "var(--accent)",
          border: "var(--border-default)",
          text: "var(--text-primary)",
          muted: "var(--text-secondary)",
        },
      },
      backdropBlur: {
        glass: "24px",
      },
    },
  },
  plugins: [],
} satisfies Config;
