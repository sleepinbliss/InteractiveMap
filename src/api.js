export const readOnly = import.meta.env.MODE === 'pages'

export async function api(endpoint, method = 'GET', body) {
  if (readOnly) {
    if (endpoint !== 'markers' || method !== 'GET') throw new Error('The published map is read-only.')
    const response = await fetch(`${import.meta.env.BASE_URL}markers.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Could not load published markers (${response.status}).`)
    const backup = await response.json()
    return backup.markers.map((marker, index) => ({ ...marker, id: `published-${index}` }))
  }
  const headers = { 'X-Knox-Board': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`/api/${endpoint}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (response.status === 204) return null
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The board server did not respond as expected.')
  }
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status })
  return data
}
