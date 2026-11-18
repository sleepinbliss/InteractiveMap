import express from 'express'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createBoard } from './board.mjs'

const dev = process.argv.includes('--dev')
const app = express()
app.disable('x-powered-by')
const database = resolve(process.env.DATABASE_PATH || 'data/markers.sqlite')
await mkdir(dirname(database), { recursive: true })
const board = createBoard({ database })
app.use('/api', board.router)
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  next()
})
app.use('/tiles/manifest.json', (_req, res) => {
  res.set('Cache-Control', 'no-cache').sendFile(resolve(dev ? 'public' : 'dist', 'tiles', 'manifest.json'))
})
app.use('/tiles', express.static(resolve(dev ? 'public' : 'dist', 'tiles'), {
  maxAge: '1y', immutable: true, fallthrough: false
}))

if (dev) {
  const { createServer } = await import('vite')
  const vite = await createServer({ configLoader: 'native', server: { middlewareMode: true } })
  app.use(vite.middlewares)
} else {
  app.use(express.static(resolve('dist')))
}

const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 5173)
app.listen(port, host, error => {
  if (error?.code === 'EADDRINUSE') {
    throw new Error(`Port ${port} is already in use. Stop the other map server before starting this one.`, { cause: error })
  }
  if (error) throw error
  console.log(`Knox Field Map: http://${host}:${port}`)
})
