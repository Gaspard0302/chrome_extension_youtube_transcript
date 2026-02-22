/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        yt: {
          red: "#FF0000",
          dark: "#0F0F0F",
          surface: "#212121",
          border: "#3F3F3F",
          text: "#F1F1F1",
          muted: "#AAAAAA",
        },
      },
    },
  },
  plugins: [],
};
