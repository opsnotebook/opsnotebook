import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  useSearchParams,
  Link,
} from "react-router-dom";
import TreeView from "./components/TreeView";
import Notebook from "./components/Notebook";
import { notebooks, getNotebook } from "./notebooks";
import { parsePairKey } from "./utils/pair";
import { groupTargets, findGroup, toGroup } from "./utils/grouping";
import { filterTargetsBySelector } from "./utils/labelSelector";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider, useTheme } from "./components/ThemeContext";

// Context for app config (group_by, etc.)
const ConfigContext = createContext({
  groupBy: ["environment", "region", "name"],
});
export const useConfig = () => useContext(ConfigContext);

// Home page showing all available notebooks
function Home({ targets }) {
  const connectedCount = targets.filter((c) => c.status === "connected").length;

  useEffect(() => {
    document.title = "OpsNotebook";
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            OpsNotebook
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {connectedCount} of {targets.length} targets connected
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Available Notebooks
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {notebooks.map((nb) => (
            <Link
              key={nb.id}
              to={`/notebooks/${nb.id}`}
              className="block p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {nb.title}
              </h3>
              {nb.description && (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {nb.description}
                </p>
              )}
              <span className="inline-block mt-4 text-sm text-blue-600 dark:text-blue-400 font-medium">
                Open notebook →
              </span>
            </Link>
          ))}
        </div>

        {notebooks.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">
            No notebooks available.
          </p>
        )}
      </main>
    </div>
  );
}

// Theme toggle button component
function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
    </button>
  );
}

// Main layout with sidebar and notebook area
function Layout({ targets, fetchTargets }) {
  const { notebookId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { groupBy } = useConfig();

  const notebook = getNotebook(notebookId);
  const NotebookComponent = notebook?.component;

  // Filter targets based on notebook's targetLabelSelector
  const filteredTargets = useMemo(() => {
    if (!notebook?.targetLabelSelector) {
      return targets; // No selector = show all targets
    }
    return filterTargetsBySelector(targets, notebook.targetLabelSelector);
  }, [targets, notebook?.targetLabelSelector]);

  // Build selectedGroup from URL query param
  const groupKeyParam = searchParams.get("group");
  const groupInfo = parsePairKey(groupKeyParam, groupBy);

  const selectedGroup = useMemo(() => {
    if (!groupInfo) return null;
    const groups = groupTargets(filteredTargets, groupBy);
    const group = findGroup(groups, groupInfo, groupBy);
    return toGroup(group);
  }, [filteredTargets, groupInfo, groupBy]);

  // Update URL when group is selected
  const handleSelectGroup = useCallback(
    (group) => {
      // Group object already has a key property from groupTargets
      if (group?.key) {
        setSearchParams({ group: group.key });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    let title = "OpsNotebook";
    if (selectedGroup) {
      title = groupBy
        .map((k) => selectedGroup.values[k]?.toUpperCase() || "UNKNOWN")
        .join(":");
      if (notebook) {
        title = `${title} | ${notebook.title}`;
      }
    } else if (notebook) {
      title = `${notebook.title} - ${title}`;
    }
    document.title = title;
  }, [notebook, selectedGroup, groupBy]);

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* Top bar */}
      <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
          >
            OpsNotebook
          </Link>
          {/* Notebook tabs */}
          <nav className="flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-4">
            {notebooks.map((nb) => (
              <Link
                key={nb.id}
                to={`/notebooks/${nb.id}${groupKeyParam ? `?group=${groupKeyParam}` : ""}`}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  notebookId === nb.id
                    ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
              >
                {nb.title}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={fetchTargets}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Refresh targets"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Tree view */}
        <div className="w-64 flex-shrink-0">
          <TreeView
            targets={filteredTargets}
            selectedGroup={selectedGroup}
            onSelectGroup={handleSelectGroup}
          />
        </div>

        {/* Main - Notebook */}
        <div className="flex-1 overflow-hidden">
          {NotebookComponent ? (
            <Notebook
              group={selectedGroup}
              functions={notebook?.functions}
              targetColors={notebook?.targetColors}
            >
              <NotebookComponent />
            </Notebook>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
              Notebook not found: {notebookId}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [targets, setTargets] = useState([]);
  const [config, setConfig] = useState({
    groupBy: ["environment", "region", "name"],
  });
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig({
        groupBy: data.group_by || ["environment", "region", "name"],
      });
    } catch {
      // Use defaults on error
    }
  }, []);

  const fetchTargets = useCallback(async () => {
    try {
      const res = await fetch("/api/targets");
      const data = await res.json();
      setTargets(data);
    } catch {
      // Silently fail - UI shows empty state, auto-retry via interval
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchTargets();
    const interval = setInterval(fetchTargets, 10000);
    return () => clearInterval(interval);
  }, [fetchConfig, fetchTargets]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <span className="text-gray-500 dark:text-gray-400">
            Loading targets...
          </span>
        </div>
      </div>
    );
  }

  return (
    <ConfigContext.Provider value={config}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Home targets={targets} />} />
              <Route
                path="/notebooks/:notebookId"
                element={
                  <Layout targets={targets} fetchTargets={fetchTargets} />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </ConfigContext.Provider>
  );
}

export default App;
