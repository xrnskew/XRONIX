import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './': сайт открывается и с корня домена, и из подпапки github.io/XRONIX
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'production-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.xronix.ru; object-src 'none'; base-uri 'self'; form-action 'none'; upgrade-insecure-requests" }, injectTo: 'head-prepend' }]
    },
  }],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
})
