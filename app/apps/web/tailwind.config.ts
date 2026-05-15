import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm, maître-d' inspired palette
        ink: "#1a1a1a",
        cream: "#faf7f2",
        brass: "#b08d57",
        sage: "#4f6e5b",
        muted: "#6b6b6b",
      },
      maxWidth: {
        phone: "430px",
      },
      fontFamily: {
        serif: ["ui-serif", "Georgia", "Cambria", "serif"],
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
