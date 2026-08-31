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
    // The i18n sweep imports every board in the app before its first
    // assertion, which is well past the 5s default on a loaded machine - and
    // it grows with every board added. A hook that times out fails the whole
    // file, so this is the difference between a slow test and a flaky one.
    hookTimeout: 60_000,
  },
})
