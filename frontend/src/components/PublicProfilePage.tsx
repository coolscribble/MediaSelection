import { useEffect, useState } from 'react'
import { getPublicProfile } from '../api'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, Category } from '../types'

interface SlotRow {
  slot_index: number
  is_locked: number
  note: string | null
  current_progress: number
  title: string | null
  thumbnail_url: string | null
  metadata: string
}

interface ProfileData {
  username: string
  slots: Record<string, SlotRow[]>
  library_counts: Record<string, number>
}

interface Props {
  username: string
}

export default function PublicProfilePage({ username }: Props) {
  const [data, setData] = useState<ProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPublicProfile(username)
      .then(setData)
      .catch(e => setError(e.message))
  }, [username])

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎲</div>
      <h2 style={{ margin: 0 }}>{error === 'This profile is private' ? 'Profile is private' : 'Profile not found'}</h2>
      <p style={{ color: 'var(--text2)', margin: 0 }}>{error}</p>
    </div>
  )

  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div className="loading">Loading…</div>
    </div>
  )

  const activeCategories = CATEGORIES.filter(cat =>
    data.slots[cat]?.some(s => s.title)
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      <header style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎲</div>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>{data.username}'s Media Picks</h1>
        <p style={{ margin: 0, color: 'var(--text2)', fontSize: 14 }}>Current randomized picks — read only</p>
      </header>

      {activeCategories.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text2)' }}>No active picks yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {activeCategories.map(cat => {
          const slots = data.slots[cat].filter(s => s.title)
          return (
            <section key={cat}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                {CATEGORY_ICONS[cat as Category]} {CATEGORY_LABELS[cat as Category]}
                <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 400 }}>
                  ({data.library_counts[cat] ?? 0} in library)
                </span>
              </h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {slots.map(slot => (
                  <SlotCard key={slot.slot_index} slot={slot} category={cat as Category} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <footer style={{ marginTop: 48, textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>
        Powered by{' '}
        <span style={{ fontWeight: 600 }}>🎲 Media Picker</span>
      </footer>
    </div>
  )
}

function SlotCard({ slot, category }: { slot: SlotRow; category: Category }) {
  const meta = (() => { try { return JSON.parse(slot.metadata || '{}') } catch { return {} } })()

  const unit = category === 'manga' || category === 'comics' ? 'ch'
    : category === 'series' || category === 'anime' ? 'ep' : null

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      width: 160,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {slot.thumbnail_url ? (
        <img
          src={slot.thumbnail_url}
          alt={slot.title ?? ''}
          style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <div style={{ width: '100%', height: 220, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
          {CATEGORY_ICONS[category]}
        </div>
      )}
      <div style={{ padding: '10px 10px 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, marginBottom: 4 }}>
          {slot.title}
          {slot.is_locked ? ' 🔒' : ''}
        </div>
        {meta.rating && (
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>⭐ {meta.rating}</div>
        )}
        {unit && slot.current_progress > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>
            {slot.current_progress} {unit} done
          </div>
        )}
        {slot.note && (
          <div style={{ fontSize: 11, color: 'var(--text2)', fontStyle: 'italic', marginTop: 4 }}>
            {slot.note}
          </div>
        )}
      </div>
    </div>
  )
}
