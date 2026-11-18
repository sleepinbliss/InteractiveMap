export const backupFormat = 'knox-field-map'
export const backupVersion = 1
export const maxBackupBytes = 50 * 1024 * 1024

export function createBackup(markers) {
  return {
    format: backupFormat,
    version: backupVersion,
    exportedAt: new Date().toISOString(),
    markers: markers.map(({ x, y, faction, players, color }) => ({ x, y, faction, players, color }))
  }
}
