import { useState, useEffect } from 'react'
import { Toast, subscribe, dismiss } from '../notifications'

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribe(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.persistent ? <span className="toast-spinner" /> : t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}
          </span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} title="Dismiss">✕</button>
        </div>
      ))}
    </div>
  )
}
