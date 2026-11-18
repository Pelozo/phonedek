import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, '../../packages/shared/src')
const alias = { '@phonedek/shared': shared }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phonedek/shared'] })],
    // Keep the native N-API hook out of the bundle; it is lazy-required at
    // runtime and unpacked from the asar archive (see electron-builder.yml).
    build: { rollupOptions: { external: ['uiohook-napi'] } },
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phonedek/shared'] })],
    resolve: { alias },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias },
  },
})
