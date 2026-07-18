async function call(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

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

export const getLibrary = (category: string) => call(`/api/library/${category}`)
export const addLibraryItem = (category: string, data: { title: string; thumbnail_url?: string }) =>
  call(`/api/library/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
export const deleteLibraryItem = (id: number) => call(`/api/library/${id}`, { method: 'DELETE' })
export const clearLibrary = (category: string) => call(`/api/library/clear/${category}`, { method: 'DELETE' })

export const getSettings = () => call('/api/settings')
export const saveSettings = (data: Record<string, unknown>) =>
  call('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

export const getStats = () => call('/api/stats')

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

export const importCSV = async (category: string, file: File, platforms?: string[]) => {
  const form = new FormData()
  form.append('file', file)
  if (platforms && platforms.length > 0) form.append('platforms', JSON.stringify(platforms))
  return call(`/api/import/csv/${category}`, { method: 'POST', body: form })
}

export const updateOngoingProgress = (id: number, watched_progress: number) =>
  call(`/api/ongoing/item/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched_progress }),
  })

export const getQueue = (category: string) => call(`/api/queue/${category}`)
export const addQueueItem = (category: string, title: string) =>
  call(`/api/queue/${category}/item`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
export const deleteQueueItem = (category: string, id: number) =>
  call(`/api/queue/${category}/item/${id}`, { method: 'DELETE' })
export const clearQueue = (category: string) =>
  call(`/api/queue/${category}`, { method: 'DELETE' })
export const importQueueCSV = async (category: string, file: File) => {
  const form = new FormData(); form.append('file', file)
  return call(`/api/queue/${category}/import`, { method: 'POST', body: form })
}

export const getOngoingItems = (category: string) => call(`/api/ongoing/${category}`)
export const addOngoingItem = (category: string, title: string) =>
  call(`/api/ongoing/${category}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
export const deleteOngoingItem = (id: number) => call(`/api/ongoing/item/${id}`, { method: 'DELETE' })
export const syncOngoingAniList = () => call('/api/ongoing/sync/anilist', { method: 'POST' })
export const syncOngoingSimkl   = () => call('/api/ongoing/sync/simkl',   { method: 'POST' })
