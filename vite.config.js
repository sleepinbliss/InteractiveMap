import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { parseBackup } from './shared/markers.mjs'

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  if (pages) {
    try {
      parseBackup(JSON.parse(readFileSync(new URL('./public/markers.json', import.meta.url), 'utf8')))
    } catch (error) {
      throw new Error(`Cannot publish public/markers.json: ${error.message}`, { cause: error })
    }
  }
  return {
    base: pages ? './' : '/',
    build: { outDir: pages ? 'dist-pages' : 'dist' },
    plugins: [vue()],
    server: {
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem,sqlite,sqlite-wal,sqlite-shm}', '**/.git/**', '**/data/**']
      }
    }
  }
})
