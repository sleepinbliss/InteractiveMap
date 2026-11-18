import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { limits, parseBackup, parseMarker } from '../shared/markers.mjs'
import { defaultMarkerColor } from '../shared/marker-color.mjs'
import { backupFormat, backupVersion, maxBackupBytes } from '../shared/backup.mjs'

const serialize = ({ players, ...marker }) => ({ ...marker, players: JSON.parse(players) })

export function createBoard({ database }) {
  const db = new DatabaseSync(database)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      faction TEXT NOT NULL,
      players TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '${defaultMarkerColor}',
      version INTEGER NOT NULL DEFAULT 1,
      updatedAt INTEGER NOT NULL
    ) STRICT;
  `)
  if (!db.prepare('PRAGMA table_info(markers)').all().some(column => column.name === 'color')) {
    db.exec(`ALTER TABLE markers ADD COLUMN color TEXT NOT NULL DEFAULT '${defaultMarkerColor}'`)
  }
  db.exec('COMMIT')
  const list = db.prepare('SELECT * FROM markers ORDER BY updatedAt DESC, id')
  const get = db.prepare('SELECT * FROM markers WHERE id = ?')
  const insert = db.prepare(`INSERT INTO markers (id, x, y, faction, players, color, updatedAt)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM markers) < ?`)
  const update = db.prepare(`UPDATE markers SET faction = ?, players = ?, color = ?, version = version + 1, updatedAt = ?
    WHERE id = ? AND version = ?`)
  const remove = db.prepare('DELETE FROM markers WHERE id = ? AND version = ?')
  const clear = db.prepare('DELETE FROM markers')

  const router = express.Router()
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Knox-Board') !== '1') {
      return res.status(403).json({ error: 'Request must come from the board.' })
    }
    next()
  })
  const backupJson = express.json({ limit: maxBackupBytes })
  const readBoard = () => list.all().map(serialize)
  const restoreToken = (current, incoming) => createHash('sha256')
    .update(JSON.stringify([current, incoming])).digest('hex')

  function readBackup(value, res) {
    try { return parseBackup(value) }
    catch (error) {
      if (!(error instanceof TypeError)) throw error
      res.status(400).json({ error: error.message })
      return null
    }
  }

  router.get('/backup', (_req, res) => {
    const markers = readBoard().map(({ x, y, faction, players, color }) => ({ x, y, faction, players, color }))
    res.json({ format: backupFormat, version: backupVersion, exportedAt: new Date().toISOString(), markers })
  })
  router.post('/backup/preview', backupJson, (req, res) => {
    const incoming = readBackup(req.body, res)
    if (!incoming) return
    const current = readBoard()
    res.json({ currentCount: current.length, incomingCount: incoming.length, token: restoreToken(current, incoming) })
  })
  router.put('/backup', backupJson, (req, res) => {
    const incoming = readBackup(req.body?.backup, res)
    if (!incoming) return
    db.exec('BEGIN IMMEDIATE')
    try {
      if (req.body.token !== restoreToken(readBoard(), incoming)) {
        db.exec('ROLLBACK')
        return res.status(409).json({ error: 'The board or backup changed. Review the restore again before replacing markers.' })
      }
      clear.run()
      const timestamp = Date.now()
      for (const [index, marker] of incoming.entries()) {
        insert.run(randomUUID(), marker.x, marker.y, marker.faction, JSON.stringify(marker.players), marker.color, timestamp - index, limits.markers)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    res.json({ count: incoming.length })
  })

  router.use(express.json({ limit: '32kb' }))
  router.get('/markers', (_req, res) => res.json(readBoard()))

  function validated(value, res) {
    try { return parseMarker(value) }
    catch (error) {
      if (!(error instanceof TypeError)) throw error
      res.status(400).json({ error: error.message })
      return null
    }
  }
  function editTarget(req, res) {
    const current = get.get(req.params.id)
    if (!current) {
      res.status(404).json({ error: 'This marker no longer exists.' })
      return null
    }
    if (!Number.isInteger(req.body?.version) || req.body.version !== current.version) {
      res.status(409).json({ error: 'Someone updated this marker. Close the form and reopen it to see the latest details.' })
      return null
    }
    return current
  }
  router.post('/markers', (req, res) => {
    const marker = validated(req.body, res)
    if (!marker) return
    const id = randomUUID()
    const result = insert.run(id, marker.x, marker.y, marker.faction, JSON.stringify(marker.players), marker.color, Date.now(), limits.markers)
    if (!result.changes) return res.status(409).json({ error: 'The board is full. Remove an old marker before adding another.' })
    res.status(201).json(serialize(get.get(id)))
  })
  router.put('/markers/:id', (req, res) => {
    const current = editTarget(req, res)
    if (!current) return
    const marker = validated({ color: current.color, ...req.body, x: current.x, y: current.y }, res)
    if (!marker) return
    const result = update.run(marker.faction, JSON.stringify(marker.players), marker.color, Date.now(), current.id, current.version)
    if (!result.changes) return res.status(409).json({ error: 'Marker changed. Reopen it to get the latest details.' })
    res.json(serialize(get.get(current.id)))
  })
  router.delete('/markers/:id', (req, res) => {
    const current = editTarget(req, res)
    if (!current) return
    const result = remove.run(current.id, current.version)
    if (!result.changes) return res.status(409).json({ error: 'Marker changed. Reopen it to get the latest details.' })
    res.status(204).end()
  })
  router.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }))
  router.use((error, _req, res, next) => {
    if (res.headersSent) return next(error)
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' })
    console.error(error)
    res.status(500).json({ error: 'The board could not complete the request. Try again.' })
  })
  return { router, close: () => db.close() }
}
