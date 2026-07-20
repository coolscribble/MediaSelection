import { useState, useEffect } from 'react'
import { getSettings, saveSettings, getSimklPin, pollSimklPin } from '../api'
import {
  Settings, CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS,
  ANILIST_STATE_OPTIONS, SIMKL_STATE_OPTIONS,
  MAL_ANIME_STATE_OPTIONS, MAL_MANGA_STATE_OPTIONS,
} from '../types'

interface Props { onClose: () => void; username: string }

const DEFAULT_SETTINGS: Settings = {
  simkl_client_id: '', simkl_token_set: false,
  anilist_username: '', mal_username: '',
  anilist_states: ['PLANNING'], simkl_states: ['plantowatch'],
  mal_anime_states: ['plantowatch'], mal_manga_states: ['plantoread'],
  queue_modes: { movies: false, series: false, anime: false, manga: false, games: false, comics: false, albums: false },
  igdb_client_id: '', igdb_client_set: false,
  comicvine_api_set: false,
  save_covers_locally: false,
  public_profile: false,
}

export default function SettingsModal({ onClose, username }: Props) {
  const [tab, setTab] = useState<'connections' | 'states' | 'queue' | 'profile'>('connections')
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [clientId, setClientId] = useState('')
  const [igdbClientId, setIgdbClientId] = useState('')
  const [igdbClientSecret, setIgdbClientSecret] = useState('')
  const [comicvineApiKey, setComicvineApiKey] = useState('')
  const [saveCoversLocally, setSaveCoversLocally] = useState(false)
  const [publicProfile, setPublicProfile] = useState(false)
  const [aniUser, setAniUser] = useState('')
  const [malUser, setMalUser] = useState('')
  const [aniStates, setAniStates] = useState<string[]>(['PLANNING'])
  const [simklStates, setSimklStates] = useState<string[]>(['plantowatch'])
  const [malAnimeStates, setMalAnimeStates] = useState<string[]>(['plantowatch'])
  const [malMangaStates, setMalMangaStates] = useState<string[]>(['plantoread'])
  const [queueModes, setQueueModes] = useState<Record<string, boolean>>({})
  const [pin, setPin] = useState<{ user_code: string; verification_url: string } | null>(null)
  const [polling, setPolling] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSettings().then((data: Settings) => {
      setS(data)
      setClientId(data.simkl_client_id)
      setIgdbClientId(data.igdb_client_id ?? '')
      setAniUser(data.anilist_username)
      setMalUser(data.mal_username)
      setAniStates(data.anilist_states ?? ['PLANNING'])
      setSimklStates(data.simkl_states ?? ['plantowatch'])
      setMalAnimeStates(data.mal_anime_states ?? ['plantowatch'])
      setMalMangaStates(data.mal_manga_states ?? ['plantoread'])
      setQueueModes(data.queue_modes ?? {})
      setSaveCoversLocally(data.save_covers_locally ?? false)
      setPublicProfile(data.public_profile ?? false)
    })
  }, [])

  const toggleArr = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]

  const save = async () => {
    setBusy(true)
    try {
      await saveSettings({
        simkl_client_id: clientId,
        anilist_username: aniUser,
        mal_username: malUser,
        anilist_states: aniStates,
        simkl_states: simklStates,
        mal_anime_states: malAnimeStates,
        mal_manga_states: malMangaStates,
        queue_modes: queueModes,
        igdb_client_id: igdbClientId,
        ...(igdbClientSecret && { igdb_client_secret: igdbClientSecret }),
        ...(comicvineApiKey && { comicvine_api_key: comicvineApiKey }),
        save_covers_locally: saveCoversLocally,
        public_profile: publicProfile,
      })
      setMsg('Saved')
      setS(prev => ({ ...prev, queue_modes: queueModes as Settings['queue_modes'] }))
    } catch { setMsg('Save failed') } finally { setBusy(false) }
  }

  const startPin = async () => {
    setBusy(true); setMsg('')
    try {
      await saveSettings({ simkl_client_id: clientId })
      const data = await getSimklPin() as { user_code: string; verification_url: string }
      setPin(data); setPolling(true); pollForToken(data.user_code)
    } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const pollForToken = (userCode: string) => {
    let tries = 0
    const iv = setInterval(async () => {
      tries++
      try {
        const res = await pollSimklPin(userCode) as { authorized: boolean }
        if (res.authorized) {
          clearInterval(iv); setPolling(false); setPin(null)
          setMsg('✓ Simkl authorized!')
          setS(prev => ({ ...prev, simkl_token_set: true }))
        }
      } catch {}
      if (tries > 60) { clearInterval(iv); setPolling(false); setMsg('PIN code expired') }
    }, 5000)
  }

  const StateCheckboxes = ({ opts, values, onChange }: {
    opts: { value: string; label: string }[]
    values: string[]
    onChange: (v: string[]) => void
  }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {opts.map(opt => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={values.includes(opt.value)}
            onChange={() => onChange(toggleArr(values, opt.value))}
          />
          {opt.label}
        </label>
      ))}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span>⚙ Settings</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={`tab${tab === 'connections' ? ' active' : ''}`} onClick={() => setTab('connections')}>Connections</button>
            <button className={`tab${tab === 'states' ? ' active' : ''}`} onClick={() => setTab('states')}>Sync States</button>
            <button className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>Queue Mode</button>
            <button className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>Profile</button>
          </div>

          {tab === 'connections' && (
            <>
              <div className="sync-section">
                <h3>⛩️ AniList (Anime + Manga)</h3>
                <div className="form-group">
                  <label>Username</label>
                  <input value={aniUser} onChange={e => setAniUser(e.target.value)} placeholder="your_username" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>Syncs from anilist.co — no password required.</p>
              </div>

              <div className="sync-section">
                <h3>🎌 MyAnimeList (Anime + Manga)</h3>
                <div className="form-group">
                  <label>Username</label>
                  <input value={malUser} onChange={e => setMalUser(e.target.value)} placeholder="your_mal_username" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>Uses Jikan — no API key needed. Profile must be public.</p>
              </div>

              <div className="sync-section">
                <h3>🎬 Simkl (Movies + Series + Anime)</h3>
                <div className="form-group">
                  <label>Client ID</label>
                  <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="from simkl.com/apps" />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.simkl_token_set ? ' ok' : ''}`}>
                    {s.simkl_token_set ? '✓ Token saved' : '✗ Not authorized'}
                  </span>
                  <button className="btn-secondary" onClick={startPin} disabled={busy || polling || !clientId}>
                    {polling ? '⏳ Waiting…' : 'Authorize via PIN'}
                  </button>
                </div>
                {pin && (
                  <div className="pin-box">
                    <div className="pin-hint">Visit and enter this code:</div>
                    <a href={pin.verification_url} target="_blank" rel="noreferrer">{pin.verification_url}</a>
                    <div className="pin-code">{pin.user_code}</div>
                    <div className="pin-hint">App detects confirmation automatically…</div>
                  </div>
                )}
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Get your Client ID at <strong>simkl.com/apps</strong> → New App (free).
                </p>
              </div>

              <div className="sync-section">
                <h3>💬 Comics cover art</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  Uses the Google Books API — no API key needed.
                  Import your comics via CSV, then click <strong>💬 Covers</strong> in the header to fetch artwork automatically.
                </p>
                <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>ComicVine (better matching)</h4>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={comicvineApiKey}
                    onChange={e => setComicvineApiKey(e.target.value)}
                    placeholder={s.comicvine_api_set ? '••••••••• (saved)' : 'paste key from comicvine.gamespot.com/api'}
                  />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.comicvine_api_set ? ' ok' : ''}`}>
                    {s.comicvine_api_set ? '✓ Key saved' : '✗ Not configured'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Get a free API key at <strong>comicvine.gamespot.com/api</strong>. Used for the 🎨 ComicVine Sync button in the library.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎵 Albums cover art</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                  Uses the iTunes Search API — no API key needed.
                  Import your albums via CSV, then click <strong>🎵 Covers</strong> in the header to fetch artwork automatically.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎮 IGDB (Games metadata + covers)</h3>
                <div className="form-group">
                  <label>Client ID</label>
                  <input value={igdbClientId} onChange={e => setIgdbClientId(e.target.value)} placeholder="from dev.twitch.tv" />
                </div>
                <div className="form-group">
                  <label>Client Secret</label>
                  <input
                    type="password"
                    value={igdbClientSecret}
                    onChange={e => setIgdbClientSecret(e.target.value)}
                    placeholder={s.igdb_client_set ? '••••••••• (saved)' : 'paste secret here'}
                  />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.igdb_client_set ? ' ok' : ''}`}>
                    {s.igdb_client_set ? '✓ Secret saved' : '✗ Not configured'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Register a free app at <strong>dev.twitch.tv/console</strong> to get credentials.
                  Hit <strong>Save</strong> then <strong>⟳ Update</strong> to fetch covers and ratings for all games.
                </p>
              </div>

              <div className="sync-section">
                <h3>💾 Local image cache</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={saveCoversLocally}
                    onChange={e => setSaveCoversLocally(e.target.checked)}
                  />
                  Save cover images to disk
                </label>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  When enabled, cover art is downloaded to <code>/data/covers/</code> inside the container
                  and served locally. Covers survive if external image hosts go offline.
                  Takes effect on the next sync or cover fetch.
                </p>
              </div>
            </>
          )}

          {tab === 'states' && (
            <>
              <div className="sync-section">
                <h3>⛩️ AniList — which lists to import</h3>
                <StateCheckboxes opts={ANILIST_STATE_OPTIONS} values={aniStates} onChange={setAniStates} />
              </div>
              <div className="sync-section">
                <h3>🎬 Simkl — which lists to import</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>Applies to Movies, Series and Anime.</p>
                <StateCheckboxes opts={SIMKL_STATE_OPTIONS} values={simklStates} onChange={setSimklStates} />
              </div>
              <div className="sync-section">
                <h3>🎌 MAL — Anime lists to import</h3>
                <StateCheckboxes opts={MAL_ANIME_STATE_OPTIONS} values={malAnimeStates} onChange={setMalAnimeStates} />
              </div>
              <div className="sync-section">
                <h3>🎌 MAL — Manga lists to import</h3>
                <StateCheckboxes opts={MAL_MANGA_STATE_OPTIONS} values={malMangaStates} onChange={setMalMangaStates} />
              </div>
            </>
          )}

          {tab === 'queue' && (
            <div className="sync-section">
              <h3>Queue Mode per category</h3>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                When enabled, completing a slot automatically pulls the next item from that category's queue
                instead of leaving it empty. Use the 📋 Queue button to manage the ordered list.
              </p>
              {CATEGORIES.map(cat => (
                <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(queueModes[cat])}
                    onChange={e => setQueueModes(prev => ({ ...prev, [cat]: e.target.checked }))}
                  />
                  <span>{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
                </label>
              ))}
            </div>
          )}

          {tab === 'profile' && (
            <div className="sync-section">
              <h3>🌐 Public profile</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={publicProfile}
                  onChange={e => setPublicProfile(e.target.checked)}
                />
                Make my profile public
              </label>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                When enabled, anyone can view your current picks and library counts at the link below.
                They cannot edit anything — it's read only.
              </p>
              {publicProfile && (() => {
                const profileUrl = `${window.location.origin}/user/${username}`
                return (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Your public profile link:</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, wordBreak: 'break-all' }}>
                        {profileUrl}
                      </code>
                      <button
                        className="btn-secondary"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => navigator.clipboard.writeText(profileUrl).then(() => setMsg('Link copied!'))}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )
              })()}
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 12 }}>
                Remember to hit <strong>Save</strong> to apply the change.
              </p>
            </div>
          )}

          {msg && <div className={msg.startsWith('✓') || msg === 'Saved' ? 'success-msg' : 'error-msg'} style={{ marginTop: 12 }}>{msg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </div>
  )
}
