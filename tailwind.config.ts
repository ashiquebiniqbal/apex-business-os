import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101827",
        mist: "#f4f7fb",
        accent: "#2b6ef3",
      },
    },
  },
  plugins: [],
} satisfies Config;
