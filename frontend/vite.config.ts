import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './': сайт открывается и с корня домена, и из подпапки github.io/XRONIX
// VITE_CSP_ALLOW_HTTP=true (образ web для docker compose): сайт по http с любого адреса, без upgrade-insecure-requests,
// иначе браузер просит ассеты по https и страница остаётся пустой
let allowHttp = false
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'production-security-policy',
    apply: 'build',
    configResolved(c) { allowHttp = c.env.VITE_CSP_ALLOW_HTTP === 'true' },
    transformIndexHtml() {
      const content = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.xronix.ru; object-src 'none'; base-uri 'self'; form-action 'none'" + (allowHttp ? '' : '; upgrade-insecure-requests')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' }]
    },
  }],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
})
