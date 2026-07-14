import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version?: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    define: { __APP_VERSION__: JSON.stringify(packageJson.version ?? '0.0.0') },
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
        '@generated': fileURLToPath(new URL('./src/generated', import.meta.url)),
      },
    },
    build: { outDir: fileURLToPath(new URL('./out/renderer', import.meta.url)) },
  },
})
