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
        rail: {
          DEFAULT: "rgb(var(--c-rail) / <alpha-value>)",
          2: "rgb(var(--c-rail-2) / <alpha-value>)",
        },
        canvas: "rgb(var(--c-canvas) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--c-border) / <alpha-value>)",
          2: "rgb(var(--c-border-2) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          2: "rgb(var(--c-ink-2) / <alpha-value>)",
          3: "rgb(var(--c-ink-3) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          d: "rgb(var(--c-accent-d) / <alpha-value>)",
          soft: "rgb(var(--c-accent-soft) / <alpha-value>)",
          2: "rgb(var(--c-accent-2) / <alpha-value>)",
          50: "rgb(var(--c-accent-50) / <alpha-value>)",
          100: "rgb(var(--c-accent-100) / <alpha-value>)",
          200: "rgb(var(--c-accent-200) / <alpha-value>)",
          300: "rgb(var(--c-accent-300) / <alpha-value>)",
          400: "rgb(var(--c-accent-400) / <alpha-value>)",
          500: "rgb(var(--c-accent-500) / <alpha-value>)",
          600: "rgb(var(--c-accent-600) / <alpha-value>)",
          700: "rgb(var(--c-accent-700) / <alpha-value>)",
          800: "rgb(var(--c-accent-800) / <alpha-value>)",
          900: "rgb(var(--c-accent-900) / <alpha-value>)",
        },
        green: {
          DEFAULT: "rgb(var(--c-green) / <alpha-value>)",
          soft: "rgb(var(--c-green-soft) / <alpha-value>)",
        },
        amber: {
          DEFAULT: "rgb(var(--c-amber) / <alpha-value>)",
          soft: "rgb(var(--c-amber-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--c-danger) / <alpha-value>)",
          soft: "rgb(var(--c-danger-soft) / <alpha-value>)",
        },
        info: {
          DEFAULT: "rgb(var(--c-info) / <alpha-value>)",
          soft: "rgb(var(--c-info-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
      },
      boxShadow: {
        glow: "0 4px 14px -6px rgba(36, 30, 26, 0.35)",
        panel: "0 10px 30px -18px rgba(36, 30, 26, 0.18)",
        card: "0 1px 3px rgba(36, 30, 26, 0.05)",
        lift: "0 12px 30px -14px rgba(36, 30, 26, 0.16)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
        "3xl": "18px",
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
          "0%": { boxShadow: "0 0 0 0 rgba(27, 166, 114, 0.5)" },
          "70%": { boxShadow: "0 0 0 7px rgba(27, 166, 114, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(27, 166, 114, 0)" },
        },
        glowpulse: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "bounce-dot": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-4px)", opacity: "1" },
        },
        fadeup: {
          from: { transform: "translateY(7px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s cubic-bezier(0.16,1,0.3,1)",
        "fade-in-fast": "fade-in-fast 0.25s ease-out",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16,1,0.3,1)",
        "pulse-ring": "pulse-ring 2s infinite",
        glowpulse: "glowpulse 1.8s infinite",
        shimmer: "shimmer 1.8s infinite linear",
        "bounce-dot": "bounce-dot 1.4s infinite ease-in-out both",
        fadeup: "fadeup 0.34s cubic-bezier(0.2, 0.7, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
