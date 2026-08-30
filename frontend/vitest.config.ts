import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
