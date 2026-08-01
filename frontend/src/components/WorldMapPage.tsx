import { useState, useEffect, useRef } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { getWorldMap, syncSimkl } from '../api'
import { ISO_NUMERIC_TO_A2, COUNTRY_NAMES } from './countryData'

interface CountryData {
  count: number
  titles: string[]
}

interface Props {
  onBack: () => void
}

const GEO_URL = '/world-110m.json'
const WATCHED_COLOR = '#27ae60'
const DEFAULT_COLOR = '#2a2d31'
const HOVER_WATCHED = '#2ecc71'
const HOVER_DEFAULT = '#3d4147'
const STROKE = '#1a1d20'

export default function WorldMapPage({ onBack }: Props) {
  const [countries, setCountries] = useState<Record<string, CountryData>>({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [tooltip, setTooltip] = useState<{ name: string; count: number; titles: string[]; x: number; y: number } | null>(null)
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadMap = (fresh = false) => {
    setLoading(true)
    setError('')
    getWorldMap(fresh)
      .then((d: { countries: Record<string, CountryData> }) => {
        setCountries(d.countries)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  useEffect(() => { loadMap() }, [])

  const handleSyncSimkl = async () => {
    setSyncing(true)
    setMsg('')
    setError('')
    try {
      await syncSimkl()
      setMsg('Simkl synced — refreshing map…')
      loadMap(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const watchedCodes = new Set(Object.keys(countries))
  const watchedCount = watchedCodes.size

  const sortedCountries = Object.entries(countries)
    .sort(([, a], [, b]) => b.count - a.count)

  const clampedZoom = Math.max(1, Math.min(zoom, 8))

  return (
    <div className="world-map-page">

      {/* ── Header ── */}
      <div className="world-map-header">
        <button className="btn-secondary" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
        <h2 className="world-map-title">🌍 Country Map</h2>
        {!loading && !error && (
          <span className="world-map-stat">{watchedCount} countries watched</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="btn-secondary"
          onClick={handleSyncSimkl}
          disabled={syncing || loading}
          title="Sync Simkl watchlist then refresh map"
        >
          {syncing ? '…' : '⟳ Sync from Simkl'}
        </button>
        <div className="world-map-zoom-btns">
          <button className="btn-ghost btn-icon" onClick={() => setZoom(z => Math.min(z * 1.5, 8))} title="Zoom in">+</button>
          <button className="btn-ghost btn-icon" onClick={() => setZoom(1)} title="Reset zoom">⊙</button>
          <button className="btn-ghost btn-icon" onClick={() => setZoom(z => Math.max(z / 1.5, 1))} title="Zoom out">−</button>
        </div>
      </div>

      {msg && <div className="world-map-msg">{msg}</div>}

      {/* ── Map ── */}
      <div
        className="world-map-container"
        ref={containerRef}
        onMouseLeave={() => { setHoveredCode(null); setTooltip(null) }}
      >
        {loading && <div className="world-map-loading">Loading Simkl data…</div>}
        {!loading && error && <div className="world-map-error"><strong>Error:</strong> {error}</div>}

        {!error && (
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `scale(${clampedZoom})`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease',
              pointerEvents: loading ? 'none' : 'auto',
            }}
          >
            <ComposableMap
              projectionConfig={{ rotate: [-10, 0, 0], scale: 147 }}
              style={{ width: '100%', height: '100%' }}
            >
              <Geographies geography={GEO_URL}>
                {({ geographies }: { geographies: Array<{ rsmKey: string; id: string }> }) =>
                  geographies.map((geo: { rsmKey: string; id: string }) => {
                    const a2 = ISO_NUMERIC_TO_A2[String(geo.id)]
                    const watched = a2 ? watchedCodes.has(a2) : false
                    const hovered = a2 === hoveredCode
                    let fill = watched ? WATCHED_COLOR : DEFAULT_COLOR
                    if (hovered) fill = watched ? HOVER_WATCHED : HOVER_DEFAULT
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke={STROKE}
                        strokeWidth={0.4}
                        style={{
                          default: { outline: 'none' },
                          hover:   { outline: 'none' },
                          pressed: { outline: 'none' },
                        }}
                        onMouseEnter={(e: React.MouseEvent) => {
                          if (!a2) return
                          setHoveredCode(a2)
                          const data = countries[a2]
                          setTooltip({
                            name: COUNTRY_NAMES[a2] || a2,
                            count: data?.count ?? 0,
                            titles: data?.titles ?? [],
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }}
                        onMouseMove={(e: React.MouseEvent) => {
                          setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
                        }}
                        onMouseLeave={() => {
                          setHoveredCode(null)
                          setTooltip(null)
                        }}
                      />
                    )
                  })
                }
              </Geographies>
            </ComposableMap>
          </div>
        )}

        {/* Legend */}
        {!loading && !error && (
          <div className="world-map-legend">
            <span className="world-map-legend-item"><i style={{ background: WATCHED_COLOR }} /> Watched ({watchedCount})</span>
            <span className="world-map-legend-item"><i style={{ background: DEFAULT_COLOR, border: '1px solid #444' }} /> Not yet</span>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="world-map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <strong>{tooltip.name}</strong>
          {tooltip.count > 0 ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--success)', margin: '2px 0' }}>{tooltip.count} title{tooltip.count !== 1 ? 's' : ''}</div>
              {tooltip.titles.slice(0, 3).map(t => (
                <div key={t} style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>
              ))}
            </>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>Nothing watched yet</div>
          )}
        </div>
      )}

      {/* Country list */}
      {!loading && !error && sortedCountries.length > 0 && (
        <div className="world-map-list-section">
          <h3 className="world-map-list-title">Watched Countries ({watchedCount})</h3>
          <div className="world-map-list">
            {sortedCountries.map(([code, data]) => (
              <div
                key={code}
                className={`world-map-country-card${hoveredCode === code ? ' hovered' : ''}`}
                onMouseEnter={() => setHoveredCode(code)}
                onMouseLeave={() => setHoveredCode(null)}
              >
                <span className="world-map-country-name">{COUNTRY_NAMES[code] || code}</span>
                <span className="world-map-country-count">{data.count} title{data.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && sortedCountries.length === 0 && (
        <div className="world-map-empty">
          No country data found. Make sure Simkl is connected and you have completed/watching items. Try "Sync from Simkl" first.
        </div>
      )}
    </div>
  )
}
