<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Crosshair, Flag, Focus, MapPin, Pencil, Plus, Search, Trash2, Users, X } from '@lucide/vue'
import WorldMap from './WorldMap.vue'
import { api } from './api.js'
import { filterMarkers } from './search.js'
import { defaultMarkerColor } from '../shared/marker-color.mjs'
import { maxBackupBytes } from '../shared/backup.mjs'
import world from '../MapData/zomboid_world_map.json'

const map = ref(null)
const mapReady = ref(false)
const loaded = ref(false)
const markers = ref([])
const query = ref('')
const mode = ref('all')
const selectedId = ref('')
const placing = ref(false)
const draft = ref(null)
const busy = ref(false)
const notice = ref('')
const syncError = ref('')
const formError = ref('')
const editor = ref(null)
const confirmDelete = ref(false)
const coords = ref(null)
const coordinateDialog = ref(null)
const backupInput = ref(null)
const restoreDialog = ref(null)
const restoreDraft = ref(null)
const backupBusy = ref(false)
const backupError = ref('')
const restoreError = ref('')
let refreshTimer, requested = 0

const modes = [{ id: 'all', label: 'All' }, { id: 'factions', label: 'Factions' }, { id: 'players', label: 'Players' }]
const results = computed(() => filterMarkers(markers.value, query.value, mode.value))
const selected = computed(() => results.value.find(marker => marker.id === selectedId.value))
const counts = computed(() => {
  const factions = new Set(), players = new Set()
  for (const marker of markers.value) {
    factions.add(marker.faction.toLowerCase())
    marker.players.forEach(player => players.add(player.toLowerCase()))
  }
  return { factions: factions.size, players: players.size }
})

async function refresh() {
  const request = ++requested
  try {
    const list = await api('markers')
    if (requested !== request) return
    if (JSON.stringify(markers.value) !== JSON.stringify(list)) markers.value = list
    loaded.value = true
    syncError.value = ''
  } catch {
    if (requested !== request) return
    syncError.value = 'Could not sync with the board. Retrying shortly.'
  }
}

function select(id, recenter = true, reveal = false) {
  selectedId.value = id
  if (recenter && selected.value) map.value?.focus(selected.value)
  if (reveal) map.value?.reveal()
}

function togglePlacement() {
  placing.value = !placing.value
  if (placing.value) map.value?.reveal()
}

function openEditor(location) {
  placing.value = false
  notice.value = ''
  formError.value = ''
  confirmDelete.value = false
  draft.value = { color: defaultMarkerColor, ...location, faction: location.faction || '', roster: location.players?.join('\n') || '' }
  editor.value.showModal()
  void nextTick(() => editor.value?.querySelector('input')?.focus())
}

function openCoordinates() {
  placing.value = false
  coords.value = { x: '', y: '' }
  coordinateDialog.value.showModal()
  void nextTick(() => coordinateDialog.value?.querySelector('input')?.focus())
}

function placeByCoordinates() {
  const location = { x: Number(coords.value.x), y: Number(coords.value.y) }
  coordinateDialog.value.close()
  map.value?.focus(location)
  openEditor(location)
}

function closeEditor() {
  if (!busy.value) editor.value.close()
}

async function save() {
  busy.value = true
  formError.value = ''
  const { id, version, x, y, faction, roster, color } = draft.value
  const body = { x, y, faction, version, color, players: roster.split(/\r?\n/).map(name => name.trim()).filter(Boolean) }
  try {
    const saved = await api(id ? `markers/${id}` : 'markers', id ? 'PUT' : 'POST', body)
    markers.value = [saved, ...markers.value.filter(marker => marker.id !== saved.id)]
    if (!results.value.some(marker => marker.id === saved.id)) query.value = ''
    select(saved.id)
    editor.value.close()
    notice.value = id ? 'Marker updated.' : 'Marker added to the shared board.'
    void refresh()
  } catch (error) {
    if ([404, 409].includes(error.status)) void refresh()
    formError.value = error.message
  } finally { busy.value = false }
}

async function deleteMarker() {
  busy.value = true
  formError.value = ''
  const { id, version } = draft.value
  try {
    await api(`markers/${id}`, 'DELETE', { version })
    markers.value = markers.value.filter(marker => marker.id !== id)
    selectedId.value = ''
    editor.value.close()
    notice.value = 'Marker removed from the shared board.'
    void refresh()
  } catch (error) {
    if ([404, 409].includes(error.status)) void refresh()
    formError.value = error.message
  } finally { busy.value = false }
}

async function downloadBackup() {
  backupBusy.value = true
  backupError.value = ''
  try {
    const backup = await api('backup')
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `knox-field-map-${backup.exportedAt.replace(/[:.]/g, '-')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    backupError.value = `Could not download the backup: ${error.message}`
  } finally { backupBusy.value = false }
}

async function chooseBackup(event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  backupBusy.value = true
  backupError.value = ''
  restoreError.value = ''
  try {
    if (file.size > maxBackupBytes) throw new Error('Backup files must be 50 MB or smaller.')
    const text = await file.text()
    let backup
    try { backup = JSON.parse(text) }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      throw new Error('The selected file is not valid JSON.')
    }
    const preview = await api('backup/preview', 'POST', backup)
    restoreDraft.value = { backup, filename: file.name, ...preview }
    await nextTick()
    restoreDialog.value.showModal()
  } catch (error) {
    backupError.value = `Could not open the backup: ${error.message}`
  } finally { backupBusy.value = false }
}

async function restoreBackup() {
  if (backupBusy.value || !restoreDraft.value?.token) return
  backupBusy.value = true
  restoreError.value = ''
  const { backup, token } = restoreDraft.value
  try {
    const { count } = await api('backup', 'PUT', { backup, token })
    placing.value = false
    selectedId.value = ''
    query.value = ''
    mode.value = 'all'
    restoreDialog.value.close()
    notice.value = `Backup restored: ${count} ${count === 1 ? 'marker' : 'markers'} on the shared board.`
    await refresh()
  } catch (error) {
    if (error.status === 409) restoreDraft.value.token = ''
    restoreError.value = error.message
  } finally { backupBusy.value = false }
}

function onEscape(event) {
  if (event.key === 'Escape' && !editor.value?.open && !coordinateDialog.value?.open) placing.value = false
}

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(refresh, 8000)
  window.addEventListener('keydown', onEscape)
})
onUnmounted(() => { clearInterval(refreshTimer); window.removeEventListener('keydown', onEscape) })
</script>

<template>
  <header class="masthead">
    <div class="brand">
      <div class="brand-icon"><Crosshair :size="25" :stroke-width="1.7" /></div>
      <div><p class="overline brand-kicker">PROJECT ZOMBOID</p><h1>Knox Field Map</h1></div>
    </div>
    <span class="board-badge"><span :class="['status-dot', { online: loaded && !syncError }]"></span>{{ syncError ? 'Sync interrupted' : loaded ? 'Shared board' : 'Connecting' }}</span>
  </header>

  <main class="workspace">
    <aside class="directory" aria-label="Marker directory">
      <div class="directory-head">
        <p class="overline section-tag"><Flag :size="14" /> FACTION DIRECTORY</p>
        <h2>Field markers</h2>
        <p class="muted description">Find factions, their members, and where they’re based in Knox Country.</p>
      </div>
        <div class="directory-tools">
          <label class="search-field">
            <Search :size="18" /><input v-model="query" type="search" aria-label="Search markers" placeholder="Search faction or player..." />
          </label>
          <div class="filters" role="group" aria-label="Search by">
            <button v-for="filter in modes" :key="filter.id" type="button" :aria-pressed="mode === filter.id" @click="mode = filter.id">{{ filter.label }}</button>
          </div>
          <div class="placement-actions">
            <button class="primary" type="button" :disabled="!mapReady" @click="togglePlacement"><component :is="placing ? X : Plus" :size="19" /> {{ placing ? 'Cancel placement' : 'Add marker' }}</button>
            <button class="icon-button" type="button" aria-label="Enter map coordinates" title="Enter map coordinates" :disabled="!mapReady" @click="openCoordinates"><Focus :size="19" /></button>
          </div>
        </div>

        <p v-if="syncError" class="feedback error" role="status">{{ syncError }}</p>
        <p v-if="notice" class="feedback" role="status">{{ notice }}</p>
        <div class="results-heading overline"><span>{{ query.trim() ? 'SEARCH RESULTS' : 'SAVED LOCATIONS' }}</span><span aria-live="polite">{{ results.length }}</span></div>
        <div v-if="results.length" class="results">
          <article v-for="marker in results" :key="marker.id" :class="['marker-card', { active: marker.id === selectedId }]">
            <button class="marker-focus" type="button" :aria-expanded="marker.id === selectedId" @click="select(marker.id, true, true)">
              <span class="marker-icon"><MapPin :size="17" /></span>
              <span class="marker-summary">
                <strong :style="{ color: marker.color }">{{ marker.faction }}</strong>
                <span class="marker-meta">X {{ marker.x }} / Y {{ marker.y }}</span>
                <span v-if="query.trim() && mode !== 'factions'" class="matching-players">{{ marker.players.filter(player => player.toLowerCase().includes(query.trim().toLowerCase())).join(', ') }}</span>
              </span>
              <ArrowRight :size="16" class="marker-arrow" />
            </button>
            <div v-if="marker.id === selectedId" class="marker-details">
              <p class="overline"><Users :size="14" /> PLAYERS ({{ marker.players.length }})</p>
              <ul v-if="marker.players.length" class="roster"><li v-for="player in marker.players" :key="player">{{ player }}</li></ul>
              <p v-else class="muted">No players listed.</p>
              <button class="text-button" type="button" @click="openEditor(marker)"><Pencil :size="14" /> Edit marker</button>
            </div>
          </article>
        </div>
        <p v-else-if="!loaded && !syncError" class="feedback" role="status">Loading shared markers...</p>
        <div v-else-if="loaded" class="empty-state">
          <div class="empty-icon"><MapPin :size="23" /></div>
          <strong>{{ query.trim() ? 'No matching locations' : 'No field markers yet' }}</strong>
          <p>{{ query.trim() ? 'Try another name or search category.' : 'Add your first marker to start mapping your faction.' }}</p>
        </div>
        <footer class="directory-footer"><span><Flag :size="14" /> {{ counts.factions }} {{ counts.factions === 1 ? 'faction' : 'factions' }}</span><span><Users :size="15" /> {{ counts.players }} {{ counts.players === 1 ? 'player' : 'players' }}</span></footer>
        <div class="backup-tools" role="group" aria-label="Board backups">
          <button type="button" class="text-button" :disabled="backupBusy" @click="downloadBackup"><ArrowDownToLine :size="15" /> Download backup</button>
          <button type="button" class="text-button" :disabled="backupBusy" @click="backupInput.click()"><ArrowUpFromLine :size="15" /> Restore backup</button>
          <input ref="backupInput" type="file" accept=".json,application/json" hidden @change="chooseBackup" />
          <p v-if="backupError" class="error" role="alert">{{ backupError }}</p>
        </div>
    </aside>

    <WorldMap ref="map" :markers="results" :selected="selectedId" :placing="placing" :draft="draft" @ready="mapReady = true" @place="openEditor" @select="select($event, false)" />
  </main>

  <dialog ref="editor" class="dialog" @close="draft = null" @cancel="busy && $event.preventDefault()">
    <form v-if="draft" @submit.prevent="save">
      <div class="dialog-heading"><div><p class="overline section-tag"><MapPin :size="14" /> X {{ draft.x }} / Y {{ draft.y }}</p><h2>{{ draft.id ? 'Edit field marker' : 'New field marker' }}</h2></div><button type="button" class="icon-button" aria-label="Close editor" :disabled="busy" @click="closeEditor"><X :size="19" /></button></div>
      <label class="form-label">Faction name<input v-model="draft.faction" maxlength="80" required autofocus placeholder="e.g. Riverside Crew" /></label>
      <label class="form-label marker-color-field">Marker color<input v-model="draft.color" type="color" /></label>
      <label class="form-label">Players based here <span class="muted">(optional)</span><textarea v-model="draft.roster" rows="5" maxlength="4100" placeholder="One player name per line"></textarea></label>
      <p v-if="formError" class="error" role="alert">{{ formError }}</p>
      <div v-if="confirmDelete" class="delete-confirm">
        <p>Remove this location for everyone on the board?</p>
        <button class="text-button" type="button" :disabled="busy" @click="confirmDelete = false">Keep marker</button>
        <button class="danger" type="button" :disabled="busy" @click="deleteMarker">Delete marker</button>
      </div>
      <div v-else class="dialog-actions">
        <button v-if="draft.id" class="icon-button danger-icon" type="button" aria-label="Delete marker" :disabled="busy" @click="confirmDelete = true"><Trash2 :size="17" /></button>
        <button class="text-button cancel" type="button" :disabled="busy" @click="closeEditor">Cancel</button>
        <button class="primary" type="submit" :disabled="busy"><ArrowDownToLine :size="17" /> {{ busy ? 'Saving...' : 'Save marker' }}</button>
      </div>
    </form>
  </dialog>

  <dialog ref="coordinateDialog" class="dialog" @close="coords = null">
    <form v-if="coords" @submit.prevent="placeByCoordinates">
      <div class="dialog-heading"><div><p class="overline section-tag"><Crosshair :size="14" /> PRECISE PLACEMENT</p><h2>Enter coordinates</h2></div><button type="button" class="icon-button" aria-label="Close coordinates" @click="coordinateDialog.close()"><X :size="19" /></button></div>
      <div class="coordinate-fields">
        <label class="form-label">Map X<input v-model="coords.x" type="number" step="1" min="0" :max="world.w - 1" required autofocus /></label>
        <label class="form-label">Map Y<input v-model="coords.y" type="number" step="1" min="0" :max="world.h - 1" required /></label>
      </div>
      <div class="dialog-actions"><button class="primary" type="submit">Continue <ArrowRight :size="17" /></button></div>
    </form>
  </dialog>

  <dialog ref="restoreDialog" class="dialog" aria-labelledby="restore-heading" @close="restoreDraft = null" @cancel="backupBusy && $event.preventDefault()">
    <form v-if="restoreDraft" @submit.prevent="restoreBackup">
      <h2 id="restore-heading">Replace shared markers?</h2>
      <p class="backup-filename">{{ restoreDraft.filename }}</p>
      <p>This will remove all {{ restoreDraft.currentCount }} current markers and replace them with {{ restoreDraft.incomingCount }} markers from the backup. It affects everyone on the shared board.</p>
      <p class="muted">Download a fresh backup first if you want to keep a copy of the current board.</p>
      <p v-if="restoreError" class="error" role="alert">{{ restoreError }}</p>
      <div class="dialog-actions">
        <button type="button" class="text-button" :disabled="backupBusy" autofocus @click="restoreDialog.close()">Cancel</button>
        <button type="submit" class="danger" :disabled="backupBusy || !restoreDraft.token">{{ backupBusy ? 'Restoring...' : 'Replace markers' }}</button>
      </div>
    </form>
  </dialog>
</template>
