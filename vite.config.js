import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { parseBackup } from './shared/markers.mjs'

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_')
  if ((url || key) && (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url ?? '') || !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key ?? ''))) {
    throw new Error('Set both VITE_SUPABASE_URL (https://<project-ref>.supabase.co) and VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...). Never use a secret key.')
  }
  if (pages && !url) {
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
