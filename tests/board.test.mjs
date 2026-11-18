import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import express from 'express'
import { createBoard } from '../server/board.mjs'
import { defaultMarkerColor } from '../shared/marker-color.mjs'
import { backupFormat, backupVersion } from '../shared/backup.mjs'

async function serve(database) {
  const board = createBoard({ database })
  const app = express()
  app.use('/api', board.router)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const root = `http://127.0.0.1:${server.address().port}/api`
  return {
    request: (path, method = 'GET', body, boardHeader = true) => fetch(`${root}/${path}`, {
      method,
      headers: {
        ...(boardHeader && { 'X-Knox-Board': '1' }),
        ...(body !== undefined && { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    close: async () => {
      await new Promise(resolve => server.close(resolve))
      board.close()
    }
  }
}

test('board opens without credentials and still requires the application header for writes', async t => {
  const { request, close } = await serve(':memory:')
  t.after(close)
  const response = await request('markers', 'GET', undefined, false)
  assert.equal(response.status, 200)
  assert.equal(response.headers.has('set-cookie'), false)
  assert.deepEqual(await response.json(), [])
  assert.equal((await request('session', 'POST', {})).status, 404)
  assert.equal((await request('markers', 'POST', {}, false)).status, 403)
  assert.equal((await request('markers', 'POST', {})).status, 400)
})

test('marker CRUD works without credentials, rejects stale versions, and survives restart', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'knox-board-'))
  const database = join(folder, 'board.sqlite')
  let running = await serve(database)
  t.after(async () => { await running.close(); await rm(folder, { recursive: true, force: true }) })
  const body = { x: 9000, y: 7600, faction: 'Riverside Crew', players: ['Robin', 'Stone'], color: '#69bcff' }
  const created = await running.request('markers', 'POST', body)
  assert.equal(created.status, 201)
  const marker = await created.json()
  assert.equal(marker.color, body.color)
  assert.deepEqual(await (await running.request('markers')).json(), [marker])
  const changed = await running.request(`markers/${marker.id}`, 'PUT', { ...marker, players: ['Robin'], x: 0, color: '#f48bad' })
  assert.equal(changed.status, 200)
  const updated = await changed.json()
  assert.equal(updated.x, body.x)
  assert.equal(updated.color, '#f48bad')
  assert.equal(updated.version, marker.version + 1)
  assert.equal((await running.request(`markers/${marker.id}`, 'DELETE', { version: marker.version })).status, 409)

  await running.close()
  running = await serve(database)
  assert.deepEqual(await (await running.request('markers')).json(), [updated])
  assert.equal((await running.request(`markers/${marker.id}`, 'DELETE', { version: updated.version })).status, 204)
  assert.deepEqual(await (await running.request('markers')).json(), [])
})

test('opening a pre-color database keeps existing markers and gives them the default color', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'knox-color-migration-'))
  const database = join(folder, 'board.sqlite')
  let running
  t.after(async () => { await running?.close(); await rm(folder, { recursive: true, force: true }) })
  const old = new DatabaseSync(database)
  old.exec(`
    CREATE TABLE markers (
      id TEXT PRIMARY KEY NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
      faction TEXT NOT NULL, players TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      updatedAt INTEGER NOT NULL
    ) STRICT;
    INSERT INTO markers VALUES ('old-pin', 42, 84, 'Old Crew', '["Robin"]', 3, 1000);
  `)
  old.close()
  running = await serve(database)
  const response = await running.request('markers')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [
    { id: 'old-pin', x: 42, y: 84, faction: 'Old Crew', players: ['Robin'], version: 3, updatedAt: 1000, color: defaultMarkerColor }
  ])
})

test('downloaded backups restore deleted markers and replace the current board only after confirmation', async t => {
  const { request, close } = await serve(':memory:')
  t.after(close)
  const original = { x: 9000, y: 7600, faction: 'Riverside Crew', players: ['Robin', 'Stone'], color: '#69bcff' }
  const response = await request('markers', 'POST', original)
  assert.equal(response.status, 201)
  const saved = await response.json()
  const exported = await request('backup')
  assert.equal(exported.status, 200)
  const backup = await exported.json()
  assert.deepEqual(backup, { format: backupFormat, version: backupVersion, exportedAt: backup.exportedAt, markers: [original] })
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)))
  assert.equal((await request(`markers/${saved.id}`, 'DELETE', { version: saved.version })).status, 204)

  const emptyPreview = await (await request('backup/preview', 'POST', backup)).json()
  assert.equal(emptyPreview.currentCount, 0)
  assert.equal(emptyPreview.incomingCount, 1)
  assert.equal((await request('backup', 'PUT', { backup, token: emptyPreview.token })).status, 200)
  assert.deepEqual((await (await request('backup')).json()).markers, [original])

  const replacement = { ...original, x: 5, faction: 'New Crew' }
  const newer = { ...backup, markers: [replacement] }
  const preview = await (await request('backup/preview', 'POST', newer)).json()
  assert.equal(preview.currentCount, 1)
  assert.deepEqual((await (await request('backup')).json()).markers, [original])
  assert.equal((await request('backup', 'PUT', { backup: newer })).status, 409)
  assert.equal((await request('backup', 'PUT', { backup, token: preview.token })).status, 409)
  assert.equal((await request('backup', 'PUT', { backup: newer, token: preview.token })).status, 200)
  assert.deepEqual((await (await request('backup')).json()).markers, [replacement])
})

test('invalid backups and stale previews leave every marker unchanged', async t => {
  const { request, close } = await serve(':memory:')
  t.after(close)
  const marker = { x: 10, y: 20, faction: 'Keep Me', players: [], color: '#f48bad' }
  const backup = { format: backupFormat, version: backupVersion, markers: [marker] }
  const preview = await (await request('backup/preview', 'POST', backup)).json()
  assert.equal((await request('markers', 'POST', marker)).status, 201)
  const before = await (await request('markers')).json()
  const invalid = { ...backup, markers: [marker, { ...marker, x: -1 }] }
  const rejected = await request('backup/preview', 'POST', invalid)
  assert.equal(rejected.status, 400)
  assert.match((await rejected.json()).error, /Backup marker 2/)
  assert.equal((await request('backup', 'PUT', { backup: invalid, token: preview.token })).status, 400)
  assert.equal((await request('backup', 'PUT', { backup, token: preview.token })).status, 409)
  assert.deepEqual(await (await request('markers')).json(), before)
})
