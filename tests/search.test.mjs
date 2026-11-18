import assert from 'node:assert/strict'
import test from 'node:test'
import { filterMarkers } from '../src/search.js'
import { parseMarker, world } from '../shared/markers.mjs'
import { defaultMarkerColor } from '../shared/marker-color.mjs'

test('a player or faction search returns all and only the associated pins', () => {
  const markers = [
    { faction: 'Riverside Crew', players: ['Stone', 'Robin'] },
    { faction: 'West Point', players: ['Robin'] },
    { faction: 'Robin Hill', players: ['Jules'] }
  ]
  assert.deepEqual(filterMarkers(markers, '  rOBin ', 'players'), markers.slice(0, 2))
  assert.deepEqual(filterMarkers(markers, 'robin', 'factions'), [markers[2]])
  assert.deepEqual(filterMarkers(markers, 'robin', 'all'), markers)
  assert.deepEqual(filterMarkers(markers, 'riverside crew', 'all'), [markers[0]])
  assert.deepEqual(filterMarkers(markers, 'unknown', 'all'), [])
  assert.deepEqual(filterMarkers(markers, '', 'factions'), markers)
})

test('marker validation accepts edge pixels and deduplicates player names', () => {
  const marker = { x: world.w - 1, y: world.h - 1, faction: ' Crew ', players: [' Stone ', 'STONE', 'Robin'] }
  assert.deepEqual(parseMarker(marker), { ...marker, faction: 'Crew', players: ['Stone', 'Robin'], color: defaultMarkerColor })
  assert.equal(parseMarker({ ...marker, color: '#A1B2C3' }).color, '#a1b2c3')
  for (const invalid of [{ x: world.w }, { y: -1 }, { y: 1.5 }, { faction: '  ' }, { players: [42] }, { color: 'red' }, { color: '#123' }]) {
    assert.throws(() => parseMarker({ ...marker, ...invalid }), TypeError)
  }
})
