import { fileURLToPath, URL } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
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
