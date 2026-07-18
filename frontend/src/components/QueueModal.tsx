import { useState, useEffect, useRef } from 'react'
import { Category, QueueItem } from '../types'
import { getQueue, addQueueItem, deleteQueueItem, clearQueue, importQueueCSV } from '../api'

interface Props {
  category: Category
  label: string
  onClose: () => void
  onRefresh: () => void
}

export default function QueueModal({ category, label, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () => getQueue(category).then(setItems).catch(() => {})
  useEffect(() => { load() }, [category])

  const pending = items.filter(i => !i.consumed)
  const done    = items.filter(i => i.consumed)

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      await addQueueItem(category, newTitle.trim())
      setNewTitle(''); setMsg('Added')
      load(); onRefresh()
    } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const handleDelete = async (id: number) => {
    await deleteQueueItem(category, id)
    load(); onRefresh()
  }

  const handleClear = async () => {
    if (!confirm(`Clear entire queue for ${label}?`)) return
    await clearQueue(category)
    load(); onRefresh()
  }

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const r = await importQueueCSV(category, file) as { imported: number }
      setMsg(`Imported ${r.imported} items into queue`)
      load(); onRefresh()
    } catch (err: unknown) { setMsg(err instanceof Error ? err.message : 'Import error') }
    finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span>📋 Queue — {label} ({pending.length} pending / {done.length} done)</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 10px', fontSize: 13 }}
              placeholder="Add to queue — title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button className="btn-primary" onClick={handleAdd} disabled={busy || !newTitle.trim()}>+ Add</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
              📥 Import CSV (ordered)
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSV} />
            <button className="btn-ghost" onClick={handleClear} disabled={busy} style={{ color: 'var(--danger)' }}>
              🗑 Clear all
            </button>
            {msg && <span className={msg.startsWith('Error') || msg.startsWith('Import') ? 'error-msg' : 'success-msg'}>{msg}</span>}
          </div>

          <div className="divider" />

          {pending.length === 0 && (
            <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
              Queue is empty — add items above or import a CSV
            </div>
          )}

          <div className="lib-list">
            {pending.map((item, idx) => (
              <div key={item.id} className="lib-item" style={{ cursor: 'default' }}>
                <div style={{ width: 28, flexShrink: 0, textAlign: 'center', fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>
                  #{idx + 1}
                </div>
                {item.thumbnail_url
                  ? <img className="lib-thumb" src={item.thumbnail_url} alt={item.title} />
                  : <div className="lib-thumb-placeholder">📄</div>
                }
                <div className="lib-info">
                  <div className="lib-name">{item.title}</div>
                  {(item.metadata as Record<string,string>).platform && (
                    <div className="lib-source">{(item.metadata as Record<string,string>).platform}</div>
                  )}
                </div>
                <button
                  className="btn-danger"
                  style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                  onClick={() => handleDelete(item.id)}
                >✕</button>
              </div>
            ))}
          </div>

          {done.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Consumed ({done.length})</div>
              <div className="lib-list" style={{ opacity: 0.5 }}>
                {done.slice(-5).map(item => (
                  <div key={item.id} className="lib-item" style={{ cursor: 'default' }}>
                    <div style={{ width: 28, flexShrink: 0, textAlign: 'center', fontSize: 13, color: 'var(--success)' }}>✓</div>
                    <div className="lib-thumb-placeholder">📄</div>
                    <div className="lib-info"><div className="lib-name">{item.title}</div></div>
                  </div>
                ))}
                {done.length > 5 && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', padding: '4px 8px' }}>…and {done.length - 5} more</div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
