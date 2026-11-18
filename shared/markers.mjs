import { readFileSync } from 'node:fs'
import { defaultMarkerColor } from './marker-color.mjs'
import { backupFormat, backupVersion } from './backup.mjs'

export const world = JSON.parse(readFileSync(new URL('../MapData/zomboid_world_map.json', import.meta.url), 'utf8'))
export const limits = Object.freeze({ faction: 80, player: 80, players: 50, markers: 2000 })

export function parseMarker(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Enter the marker details.')
  const { x, y } = value
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.w || y >= world.h) {
    throw new TypeError('Choose a location inside the map.')
  }

  const faction = typeof value.faction === 'string' ? value.faction.trim() : ''
  if (!faction || faction.length > limits.faction) throw new TypeError('Enter a faction name (1-80 characters).')
  if (!Array.isArray(value.players) || value.players.length > limits.players) throw new TypeError('Enter up to 50 players.')
  const players = new Map()
  for (const raw of value.players) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name || name.length > limits.player) throw new TypeError('Player names must be 1-80 characters.')
    const key = name.toLowerCase()
    if (!players.has(key)) players.set(key, name)
  }
  const color = value.color === undefined ? defaultMarkerColor : value.color
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new TypeError('Choose a valid marker color.')
  }
  return { x, y, faction, players: [...players.values()], color: color.toLowerCase() }
}

export function parseBackup(value) {
  if (value?.format !== backupFormat || value.version !== backupVersion || !Array.isArray(value.markers)) {
    throw new TypeError('Choose a supported Knox Field Map backup file.')
  }
  if (value.markers.length > limits.markers) {
    throw new TypeError(`A backup can contain at most ${limits.markers} markers.`)
  }
  return value.markers.map((raw, index) => {
    try { return parseMarker(raw) }
    catch (error) {
      if (!(error instanceof TypeError)) throw error
      throw new TypeError(`Backup marker ${index + 1}: ${error.message}`)
    }
  })
}
