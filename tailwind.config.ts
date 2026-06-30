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
          DEFAULT: "#1a1714",
          2: "#262119",
        },
        canvas: "#f6f3ee",
        surface: "#ffffff",
        muted: "#f0ede6",
        border: {
          DEFAULT: "#e6e1d8",
          2: "#efebe3",
        },
        ink: {
          DEFAULT: "#221f1a",
          2: "#6c685f",
          3: "#9b968b",
        },
        accent: {
          DEFAULT: "#e85d2c",
          d: "#ce4e22",
          soft: "#fbe9de",
          50: "#fbe9de",
          100: "#fbe9de",
          200: "#f5d4c0",
          300: "#efb89a",
          400: "#e8855a",
          500: "#e85d2c",
          600: "#ce4e22",
          700: "#b0441e",
          800: "#8c3719",
          900: "#6e2c14",
        },
        green: {
          DEFAULT: "#1ba672",
          soft: "#e3f4eb",
        },
        amber: {
          DEFAULT: "#cb8a1b",
          soft: "#fbefd6",
        },
        danger: {
          DEFAULT: "#d9483b",
          soft: "#fbe3e0",
        },
        info: {
          DEFAULT: "#2f6fed",
          soft: "#e5edfd",
        },
      },
      fontFamily: {
        sans: ["var(--font-schibsted)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 4px 14px -6px rgba(232, 93, 44, 0.55)",
        panel: "0 10px 30px -18px rgba(40, 30, 15, 0.32)",
        card: "0 1px 3px rgba(40, 30, 15, 0.06)",
        lift: "0 12px 30px -14px rgba(40, 34, 24, 0.22)",
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
