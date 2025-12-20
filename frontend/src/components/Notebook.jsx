import { useState, useEffect, useCallback, createContext, useContext, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import { useToast } from './toastContext'
import { useConfig } from './configContext'
import { commonFunctions } from '../utils/pipeFunctions'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import { useTheme } from './themeState'

hljs.registerLanguage('json', json)

// Helper to format group display string from values
function formatGroupLabel(group, groupBy) {
  if (!group?.values) return 'No group selected'
  return groupBy.map(k => group.values[k] || 'unknown').join('/')
}

// Context for notebook state (pair, variables, functions)
const NotebookContext = createContext(null)

// Helper to resolve a path like "foo.bar.0.baz" from an object
function resolvePath(obj, path) {
  if (!path) return obj
  const parts = path.split('.')
  let value = obj
  for (const part of parts) {
    if (value === undefined || value === null) return undefined
    value = /^\d+$/.test(part) ? value[parseInt(part, 10)] : value[part]
  }
  return value
}

// Resolve expression with pipe functions: "varName.path | func1 | func2"
function resolveExpr(expr, variables, functions = {}) {
  if (!expr) return variables
  const parts = expr.split('|').map(s => s.trim())
  const varPath = parts[0]
  const pipes = parts.slice(1)

  let value = resolvePath(variables, varPath)

  // Apply pipe functions in sequence
  for (const pipe of pipes) {
    // Special case: default value if current value is empty/undefined
    // Syntax: {{var | default:*}}
    if (pipe.startsWith('default:')) {
      if (value === undefined || value === null || value === '') {
        value = pipe.slice(8)
      }
      continue
    }

    // Propagate undefined so that {{missing | func}} remains undefined
    if (value === undefined) continue

    const fn = functions[pipe]
    if (typeof fn === 'function') {
      try {
        value = fn(value, variables)
      } catch {
        // On error, value becomes undefined, but we continue (might hit a default pipe later)
        value = undefined
      }
    }
  }

  return value
}

// Helper to interpolate {{varName}} or {{varName | func}} in strings
function interpolate(text, variables, functions) {
  if (typeof text !== 'string') return text
  return text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions)
    if (value === undefined) return match
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

// Helper to interpolate variables in JSON body
// Supports pipe functions: {{myVar | keys | first}}
function interpolateBody(body, variables, functions) {
  if (!body) return null

  let template = typeof body === 'string' ? body : JSON.stringify(body)

  // Remove quotes around {{var}} first (handles object syntax: "{{var}}" -> {{var}})
  template = template.replace(/"(\{\{[^}]+\}\})"/g, '$1')

  // Replace {{var}} with JSON-stringified value
  const result = template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions)
    return value === undefined ? match : JSON.stringify(value)
  })

  try { return JSON.parse(result) } catch { return body }
}

// Format body for display (removes quotes around {{var}} for cleaner display)
function formatBodyForDisplay(body) {
  if (!body) return null
  const json = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
  return json.replace(/"(\{\{[^}]+\}\})"/g, '$1')
}

// Renders a variable badge with hover tooltip
function VariableBadge({ value, raw }) {
  const [hovered, setHovered] = useState(false)
  const resolved = value !== undefined

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`px-1.5 py-0.5 rounded font-mono text-xs ${
        resolved
          ? 'bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200'
          : 'bg-orange-100 dark:bg-orange-900 border border-orange-300 dark:border-orange-700 text-orange-800 dark:text-orange-200'
      }`}>
        {resolved
          ? (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, 60) + (JSON.stringify(value).length > 60 ? '...' : '')
          : raw
        }
      </span>
      {hovered && resolved && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded whitespace-nowrap z-10">
          {raw}
        </span>
      )}
    </span>
  )
}

// Renders text with variables shown as styled badges with tooltips
function InterpolatedText({ text }) {
  const { variables, functions } = useContext(NotebookContext)

  if (typeof text !== 'string') return <span>{text}</span>

  const parts = []
  let lastIdx = 0
  const regex = /\{\{([^}]+)\}\}/g
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: text.slice(lastIdx, match.index) })
    }
    const expr = match[1].trim()
    const value = resolveExpr(expr, variables, functions)
    parts.push({ type: 'var', expr, value, raw: match[0] })
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) parts.push({ type: 'text', content: text.slice(lastIdx) })
  if (parts.length === 0) return <span>{text}</span>

  return (
    <span>
      {parts.map((p, i) => p.type === 'var' ? (
        <VariableBadge key={i} value={p.value} raw={p.raw} />
      ) : <span key={i}>{p.content}</span>)}
    </span>
  )
}

// Simple syntax highlighting for JSON templates with {{var}} support
function highlightJsonTemplate(text) {
  // Escape HTML first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Apply highlighting patterns in order
  return escaped
    // Template variables: {{var}} -> blue badge
    .replace(/\{\{([^}]+)\}\}/g, '<span class="hl-var">{{$1}}</span>')
    // Property keys: "key": -> blue
    .replace(/"([^"]+)"(\s*:)/g, '<span class="hl-key">"$1"</span>$2')
    // String values (but not already highlighted)
    .replace(/: *"([^"]*)"/g, ': <span class="hl-str">"$1"</span>')
    // Numbers
    .replace(/: *(\d+\.?\d*)/g, ': <span class="hl-num">$1</span>')
    // Booleans and null
    .replace(/: *(true|false|null)\b/g, ': <span class="hl-lit">$1</span>')
}

// Open a popup window pre-wired with this app's stylesheets and the current
// theme's `dark` class, so anything rendered into it (React portal or raw
// HTML) picks up the same design tokens as the main window instead of a
// separately hardcoded color palette.
function openThemedPopup(title, isDark, { width = 1200, height = 1000 } = {}) {
  const w = Math.min(width, window.screen.availWidth * 0.9)
  const h = Math.min(height, window.screen.availHeight * 0.9)
  const left = (window.screen.availWidth - w) / 2
  const top = (window.screen.availHeight - h) / 2

  const win = window.open('', '_blank', `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`)
  if (!win) return null

  win.document.title = title

  // Copy all stylesheets so utility classes (including theme tokens) resolve
  Array.from(document.styleSheets).forEach(sheet => {
    try {
      if (sheet.href) {
        const link = win.document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        win.document.head.appendChild(link)
      } else if (sheet.cssRules) {
        const style = win.document.createElement('style')
        style.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n')
        win.document.head.appendChild(style)
      }
    } catch {
      // Cross-origin stylesheets may throw
    }
  })

  if (isDark) win.document.documentElement.classList.add('dark')
  win.document.body.className = 'bg-surface-sunken text-text m-0'

  return win
}

// Highlighted JSON response with copy button
function JsonResponse({ data }) {
  const [copied, setCopied] = useState(false)
  const { isDark } = useTheme()

  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  const isJson = typeof data === 'object'

  const highlighted = useMemo(() => {
    if (!isJson) return null
    try {
      return hljs.highlight(text, { language: 'json' }).value
    } catch {
      return null
    }
  }, [text, isJson])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleExpand = () => {
    const win = openThemedPopup('JSON Viewer', isDark)
    if (!win) return

    const pre = win.document.createElement('pre')
    pre.className = 'hljs-response p-5 text-[13px] leading-normal font-mono whitespace-pre-wrap break-all'
    if (highlighted) {
      pre.innerHTML = highlighted
    } else {
      pre.textContent = text
    }
    win.document.body.appendChild(pre)
  }

  return (
    <div className="relative pt-2">
      <div className="sticky top-12 float-right mr-2 flex gap-2 z-10">
        <button
          onClick={handleExpand}
          className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-secondary rounded transition-colors flex items-center gap-1"
          title="Expand in new window"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
          Expand
        </button>
        <button
          onClick={handleCopy}
          className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-secondary rounded transition-colors flex items-center gap-1"
        >
          {copied ? (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
          ) : (
            <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
          )}
        </button>
      </div>
      {highlighted ? (
        <pre
          className="hljs-response p-3 pr-20 text-xs font-mono whitespace-pre-wrap break-words text-text"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="p-3 pr-20 text-xs font-mono whitespace-pre-wrap break-words text-text">{text}</pre>
      )}
    </div>
  )
}

function ExecResponse({ data }) {
  return (
    <div className="p-3 font-mono text-xs space-y-3">
      {data.stdout && (
        <div>
          <div className="text-[10px] text-text-muted uppercase font-bold mb-1">stdout</div>
          <pre className="text-green-600 dark:text-green-400 whitespace-pre-wrap">{data.stdout}</pre>
        </div>
      ) || (!data.stderr && <div className="text-text-muted italic">No output</div>)}
      {data.stderr && (
        <div>
          <div className="text-[10px] text-red-500 dark:text-red-400 uppercase font-bold mb-1">stderr</div>
          <pre className="text-red-600 dark:text-red-300 whitespace-pre-wrap">{data.stderr}</pre>
        </div>
      )}
      {data.error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-900/50 p-2 rounded">
          <div className="text-[10px] text-red-500 dark:text-red-400 uppercase font-bold mb-1">system error</div>
          <div className="text-red-700 dark:text-red-200">{data.error}</div>
        </div>
      )}
    </div>
  )
}

function ResponseView({ result, method, onClear, children }) {
  if (!result) return null

  const responseMethod = result.method || method

  return (
    <div className="bg-surface-sunken text-text flex-1 overflow-auto">
      <div className="sticky top-0 px-3 py-2 flex items-center justify-between border-b border-border bg-surface-sunken z-10">
        <div className="flex items-center gap-2">
          {responseMethod === 'EXEC' ? (
            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
              result.data?.exit_code === 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
            }`}>
              EXIT {result.data?.exit_code ?? result.status}
            </span>
          ) : (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              result.status >= 200 && result.status < 300 ? 'bg-success-bg text-success'
              : result.status >= 400 ? 'bg-danger-bg text-danger' : 'bg-surface-header text-text-secondary'
            }`}>{result.status || 'Error'}</span>
          )}
          {result.duration && <span className="text-xs text-text-muted">{result.duration}ms</span>}
        </div>
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Clear</button>
      </div>
      {children}
      {responseMethod === 'EXEC' ? (
        <ExecResponse data={result.data} />
      ) : result.emptyBody ? (
        <div className="p-3 text-xs font-mono text-text-muted italic">
          No response body{responseMethod === 'HEAD' ? ' (expected for HEAD requests)' : ''}
        </div>
      ) : (
        <JsonResponse data={result.data} />
      )}
    </div>
  )
}

// Highlighted request body with variable interpolation
function HighlightedBody({ body }) {
  const { variables, functions } = useContext(NotebookContext)
  const [copied, setCopied] = useState(false)

  const text = formatBodyForDisplay(body)
  if (!text) return null

  // Split text into parts: regular text and {{var}} tokens
  const parts = []
  let lastIdx = 0
  const regex = /\{\{([^}]+)\}\}/g
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: text.slice(lastIdx, match.index) })
    }
    const expr = match[1].trim()
    const value = resolveExpr(expr, variables, functions)
    parts.push({ type: 'var', expr, value, raw: match[0] })
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIdx) })
  }

  // Build copy text with interpolated variables
  const handleCopy = async () => {
    const copyText = text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
      const value = resolveExpr(expr.trim(), variables, functions)
      if (value === undefined) return match
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    })
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute top-0 right-0 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-text-secondary rounded transition-colors flex items-center gap-1"
      >
        {copied ? (
          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied</>
        ) : (
          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy</>
        )}
      </button>
      <pre className="text-xs font-mono whitespace-pre-wrap json-template pr-16">
        {parts.map((p, i) => p.type === 'var' ? (
          <VariableBadge key={i} value={p.value} raw={p.raw} />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: highlightJsonTemplate(p.content) }} />
        ))}
      </pre>
    </div>
  )
}

// Badge colors. GET/POST/PUT/DELETE reuse the semantic status tokens (safe
// read / create / update / destructive-delete); EXEC is a distinct decorative
// category (matches the SCRIPT badge) so it stays a literal Tailwind pair.
const methodColors = {
  GET: 'bg-success-bg text-success',
  POST: 'bg-info-bg text-info',
  PUT: 'bg-warning-bg text-warning',
  DELETE: 'bg-danger-bg text-danger',
  EXEC: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200',
}
// Default target color (can be overridden by notebook-specific colors)
const defaultTargetColors = {
  default: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200',
}

// Context for notebook-specific target colors
const TargetColorsContext = createContext(defaultTargetColors)

function resolveTarget(group, requestedVariant = 'default') {
  const targets = group?.targets || {}
  if (requestedVariant && targets[requestedVariant]) {
    return { variant: requestedVariant, target: targets[requestedVariant] }
  }

  if (requestedVariant === 'default') {
    const fallbackVariant = Object.keys(targets).length === 1 ? Object.keys(targets)[0] : null

    if (fallbackVariant) {
      return { variant: fallbackVariant, target: targets[fallbackVariant] }
    }
  }

  return { variant: requestedVariant, target: null }
}

function getDefaultTargetVariant(group) {
  return resolveTarget(group, 'default').variant || 'default'
}

// ============ PUBLIC API ============

// Text description cell
export function Text({ children }) {
  return (
    <div className="py-2 text-sm text-text-secondary">
      {typeof children === 'string' ? <InterpolatedText text={children} /> : children}
    </div>
  )
}

// Section with title
export function Section({ title, children }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mb-6 border border-border rounded-lg overflow-hidden bg-surface shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-header border-b border-border-subtle hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <h3 className="text-lg font-semibold text-text">{title}</h3>
        <svg
          className={`w-5 h-5 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          {children}
        </div>
      )}
    </div>
  )
}

Section.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node
}

// Request cell - the main building block
// Props: target (variant name), method, path, body, description, saveAs
export function Request({ target, method = 'GET', path, body, description, saveAs }) {
  const { group, variables, setVariable, functions } = useContext(NotebookContext)
  const targetColors = useContext(TargetColorsContext)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState({}) // keyed by target.id or 'external'
  const [saved, setSaved] = useState({})
  const { addToast } = useToast()

  // Auto-detect external URL
  const isExternal = path?.startsWith('http://') || path?.startsWith('https://')

  // Look up target by variant name from the group
  const resolvedTarget = isExternal ? { variant: target, target: null } : resolveTarget(group, target)
  const targetObj = resolvedTarget.target
  const resultKey = isExternal ? 'external' : targetObj?.id
  const result = resultKey ? results[resultKey] : null

  // Check for unresolved variables in path and body
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''
  const allText = (path || '') + bodyStr
  const varMatches = allText.match(/\{\{([^}]+)\}\}/g) || []
  const unresolvedVars = varMatches
    .map(m => m.slice(2, -2).trim())
    .filter(expr => resolveExpr(expr, variables, functions) === undefined)
  const hasUnresolvedVars = unresolvedVars.length > 0

  const isDisabled = isExternal
    ? hasUnresolvedVars
    : (!targetObj || targetObj.status !== 'connected' || hasUnresolvedVars)

  const handleRun = useCallback(async () => {
    if (!isExternal && !targetObj && method !== 'EXEC') return
    setRunning(true)
    const start = Date.now()
    const key = isExternal ? 'external' : (targetObj?.id || 'exec')

    try {
      const interpolatedPath = interpolate(path || '', variables, functions)
      let fetchUrl, options

      if (method === 'EXEC') {
        if (!targetObj) {
           // Should not happen if UI disabled correctly, but safe guard
           throw new Error("Target required for EXEC")
        }
        fetchUrl = `/api/targets/${targetObj.id}/exec`
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: interpolatedPath })
        }
      } else {
        fetchUrl = isExternal ? interpolatedPath : `/api/targets/${targetObj.id}/proxy${interpolatedPath}`
        const interpolatedBody = interpolateBody(body, variables, functions)
        // Use POST with X-HTTP-Method-Override for requests with body (browsers don't support GET with body)
        // Only apply override for proxy requests (not external)
        const hasBody = !!interpolatedBody
        const useOverride = hasBody && !isExternal
        options = {
          method: useOverride ? 'POST' : method,
          headers: useOverride ? { 'X-HTTP-Method-Override': method } : {}
        }
        if (interpolatedBody) {
          options.headers['Content-Type'] = 'application/json'
          options.body = JSON.stringify(interpolatedBody)
        }
      }

      const res = await fetch(fetchUrl, options)
      const data = await res.json()
      setResults(prev => ({ ...prev, [key]: { status: res.status, data, duration: Date.now() - start } }))

      if (res.status >= 200 && res.status < 300) {
        addToast(`Request succeeded: ${method} ${path}`, 'success')
      } else {
        addToast(`Request failed (${res.status}): ${data.error || 'Unknown error'}`, 'error')
      }
    } catch (err) {
      setResults(prev => ({ ...prev, [key]: { status: 0, data: err.message, duration: Date.now() - start } }))
      addToast(`System error: ${err.message}`, 'error')
    } finally {
      setRunning(false)
    }
  }, [isExternal, targetObj, method, path, body, variables, functions, addToast])

  const saveAsArray = saveAs ? (Array.isArray(saveAs) ? saveAs : [saveAs]) : []

  const handleSave = (varName, varPath) => {
    const value = resolveExpr(varPath, result?.data, functions)

    if (value !== undefined) {
      setVariable(varName, value)
      setSaved(p => ({ ...p, [varName]: true }))
      setTimeout(() => setSaved(p => { const n = { ...p }; delete n[varName]; return n }), 1000)
    }
  }

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-surface-header border-b border-border-subtle flex items-center gap-2">
        {!isExternal && target && (targetColors[resolvedTarget.variant] || targetColors[target]) && (
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium cursor-help flex-shrink-0 ${targetColors[resolvedTarget.variant] || targetColors[target]}`}
            title={`ID: ${targetObj?.id || 'unknown'}\nName: ${targetObj?.name || 'unknown'}`}
          >
            {resolvedTarget.variant}
          </span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${methodColors[method]}`}>{method}</span>
        <code className="text-sm font-mono text-text-secondary flex-1 min-w-0 break-all">
          <InterpolatedText text={path} />
        </code>
        <div className="flex gap-2 flex-shrink-0">
          {method === 'EXEC' && (
            <button
              onClick={() => {
                const interpolatedCommand = interpolate(path || '', variables, functions)
                navigator.clipboard.writeText(interpolatedCommand)
                addToast('Copied command to clipboard', 'info')
              }}
              disabled={isDisabled}
              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-text-secondary rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
              title="Copy Command"
            >
              Copy
            </button>
          )}
          {method !== 'EXEC' && (
            <button
              onClick={() => {
                // Use Proxy URL (same as browser request) for clarity and safety
                const url = isExternal ? path : `http://localhost:12808/api/targets/${targetObj.id}/proxy${path}`
                const interpolatedUrl = interpolate(url, variables, functions)
                const interpolatedBody = interpolateBody(body, variables, functions)

                // For proxy requests with body, use POST + X-HTTP-Method-Override (matches browser behavior)
                const useOverride = interpolatedBody && !isExternal
                const curlMethod = useOverride ? 'POST' : method
                let curl = `curl -X ${curlMethod} '${interpolatedUrl}'`

                if (useOverride) {
                  curl += ` -H 'X-HTTP-Method-Override: ${method}'`
                }
                if (interpolatedBody) {
                  curl += ` -H 'Content-Type: application/json' -d '${JSON.stringify(interpolatedBody)}'`
                }

                navigator.clipboard.writeText(curl)
                addToast('Copied cURL to clipboard', 'info')
              }}
              disabled={isDisabled}
              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-text-secondary rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
              title="Copy as cURL"
            >
              cURL
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running || isDisabled}
            className="px-3 py-1 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>

      {description && <div className="px-3 py-2 text-sm text-text-secondary border-b border-border-subtle">{description}</div>}

      {body && (
        <div className="px-3 py-2 bg-surface-header border-b border-border-subtle">
          <HighlightedBody body={body} />
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="max-h-96 flex flex-col">
          <ResponseView
            result={result}
            method={method}
            onClear={() => resultKey && setResults(prev => { const n = { ...prev }; delete n[resultKey]; return n })}
          >
            {/* Save buttons */}
            {result.status >= 200 && result.status < 300 && saveAsArray.length > 0 && (
              <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-gray-100 dark:bg-gray-800 flex-wrap">
                {saveAsArray.map(({ varName, path: vp }) => {
                  const available = resolveExpr(vp || '', result.data, functions) !== undefined
                  return (
                    <button
                      key={varName}
                      onClick={() => handleSave(varName, vp)}
                      disabled={!available || saved[varName]}
                      className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${
                        saved[varName] ? 'bg-green-200 dark:bg-green-700 text-green-800 dark:text-green-200'
                        : available ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 dark:bg-gray-700 text-text-muted cursor-not-allowed'
                      }`}
                    >
                      {saved[varName] ? (
                        <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="font-mono">{`{{${varName}}}`}</span></>
                      ) : (
                        <><span className="text-text-muted">{vp || 'response'}</span><span className="text-gray-500">→</span><span className="font-mono">{`{{${varName}}}`}</span></>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </ResponseView>
        </div>
      )}

      {isDisabled && !hasUnresolvedVars && !group && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm">
          Select a target group
        </div>
      )}

      {isDisabled && !hasUnresolvedVars && group && !isExternal && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm">
          {!targetObj ? `No '${target}' target in group` : `${resolvedTarget.variant} target: ${targetObj.status}`}
        </div>
      )}

      {hasUnresolvedVars && (
        <div className="px-3 py-2 bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Missing variables: {unresolvedVars.map(v => `{{${v}}}`).join(', ')}</span>
        </div>
      )}
    </div>
  )
}

// Script cell - execute JavaScript functions with API access
export function Script({ children, description }) {
  const { group, variables, setVariable, functions } = useContext(NotebookContext)
  const { addToast } = useToast()
  const { isDark } = useTheme()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState({}) // keyed by group.key
  const [expandWindow, setExpandWindow] = useState(null)
  const [expandContainer, setExpandContainer] = useState(null)

  // Get result for current group
  const groupKey = group?.key
  const currentResult = groupKey ? results[groupKey] : null
  const result = currentResult?.data ?? null
  const error = currentResult?.error ?? null
  const duration = currentResult?.duration ?? null

  // Clean up expand window on unmount or when result changes
  useEffect(() => {
    return () => {
      if (expandWindow && !expandWindow.closed) {
        expandWindow.close()
      }
    }
  }, [expandWindow])

  // Handle expand window being closed by user
  useEffect(() => {
    if (!expandWindow) return
    const checkClosed = setInterval(() => {
      if (expandWindow.closed) {
        setExpandWindow(null)
        setExpandContainer(null)
      }
    }, 500)
    return () => clearInterval(checkClosed)
  }, [expandWindow])

  // Open expand window for React component
  const handleExpand = useCallback(() => {
    const win = openThemedPopup(description || 'Script Result', isDark, { width: 1200, height: 800 })
    if (!win) {
      addToast('Failed to open window (popup blocked?)', 'error')
      return
    }
    win.document.body.classList.add('p-4')

    // Create container for React portal
    const container = win.document.createElement('div')
    container.id = 'portal-root'
    win.document.body.appendChild(container)

    setExpandWindow(win)
    setExpandContainer(container)
  }, [description, addToast, isDark])

  // Create request helper function
  const request = useCallback(async (variant, { method = 'GET', path, body } = {}) => {
    const resolvedTarget = resolveTarget(group, variant)
    const targetObj = resolvedTarget.target
    if (!targetObj) throw new Error(`Target "${variant}" not found`)
    if (targetObj.status !== 'connected') throw new Error(`Target "${variant}" not connected (status: ${targetObj.status})`)

    const interpolatedPath = interpolate(path || '', variables, functions)
    const fetchUrl = `/api/targets/${targetObj.id}/proxy${interpolatedPath}`
    // Use POST with X-HTTP-Method-Override for requests with body (browsers don't support GET with body)
    const interpolatedBody = body ? interpolateBody(body, variables, functions) : null
    const options = {
      method: interpolatedBody ? 'POST' : method,
      headers: interpolatedBody ? { 'X-HTTP-Method-Override': method } : {}
    }

    if (interpolatedBody) {
      options.headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(interpolatedBody)
    }

    const res = await fetch(fetchUrl, options)
    const data = await res.json()
    if (!res.ok) {
      const err = new Error(`${method} ${path} failed (${res.status})`)
      err.status = res.status
      err.response = data
      throw err
    }
    return data
  }, [group, variables, functions])

  // Execute the script function
  const handleRun = useCallback(async () => {
    if (typeof children !== 'function') {
      if (groupKey) {
        setResults(prev => ({ ...prev, [groupKey]: { error: new Error('Script children must be a function'), duration: 0 } }))
      }
      return
    }

    setRunning(true)
    const start = Date.now()

    try {
      const output = await children({ request, variables, setVariable, group, functions })
      if (groupKey) {
        setResults(prev => ({ ...prev, [groupKey]: { data: output, duration: Date.now() - start } }))
      }
      addToast('Script completed', 'success')
    } catch (err) {
      if (groupKey) {
        setResults(prev => ({ ...prev, [groupKey]: { error: err, duration: Date.now() - start } }))
      }
      addToast(`Script error: ${err.message}`, 'error')
    } finally {
      setRunning(false)
    }
  }, [children, request, variables, setVariable, group, functions, addToast, groupKey])

  // Check if group is available
  const isDisabled = !group

  // Check if result is a React element
  const isReactElement = result !== null && typeof result === 'object' && result.$$typeof

  // Render result based on type
  const renderResult = () => {
    if (error) {
      return (
        <div className="p-3">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-300 font-medium mb-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Error
          </div>
          <pre className="text-sm text-red-700 dark:text-red-200 whitespace-pre-wrap font-mono overflow-auto">
            {error.message}
            {error.response && '\n\nResponse: ' + JSON.stringify(error.response, null, 2)}
          </pre>
        </div>
      )
    }

    if (result === null || result === undefined) return null

    // React element - render directly
    if (isReactElement) {
      return <div className="p-3 text-text">{result}</div>
    }

    // String - render as text
    if (typeof result === 'string') {
      return <pre className="p-3 text-sm font-mono whitespace-pre-wrap">{result}</pre>
    }

    // Object/Array - render as JSON
    return <JsonResponse data={result} functions={functions} />
  }

  return (
    <div className="border border-border rounded-lg bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-surface-header border-b border-border-subtle flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 flex-shrink-0">
          SCRIPT
        </span>
        {description && (
          <span className="text-sm text-text-secondary flex-1 break-words min-w-0">{description}</span>
        )}
        <button
          onClick={handleRun}
          disabled={running || isDisabled}
          className="px-3 py-1 bg-indigo-500 text-white text-sm font-medium rounded hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>

      {/* Result */}
      {(result !== null || error) && (
        <div className="max-h-96 overflow-auto bg-surface-sunken text-text">
          <div className="sticky top-0 px-3 py-2 flex items-center justify-between border-b border-border bg-surface-sunken z-10">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                error ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'
              }`}>
                {error ? 'ERROR' : 'OK'}
              </span>
              {duration && <span className="text-xs text-text-muted">{duration}ms</span>}
            </div>
            <div className="flex items-center gap-2">
              {isReactElement && (
                <button
                  onClick={handleExpand}
                  className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-secondary rounded transition-colors flex items-center gap-1"
                  title="Expand in new window"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                  Expand
                </button>
              )}
              <button
                onClick={() => {
                  if (groupKey) {
                    setResults(prev => { const n = { ...prev }; delete n[groupKey]; return n })
                  }
                  if (expandWindow) expandWindow.close()
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
          {renderResult()}
        </div>
      )}

      {/* Portal for expanded React component */}
      {expandContainer && isReactElement && createPortal(
        <div className="text-text">{result}</div>,
        expandContainer
      )}

      {isDisabled && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm">
          Select a target group to run this script
        </div>
      )}
    </div>
  )
}

Script.propTypes = {
  children: PropTypes.func.isRequired,
  description: PropTypes.string
}

// ============ INTERNAL COMPONENTS ============

// Variables dropdown button
function VariablesButton({ userVariables, configVariables, setVariable, deleteVariable }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const userEntries = Object.entries(userVariables || {})
  const configEntries = Object.entries(configVariables || {})
  const hasVariables = userEntries.length > 0 || configEntries.length > 0

  const handleSave = (name) => {
    try { setVariable(name, JSON.parse(editValue)) } catch { setVariable(name, editValue) }
    setEditing(null)
  }

  const handleCreateVariable = () => {
    if (!newName.trim()) {
      alert('Variable name cannot be empty')
      return
    }
    if (userVariables && userVariables[newName]) {
      alert('Variable already exists')
      return
    }
    if (configVariables && configVariables[newName]) {
      alert('Variable name conflicts with config variable. Use edit to override.')
      return
    }
    try {
      setVariable(newName, JSON.parse(newValue))
    } catch {
      setVariable(newName, newValue)
    }
    setNewName('')
    setNewValue('')
    setCreating(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 text-sm border rounded flex items-center gap-1.5 ${
          hasVariables ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Variables
        {hasVariables && (
          <span className="px-1.5 py-0.5 text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full">
            {userEntries.length + configEntries.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-96 bg-surface border border-border rounded-lg shadow-lg z-50 max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
              <span className="text-sm font-medium text-text-secondary">Variables</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">×</button>
            </div>

            <div className="overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
              {/* Config Variables (Read-only) */}
              {configEntries.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-surface-header text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    From Config (Read-only)
                  </div>
                  {configEntries.map(([name, value]) => (
                    <div key={name} className="px-3 py-2 opacity-80">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm text-blue-700 dark:text-blue-400">{`{{${name}}}`}</span>
                        {userVariables[name] !== undefined && (
                          <span className="text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 px-1 rounded">Overridden</span>
                        )}
                      </div>
                      <pre className="text-xs font-mono text-text-secondary bg-surface-header rounded px-2 py-1.5 max-h-24 overflow-auto whitespace-pre-wrap">
                        {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {/* Session Variables (Editable) */}
              <div>
                {configEntries.length > 0 && (
                  <div className="px-3 py-1.5 bg-surface-header text-[10px] font-bold text-text-muted uppercase tracking-wider border-t border-border-subtle">
                    Session Variables
                  </div>
                )}

                {/* Create New Variable Section */}
                <div className="px-3 py-3 border-b border-border-subtle">
                  {!creating ? (
                    <button
                      onClick={() => setCreating(true)}
                      className="w-full py-2 px-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded border border-dashed border-blue-300 dark:border-blue-700"
                    >
                      + Create Variable
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Variable name (e.g., myVar)"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-text rounded"
                        autoFocus
                      />
                      <textarea
                        placeholder='Value (e.g., "hello" or {"key": "value"})'
                        value={newValue}
                        onChange={e => setNewValue(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-text rounded"
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => { setCreating(false); setNewName(''); setNewValue('') }}
                          className="px-2 py-1 text-xs text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateVariable}
                          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {userEntries.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-muted text-center italic">No session variables</div>
                ) : (
                  userEntries.map(([name, value]) => (
                    <div key={name} className="px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm text-blue-700 dark:text-blue-400">{`{{${name}}}`}</span>
                        <div className="flex gap-1">
                          {editing !== name && (
                            <button onClick={() => { setEditing(name); setEditValue(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)) }} className="p-1 text-text-muted hover:text-blue-500">✎</button>
                          )}
                          <button onClick={() => deleteVariable(name)} className="p-1 text-text-muted hover:text-red-500">×</button>
                        </div>
                      </div>
                      {editing === name ? (
                        <div className="space-y-2">
                          <textarea value={editValue} onChange={e => setEditValue(e.target.value)} className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-text rounded" rows={4} autoFocus />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditing(null)} className="px-2 py-1 text-xs text-text-secondary">Cancel</button>
                            <button onClick={() => handleSave(name)} className="px-2 py-1 text-xs bg-blue-500 text-white rounded">Save</button>
                          </div>
                        </div>
                      ) : (
                        <pre className="text-xs font-mono text-text-secondary bg-surface-header rounded px-2 py-1.5 max-h-24 overflow-auto whitespace-pre-wrap">
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Color mapping for target visuals
const colorMap = {
  red: { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800 dark:text-red-200', border: 'border-red-200 dark:border-red-700', ring: 'focus:ring-red-500' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-800 dark:text-orange-200', border: 'border-orange-200 dark:border-orange-700', ring: 'focus:ring-orange-500' },
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900', text: 'text-yellow-800 dark:text-yellow-200', border: 'border-yellow-200 dark:border-yellow-700', ring: 'focus:ring-yellow-500' },
  green: { bg: 'bg-green-100 dark:bg-green-900', text: 'text-green-800 dark:text-green-200', border: 'border-green-200 dark:border-green-700', ring: 'focus:ring-green-500' },
  blue: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-200', border: 'border-blue-200 dark:border-blue-700', ring: 'focus:ring-blue-500' },
  indigo: { bg: 'bg-indigo-100 dark:bg-indigo-900', text: 'text-indigo-800 dark:text-indigo-200', border: 'border-indigo-200 dark:border-indigo-700', ring: 'focus:ring-indigo-500' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900', text: 'text-purple-800 dark:text-purple-200', border: 'border-purple-200 dark:border-purple-700', ring: 'focus:ring-purple-500' },
  pink: { bg: 'bg-pink-100 dark:bg-pink-900', text: 'text-pink-800 dark:text-pink-200', border: 'border-pink-200 dark:border-pink-700', ring: 'focus:ring-pink-500' },
  gray: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-800 dark:text-gray-200', border: 'border-gray-200 dark:border-gray-600', ring: 'focus:ring-gray-500' },
}

// ============ KIBANA-STYLE CONSOLE ============

const CONSOLE_METHOD_RE = /^(GET|POST|PUT|DELETE|HEAD|PATCH)\s+(.+?)\s*$/i

// Parse console text into discrete requests (Kibana-style: multiple per editor)
function parseConsoleRequests(text) {
  const lines = text.split('\n')
  const reqs = []
  let cur = null
  lines.forEach((line, i) => {
    const m = line.match(CONSOLE_METHOD_RE)
    if (m) {
      if (cur) { cur.endLine = i - 1; reqs.push(cur) }
      cur = { method: m[1].toUpperCase(), path: m[2].trim(), startLine: i, bodyLines: [] }
    } else if (cur) {
      cur.bodyLines.push(line)
    }
  })
  if (cur) { cur.endLine = lines.length - 1; reqs.push(cur) }
  return reqs.map(r => ({
    method: r.method,
    path: r.path,
    startLine: r.startLine,
    endLine: r.endLine,
    bodyText: r.bodyLines.join('\n').trim(),
  }))
}

// Find the request whose line range contains the cursor line
function requestAtLine(reqs, line) {
  if (!reqs.length) return -1
  for (let i = 0; i < reqs.length; i++) {
    if (line >= reqs[i].startLine && line <= reqs[i].endLine) return i
  }
  // Cursor after last method line of last request
  return reqs.length - 1
}

function escapeConsoleHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Highlight a {{var}} bearing string, resolving for tooltip/state classes
function highlightVarsInline(escaped, variables, functions) {
  return escaped.replace(/\{\{([^}]+)\}\}/g, (m, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions)
    const cls = value === undefined ? 'con-var con-var-missing' : 'con-var'
    return `<span class="${cls}">${m}</span>`
  })
}

// Build syntax-highlighted HTML for the editor overlay, line by line
function buildConsoleHighlight(text, variables, functions) {
  return text.split('\n').map(line => {
    const m = line.match(CONSOLE_METHOD_RE)
    if (m) {
      const lead = line.slice(0, m.index ?? 0)
      const method = m[1].toUpperCase()
      const pathEscaped = highlightVarsInline(escapeConsoleHtml(line.slice((m.index ?? 0) + m[1].length)), variables, functions)
      return `${escapeConsoleHtml(lead)}<span class="con-method con-${method}">${escapeConsoleHtml(m[1])}</span>${pathEscaped}`
    }
    if (line === '') return ''
    return highlightVarsInline(highlightJsonTemplate(line), variables, functions)
  }).join('\n')
}

// Pretty-print JSON bodies while preserving {{var}} tokens
function formatConsoleBody(body) {
  if (!body.trim()) return body
  const tokens = []
  const protectedStr = body.replace(/\{\{[^}]+\}\}/g, (mm) => {
    tokens.push(mm)
    return `"__VAR_${tokens.length - 1}__"`
  })
  try {
    const obj = JSON.parse(protectedStr)
    let out = JSON.stringify(obj, null, 2)
    out = out.replace(/"__VAR_(\d+)__"/g, (_x, i) => tokens[+i])
    return out
  } catch {
    return body
  }
}

// Reformat the whole editor: pretty-print each request body
function formatConsoleText(text) {
  const reqs = parseConsoleRequests(text)
  if (!reqs.length) return text
  return reqs.map(r => {
    const head = `${r.method} ${r.path}`
    const body = formatConsoleBody(r.bodyText)
    return body ? `${head}\n${body}` : head
  }).join('\n\n')
}

// Interpolate variables inside a raw body string (NDJSON-safe, keeps non-JSON intact)
function interpolateBodyText(text, variables, functions) {
  if (!text) return null
  const stripped = text.replace(/"(\{\{[^}]+\}\})"/g, '$1')
  return stripped.replace(/\{\{([^}]+)\}\}/g, (m, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions)
    if (value === undefined) return m
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

// Build a cURL command for a parsed request
function buildConsoleCurl(req, targetObj, variables, functions, isExternal) {
  const interpolatedPath = interpolate(req.path, variables, functions)
  const url = isExternal
    ? interpolatedPath
    : `http://localhost:12808/api/targets/${targetObj?.id}/proxy${interpolatedPath.startsWith('/') ? '' : '/'}${interpolatedPath}`
  const body = req.bodyText ? interpolateBodyText(req.bodyText, variables, functions) : null
  const useOverride = body && !isExternal
  const curlMethod = useOverride ? 'POST' : req.method
  let curl = `curl -X ${curlMethod} '${url}'`
  if (useOverride) curl += ` -H 'X-HTTP-Method-Override: ${req.method}'`
  if (body) curl += ` -H 'Content-Type: application/json' -d '${body.replace(/'/g, `'\\''`)}'`
  return curl
}

// The code editor: textarea + highlight overlay + gutter with per-request run buttons
function ConsoleEditor({ value, onChange, requests, currentReq, onCursorLine, onRunRequest, variables, functions, disabled }) {
  const taRef = useRef(null)
  const preRef = useRef(null)
  const gutterRef = useRef(null)

  const lineCount = useMemo(() => value.split('\n').length, [value])
  const startLines = useMemo(() => new Set(requests.map(r => r.startLine)), [requests])
  const activeReq = requests[currentReq]

  const highlighted = useMemo(
    () => buildConsoleHighlight(value, variables, functions),
    [value, variables, functions]
  )

  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`
    }
  }, [])

  const updateCursor = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const line = value.slice(0, ta.selectionStart).split('\n').length - 1
    onCursorLine(line)
  }, [value, onCursorLine])

  const handleKeyDown = useCallback((e) => {
    const ta = taRef.current
    const INDENT = '  '
    // Tab / Shift+Tab: indent / dedent
    if (e.key === 'Tab') {
      e.preventDefault()
      const s = ta.selectionStart, en = ta.selectionEnd
      const dedent = e.shiftKey
      const hasSelection = s !== en

      // No selection + plain Tab: just insert an indent at the cursor
      if (!dedent && !hasSelection) {
        const next = value.slice(0, s) + INDENT + value.slice(en)
        onChange(next)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + INDENT.length })
        return
      }

      // Otherwise operate on every line the selection (or cursor) touches
      const blockStart = value.lastIndexOf('\n', s - 1) + 1
      let endIdx = en
      if (hasSelection && value[en - 1] === '\n') endIdx = en - 1 // don't pull in the trailing empty line
      const nl = value.indexOf('\n', endIdx)
      const blockEnd = nl === -1 ? value.length : nl

      const before = value.slice(0, blockStart)
      const after = value.slice(blockEnd)
      const lines = value.slice(blockStart, blockEnd).split('\n')

      let firstDelta = 0, totalDelta = 0
      const newLines = lines.map((line, idx) => {
        if (dedent) {
          let remove = 0
          if (line.startsWith(INDENT)) remove = INDENT.length
          else if (line.startsWith('\t') || line.startsWith(' ')) remove = 1
          if (idx === 0) firstDelta = -remove
          totalDelta -= remove
          return line.slice(remove)
        }
        if (idx === 0) firstDelta = INDENT.length
        totalDelta += INDENT.length
        return INDENT + line
      })

      onChange(before + newLines.join('\n') + after)
      requestAnimationFrame(() => {
        ta.selectionStart = Math.max(blockStart, s + firstDelta)
        ta.selectionEnd = Math.max(blockStart, en + totalDelta)
      })
      return
    }
    // Auto-close braces/brackets
    if (e.key === '{' || e.key === '[') {
      const close = e.key === '{' ? '}' : ']'
      const s = ta.selectionStart, en = ta.selectionEnd
      if (s === en) {
        e.preventDefault()
        const next = value.slice(0, s) + e.key + close + value.slice(en)
        onChange(next)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
      }
    }
  }, [value, onChange])

  return (
    <div className="flex-1 flex min-h-0 font-mono text-[13px] leading-5 bg-surface-sunken">
      {/* Gutter */}
      <div className="relative w-12 flex-shrink-0 overflow-hidden bg-gray-50 dark:bg-gray-800/60 border-r border-border select-none">
        <div ref={gutterRef} className="absolute top-0 left-0 right-0 py-3">
          {Array.from({ length: lineCount }, (_, i) => {
            const inActive = activeReq && i >= activeReq.startLine && i <= activeReq.endLine
            return (
            <div key={i} className={`h-5 pr-1.5 flex items-center justify-end gap-1 text-[11px] ${inActive ? 'text-gray-700 dark:text-gray-200 bg-blue-50 dark:bg-blue-900/20' : 'text-text-muted'}`}>
              {startLines.has(i) && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); if (!disabled) onRunRequest(requests.find(r => r.startLine === i)) }}
                  disabled={disabled}
                  title="Run this request"
                  className="flex items-center justify-center rounded p-0.5 text-green-600 dark:text-green-400 transition-all duration-150 hover:text-white hover:bg-green-600 dark:hover:bg-green-500 hover:scale-125 hover:shadow-sm active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-green-600 disabled:hover:scale-100 leading-none cursor-pointer"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </button>
              )}
              <span>{i + 1}</span>
            </div>
            )
          })}
        </div>
      </div>

      {/* Code area: overlay + textarea */}
      <div className="relative flex-1 min-w-0">
        <pre
          ref={preRef}
          aria-hidden
          className="console-code absolute inset-0 m-0 p-3 overflow-hidden whitespace-pre json-template pointer-events-none"
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
        />
        <textarea
          ref={taRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyUp={updateCursor}
          onClick={updateCursor}
          onSelect={updateCursor}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="console-code absolute inset-0 m-0 p-3 w-full h-full resize-none overflow-auto whitespace-pre bg-transparent text-transparent caret-gray-900 dark:caret-gray-100 outline-none border-0"
          autoFocus
        />
      </div>
    </div>
  )
}

ConsoleEditor.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  requests: PropTypes.array.isRequired,
  currentReq: PropTypes.number,
  onCursorLine: PropTypes.func.isRequired,
  onRunRequest: PropTypes.func.isRequired,
  variables: PropTypes.object,
  functions: PropTypes.object,
  disabled: PropTypes.bool,
}

// Wrench / tools dropdown
function ConsoleToolsMenu({ onAutoIndent, onCopyCurl, onClear, disabled }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Tools"
        className="p-1.5 text-text-muted hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 text-sm overflow-hidden">
            <button onClick={() => { onAutoIndent(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700">Auto indent</button>
            <button onClick={() => { onCopyCurl(); setOpen(false) }} disabled={disabled} className="w-full text-left px-3 py-1.5 text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">Copy as cURL</button>
            <div className="border-t border-border-subtle my-1" />
            <button onClick={() => { onClear(); setOpen(false) }} className="w-full text-left px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700">Clear editor</button>
          </div>
        </>
      )}
    </div>
  )
}

// Full-screen Kibana-style console
function ConsoleModal({ group, target, onTargetChange, onClose }) {
  const { variables, functions, userVariables, configVariables, setVariable, deleteVariable } = useContext(NotebookContext)
  const { groupBy } = useConfig()
  const { addToast } = useToast()

  const storageKey = group ? `tool-console:${group.key}` : 'tool-console:__none__'
  const defaultCommand = useMemo(() => {
    if (!group) return 'GET /_cluster/health'
    const firstTarget = Object.values(group.targets)[0]
    return firstTarget?.metadata?.default_command || 'GET /_cluster/health'
  }, [group])

  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(storageKey) ?? defaultCommand } catch { return defaultCommand }
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [cursorLine, setCursorLine] = useState(0)
  const [splitPct, setSplitPct] = useState(50)

  // Load saved text when switching groups
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      setInput(saved ?? defaultCommand)
    } catch {
      setInput(defaultCommand)
    }
    setResult(null)
  }, [storageKey, defaultCommand])

  // Persist editor content per group
  useEffect(() => {
    try { localStorage.setItem(storageKey, input) } catch { /* ignore */ }
  }, [storageKey, input])

  const requests = useMemo(() => parseConsoleRequests(input), [input])
  const currentReq = useMemo(() => requestAtLine(requests, cursorLine), [requests, cursorLine])

  const targetObj = group?.targets?.[target]
  const notConnected = !targetObj || targetObj.status !== 'connected'

  const runRequest = useCallback(async (req) => {
    if (!req || !targetObj || notConnected) return
    const interpolatedPath = interpolate(req.path, variables, functions)
    const path = interpolatedPath.startsWith('/') ? interpolatedPath : '/' + interpolatedPath
    let body = req.bodyText ? interpolateBodyText(req.bodyText, variables, functions) : null
    if (body && path.includes('_bulk') && !body.endsWith('\n')) body += '\n'

    setRunning(true)
    const start = Date.now()
    try {
      const hasBody = body != null && body !== ''
      const options = {
        method: hasBody ? 'POST' : req.method,
        headers: hasBody ? { 'X-HTTP-Method-Override': req.method, 'Content-Type': 'application/json' } : {},
      }
      if (hasBody) options.body = body

      const res = await fetch(`/api/targets/${targetObj.id}/proxy${path}`, options)
      const text = await res.text()
      let data = null
      if (text) { try { data = JSON.parse(text) } catch { data = text } }

      setResult({ status: res.status, data, method: req.method, emptyBody: text.length === 0, duration: Date.now() - start })
    } catch (err) {
      setResult({ status: 0, data: err.message, duration: Date.now() - start })
      addToast(`System error: ${err.message}`, 'error')
    } finally {
      setRunning(false)
    }
  }, [targetObj, notConnected, variables, functions, addToast])

  const runCurrent = useCallback(() => {
    const req = requests[currentReq]
    if (req) runRequest(req)
  }, [requests, currentReq, runRequest])

  const handleAutoIndent = useCallback(() => setInput(prev => formatConsoleText(prev)), [])

  const handleCopyCurl = useCallback(() => {
    const req = requests[currentReq]
    if (!req) return
    navigator.clipboard.writeText(buildConsoleCurl(req, targetObj, variables, functions, false))
    addToast('Copied cURL to clipboard', 'info')
  }, [requests, currentReq, targetObj, variables, functions, addToast])

  // Resizable split
  const splitRef = useRef(null)
  const handleDrag = useCallback((e) => {
    e.preventDefault()
    const onMove = (ev) => {
      const rect = splitRef.current?.getBoundingClientRect()
      if (!rect) return
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const unresolvedCount = useMemo(() => {
    const matches = input.match(/\{\{([^}]+)\}\}/g) || []
    return new Set(
      matches.map(m => m.slice(2, -2).trim()).filter(e => resolveExpr(e, variables, functions) === undefined)
    ).size
  }, [input, variables, functions])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3" onMouseDown={onClose}>
      <div
        className="bg-surface-sunken rounded-lg shadow-2xl w-full max-w-[1600px] h-[92vh] flex flex-col overflow-hidden border border-border"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-3 flex-shrink-0 bg-surface">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
            <span className="font-semibold text-text">Console</span>
            <span className="text-xs text-text-muted">{formatGroupLabel(group, groupBy)}</span>
          </div>

          {/* Context (target variant) selector */}
          {group && (
            <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600 ml-2">
              {Object.keys(group.targets).sort().map(variant => {
                const tObj = group.targets[variant]
                const tColor = colorMap[tObj?.visual?.color] || colorMap.gray
                const isSelected = target === variant
                const dot = tObj?.status === 'connected' ? 'bg-green-500' : 'bg-gray-400'
                return (
                  <button
                    key={variant}
                    onClick={() => onTargetChange(variant)}
                    title={`${tObj?.name || variant} — ${tObj?.status || 'unknown'}`}
                    className={`px-3 py-1 text-xs font-medium border-r last:border-r-0 border-gray-300 dark:border-gray-600 flex items-center gap-1.5 transition-colors ${
                      isSelected ? `${tColor.bg} ${tColor.text} font-bold` : 'bg-white dark:bg-gray-700 text-text-muted hover:bg-gray-50 dark:hover:bg-gray-600'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    {variant}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex-1" />

          {unresolvedCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300">
              {unresolvedCount} unresolved {unresolvedCount === 1 ? 'var' : 'vars'}
            </span>
          )}
          <VariablesButton
            userVariables={userVariables}
            configVariables={configVariables}
            setVariable={setVariable}
            deleteVariable={deleteVariable}
          />
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none" title="Close (Esc)">×</button>
        </div>

        {/* Split: editor | response */}
        <div ref={splitRef} className="flex-1 flex min-h-0" onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
          {/* Editor pane */}
          <div className="flex flex-col min-h-0 min-w-0" style={{ width: `${splitPct}%` }}>
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-surface-sunken flex-shrink-0">
              <button
                onClick={runCurrent}
                disabled={running || notConnected || !requests.length}
                title="Run request at cursor (Ctrl/Cmd+Enter)"
                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                {running ? 'Running...' : 'Run'}
              </button>
              <span className="text-xs text-text-muted">
                {requests.length} request{requests.length === 1 ? '' : 's'} · Ctrl+Enter to run
              </span>
              <div className="flex-1" />
              <ConsoleToolsMenu
                onAutoIndent={handleAutoIndent}
                onCopyCurl={handleCopyCurl}
                onClear={() => setInput('')}
                disabled={!requests.length}
              />
            </div>
            <div
              className="flex-1 flex min-h-0"
              onKeyDownCapture={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCurrent() } }}
            >
              <ConsoleEditor
                value={input}
                onChange={setInput}
                requests={requests}
                currentReq={currentReq}
                onCursorLine={setCursorLine}
                onRunRequest={runRequest}
                variables={variables}
                functions={functions}
                disabled={notConnected}
              />
            </div>
          </div>

          {/* Divider */}
          <div
            onMouseDown={handleDrag}
            className="w-1 flex-shrink-0 cursor-col-resize bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
          />

          {/* Response pane */}
          <div className="flex flex-col min-h-0 min-w-0 bg-surface-sunken" style={{ width: `${100 - splitPct}%` }}>
            {result && !result.loading ? (
              <ResponseView result={result} method={result.method || 'GET'} onClear={() => setResult(null)} />
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-center">
                <div className="text-text-muted text-sm">
                  {running ? (
                    <div className="flex items-center gap-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />Running…</div>
                  ) : notConnected ? (
                    <span>Selected target is not connected.</span>
                  ) : (
                    <span>Response will appear here.<br />Use <code className="text-blue-600 dark:text-blue-400">{'{{var}}'}</code> for variables, <code className="text-blue-600 dark:text-blue-400">▶</code> to run a request.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

ConsoleModal.propTypes = {
  group: PropTypes.object,
  target: PropTypes.string,
  onTargetChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}

// ============ NOTEBOOK CONTAINER ============

const STORAGE_KEY = 'tool-variables'
const EMPTY_OBJECT = Object.freeze({})

export default function Notebook({ group, children, functions: notebookFunctions = {}, targetColors: customTargetColors = {} }) {
  const { groupBy } = useConfig()
  const [searchParams, setSearchParams] = useSearchParams()

  // Console open/close state lives in the URL (?console=1) so it survives reload & is shareable
  const showConsole = searchParams.get('console') === '1'
  const consoleTarget = searchParams.get('ctarget') || getDefaultTargetVariant(group)

  const openConsole = useCallback(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('console', '1')
      if (!p.get('ctarget')) p.set('ctarget', getDefaultTargetVariant(group))
      return p
    })
  }, [setSearchParams, group])

  const closeConsole = useCallback(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.delete('console')
      p.delete('ctarget')
      return p
    }, { replace: true })
  }, [setSearchParams])

  const setConsoleTarget = useCallback((variant) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('ctarget', variant)
      return p
    }, { replace: true })
  }, [setSearchParams])

  // Close the console with Escape from anywhere while it's open
  useEffect(() => {
    if (!showConsole) return
    const onKey = (e) => { if (e.key === 'Escape') closeConsole() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showConsole, closeConsole])

  // Merge default and custom target colors
  const mergedTargetColors = useMemo(() => ({
    ...defaultTargetColors,
    ...customTargetColors
  }), [customTargetColors])

  // Initialize from localStorage
  const [allVariables, setAllVariables] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allVariables))
  }, [allVariables])

  // Merge common functions with notebook-specific functions (notebook overrides common)
  const functions = useMemo(
    () => ({ ...commonFunctions, ...notebookFunctions }),
    [notebookFunctions]
  )

  const groupKey = group ? group.key : null
  const userVariables = useMemo(
    () => (groupKey ? (allVariables[groupKey] || EMPTY_OBJECT) : EMPTY_OBJECT),
    [allVariables, groupKey]
  )

  // Combine group info (including config variables) with user-defined variables
  const variables = useMemo(() => ({
    ...(group?.variables || {}), // Promote group variables to top level
    ...group,
    ...userVariables
  }), [group, userVariables])

  const setVariable = useCallback((name, value) => {
    if (!groupKey) return
    setAllVariables(prev => ({ ...prev, [groupKey]: { ...(prev[groupKey] || {}), [name]: value } }))
  }, [groupKey])

  const deleteVariable = useCallback((name) => {
    if (!groupKey) return
    setAllVariables(prev => {
      const vars = { ...(prev[groupKey] || {}) }
      delete vars[name]
      return { ...prev, [groupKey]: vars }
    })
  }, [groupKey])

  return (
    <TargetColorsContext.Provider value={mergedTargetColors}>
      <NotebookContext.Provider value={{ group, variables, setVariable, deleteVariable, functions, userVariables, configVariables: group?.variables }}>
        <div className="h-full flex flex-col bg-surface-sunken">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-surface flex-shrink-0 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-text">Operations</h2>
            <p className="text-xs text-text-muted mt-0.5">{group ? formatGroupLabel(group, groupBy) : 'Select a target group'}</p>
          </div>
          <div className="flex items-center gap-2">
            <VariablesButton
              userVariables={userVariables}
              configVariables={group?.variables}
              setVariable={setVariable}
              deleteVariable={deleteVariable}
            />
            <button onClick={openConsole} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 text-text-secondary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              Console
            </button>
          </div>
        </div>

        {showConsole && (
          <ConsoleModal
            group={group}
            target={consoleTarget}
            onTargetChange={setConsoleTarget}
            onClose={closeConsole}
          />
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">{children}</div>
        </div>
      </div>
    </NotebookContext.Provider>
    </TargetColorsContext.Provider>
  )
}
