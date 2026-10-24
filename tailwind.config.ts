import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        // Brutalist colors
        brutal: {
          yellow: "var(--brutal-yellow)",
          cyan: "var(--brutal-cyan)",
          magenta: "var(--brutal-magenta)",
          green: "var(--brutal-green)",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      boxShadow: {
        'brutal': '6px 6px 0px var(--foreground)',
        'brutal-lg': '8px 8px 0px var(--foreground)',
        'brutal-sm': '3px 3px 0px var(--foreground)',
      },
      animation: {
        'brutal-press': 'brutal-press 0.1s ease-in-out',
      },
      keyframes: {
        'brutal-press': {
          '0%': { transform: 'translate(0, 0)', boxShadow: '6px 6px 0px var(--foreground)' },
          '100%': { transform: 'translate(3px, 3px)', boxShadow: '3px 3px 0px var(--foreground)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;


