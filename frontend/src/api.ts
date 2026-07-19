const TOKEN_KEY = 'mp_token'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function call(url: string, opts?: RequestInit) {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string> | undefined),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { ...opts, headers })

  if (res.status === 401) {
    if (token) {
      clearToken()
      window.location.reload()
    }
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// --- Auth ---

export const login = (serverUrl: string, username: string, password: string) =>
  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, username, password }),
  }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { token: string; username: string }
  })

export const loginLocal = () =>
  fetch('/api/auth/local', { method: 'POST' }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { token: string; username: string }
  })

export const getMe = () => call('/api/auth/me')

export const logout = () => call('/api/auth/logout', { method: 'POST' })

// --- Slots ---

export const getSlots = () => call('/api/slots')
export const lockSlot = (id: number) => call(`/api/slots/${id}/lock`, { method: 'POST' })
export const completeSlot = (id: number) => call(`/api/slots/${id}/complete`, { method: 'POST' })
export const rerollSlot = (id: number) => call(`/api/slots/${id}/reroll`, { method: 'POST' })
export const saveNote = (id: number, note: string) =>
  call(`/api/slots/${id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
export const updateProgress = (id: number, progress: number) =>
  call(`/api/slots/${id}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progress }) })
export const assignSlot = (slotId: number, itemId: number) =>
  call(`/api/slots/${slotId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId }) })
export const rerollCategory = (category: string) =>
  call(`/api/slots/category/${category}/reroll-all`, { method: 'POST' })

// --- Library ---

export const getLibrary = (category: string) => call(`/api/library/${category}`)
export const addLibraryItem = (category: string, data: { title: string; thumbnail_url?: string }) =>
  call(`/api/library/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteLibraryItem = (id: number) => call(`/api/library/${id}`, { method: 'DELETE' })
export const clearLibrary = (category: string) => call(`/api/library/clear/${category}`, { method: 'DELETE' })
export const updateLibraryItemCover = (id: number, thumbnail_url: string, clear_review = false) =>
  call(`/api/library/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thumbnail_url, clear_review }) })
export const uploadLibraryItemCover = async (id: number, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api/library/${id}/cover`, { method: 'POST', headers, body: form })
  if (res.status === 401) { if (token) { clearToken(); window.location.reload() }; throw new Error('Session expired') }
  if (!res.ok) { const err = await res.json().catch(() => ({})) as { error?: string }; throw new Error(err.error || `HTTP ${res.status}`) }
  return res.json()
}

// --- Settings ---

export const getSettings = () => call('/api/settings')
export const saveSettings = (data: Record<string, unknown>) =>
  call('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

// --- Stats ---

export const getStats = () => call('/api/stats')

// --- Sync ---

export const syncAniList = () => call('/api/sync/anilist', { method: 'POST' })
export const syncSimkl  = () => call('/api/sync/simkl',  { method: 'POST' })
export const syncMAL    = () => call('/api/sync/mal',    { method: 'POST' })
export const updateMetadata = () => call('/api/sync/update-metadata', { method: 'POST' })
export const fetchIGDBCovers = () => call('/api/sync/igdb', { method: 'POST' })
export const fetchAOTYCovers = () => call('/api/sync/aoty', { method: 'POST' })
export const fetchComicVineCovers = () => call('/api/sync/comicvine', { method: 'POST' })
export const fetchGoogleBooksCovers = () => call('/api/sync/googlebooks', { method: 'POST' })
export const getSimklPin    = () => call('/api/sync/simkl/pin')
export const pollSimklPin   = (uc: string) => call(`/api/sync/simkl/pin/${uc}`)

// --- Import ---

export const importCSV = async (category: string, file: File, platforms?: string[], acquisitionTypes?: string[], retro?: boolean) => {
  const form = new FormData()
  form.append('file', file)
  if (platforms && platforms.length > 0) form.append('platforms', JSON.stringify(platforms))
  if (acquisitionTypes && acquisitionTypes.length > 0) form.append('acquisitionTypes', JSON.stringify(acquisitionTypes))
  if (retro) form.append('retro', 'true')
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api/import/csv/${category}`, { method: 'POST', headers, body: form })
  if (res.status === 401) { if (token) { clearToken(); window.location.reload() }; throw new Error('Session expired') }
  if (!res.ok) { const err = await res.json().catch(() => ({})) as { error?: string }; throw new Error(err.error || `HTTP ${res.status}`) }
  return res.json()
}

export const refreshCategoryCovers = (category: string) =>
  call(`/api/sync/covers/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })

export const refreshItemCover = (category: string, itemId: number) =>
  call(`/api/sync/covers/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }) })

export const previewCSVImport = async (category: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api/import/preview/${category}`, { method: 'POST', headers, body: form })
  if (res.status === 401) { if (token) { clearToken(); window.location.reload() }; throw new Error('Session expired') }
  if (!res.ok) { const err = await res.json().catch(() => ({})) as { error?: string }; throw new Error(err.error || `HTTP ${res.status}`) }
  return res.json()
}

// --- Ongoing ---

export const updateOngoingProgress = (id: number, watched_progress: number) =>
  call(`/api/ongoing/item/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched_progress }),
  })

// --- Queue ---

export const getQueue = (category: string) => call(`/api/queue/${category}`)
export const addQueueItem = (category: string, title: string) =>
  call(`/api/queue/${category}/item`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
export const deleteQueueItem = (category: string, id: number) =>
  call(`/api/queue/${category}/item/${id}`, { method: 'DELETE' })
export const clearQueue = (category: string) =>
  call(`/api/queue/${category}`, { method: 'DELETE' })
export const importQueueCSV = async (category: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`/api/queue/${category}/import`, { method: 'POST', headers, body: form })
  if (res.status === 401) { if (token) { clearToken(); window.location.reload() }; throw new Error('Session expired') }
  if (!res.ok) { const err = await res.json().catch(() => ({})) as { error?: string }; throw new Error(err.error || `HTTP ${res.status}`) }
  return res.json()
}

export const getOngoingItems = (category: string) => call(`/api/ongoing/${category}`)
export const addOngoingItem = (category: string, title: string, thumbnail_url?: string | null) =>
  call(`/api/ongoing/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, ...(thumbnail_url ? { thumbnail_url } : {}) }) })
export const deleteOngoingItem = (id: number) => call(`/api/ongoing/item/${id}`, { method: 'DELETE' })
export const syncOngoingAniList = () => call('/api/ongoing/sync/anilist', { method: 'POST' })
export const syncOngoingSimkl   = () => call('/api/ongoing/sync/simkl',   { method: 'POST' })
