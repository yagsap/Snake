import { defineConfig } from 'vite'

export default defineConfig({
  // relative base so the built site works from any path — GitHub Pages
  // serves this repo from /<repo>/, not from the domain root.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
