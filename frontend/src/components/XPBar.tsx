import { useEffect, useRef } from 'react'
import { toast } from '../notifications'

// EXP awarded per completed item
const ITEM_EXP: Record<string, number> = {
  movies:  80,
  series:  60,
  anime:   60,
  manga:   40,
  games:  120,
  comics:  40,
  albums:  30,
}

// EXP per episode/chapter of progress tracked
const PROGRESS_EXP: Record<string, number> = {
  series: 5,
  anime:  5,
  manga:  1,
  comics: 1,
}

function calcTotalExp(counts: Record<string, number>, progress: Record<string, number>): number {
  let exp = 0
  for (const [cat, w] of Object.entries(ITEM_EXP))    exp += (counts[cat]   ?? 0) * w
  for (const [cat, w] of Object.entries(PROGRESS_EXP)) exp += (progress[cat] ?? 0) * w
  return exp
}

// Exponential level curve: EXP needed for level N → 100 * 1.4^(N-1)
function levelInfo(totalExp: number) {
  let level = 1
  let cumulative = 0
  while (true) {
    const needed = Math.floor(100 * Math.pow(1.4, level - 1))
    if (cumulative + needed > totalExp) {
      const current = totalExp - cumulative
      return { level, current, needed, ratio: current / needed }
    }
    cumulative += needed
    level++
  }
}

interface Props {
  statCounts:   Record<string, number>
  statProgress: Record<string, number>
}

export default function XPBar({ statCounts, statProgress }: Props) {
  const totalExp = calcTotalExp(statCounts, statProgress)
  const { level, current, needed, ratio } = levelInfo(totalExp)
  const prevLevel = useRef<number | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('mp_level')
    const prev = stored ? parseInt(stored, 10) : null
    if (prev !== null && level > prev) {
      toast(`Level up! You reached level ${level}!`, 'success')
    }
    localStorage.setItem('mp_level', String(level))
    prevLevel.current = level
  }, [level])

  const remaining = needed - current
  const pct = Math.min(ratio * 100, 100)

  return (
    <div className="xp-strip">
      {/* Level badge */}
      <span className="xp-level">★ LVL {level}</span>

      {/* Progress bar */}
      <div className="xp-bar-track">
        <div className="xp-bar-fill" style={{ width: `${pct}%` }}>
          <div className="xp-bar-segments" />
          <div className="xp-bar-shine" />
        </div>
        <div className="xp-bar-segments xp-bar-segments-overlay" />
      </div>

      {/* EXP label */}
      <span className="xp-label-current">{current.toLocaleString()} / {needed.toLocaleString()} XP</span>
      <span className="xp-label-next">{remaining.toLocaleString()} → LVL {level + 1}</span>
    </div>
  )
}
