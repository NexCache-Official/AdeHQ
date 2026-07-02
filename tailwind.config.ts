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
          DEFAULT: "#000000",
          2: "#12151b",
        },
        canvas: "#ffffff",
        surface: "#ffffff",
        muted: "#eef0f3",
        border: {
          DEFAULT: "#e1e4ea",
          2: "#ebedf1",
        },
        ink: {
          DEFAULT: "#0b0d12",
          2: "#535a66",
          3: "#868c99",
        },
        accent: {
          DEFAULT: "#2f6fed",
          d: "#2557c7",
          soft: "#e7effe",
          2: "#5fa0ff",
          50: "#e7effe",
          100: "#dbe7fd",
          200: "#bcd2fb",
          300: "#8fb4f7",
          400: "#5fa0ff",
          500: "#2f6fed",
          600: "#2557c7",
          700: "#1f47a3",
          800: "#1c3c85",
          900: "#1a356e",
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
        glow: "0 4px 14px -6px rgba(47, 111, 237, 0.55)",
        panel: "0 10px 30px -18px rgba(15, 23, 42, 0.32)",
        card: "0 1px 3px rgba(15, 23, 42, 0.06)",
        lift: "0 12px 30px -14px rgba(15, 23, 42, 0.22)",
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
