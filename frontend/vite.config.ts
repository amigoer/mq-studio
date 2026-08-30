import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wails from '@wailsio/runtime/plugins/vite'

export default defineConfig({
  plugins: [react(), wails('./bindings')],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bindings': fileURLToPath(
        new URL('./bindings/github.com/amigoer/mq-studio/internal', import.meta.url),
      ),
      // Wails' own service bindings, which sit outside our module's tree.
      '@wails': fileURLToPath(
        new URL('./bindings/github.com/wailsapp/wails/v3/pkg', import.meta.url),
      ),
    },
  },
  server: {
    // Bind IPv4 explicitly. Node resolves "localhost" to ::1 first, and the
    // Wails dev proxy dials tcp4 127.0.0.1, so the default leaves the asset
    // handler with a connection refused.
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
