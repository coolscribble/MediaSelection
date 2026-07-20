import { useState } from 'react'
import { login, loginAccount, registerAccount, loginLocal } from '../api'
import { User } from '../types'

interface Props {
  onLogin: (user: User) => void
}

type Mode = 'jellyfin' | 'account'
type AccountMode = 'login' | 'register'

export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>('jellyfin')
  const [accountMode, setAccountMode] = useState<AccountMode>('login')

  // Jellyfin fields
  const [serverUrl, setServerUrl] = useState('')
  const [jfUsername, setJfUsername] = useState('')
  const [jfPassword, setJfPassword] = useState('')

  // Local account fields
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJellyfin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl.trim() || !jfUsername.trim() || !jfPassword.trim()) {
      setError('All fields are required')
      return
    }
    setBusy(true); setError(null)
    try {
      const data = await login(serverUrl.trim(), jfUsername.trim(), jfPassword)
      onLogin({ username: data.username, server_url: serverUrl.trim() })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally { setBusy(false) }
  }

  const handleAccountLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('All fields are required'); return }
    setBusy(true); setError(null)
    try {
      const data = await loginAccount(username.trim(), password)
      onLogin({ username: data.username, server_url: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally { setBusy(false) }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('All fields are required'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setBusy(true); setError(null)
    try {
      const data = await registerAccount(username.trim(), password, inviteCode || undefined)
      onLogin({ username: data.username, server_url: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally { setBusy(false) }
  }

  const handleAnonymous = async () => {
    setBusy(true); setError(null)
    try {
      const data = await loginLocal()
      onLogin({ username: data.username, server_url: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally { setBusy(false) }
  }

  const switchMode = (m: Mode) => { setMode(m); setError(null) }
  const switchAccountMode = (m: AccountMode) => { setAccountMode(m); setError(null); setPassword(''); setConfirmPassword('') }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '36px 32px', width: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, textAlign: 'center', fontSize: 22 }}>🎲 Media Picker</h2>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {(['jellyfin', 'account'] as Mode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                flex: 1, padding: '8px 0', fontSize: 13, fontWeight: mode === m ? 600 : 400,
                background: mode === m ? 'var(--primary, #6c5ce7)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text2)',
                border: 'none', cursor: 'pointer', transition: 'background 0.15s',
              }}
            >
              {m === 'jellyfin' ? '🎬 Jellyfin' : '👤 Local Account'}
            </button>
          ))}
        </div>

        {/* Jellyfin form */}
        {mode === 'jellyfin' && (
          <form onSubmit={handleJellyfin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, color: 'var(--text2)', fontSize: 12, textAlign: 'center' }}>
              Sign in with your Jellyfin account
            </p>
            <div className="form-group">
              <label>Server URL</label>
              <input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                placeholder="https://jellyfin.example.com" autoComplete="url" />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={jfUsername} onChange={e => setJfUsername(e.target.value)}
                placeholder="your Jellyfin username" autoComplete="username" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={jfPassword} onChange={e => setJfPassword(e.target.value)}
                placeholder="your Jellyfin password" autoComplete="current-password" />
            </div>
            {error && <p style={{ margin: 0, color: 'var(--error, #e55)', fontSize: 13, textAlign: 'center' }}>{error}</p>}
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with Jellyfin'}
            </button>
          </form>
        )}

        {/* Local account form */}
        {mode === 'account' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Login / Register sub-tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
              {(['login', 'register'] as AccountMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchAccountMode(m)}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 13, fontWeight: accountMode === m ? 600 : 400,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderBottom: accountMode === m ? '2px solid var(--primary, #6c5ce7)' : '2px solid transparent',
                    color: accountMode === m ? 'var(--text)' : 'var(--text2)',
                    marginBottom: -1,
                  }}
                >
                  {m === 'login' ? 'Sign in' : 'Register'}
                </button>
              ))}
            </div>

            {accountMode === 'login' && (
              <form onSubmit={handleAccountLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="your username" autoComplete="username" />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="your password" autoComplete="current-password" />
                </div>
                {error && <p style={{ margin: 0, color: 'var(--error, #e55)', fontSize: 13, textAlign: 'center' }}>{error}</p>}
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {accountMode === 'register' && (
              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="3–30 chars, letters/numbers/_-" autoComplete="username" />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="at least 6 characters" autoComplete="new-password" />
                </div>
                <div className="form-group">
                  <label>Confirm password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="repeat password" autoComplete="new-password" />
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    Invite code
                    <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 400 }}>(if required)</span>
                  </label>
                  <input type="password" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                    placeholder="leave blank if not needed" autoComplete="off" />
                </div>
                {error && <p style={{ margin: 0, color: 'var(--error, #e55)', fontSize: 13, textAlign: 'center' }}>{error}</p>}
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Creating account…' : 'Create account'}
                </button>
                <p style={{ margin: 0, color: 'var(--text2)', fontSize: 11, textAlign: 'center' }}>
                  Your password is hashed and stored only on this server.
                </p>
              </form>
            )}
          </div>
        )}

        {/* Anonymous divider + button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text2)', fontSize: 12 }}>or</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
        </div>
        {error && mode !== 'jellyfin' && mode !== 'account' && (
          <p style={{ margin: 0, color: 'var(--error, #e55)', fontSize: 13, textAlign: 'center' }}>{error}</p>
        )}
        <button type="button" className="btn-ghost" disabled={busy} style={{ width: '100%' }} onClick={handleAnonymous}>
          Continue without account
        </button>
        <p style={{ margin: 0, textAlign: 'center', color: 'var(--text2)', fontSize: 11 }}>
          Anonymous data is saved under a shared "local" account
        </p>
      </div>
    </div>
  )
}
