import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works from any static path (GitHub Pages, file server, etc.)
export default defineConfig({
  base: './',
  plugins: [react()],
})
