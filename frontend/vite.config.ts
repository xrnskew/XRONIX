import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './': сайт открывается и с корня домена, и из подпапки github.io/XRONIX
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
})
