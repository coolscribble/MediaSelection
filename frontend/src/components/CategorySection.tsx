import { useState } from 'react'
import { Category, Slot } from '../types'
import { rerollCategory } from '../api'
import SlotCard from './SlotCard'
import LibraryModal from './LibraryModal'
import QueueModal from './QueueModal'

interface Props {
  category: Category
  label: string
  icon: string
  slots: Slot[]
  queueMode: boolean
  onRefresh: () => void
}

export default function CategorySection({ category, label, icon, slots, queueMode, onRefresh }: Props) {
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState('')
  const [libOpen, setLibOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  const handleRerollAll = async () => {
    setRolling(true); setError('')
    try { await rerollCategory(category); onRefresh() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setRolling(false) }
  }

  return (
    <section className={`category${queueMode ? ' queue-mode' : ''}`}>
      <div className="category-header">
        <span className="category-title">
          {icon} {label}
          {queueMode && <span className="queue-badge">Queue</span>}
        </span>
        <div className="category-actions">
          {queueMode && (
            <button className="btn-secondary" onClick={() => setQueueOpen(true)} title="Manage queue">📋 Queue</button>
          )}
          {!queueMode && (
            <button className="btn-secondary" onClick={() => setLibOpen(true)} title="Library">📚</button>
          )}
          <button className="btn-primary" onClick={handleRerollAll} disabled={rolling}>
            {rolling ? '…' : queueMode ? '⏭ Fill from queue' : '🎲 Reroll'}
          </button>
        </div>
      </div>
      {error && <div className="error-msg" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="slots">
        {slots.map(slot => (
          <SlotCard key={slot.id} slot={slot} queueMode={queueMode} onRefresh={onRefresh} />
        ))}
      </div>
      {libOpen && (
        <LibraryModal category={category} label={label} onClose={() => setLibOpen(false)} onRefresh={onRefresh} />
      )}
      {queueOpen && (
        <QueueModal category={category} label={label} onClose={() => setQueueOpen(false)} onRefresh={onRefresh} />
      )}
    </section>
  )
}
