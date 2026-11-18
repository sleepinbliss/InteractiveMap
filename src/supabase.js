import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const cloud = url && key ? createClient(url, key, {
  auth: { detectSessionInUrl: false }
}) : null

export function unwrap({ data, error, status }) {
  if (error) throw Object.assign(new Error(error.message), { status: error.code === 'PT409' ? 409 : status })
  return data
}

export async function cloudApi(endpoint, method, body) {
  if (endpoint.startsWith('backup')) {
    return unwrap(await cloud.rpc('knox_restore', {
      payload: method === 'POST' ? body : body.backup,
      ...(method === 'PUT' ? { expected_token: body.token } : {})
    }))
  }
  const table = () => cloud.from('knox_markers')
  if (method === 'GET') {
    const markers = []
    let cursor = ''
    while (true) {
      let request = table().select('*').order('id').limit(500)
      if (cursor) request = request.gt('id', cursor)
      const batch = unwrap(await request)
      if (!batch.length) break
      markers.push(...batch)
      cursor = batch.at(-1).id
    }
    return markers.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))
  }
  const { faction, players, color, version } = body
  const fields = { faction: faction?.trim(), players, color }
  if (method === 'POST') {
    return unwrap(await table().insert({ ...fields, x: body.x, y: body.y }).select().single())
  }
  const id = endpoint.split('/')[1]
  const mutation = method === 'PUT' ? table().update(fields) : table().delete()
  const changed = unwrap(await mutation.eq('id', id).eq('version', version).select().maybeSingle())
  if (!changed) throw Object.assign(new Error('This marker changed or you no longer have permission. Reopen it and try again.'), { status: 409 })
  return changed
}
