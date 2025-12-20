import { useState, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import { ToastContext } from './toastContext'

function ToastItem({ id, type, message, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id)
    }, 3000)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  const colors = {
    success: 'bg-green-100 border-green-200 text-green-800',
    error: 'bg-red-100 border-red-200 text-red-800',
    info: 'bg-blue-100 border-blue-200 text-blue-800'
  }

  return (
    <div className={`flex items-center justify-between px-4 py-3 mb-2 rounded border shadow-sm min-w-[300px] animate-fade-in-up ${colors[type] || colors.info}`}>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={() => onDismiss(id)} className="ml-4 opacity-50 hover:opacity-100">
        ×
      </button>
    </div>
  )
}

ToastItem.propTypes = {
  id: PropTypes.number.isRequired,
  type: PropTypes.oneOf(['success', 'error', 'info']).isRequired,
  message: PropTypes.string.isRequired,
  onDismiss: PropTypes.func.isRequired
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end pointer-events-none">
        <div className="pointer-events-auto">
          {toasts.map(toast => (
            <ToastItem key={toast.id} {...toast} onDismiss={removeToast} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

ToastProvider.propTypes = {
  children: PropTypes.node.isRequired
}
