import { useState, useEffect } from 'react'
import { Slot, LibraryItem } from '../types'
import { getLibrary, assignSlot } from '../api'

interface Props {
  slot: Slot
  onClose: () => void
  onRefresh: () => void
}

export default function ManualSelectModal({ slot, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getLibrary(slot.category).then(setItems).catch(() => setError('Failed to load library'))
  }, [slot.category])

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    if (!q) return true
    if (i.title.toLowerCase().includes(q)) return true
    const romaji = typeof (i.metadata as Record<string, unknown>).romaji_title === 'string'
      ? ((i.metadata as Record<string, string>).romaji_title).toLowerCase()
      : ''
    return romaji.includes(q)
  })

  const handleAssign = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await assignSlot(slot.id, selected)
      onRefresh()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Pick manually — Slot {slot.slot_index}</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg" style={{ marginBottom: 10 }}>{error}</div>}
          <div className="form-group lib-search">
            <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="lib-list">
            {filtered.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13 }}>No items</div>}
            {filtered.map(item => (
              <div
                key={item.id}
                className={`lib-item${selected === item.id ? ' selected' : ''}`}
                onClick={() => setSelected(item.id)}
              >
                {item.thumbnail_url
                  ? <img className="lib-thumb" src={item.thumbnail_url} alt={item.title} />
                  : <div className="lib-thumb-placeholder">📄</div>
                }
                <div className="lib-info">
                  <div className="lib-name">{item.title}</div>
                  <div className="lib-source">{item.source}{(item.metadata as Record<string,string>).platform ? ` · ${(item.metadata as Record<string,string>).platform}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleAssign} disabled={!selected || busy}>
            {busy ? '…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
