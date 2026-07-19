import { useState, useEffect, useRef } from 'react'
import { Category, LibraryItem } from '../types'
import { getLibrary, addLibraryItem, deleteLibraryItem, importCSV, refreshCategoryCovers, refreshItemCover, previewCSVImport } from '../api'
import { toast, dismiss } from '../notifications'

interface Props {
  category: Category
  label: string
  onClose: () => void
  onRefresh: () => void
}

// Categories that have a cover sync API
const COVER_CATEGORIES: Category[] = ['games', 'albums', 'comics', 'anime', 'manga']

interface CSVPreview {
  serviceValues: string[]
  filterColumns: { column: string; values: string[] }[]
}

export default function LibraryModal({ category, label, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newThumb, setNewThumb] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshingItem, setRefreshingItem] = useState<number | null>(null)
  // CSV 2-step import state (games only)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<CSVPreview | null>(null)
  const [selectedAcqTypes, setSelectedAcqTypes] = useState<Set<string>>(new Set())
  const [previewLoading, setPreviewLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => getLibrary(category).then(d => setItems(d as LibraryItem[])).catch(() => {})

  useEffect(() => { load() }, [category])

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    if (!q) return true
    if (i.title.toLowerCase().includes(q)) return true
    const romaji = typeof (i.metadata as Record<string, unknown>).romaji_title === 'string'
      ? ((i.metadata as Record<string, string>).romaji_title).toLowerCase()
      : ''
    return romaji.includes(q)
  })

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      await addLibraryItem(category, { title: newTitle.trim(), thumbnail_url: newThumb.trim() || undefined })
      setNewTitle(''); setNewThumb('')
      setMsg('Added')
      load(); onRefresh()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally { setBusy(false) }
  }

  const handleDelete = async (id: number) => {
    await deleteLibraryItem(id)
    load(); onRefresh()
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    const tid = toast(`Refreshing all ${label} covers…`, 'info', true)
    try {
      const r = await refreshCategoryCovers(category) as { updated?: number; skipped?: number; deleted?: number }
      dismiss(tid)
      const parts = [`${r.updated ?? 0} updated`, `${r.skipped ?? 0} not found`]
      if ((r.deleted ?? 0) > 0) parts.push(`${r.deleted} DLC removed`)
      toast(`${label}: ${parts.join(', ')}`, 'success')
      load(); onRefresh()
    } catch (e: unknown) {
      dismiss(tid)
      toast(e instanceof Error ? e.message : 'Refresh failed', 'error')
    } finally { setRefreshingAll(false) }
  }

  const handleRefreshItem = async (itemId: number) => {
    setRefreshingItem(itemId)
    try {
      await refreshItemCover(category, itemId)
      load(); onRefresh()
    } catch { /* silent */ }
    finally { setRefreshingItem(null) }
  }

  // Step 1: file selected → preview
  const handleCSVSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''

    if (category === 'games') {
      setCsvFile(file)
      setPreviewLoading(true)
      try {
        const preview = await previewCSVImport(category, file) as CSVPreview
        setCsvPreview(preview)
        // default: all service types selected
        setSelectedAcqTypes(new Set(preview.serviceValues))
      } catch {
        // Fallback: import without filter
        setCsvPreview({ serviceValues: [], filterColumns: [] })
      } finally { setPreviewLoading(false) }
    } else {
      // Non-games: import immediately
      setBusy(true)
      try {
        const result = await importCSV(category, file) as { imported: number }
        setMsg(`Imported ${result.imported} items`)
        load(); onRefresh()
      } catch (err: unknown) {
        setMsg(err instanceof Error ? err.message : 'Import error')
      } finally { setBusy(false) }
    }
  }

  // Step 2 (games only): actually import with chosen filters
  const handleCSVConfirm = async () => {
    if (!csvFile) return
    setBusy(true)
    try {
      const acqArr = selectedAcqTypes.size > 0 && csvPreview?.serviceValues.length
        ? [...selectedAcqTypes]
        : undefined
      const result = await importCSV(category, csvFile, undefined, acqArr) as { imported: number }
      setMsg(`Imported ${result.imported} items`)
      setCsvFile(null); setCsvPreview(null)
      load(); onRefresh()
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Import error')
    } finally { setBusy(false) }
  }

  const toggleAcqType = (t: string) => {
    setSelectedAcqTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  const hasCoverAPI = COVER_CATEGORIES.includes(category)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <span>📋 Library — {label} ({items.length})</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          {/* Add manually */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13 }}
              placeholder="Add manually — title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <input
              style={{ width: 140, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13 }}
              placeholder="Image URL (opt.)"
              value={newThumb}
              onChange={e => setNewThumb(e.target.value)}
            />
            <button className="btn-primary" onClick={handleAdd} disabled={busy || !newTitle.trim()}>+ Add</button>
          </div>

          {/* Actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy || previewLoading}>
              📥 Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVSelect} />
            {hasCoverAPI && (
              <button className="btn-secondary" onClick={handleRefreshAll} disabled={refreshingAll || busy}>
                {refreshingAll ? '…' : '🖼 Refresh All Covers'}
              </button>
            )}
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Import') || msg.startsWith('Added') ? 'var(--success)' : 'var(--danger)' }}>{msg}</span>}
          </div>

          {/* Games CSV filter step */}
          {category === 'games' && csvFile && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
              {previewLoading ? (
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>Reading CSV…</div>
              ) : (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                    Import from: <span style={{ color: 'var(--text2)' }}>{csvFile.name}</span>
                  </div>
                  {csvPreview && csvPreview.serviceValues.length > 0 ? (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                        Filter by format / digital service (uncheck to exclude):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                        {csvPreview.serviceValues.map(t => (
                          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', background: 'var(--surface)', padding: '4px 10px', borderRadius: 6, border: selectedAcqTypes.has(t) ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                            <input type="checkbox" checked={selectedAcqTypes.has(t)} onChange={() => toggleAcqType(t)} />
                            {t}
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                      No acquisition type filter detected — will import all games.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" onClick={handleCSVConfirm} disabled={busy}>
                      {busy ? 'Importing…' : '✓ Import'}
                    </button>
                    <button className="btn-ghost" onClick={() => { setCsvFile(null); setCsvPreview(null) }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="divider" />

          <div className="form-group lib-search">
            <input placeholder="Search library…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="lib-list">
            {filtered.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13 }}>No items</div>}
            {filtered.map(item => {
              const meta = item.metadata as Record<string, string | string[]>
              const artist = category === 'albums' ? (meta.artist as string || '') : ''
              const author = category === 'comics' ? (meta.author as string || '') : ''
              const platform = category === 'games'
                ? ((meta.platform as string) || (Array.isArray(meta.platforms) ? (meta.platforms as string[]).slice(0, 2).join(', ') : ''))
                : ''
              const acqType = category === 'games' ? (meta.acquisition_type as string || '') : ''
              return (
                <div key={item.id} className="lib-item" style={{ cursor: 'default' }}>
                  {item.thumbnail_url
                    ? <img className="lib-thumb" src={item.thumbnail_url} alt={item.title} />
                    : <div className="lib-thumb-placeholder">📄</div>
                  }
                  <div className="lib-info" style={{ flex: 1, minWidth: 0 }}>
                    <div className="lib-name">{item.title}</div>
                    <div className="lib-source" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                      <span>{item.source}</span>
                      {platform && <span>· {platform}</span>}
                      {artist && <span>· {artist}</span>}
                      {author && <span>· {author}</span>}
                      {acqType && <span style={{ color: 'var(--accent)' }}>· {acqType}</span>}
                      {(meta.status as string) && <span>· {meta.status}</span>}
                      {meta.is_dlc && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>· DLC</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {hasCoverAPI && (
                      <button
                        className="btn-icon"
                        title="Refresh cover"
                        onClick={() => handleRefreshItem(item.id)}
                        disabled={refreshingItem === item.id}
                        style={{ fontSize: 12 }}
                      >
                        {refreshingItem === item.id ? '…' : '⟳'}
                      </button>
                    )}
                    <button
                      className="btn-danger"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => handleDelete(item.id)}
                    >✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
