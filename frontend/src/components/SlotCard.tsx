import { useState, useRef } from 'react'
import { Slot } from '../types'
import { lockSlot, completeSlot, rerollSlot, saveNote, updateProgress } from '../api'
import ManualSelectModal from './ManualSelectModal'

interface Props {
  slot: Slot
  queueMode: boolean
  onRefresh: () => void
}

function progressUnit(category: string): string {
  if (category === 'manga' || category === 'comics') return 'ch'
  if (category === 'movies') return ''
  return 'ep'
}

export default function SlotCard({ slot, queueMode, onRefresh }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectOpen, setSelectOpen] = useState(false)
  const [note, setNote] = useState(slot.note ?? '')
  const [prog, setProg] = useState(slot.current_progress ?? 0)
  const saveNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveProgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await fn(); onRefresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const handleNoteChange = (val: string) => {
    setNote(val)
    if (saveNoteTimer.current) clearTimeout(saveNoteTimer.current)
    saveNoteTimer.current = setTimeout(() => saveNote(slot.id, val).catch(() => {}), 600)
  }

  const handleProgChange = (val: number) => {
    const v = Math.max(0, val)
    setProg(v)
    if (saveProgTimer.current) clearTimeout(saveProgTimer.current)
    saveProgTimer.current = setTimeout(() => updateProgress(slot.id, v).catch(() => {}), 600)
  }

  const total = (slot.metadata?.total as number | null) ?? null
  const unit = progressUnit(slot.category)
  const isEmpty = !slot.item_id

  return (
    <div className={`slot${slot.is_locked ? ' locked' : ''}`}>
      {slot.thumbnail_url && !isEmpty && (
        <img className="slot-thumb" src={slot.thumbnail_url} alt={slot.title ?? ''} loading="lazy" />
      )}
      <div className="slot-body">
        <span className="slot-label">Slot {slot.slot_index}{queueMode ? ' · queue' : ''}</span>
        {isEmpty
          ? <span className="slot-empty">empty</span>
          : <span className="slot-title">{slot.title}</span>
        }
        {!isEmpty && slot.category === 'albums' && typeof slot.metadata?.artist === 'string' && (
          <span className="slot-subtitle">{slot.metadata.artist}</span>
        )}
        {!isEmpty && slot.category === 'games' && (
          <span className="slot-subtitle">
            {Array.isArray(slot.metadata?.platforms)
              ? (slot.metadata.platforms as string[]).slice(0, 2).join(', ')
              : typeof slot.metadata?.platform === 'string'
                ? slot.metadata.platform
                : ''}
          </span>
        )}
        {!isEmpty && (
          <>
            {/* Progress only for categories that track episodes/chapters — not movies, games, or albums */}
            {slot.category !== 'movies' && slot.category !== 'games' && slot.category !== 'albums' && (
            <div className="slot-progress">
              <input
                className="slot-progress-input"
                type="number"
                min={0}
                max={total ?? undefined}
                value={prog}
                onChange={e => {
                  const v = parseInt(e.target.value)
                  if (!isNaN(v)) handleProgChange(v)
                }}
                title="Current episode/chapter"
              />
              {total !== null && <span className="slot-progress-sep">/{total}</span>}
              {unit && <span className="slot-progress-unit">{unit}</span>}
              <button
                className="slot-progress-btn"
                onClick={() => handleProgChange(prog + 1)}
                title="Increment"
                disabled={total !== null && prog >= total}
              >+</button>
            </div>
            )}
            <textarea
              className="slot-note"
              placeholder="Add a note…"
              value={note}
              onChange={e => handleNoteChange(e.target.value)}
              rows={2}
            />
          </>
        )}
        {error && <div className="slot-error">{error}</div>}
      </div>
      <div className="slot-actions">
        <button
          className={`btn-icon${slot.is_locked ? ' active' : ''}`}
          title={slot.is_locked ? 'Unlock' : 'Lock'}
          onClick={() => act(() => lockSlot(slot.id))}
          disabled={busy || isEmpty}
        >{slot.is_locked ? '🔒' : '🔓'}</button>
        <button
          className="btn-icon"
          title={queueMode ? 'Next in queue' : 'Reroll'}
          onClick={() => act(() => rerollSlot(slot.id))}
          disabled={busy || slot.is_locked}
        >{queueMode ? '⏭' : '🎲'}</button>
        <button
          className="btn-icon"
          title="Pick manually"
          onClick={() => setSelectOpen(true)}
          disabled={busy || slot.is_locked}
        >🔍</button>
        {!isEmpty && (
          <button
            className="btn-icon"
            title="Mark as done"
            onClick={() => { setNote(''); setProg(0); act(() => completeSlot(slot.id)) }}
            disabled={busy}
            style={{ color: 'var(--success)' }}
          >✓</button>
        )}
      </div>
      {selectOpen && (
        <ManualSelectModal slot={slot} onClose={() => setSelectOpen(false)} onRefresh={onRefresh} />
      )}
    </div>
  )
}
