export function filterMarkers(markers, query, mode) {
  const name = query.trim().toLowerCase()
  if (!name) return markers
  return markers.filter(marker =>
    (mode !== 'players' && marker.faction.toLowerCase().includes(name)) ||
    (mode !== 'factions' && marker.players.some(player => player.toLowerCase().includes(name))))
}
