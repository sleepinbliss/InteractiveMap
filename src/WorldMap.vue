<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import L from 'leaflet'
import { Crosshair, LocateFixed, Minus, Plus } from '@lucide/vue'
import world from '../MapData/zomboid_world_map.json'

const props = defineProps({ markers: Array, selected: String, placing: Boolean, draft: Object })
const emit = defineEmits(['place', 'select', 'ready'])
const surface = ref(null)
const cursor = ref(null)
const tileError = ref('')
const zoom = ref(null)
const ready = ref(false)
const pins = new Map()
const pinSvg = '<svg width="35" height="43" viewBox="0 0 35 43" aria-hidden="true"><path d="M17.5 40S3 26 3 17.5a14.5 14.5 0 1 1 29 0C32 26 17.5 40 17.5 40Z" fill="currentColor" stroke="#181c16" stroke-width="2"/><circle cx="17.5" cy="17.5" r="5" fill="#22271d"/></svg>'
let map, bounds, nativeZoom, preview, observer, tiles
let alive = true

function mapPoint({ x, y }) {
  return map.unproject([x + 0.5, y + 0.5], nativeZoom)
}

function locationAt(latlng) {
  const { x, y } = map.project(latlng, nativeZoom).floor()
  return x >= 0 && y >= 0 && x < world.w && y < world.h ? { x, y } : null
}

function rosterTooltip({ faction, players, color }) {
  const content = document.createElement('div')
  const heading = document.createElement('strong')
  heading.textContent = faction
  heading.style.color = color || ''
  content.append(heading)
  if (players.length) {
    const roster = document.createElement('ul')
    for (const player of players) {
      const row = document.createElement('li')
      row.textContent = player
      roster.append(row)
    }
    content.append(roster)
  } else {
    const empty = document.createElement('p')
    empty.textContent = 'No players listed.'
    content.append(empty)
  }
  return content
}

function renderPins() {
  if (!ready.value) return
  const visible = new Set(props.markers.map(marker => marker.id))
  for (const [id, pin] of pins) {
    if (!visible.has(id)) { pin.remove(); pins.delete(id) }
  }
  for (const marker of props.markers) {
    let pin = pins.get(marker.id)
    if (!pin) {
      pin = L.marker(mapPoint(marker), {
        icon: L.divIcon({
          className: 'world-pin', html: pinSvg, iconSize: [35, 43],
          iconAnchor: [17.5, 40], tooltipAnchor: [0, -23]
        }),
        bubblingMouseEvents: false
      }).bindTooltip(() => rosterTooltip(marker), {
        className: 'marker-roster-tooltip', offset: [18, 0]
      }).on('click', () => emit('select', marker.id)).addTo(map)
      pins.set(marker.id, pin)
    } else {
      pin.setTooltipContent(() => rosterTooltip(marker))
    }
    const element = pin.getElement()
    element.setAttribute('aria-label', `${marker.faction} at ${marker.x}, ${marker.y}`)
    element.style.color = marker.color || ''
    element.classList.toggle('selected', marker.id === props.selected)
    pin.setZIndexOffset(marker.id === props.selected ? 10000 : 0)
  }
}

function renderPreview() {
  if (!ready.value) return
  preview?.remove()
  preview = props.draft && !props.draft.id
    ? L.circleMarker(mapPoint(props.draft), { radius: 9, color: props.draft.color, fillOpacity: 0.3, interactive: false }).addTo(map)
    : null
}

function reset() {
  if (map && bounds) map.fitBounds(bounds, { padding: [28, 28], animate: false })
}

function focus(marker) {
  if (!ready.value) return
  map.setView(mapPoint(marker), Math.max(map.getZoom(), nativeZoom - 1), { animate: false })
}

function reveal() {
  if (matchMedia('(max-width: 700px)').matches) surface.value?.scrollIntoView({ block: 'center' })
}

async function initialize() {
  tileError.value = ''
  if (tiles) {
    tiles.redraw()
    return
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}tiles/manifest.json`)
    if (!response.ok) throw new Error('Missing map tiles')
    const manifest = await response.json()
    if (!alive) return
    nativeZoom = manifest.maxZoom
    map = L.map(surface.value, {
      crs: L.CRS.Simple, minZoom: -3, maxZoom: nativeZoom + 1,
      zoomControl: false, attributionControl: false, doubleClickZoom: false,
      maxBoundsViscosity: 0.9, scrollWheelZoom: true
    })
    bounds = L.latLngBounds(map.unproject([0, world.h], nativeZoom), map.unproject([world.w, 0], nativeZoom))
    map.setMaxBounds(bounds.pad(0.35))
    tiles = L.tileLayer(`${import.meta.env.BASE_URL}tiles/${manifest.version}/{z}/{y}/{x}.webp`, {
      bounds, noWrap: true, minZoom: -3, minNativeZoom: 0, maxNativeZoom: nativeZoom,
      maxZoom: nativeZoom + 1, tileSize: manifest.tileSize
    }).on('tileerror', () => { tileError.value = 'Some map tiles did not load.' }).addTo(map)
    map.on('click', event => {
      const location = locationAt(event.latlng)
      if (props.placing && location) emit('place', location)
    })
    map.on('mousemove', event => { cursor.value = locationAt(event.latlng) })
    map.on('mouseout', () => { cursor.value = null })
    map.on('zoomend', () => { zoom.value = map.getZoom() })
    reset()
    observer = new ResizeObserver(() => map?.invalidateSize({ pan: false }))
    observer.observe(surface.value)
    ready.value = true
    renderPins()
    renderPreview()
    emit('ready')
  } catch (error) {
    console.error(error)
    if (alive) tileError.value = 'The map could not load.'
  }
}

watch(() => [props.markers, props.selected], renderPins)
watch(() => [props.draft, props.draft?.color], renderPreview)
onMounted(initialize)
onUnmounted(() => { alive = false; observer?.disconnect(); map?.remove() })
defineExpose({ focus, reveal })
</script>

<template>
  <section class="map-region" aria-label="Interactive Knox Country map">
    <div ref="surface" class="map-surface" :class="{ 'is-placing': placing }" aria-label="Map canvas"></div>
    <div class="map-label map-overlay"><Crosshair :size="15" /><span>KNOX COUNTRY</span><span class="map-label-divider"></span><span class="overline muted">WORLD MAP</span></div>
    <div v-if="placing" class="placement-banner map-overlay"><Crosshair :size="17" /> Pick a location on the map <kbd>ESC</kbd></div>
    <div v-if="tileError" class="map-warning map-overlay" role="status">{{ tileError }} <button type="button" class="text-button" @click="initialize">Retry</button></div>
    <div v-else-if="!ready" class="map-warning map-overlay" role="status">Loading map tiles...</div>
    <nav v-if="ready" class="map-controls map-overlay" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" :disabled="zoom >= nativeZoom + 1" @click="map.zoomIn()"><Plus :size="19" /></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" :disabled="zoom <= -3" @click="map.zoomOut()"><Minus :size="19" /></button>
      <button type="button" aria-label="Fit whole map" title="Fit whole map" @click="reset"><LocateFixed :size="19" /></button>
    </nav>
    <div class="map-coordinates map-overlay"><Crosshair :size="14" /> <span>X {{ cursor?.x ?? '---' }}</span><span>Y {{ cursor?.y ?? '---' }}</span></div>
    <div class="map-credit map-overlay">Project Zomboid <span>&middot;</span> The Indie Stone</div>
  </section>
</template>
