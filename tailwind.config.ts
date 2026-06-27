import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces — deep charcoal / near black (legacy, rarely used in light mode)
        ink: {
          950: "#070708",
          900: "#0a0a0c",
          850: "#0e0e12",
          800: "#131318",
          700: "#1a1a21",
          600: "#22232c",
          500: "#2c2d38",
        },
        // Accent — warm orange
        accent: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
        },
        glow: {
          orange: "#fb923c",
          amber: "#f59e0b",
          warm: "#fbbf24",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(249,115,22,0.2), 0 0 28px -4px rgba(249,115,22,0.25)",
        "glow-sm": "0 0 18px -6px rgba(249,115,22,0.3)",
        panel: "0 1px 3px 0 rgba(0,0,0,0.06), 0 8px 24px -8px rgba(0,0,0,0.1)",
        card: "0 1px 2px 0 rgba(0,0,0,0.04), 0 4px 12px -4px rgba(0,0,0,0.06)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(249,115,22,0.06), transparent 70%)",
        "mesh":
          "radial-gradient(at 0% 0%, rgba(249,115,22,0.04) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(251,146,60,0.03) 0px, transparent 50%)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-fast": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(74,222,128,0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgba(74,222,128,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(74,222,128,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "bounce-dot": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-4px)", opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s cubic-bezier(0.16,1,0.3,1)",
        "fade-in-fast": "fade-in-fast 0.25s ease-out",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16,1,0.3,1)",
        "pulse-ring": "pulse-ring 2s infinite",
        shimmer: "shimmer 2s infinite",
        "bounce-dot": "bounce-dot 1.4s infinite ease-in-out both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
