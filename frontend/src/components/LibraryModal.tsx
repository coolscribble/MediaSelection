import { useState, useEffect, useRef } from 'react'
import { Category, LibraryItem } from '../types'
import { getLibrary, addLibraryItem, deleteLibraryItem, importCSV } from '../api'

interface Props {
  category: Category
  label: string
  onClose: () => void
  onRefresh: () => void
}

export default function LibraryModal({ category, label, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newThumb, setNewThumb] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => getLibrary(category).then(setItems).catch(() => {})

  useEffect(() => { load() }, [category])

  const filtered = items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()))

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      await addLibraryItem(category, { title: newTitle.trim(), thumbnail_url: newThumb.trim() || undefined })
      setNewTitle('')
      setNewThumb('')
      setMsg('Added')
      load()
      onRefresh()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: number) => {
    await deleteLibraryItem(id)
    load()
    onRefresh()
  }

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const result = await importCSV(category, file) as { imported: number }
      setMsg(`Imported ${result.imported} items`)
      load()
      onRefresh()
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Import error')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span>📋 Library — {label} ({items.length})</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
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
              placeholder="Image URL (optional)"
              value={newThumb}
              onChange={e => setNewThumb(e.target.value)}
            />
            <button className="btn-primary" onClick={handleAdd} disabled={busy || !newTitle.trim()}>
              + Add
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              📥 Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSV} />
            {msg && <span className={msg.startsWith('Error') || msg.startsWith('Import error') ? 'error-msg' : 'success-msg'}>{msg}</span>}
          </div>

          <div className="divider" />

          <div className="form-group lib-search">
            <input placeholder="Search library…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="lib-list">
            {filtered.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13 }}>No items</div>}
            {filtered.map(item => (
              <div key={item.id} className="lib-item" style={{ cursor: 'default' }}>
                {item.thumbnail_url
                  ? <img className="lib-thumb" src={item.thumbnail_url} alt={item.title} />
                  : <div className="lib-thumb-placeholder">📄</div>
                }
                <div className="lib-info">
                  <div className="lib-name">{item.title}</div>
                  <div className="lib-source">
                    {item.source}
                    {(item.metadata as Record<string,string>).platform ? ` · ${(item.metadata as Record<string,string>).platform}` : ''}
                    {(item.metadata as Record<string,string>).status ? ` · ${(item.metadata as Record<string,string>).status}` : ''}
                  </div>
                </div>
                <button
                  className="btn-danger"
                  style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                  onClick={() => handleDelete(item.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
