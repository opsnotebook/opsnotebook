import { useState, useEffect, useCallback, useMemo } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams, Link } from 'react-router-dom'
import TreeView from './components/TreeView'
import Notebook from './components/Notebook'
import { notebooks, getNotebook } from './notebooks'
import { parsePairKey } from './utils/pair'
import { groupTargets, findGroup, toGroup } from './utils/grouping'
import { ToastProvider } from './components/Toast'

// Home page showing all available notebooks
function Home({ targets }) {
  const connectedCount = targets.filter(c => c.status === 'connected').length

  useEffect(() => {
    document.title = 'OpsNotebook'
  }, [])

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900">OpsNotebook</h1>
          <p className="mt-2 text-gray-600">
            {connectedCount} of {targets.length} targets connected
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Notebooks</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {notebooks.map(nb => (
            <Link
              key={nb.id}
              to={`/notebooks/${nb.id}`}
              className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all"
            >
              <h3 className="text-lg font-semibold text-gray-900">{nb.title}</h3>
              {nb.description && (
                <p className="mt-2 text-sm text-gray-600">{nb.description}</p>
              )}
              <span className="inline-block mt-4 text-sm text-blue-600 font-medium">
                Open notebook →
              </span>
            </Link>
          ))}
        </div>

        {notebooks.length === 0 && (
          <p className="text-gray-500">No notebooks available.</p>
        )}
      </main>
    </div>
  )
}

// Main layout with sidebar and notebook area
function Layout({ targets, fetchTargets }) {
  const { notebookId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const notebook = getNotebook(notebookId)
  const NotebookComponent = notebook?.component

  // Build selectedGroup from URL query param
  const groupKeyParam = searchParams.get('group')
  const groupInfo = parsePairKey(groupKeyParam) // parsePairKey logic is still valid for parsing "env|region|name"

  const selectedGroup = useMemo(() => {
    if (!groupInfo) return null
    const groups = groupTargets(targets)
    const group = findGroup(groups, groupInfo)
    return toGroup(group)
  }, [targets, groupInfo])

  // Update URL when group is selected
  const handleSelectGroup = useCallback((group) => {
    // Group object already has a key property from groupTargets
    if (group?.key) {
      setSearchParams({ group: group.key })
    } else {
      setSearchParams({})
    }
  }, [setSearchParams])

  useEffect(() => {
    let title = 'OpsNotebook'
    if (selectedGroup) {
      const { environment, region, name } = selectedGroup
      title = `${environment.toUpperCase()}:${region.toUpperCase()}:${name}`
      if (notebook) {
        title = `${title} | ${notebook.title}`
      }
    } else if (notebook) {
      title = `${notebook.title} - ${title}`
    }
    document.title = title
  }, [notebook, selectedGroup])

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Top bar */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/" className="font-bold text-gray-900 hover:text-blue-600">OpsNotebook</Link>
          {/* Notebook tabs */}
          <nav className="flex items-center gap-1 border-l border-gray-200 pl-4">
            {notebooks.map(nb => (
              <Link
                key={nb.id}
                to={`/notebooks/${nb.id}${groupKeyParam ? `?group=${groupKeyParam}` : ''}`}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  notebookId === nb.id
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {nb.title}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={fetchTargets}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          title="Refresh targets"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Tree view */}
        <div className="w-64 flex-shrink-0">
          <TreeView
            targets={targets}
            selectedGroup={selectedGroup}
            onSelectGroup={handleSelectGroup}
          />
        </div>

        {/* Main - Notebook */}
        <div className="flex-1 overflow-hidden">
          {NotebookComponent ? (
            <Notebook group={selectedGroup} functions={notebook?.functions}>
              <NotebookComponent />
            </Notebook>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              Notebook not found: {notebookId}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [targets, setTargets] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchTargets = useCallback(async () => {
    try {
      const res = await fetch('/api/targets')
      const data = await res.json()
      setTargets(data)
    } catch {
      // Silently fail - UI shows empty state, auto-retry via interval
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTargets()
    const interval = setInterval(fetchTargets, 10000)
    return () => clearInterval(interval)
  }, [fetchTargets])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="text-gray-500">Loading targets...</span>
        </div>
      </div>
    )
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home targets={targets} />} />
          <Route path="/notebooks/:notebookId" element={<Layout targets={targets} fetchTargets={fetchTargets} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

export default App
