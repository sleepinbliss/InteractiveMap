export async function api(endpoint, method = 'GET', body) {
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
