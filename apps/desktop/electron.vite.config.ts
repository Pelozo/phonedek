import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, '../../packages/shared/src')
const alias = { '@phonedek/shared': shared }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phonedek/shared'] })],
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
