async function call(url: string, opts?: RequestInit) {
  const res = await fetch(url, { ...opts, credentials: 'include' })

  if (res.status === 401) {
    // Session expired or not authenticated — reload to show the login page
    window.location.reload()
    throw new Error('Not authenticated')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// --- Public profile (no auth) ---

export const getPublicProfile = (username: string) =>
  fetch(`/api/public/${encodeURIComponent(username)}`).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as {
      username: string
      slots: Record<string, { slot_index: number; is_locked: number; note: string | null; current_progress: number; title: string | null; thumbnail_url: string | null; metadata: string }[]>
      library_counts: Record<string, number>
    }
  })

// --- Auth ---

export const login = (serverUrl: string, username: string, password: string) =>
  fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, username, password }),
  }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { username: string }
  })

export const registerAccount = (username: string, password: string, passcode?: string) =>
  fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, ...(passcode ? { passcode } : {}) }),
  }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { username: string }
  })

export const loginAccount = (username: string, password: string) =>
  fetch('/api/auth/login-account', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { username: string }
  })

export const loginLocal = (passcode?: string) =>
  fetch('/api/auth/local', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(passcode ? { passcode } : {}),
  }).then(async res => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data as { username: string }
  })

export const getMe = () =>
  fetch('/api/auth/me', { credentials: 'include' }).then(async res => {
    if (!res.ok) throw new Error('Not authenticated')
    return res.json()
  })

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
  return call(`/api/library/${id}/cover`, { method: 'POST', body: form })
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
  return call(`/api/import/csv/${category}`, { method: 'POST', body: form })
}

export const refreshCategoryCovers = (category: string) =>
  call(`/api/sync/covers/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })

export const refreshItemCover = (category: string, itemId: number) =>
  call(`/api/sync/covers/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }) })

export const previewCSVImport = async (category: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return call(`/api/import/preview/${category}`, { method: 'POST', body: form })
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
  return call(`/api/queue/${category}/import`, { method: 'POST', body: form })
}

export const getOngoingItems = (category: string) => call(`/api/ongoing/${category}`)
export const addOngoingItem = (category: string, title: string, thumbnail_url?: string | null) =>
  call(`/api/ongoing/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, ...(thumbnail_url ? { thumbnail_url } : {}) }) })
export const deleteOngoingItem = (id: number) => call(`/api/ongoing/item/${id}`, { method: 'DELETE' })
export const syncOngoingAniList = () => call('/api/ongoing/sync/anilist', { method: 'POST' })
export const syncOngoingSimkl   = () => call('/api/ongoing/sync/simkl',   { method: 'POST' })
