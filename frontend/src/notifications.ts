// Lightweight pub/sub toast system — no context needed, call from anywhere.

export type ToastType = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  type: ToastType
  /** Persistent toasts don't auto-dismiss — use for in-progress operations */
  persistent: boolean
}

type Listener = (toasts: Toast[]) => void

let _toasts: Toast[] = []
let _nextId = 0
const _listeners = new Set<Listener>()

function _broadcast() {
  _listeners.forEach(l => l([..._toasts]))
}

/** Subscribe to toast updates. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  _listeners.add(listener)
  listener([..._toasts])
  return () => _listeners.delete(listener)
}

/** Dismiss a toast by id. */
export function dismiss(id: number) {
  _toasts = _toasts.filter(t => t.id !== id)
  _broadcast()
}

/**
 * Show a toast.
 * @param message  Text to display.
 * @param type     'info' (default) | 'success' | 'error'
 * @param persistent  If true, stays until dismiss(id) is called — use for in-progress ops.
 * @returns  The toast id (needed to dismiss persistent toasts).
 */
export function toast(
  message: string,
  type: ToastType = 'info',
  persistent = false
): number {
  const id = _nextId++
  _toasts = [..._toasts, { id, message, type, persistent }]
  _broadcast()
  if (!persistent) {
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 4000)
  }
  return id
}
