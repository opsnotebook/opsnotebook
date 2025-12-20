import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { useToast } from "./toastContext";
import { useConfig } from "../App";
import { commonFunctions } from "../utils/pipeFunctions";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("json", json);

// Helper to format group display string from values
function formatGroupLabel(group, groupBy) {
  if (!group?.values) return "No group selected";
  return groupBy.map((k) => group.values[k] || "unknown").join("/");
}

// Context for notebook state (pair, variables, functions)
const NotebookContext = createContext(null);

// Helper to resolve a path like "foo.bar.0.baz" from an object
function resolvePath(obj, path) {
  if (!path) return obj;
  const parts = path.split(".");
  let value = obj;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = /^\d+$/.test(part) ? value[parseInt(part, 10)] : value[part];
  }
  return value;
}

// Resolve expression with pipe functions: "varName.path | func1 | func2"
function resolveExpr(expr, variables, functions = {}) {
  if (!expr) return variables;
  const parts = expr.split("|").map((s) => s.trim());
  const varPath = parts[0];
  const pipes = parts.slice(1);

  let value = resolvePath(variables, varPath);

  // Apply pipe functions in sequence
  for (const pipe of pipes) {
    // Special case: default value if current value is empty/undefined
    // Syntax: {{var | default:*}}
    if (pipe.startsWith("default:")) {
      if (value === undefined || value === null || value === "") {
        value = pipe.slice(8);
      }
      continue;
    }

    // Propagate undefined so that {{missing | func}} remains undefined
    if (value === undefined) continue;

    const fn = functions[pipe];
    if (typeof fn === "function") {
      try {
        value = fn(value, variables);
      } catch {
        // On error, value becomes undefined, but we continue (might hit a default pipe later)
        value = undefined;
      }
    }
  }

  return value;
}

// Helper to interpolate {{varName}} or {{varName | func}} in strings
function interpolate(text, variables, functions) {
  if (typeof text !== "string") return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions);
    if (value === undefined) return match;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

// Helper to interpolate variables in JSON body
// Supports pipe functions: {{myVar | keys | first}}
function interpolateBody(body, variables, functions) {
  if (!body) return null;

  let template = typeof body === "string" ? body : JSON.stringify(body);

  // Remove quotes around {{var}} first (handles object syntax: "{{var}}" -> {{var}})
  template = template.replace(/"(\{\{[^}]+\}\})"/g, "$1");

  // Replace {{var}} with JSON-stringified value
  const result = template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const value = resolveExpr(expr.trim(), variables, functions);
    return value === undefined ? match : JSON.stringify(value);
  });

  try {
    return JSON.parse(result);
  } catch {
    return body;
  }
}

// Format body for display (removes quotes around {{var}} for cleaner display)
function formatBodyForDisplay(body) {
  if (!body) return null;
  const json = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  return json.replace(/"(\{\{[^}]+\}\})"/g, "$1");
}

// Renders a variable badge with hover tooltip
function VariableBadge({ value, raw }) {
  const [hovered, setHovered] = useState(false);
  const resolved = value !== undefined;

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={`px-1.5 py-0.5 rounded font-mono text-xs ${
          resolved
            ? "bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
            : "bg-orange-100 dark:bg-orange-900 border border-orange-300 dark:border-orange-700 text-orange-800 dark:text-orange-200"
        }`}
      >
        {resolved
          ? (typeof value === "object"
              ? JSON.stringify(value)
              : String(value)
            ).slice(0, 60) + (JSON.stringify(value).length > 60 ? "..." : "")
          : raw}
      </span>
      {hovered && resolved && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded whitespace-nowrap z-10">
          {raw}
        </span>
      )}
    </span>
  );
}

// Renders text with variables shown as styled badges with tooltips
function InterpolatedText({ text }) {
  const { variables, functions } = useContext(NotebookContext);

  if (typeof text !== "string") return <span>{text}</span>;

  const parts = [];
  let lastIdx = 0;
  const regex = /\{\{([^}]+)\}\}/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "text", content: text.slice(lastIdx, match.index) });
    }
    const expr = match[1].trim();
    const value = resolveExpr(expr, variables, functions);
    parts.push({ type: "var", expr, value, raw: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length)
    parts.push({ type: "text", content: text.slice(lastIdx) });
  if (parts.length === 0) return <span>{text}</span>;

  return (
    <span>
      {parts.map((p, i) =>
        p.type === "var" ? (
          <VariableBadge key={i} value={p.value} raw={p.raw} />
        ) : (
          <span key={i}>{p.content}</span>
        ),
      )}
    </span>
  );
}

// Simple syntax highlighting for JSON templates with {{var}} support
function highlightJsonTemplate(text) {
  // Escape HTML first
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Apply highlighting patterns in order
  return (
    escaped
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
  );
}

// Highlighted JSON response with copy button
function JsonResponse({ data }) {
  const [copied, setCopied] = useState(false);

  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isJson = typeof data === "object";

  const highlighted = useMemo(() => {
    if (!isJson) return null;
    try {
      return hljs.highlight(text, { language: "json" }).value;
    } catch {
      return null;
    }
  }, [text, isJson]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleExpand = () => {
    const width = Math.min(1200, window.screen.availWidth * 0.9);
    const height = Math.min(1000, window.screen.availHeight * 0.9);
    const left = (window.screen.availWidth - width) / 2;
    const top = (window.screen.availHeight - height) / 2;

    const win = window.open(
      "",
      "_blank",
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (win) {
      win.document.title = "JSON Viewer";
      win.document.body.style.backgroundColor = "#0d1117";
      win.document.body.style.margin = "0";
      win.document.body.style.color = "#c9d1d9";
      win.document.body.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

      const style = win.document.createElement("style");
      style.textContent = `
        pre { padding: 20px; margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 13px; line-height: 1.5; }
        .hljs-attr { color: #7ee787; }
        .hljs-string { color: #a5d6ff; }
        .hljs-number { color: #79c0ff; }
        .hljs-keyword { color: #ff7b72; }
        .hljs-literal { color: #79c0ff; }
        .hljs-comment { color: #8b949e; }
        .hljs-bullet { color: #79c0ff; }
      `;
      win.document.head.appendChild(style);

      const pre = win.document.createElement("pre");
      if (highlighted) {
        pre.innerHTML = highlighted;
      } else {
        pre.textContent = text;
      }
      win.document.body.appendChild(pre);
    }
  };

  return (
    <div className="relative pt-2">
      <div className="sticky top-12 float-right mr-2 flex gap-2 z-10">
        <button
          onClick={handleExpand}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center gap-1"
          title="Expand in new window"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
          Expand
        </button>
        <button
          onClick={handleCopy}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center gap-1"
        >
          {copied ? (
            <>
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      {highlighted ? (
        <pre
          className="p-3 pr-20 text-xs font-mono whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="p-3 pr-20 text-xs font-mono whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}
    </div>
  );
}

function ExecResponse({ data }) {
  return (
    <div className="p-3 font-mono text-xs space-y-3">
      {(data.stdout && (
        <div>
          <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">
            stdout
          </div>
          <pre className="text-green-400 whitespace-pre-wrap">
            {data.stdout}
          </pre>
        </div>
      )) ||
        (!data.stderr && <div className="text-gray-500 italic">No output</div>)}
      {data.stderr && (
        <div>
          <div className="text-[10px] text-red-400 uppercase font-bold mb-1">
            stderr
          </div>
          <pre className="text-red-300 whitespace-pre-wrap">{data.stderr}</pre>
        </div>
      )}
      {data.error && (
        <div className="bg-red-900/30 border border-red-900/50 p-2 rounded">
          <div className="text-[10px] text-red-400 uppercase font-bold mb-1">
            system error
          </div>
          <div className="text-red-200">{data.error}</div>
        </div>
      )}
    </div>
  );
}

function ResponseView({ result, method, onClear, children }) {
  if (!result) return null;

  return (
    <div className="bg-gray-900 text-gray-100 flex-1 overflow-auto">
      <div className="sticky top-0 px-3 py-2 flex items-center justify-between border-b border-gray-700 bg-gray-900 z-10">
        <div className="flex items-center gap-2">
          {method === "EXEC" ? (
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                result.data?.exit_code === 0
                  ? "bg-green-900 text-green-300"
                  : "bg-red-900 text-red-300"
              }`}
            >
              EXIT {result.data?.exit_code ?? result.status}
            </span>
          ) : (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                result.status >= 200 && result.status < 300
                  ? "bg-green-900 text-green-300"
                  : result.status >= 400
                    ? "bg-red-900 text-red-300"
                    : "bg-gray-700 text-gray-300"
              }`}
            >
              {result.status || "Error"}
            </span>
          )}
          {result.duration && (
            <span className="text-xs text-gray-500">{result.duration}ms</span>
          )}
        </div>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Clear
        </button>
      </div>
      {children}
      {method === "EXEC" ? (
        <ExecResponse data={result.data} />
      ) : (
        <JsonResponse data={result.data} />
      )}
    </div>
  );
}

// Highlighted request body with variable interpolation
function HighlightedBody({ body }) {
  const { variables, functions } = useContext(NotebookContext);
  const [copied, setCopied] = useState(false);

  const text = formatBodyForDisplay(body);
  if (!text) return null;

  // Split text into parts: regular text and {{var}} tokens
  const parts = [];
  let lastIdx = 0;
  const regex = /\{\{([^}]+)\}\}/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "text", content: text.slice(lastIdx, match.index) });
    }
    const expr = match[1].trim();
    const value = resolveExpr(expr, variables, functions);
    parts.push({ type: "var", expr, value, raw: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ type: "text", content: text.slice(lastIdx) });
  }

  // Build copy text with interpolated variables
  const handleCopy = async () => {
    const copyText = text.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
      const value = resolveExpr(expr.trim(), variables, functions);
      if (value === undefined) return match;
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    });
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute top-0 right-0 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-600 dark:text-gray-300 rounded transition-colors flex items-center gap-1"
      >
        {copied ? (
          <>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Copy
          </>
        )}
      </button>
      <pre className="text-xs font-mono whitespace-pre-wrap json-template pr-16">
        {parts.map((p, i) =>
          p.type === "var" ? (
            <VariableBadge key={i} value={p.value} raw={p.raw} />
          ) : (
            <span
              key={i}
              dangerouslySetInnerHTML={{
                __html: highlightJsonTemplate(p.content),
              }}
            />
          ),
        )}
      </pre>
    </div>
  );
}

// Badge colors
const methodColors = {
  GET: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
  POST: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
  PUT: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200",
  DELETE: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200",
  EXEC: "bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200",
};
// Default target color (can be overridden by notebook-specific colors)
const defaultTargetColors = {
  default: "bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200",
};

// Context for notebook-specific target colors
const TargetColorsContext = createContext(defaultTargetColors);

// ============ PUBLIC API ============

// Text description cell
export function Text({ children }) {
  return (
    <div className="py-2 text-sm text-gray-700 dark:text-gray-300">
      {typeof children === "string" ? (
        <InterpolatedText text={children} />
      ) : (
        children
      )}
    </div>
  );
}

// Section with title
export function Section({ title, children }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
        <svg
          className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {expanded && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

Section.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
};

// Request cell - the main building block
// Props: target (variant name), method, path, body, description, saveAs
export function Request({
  target,
  method = "GET",
  path,
  body,
  description,
  saveAs,
}) {
  const { group, variables, setVariable, functions } =
    useContext(NotebookContext);
  const targetColors = useContext(TargetColorsContext);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({}); // keyed by target.id or 'external'
  const [saved, setSaved] = useState({});
  const { addToast } = useToast();

  // Auto-detect external URL
  const isExternal =
    path?.startsWith("http://") || path?.startsWith("https://");

  // Look up target by variant name from the group
  const targetObj = isExternal ? null : group?.targets?.[target] || null;
  const resultKey = isExternal ? "external" : targetObj?.id;
  const result = resultKey ? results[resultKey] : null;

  // Check for unresolved variables in path and body
  const bodyStr = body
    ? typeof body === "string"
      ? body
      : JSON.stringify(body)
    : "";
  const allText = (path || "") + bodyStr;
  const varMatches = allText.match(/\{\{([^}]+)\}\}/g) || [];
  const unresolvedVars = varMatches
    .map((m) => m.slice(2, -2).trim())
    .filter((expr) => resolveExpr(expr, variables, functions) === undefined);
  const hasUnresolvedVars = unresolvedVars.length > 0;

  const isDisabled = isExternal
    ? hasUnresolvedVars
    : !targetObj || targetObj.status !== "connected" || hasUnresolvedVars;

  const handleRun = useCallback(async () => {
    if (!isExternal && !targetObj && method !== "EXEC") return;
    setRunning(true);
    const start = Date.now();
    const key = isExternal ? "external" : targetObj?.id || "exec";

    try {
      const interpolatedPath = interpolate(path || "", variables, functions);
      let fetchUrl, options;

      if (method === "EXEC") {
        if (!targetObj) {
          // Should not happen if UI disabled correctly, but safe guard
          throw new Error("Target required for EXEC");
        }
        fetchUrl = `/api/targets/${targetObj.id}/exec`;
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: interpolatedPath }),
        };
      } else {
        fetchUrl = isExternal
          ? interpolatedPath
          : `/api/targets/${targetObj.id}/proxy${interpolatedPath}`;
        const interpolatedBody = interpolateBody(body, variables, functions);
        // Use POST with X-HTTP-Method-Override for requests with body (browsers don't support GET with body)
        // Only apply override for proxy requests (not external)
        const hasBody = !!interpolatedBody;
        const useOverride = hasBody && !isExternal;
        options = {
          method: useOverride ? "POST" : method,
          headers: useOverride ? { "X-HTTP-Method-Override": method } : {},
        };
        if (interpolatedBody) {
          options.headers["Content-Type"] = "application/json";
          options.body = JSON.stringify(interpolatedBody);
        }
      }

      const res = await fetch(fetchUrl, options);
      const data = await res.json();
      setResults((prev) => ({
        ...prev,
        [key]: { status: res.status, data, duration: Date.now() - start },
      }));

      if (res.status >= 200 && res.status < 300) {
        addToast(`Request succeeded: ${method} ${path}`, "success");
      } else {
        addToast(
          `Request failed (${res.status}): ${data.error || "Unknown error"}`,
          "error",
        );
      }
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [key]: { status: 0, data: err.message, duration: Date.now() - start },
      }));
      addToast(`System error: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }, [
    isExternal,
    targetObj,
    method,
    path,
    body,
    variables,
    functions,
    addToast,
  ]);

  const saveAsArray = saveAs ? (Array.isArray(saveAs) ? saveAs : [saveAs]) : [];

  const handleSave = (varName, varPath) => {
    const value = resolveExpr(varPath, result?.data, functions);

    if (value !== undefined) {
      setVariable(varName, value);
      setSaved((p) => ({ ...p, [varName]: true }));
      setTimeout(
        () =>
          setSaved((p) => {
            const n = { ...p };
            delete n[varName];
            return n;
          }),
        1000,
      );
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2 rounded-t-lg">
        {!isExternal && target && targetColors[target] && (
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium cursor-help ${targetColors[target]}`}
            title={`ID: ${targetObj?.id || "unknown"}\nName: ${targetObj?.name || "unknown"}`}
          >
            {target}
          </span>
        )}
        <span
          className={`text-xs px-2 py-0.5 rounded font-medium ${methodColors[method]}`}
        >
          {method}
        </span>
        <code className="text-sm font-mono text-gray-700 dark:text-gray-300 flex-1 min-w-0">
          <InterpolatedText text={path} />
        </code>
        <div className="flex gap-2">
          {method === "EXEC" && (
            <button
              onClick={() => {
                const interpolatedCommand = interpolate(
                  path || "",
                  variables,
                  functions,
                );
                navigator.clipboard.writeText(interpolatedCommand);
                addToast("Copied command to clipboard", "info");
              }}
              disabled={isDisabled}
              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
              title="Copy Command"
            >
              Copy
            </button>
          )}
          {method !== "EXEC" && (
            <button
              onClick={() => {
                // Use Proxy URL (same as browser request) for clarity and safety
                const url = isExternal
                  ? path
                  : `http://localhost:12808/api/targets/${targetObj.id}/proxy${path}`;
                const interpolatedUrl = interpolate(url, variables, functions);
                const interpolatedBody = interpolateBody(
                  body,
                  variables,
                  functions,
                );

                // For proxy requests with body, use POST + X-HTTP-Method-Override (matches browser behavior)
                const useOverride = interpolatedBody && !isExternal;
                const curlMethod = useOverride ? "POST" : method;
                let curl = `curl -X ${curlMethod} '${interpolatedUrl}'`;

                if (useOverride) {
                  curl += ` -H 'X-HTTP-Method-Override: ${method}'`;
                }
                if (interpolatedBody) {
                  curl += ` -H 'Content-Type: application/json' -d '${JSON.stringify(interpolatedBody)}'`;
                }

                navigator.clipboard.writeText(curl);
                addToast("Copied cURL to clipboard", "info");
              }}
              disabled={isDisabled}
              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
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
            {running ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      {description && (
        <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
          {description}
        </div>
      )}

      {body && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700">
          <HighlightedBody body={body} />
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="max-h-96 flex flex-col">
          <ResponseView
            result={result}
            method={method}
            onClear={() =>
              resultKey &&
              setResults((prev) => {
                const n = { ...prev };
                delete n[resultKey];
                return n;
              })
            }
          >
            {/* Save buttons */}
            {result.status >= 200 &&
              result.status < 300 &&
              saveAsArray.length > 0 && (
                <div className="px-3 py-2 border-b border-gray-700 flex items-center gap-2 bg-gray-800 flex-wrap">
                  {saveAsArray.map(({ varName, path: vp }) => {
                    const available =
                      resolveExpr(vp || "", result.data, functions) !==
                      undefined;
                    return (
                      <button
                        key={varName}
                        onClick={() => handleSave(varName, vp)}
                        disabled={!available || saved[varName]}
                        className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 ${
                          saved[varName]
                            ? "bg-green-700 text-green-200"
                            : available
                              ? "bg-blue-600 text-white hover:bg-blue-700"
                              : "bg-gray-700 text-gray-500 cursor-not-allowed"
                        }`}
                      >
                        {saved[varName] ? (
                          <>
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span className="font-mono">{`{{${varName}}}`}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-gray-400">
                              {vp || "response"}
                            </span>
                            <span className="text-gray-500">→</span>
                            <span className="font-mono">{`{{${varName}}}`}</span>
                          </>
                        )}
                      </button>
                    );
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
          {!targetObj
            ? `No '${target}' target in group`
            : `${target} target: ${targetObj.status}`}
        </div>
      )}

      {hasUnresolvedVars && (
        <div className="px-3 py-2 bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 text-sm flex items-center gap-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            Missing variables:{" "}
            {unresolvedVars.map((v) => `{{${v}}}`).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

// Script cell - execute JavaScript functions with API access
export function Script({ children, description }) {
  const { group, variables, setVariable, functions } =
    useContext(NotebookContext);
  const { addToast } = useToast();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({}); // keyed by group.key
  const [expandWindow, setExpandWindow] = useState(null);
  const [expandContainer, setExpandContainer] = useState(null);

  // Get result for current group
  const groupKey = group?.key;
  const currentResult = groupKey ? results[groupKey] : null;
  const result = currentResult?.data ?? null;
  const error = currentResult?.error ?? null;
  const duration = currentResult?.duration ?? null;

  // Clean up expand window on unmount or when result changes
  useEffect(() => {
    return () => {
      if (expandWindow && !expandWindow.closed) {
        expandWindow.close();
      }
    };
  }, [expandWindow]);

  // Handle expand window being closed by user
  useEffect(() => {
    if (!expandWindow) return;
    const checkClosed = setInterval(() => {
      if (expandWindow.closed) {
        setExpandWindow(null);
        setExpandContainer(null);
      }
    }, 500);
    return () => clearInterval(checkClosed);
  }, [expandWindow]);

  // Open expand window for React component
  const handleExpand = useCallback(() => {
    const width = Math.min(1200, window.screen.availWidth * 0.9);
    const height = Math.min(800, window.screen.availHeight * 0.9);
    const left = (window.screen.availWidth - width) / 2;
    const top = (window.screen.availHeight - height) / 2;

    const win = window.open(
      "",
      "_blank",
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
    );
    if (!win) {
      addToast("Failed to open window (popup blocked?)", "error");
      return;
    }

    win.document.title = description || "Script Result";

    // Copy all stylesheets to new window
    const styleSheets = Array.from(document.styleSheets);
    styleSheets.forEach((sheet) => {
      try {
        if (sheet.href) {
          const link = win.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          win.document.head.appendChild(link);
        } else if (sheet.cssRules) {
          const style = win.document.createElement("style");
          style.textContent = Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n");
          win.document.head.appendChild(style);
        }
      } catch (e) {
        // Cross-origin stylesheets may throw
      }
    });

    // Set up body styles
    win.document.body.style.backgroundColor = "#111827";
    win.document.body.style.margin = "0";
    win.document.body.style.padding = "16px";
    win.document.body.className = "text-gray-100";

    // Create container for React portal
    const container = win.document.createElement("div");
    container.id = "portal-root";
    win.document.body.appendChild(container);

    setExpandWindow(win);
    setExpandContainer(container);
  }, [description, addToast]);

  // Create request helper function
  const request = useCallback(
    async (variant, { method = "GET", path, body } = {}) => {
      const targetObj = group?.targets?.[variant];
      if (!targetObj) throw new Error(`Target "${variant}" not found`);
      if (targetObj.status !== "connected")
        throw new Error(
          `Target "${variant}" not connected (status: ${targetObj.status})`,
        );

      const interpolatedPath = interpolate(path || "", variables, functions);
      const fetchUrl = `/api/targets/${targetObj.id}/proxy${interpolatedPath}`;
      // Use POST with X-HTTP-Method-Override for requests with body (browsers don't support GET with body)
      const interpolatedBody = body
        ? interpolateBody(body, variables, functions)
        : null;
      const options = {
        method: interpolatedBody ? "POST" : method,
        headers: interpolatedBody ? { "X-HTTP-Method-Override": method } : {},
      };

      if (interpolatedBody) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(interpolatedBody);
      }

      const res = await fetch(fetchUrl, options);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(`${method} ${path} failed (${res.status})`);
        err.status = res.status;
        err.response = data;
        throw err;
      }
      return data;
    },
    [group, variables, functions],
  );

  // Execute the script function
  const handleRun = useCallback(async () => {
    if (typeof children !== "function") {
      if (groupKey) {
        setResults((prev) => ({
          ...prev,
          [groupKey]: {
            error: new Error("Script children must be a function"),
            duration: 0,
          },
        }));
      }
      return;
    }

    setRunning(true);
    const start = Date.now();

    try {
      const output = await children({
        request,
        variables,
        setVariable,
        group,
        functions,
      });
      if (groupKey) {
        setResults((prev) => ({
          ...prev,
          [groupKey]: { data: output, duration: Date.now() - start },
        }));
      }
      addToast("Script completed", "success");
    } catch (err) {
      if (groupKey) {
        setResults((prev) => ({
          ...prev,
          [groupKey]: { error: err, duration: Date.now() - start },
        }));
      }
      addToast(`Script error: ${err.message}`, "error");
    } finally {
      setRunning(false);
    }
  }, [
    children,
    request,
    variables,
    setVariable,
    group,
    functions,
    addToast,
    groupKey,
  ]);

  // Check if group is available
  const isDisabled = !group;

  // Check if result is a React element
  const isReactElement =
    result !== null && typeof result === "object" && result.$$typeof;

  // Render result based on type
  const renderResult = () => {
    if (error) {
      return (
        <div className="p-3">
          <div className="flex items-center gap-2 text-red-300 font-medium mb-2">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Error
          </div>
          <pre className="text-sm text-red-200 whitespace-pre-wrap font-mono overflow-auto">
            {error.message}
            {error.response &&
              "\n\nResponse: " + JSON.stringify(error.response, null, 2)}
          </pre>
        </div>
      );
    }

    if (result === null || result === undefined) return null;

    // React element - render directly
    if (isReactElement) {
      return <div className="p-3 text-gray-100">{result}</div>;
    }

    // String - render as text
    if (typeof result === "string") {
      return (
        <pre className="p-3 text-sm font-mono whitespace-pre-wrap">
          {result}
        </pre>
      );
    }

    // Object/Array - render as JSON
    return <JsonResponse data={result} functions={functions} />;
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2 rounded-t-lg">
        <span className="text-xs px-2 py-0.5 rounded font-medium bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200">
          SCRIPT
        </span>
        {description && (
          <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
            {description}
          </span>
        )}
        <button
          onClick={handleRun}
          disabled={running || isDisabled}
          className="px-3 py-1 bg-indigo-500 text-white text-sm font-medium rounded hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>

      {/* Result */}
      {(result !== null || error) && (
        <div className="max-h-96 overflow-auto bg-gray-900 text-gray-100">
          <div className="sticky top-0 px-3 py-2 flex items-center justify-between border-b border-gray-700 bg-gray-900 z-10">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  error
                    ? "bg-red-900 text-red-300"
                    : "bg-green-900 text-green-300"
                }`}
              >
                {error ? "ERROR" : "OK"}
              </span>
              {duration && (
                <span className="text-xs text-gray-500">{duration}ms</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isReactElement && (
                <button
                  onClick={handleExpand}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center gap-1"
                  title="Expand in new window"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    />
                  </svg>
                  Expand
                </button>
              )}
              <button
                onClick={() => {
                  if (groupKey) {
                    setResults((prev) => {
                      const n = { ...prev };
                      delete n[groupKey];
                      return n;
                    });
                  }
                  if (expandWindow) expandWindow.close();
                }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
          {renderResult()}
        </div>
      )}

      {/* Portal for expanded React component */}
      {expandContainer &&
        isReactElement &&
        createPortal(
          <div className="text-gray-100">{result}</div>,
          expandContainer,
        )}

      {isDisabled && (
        <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-sm">
          Select a target group to run this script
        </div>
      )}
    </div>
  );
}

Script.propTypes = {
  children: PropTypes.func.isRequired,
  description: PropTypes.string,
};

// ============ INTERNAL COMPONENTS ============

// Variables dropdown button
function VariablesButton({
  userVariables,
  configVariables,
  setVariable,
  deleteVariable,
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  const userEntries = Object.entries(userVariables || {});
  const configEntries = Object.entries(configVariables || {});
  const hasVariables = userEntries.length > 0 || configEntries.length > 0;

  const handleSave = (name) => {
    try {
      setVariable(name, JSON.parse(editValue));
    } catch {
      setVariable(name, editValue);
    }
    setEditing(null);
  };

  const handleCreateVariable = () => {
    if (!newName.trim()) {
      alert("Variable name cannot be empty");
      return;
    }
    if (userVariables && userVariables[newName]) {
      alert("Variable already exists");
      return;
    }
    if (configVariables && configVariables[newName]) {
      alert(
        "Variable name conflicts with config variable. Use edit to override.",
      );
      return;
    }
    try {
      setVariable(newName, JSON.parse(newValue));
    } catch {
      setVariable(newName, newValue);
    }
    setNewName("");
    setNewValue("");
    setCreating(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 text-sm border rounded flex items-center gap-1.5 ${
          hasVariables
            ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
            : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
        }`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
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
          <div className="absolute right-0 top-full mt-1 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-[80vh] flex flex-col">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Variables
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
              >
                ×
              </button>
            </div>

            <div className="overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
              {/* Config Variables (Read-only) */}
              {configEntries.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    From Config (Read-only)
                  </div>
                  {configEntries.map(([name, value]) => (
                    <div key={name} className="px-3 py-2 opacity-80">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm text-blue-700 dark:text-blue-400">{`{{${name}}}`}</span>
                        {userVariables[name] !== undefined && (
                          <span className="text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 px-1 rounded">
                            Overridden
                          </span>
                        )}
                      </div>
                      <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded px-2 py-1.5 max-h-24 overflow-auto whitespace-pre-wrap">
                        {typeof value === "object"
                          ? JSON.stringify(value, null, 2)
                          : String(value)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}

              {/* Session Variables (Editable) */}
              <div>
                {configEntries.length > 0 && (
                  <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-t border-gray-100 dark:border-gray-700">
                    Session Variables
                  </div>
                )}

                {/* Create New Variable Section */}
                <div className="px-3 py-3 border-b border-gray-100 dark:border-gray-700">
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
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded"
                        autoFocus
                      />
                      <textarea
                        placeholder='Value (e.g., "hello" or {"key": "value"})'
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded"
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setCreating(false);
                            setNewName("");
                            setNewValue("");
                          }}
                          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
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
                  <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center italic">
                    No session variables
                  </div>
                ) : (
                  userEntries.map(([name, value]) => (
                    <div key={name} className="px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm text-blue-700 dark:text-blue-400">{`{{${name}}}`}</span>
                        <div className="flex gap-1">
                          {editing !== name && (
                            <button
                              onClick={() => {
                                setEditing(name);
                                setEditValue(
                                  typeof value === "object"
                                    ? JSON.stringify(value, null, 2)
                                    : String(value),
                                );
                              }}
                              className="p-1 text-gray-400 hover:text-blue-500"
                            >
                              ✎
                            </button>
                          )}
                          <button
                            onClick={() => deleteVariable(name)}
                            className="p-1 text-gray-400 hover:text-red-500"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {editing === name ? (
                        <div className="space-y-2">
                          <textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded"
                            rows={4}
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditing(null)}
                              className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSave(name)}
                              className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded px-2 py-1.5 max-h-24 overflow-auto whitespace-pre-wrap">
                          {typeof value === "object"
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
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
  );
}

// Color mapping for target visuals
const colorMap = {
  red: {
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-200",
    ring: "focus:ring-red-500",
  },
  orange: {
    bg: "bg-orange-100",
    text: "text-orange-800",
    border: "border-orange-200",
    ring: "focus:ring-orange-500",
  },
  yellow: {
    bg: "bg-yellow-100",
    text: "text-yellow-800",
    border: "border-yellow-200",
    ring: "focus:ring-yellow-500",
  },
  green: {
    bg: "bg-green-100",
    text: "text-green-800",
    border: "border-green-200",
    ring: "focus:ring-green-500",
  },
  blue: {
    bg: "bg-blue-100",
    text: "text-blue-800",
    border: "border-blue-200",
    ring: "focus:ring-blue-500",
  },
  indigo: {
    bg: "bg-indigo-100",
    text: "text-indigo-800",
    border: "border-indigo-200",
    ring: "focus:ring-indigo-500",
  },
  purple: {
    bg: "bg-purple-100",
    text: "text-purple-800",
    border: "border-purple-200",
    ring: "focus:ring-purple-500",
  },
  pink: {
    bg: "bg-pink-100",
    text: "text-pink-800",
    border: "border-pink-200",
    ring: "focus:ring-pink-500",
  },
  gray: {
    bg: "bg-gray-100",
    text: "text-gray-800",
    border: "border-gray-200",
    ring: "focus:ring-gray-500",
  },
};

// Console modal for ad-hoc requests
function ConsoleModal({ group, onClose }) {
  const { variables } = useContext(NotebookContext);
  const { groupBy } = useConfig();

  // Find default command from any target in the group
  const defaultCommand = useMemo(() => {
    if (!group) return "GET /";
    const firstTarget = Object.values(group.targets)[0];
    return firstTarget?.metadata?.default_command || "GET /";
  }, [group]);

  const [input, setInput] = useState(defaultCommand);
  const [target, setTarget] = useState("old");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const targetObj = group?.targets?.[target];
  const targetColor = colorMap[targetObj?.visual?.color] || colorMap.gray;

  const handleRun = useCallback(async () => {
    if (!targetObj) return;
    const interpolated = interpolate(input, variables);
    const lines = interpolated.trim().split("\n");
    const match = lines[0]?.match(/^(GET|POST|PUT|DELETE|HEAD)\s+(.+)$/i);
    if (!match) {
      setResult({ status: 0, data: "Invalid format" });
      return;
    }

    const method = match[1].toUpperCase();
    const path = match[2].startsWith("/") ? match[2] : "/" + match[2];
    let body = null;
    if (lines.length > 1) {
      const bodyText = lines.slice(1).join("\n").trim();
      if (bodyText)
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
    }

    setRunning(true);
    const start = Date.now();
    try {
      // Use POST with X-HTTP-Method-Override for requests with body (browsers don't support GET with body)
      const hasBody = body !== null;
      const options = {
        method: hasBody ? "POST" : method,
        headers: hasBody ? { "X-HTTP-Method-Override": method } : {},
      };
      if (hasBody) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      const res = await fetch(
        `/api/targets/${targetObj.id}/proxy${path}`,
        options,
      );
      setResult({
        status: res.status,
        data: await res.json(),
        duration: Date.now() - start,
      });
    } catch (err) {
      setResult({ status: 0, data: err.message, duration: Date.now() - start });
    } finally {
      setRunning(false);
    }
  }, [targetObj, input, variables]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Console
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatGroupLabel(group, groupBy)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ×
          </button>
        </div>

        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600">
                {group &&
                  Object.keys(group.targets)
                    .sort()
                    .map((variant) => {
                      const tObj = group.targets[variant];
                      const tColor =
                        colorMap[tObj?.visual?.color] || colorMap.gray;
                      const isSelected = target === variant;

                      return (
                        <button
                          key={variant}
                          onClick={() => setTarget(variant)}
                          className={`px-3 py-1 text-sm font-medium border-r last:border-r-0 transition-colors ${
                            isSelected
                              ? `${tColor.bg} ${tColor.text} font-bold`
                              : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600"
                          }`}
                        >
                          {variant}
                        </button>
                      );
                    })}
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Ctrl+Enter to run
              </span>
            </div>
            <button
              onClick={handleRun}
              disabled={
                running || !targetObj || targetObj.status !== "connected"
              }
              className={`px-4 py-1.5 text-white text-sm rounded disabled:opacity-50 transition-colors ${
                running || !targetObj || targetObj.status !== "connected"
                  ? "bg-gray-400"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {running ? "Running..." : "Run"}
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleRun();
              if (e.key === "Escape") onClose();
            }}
            className={`w-full h-40 p-3 font-mono text-sm border rounded focus:outline-none focus:ring-2 resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 ${targetColor.ring}`}
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-gray-900 min-h-[200px]">
          {result ? (
            <ResponseView
              result={result}
              method="GET"
              onClear={() => setResult(null)}
            />
          ) : (
            <div className="p-4 text-gray-500 text-sm">
              Response will appear here. Use {"{{var}}"} for variables.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ NOTEBOOK CONTAINER ============

const STORAGE_KEY = "opsnotebook-variables";
const EMPTY_OBJECT = Object.freeze({});

export default function Notebook({
  group,
  children,
  functions: notebookFunctions = {},
  targetColors: customTargetColors = {},
}) {
  const [showConsole, setShowConsole] = useState(false);
  const { groupBy } = useConfig();

  // Merge default and custom target colors
  const mergedTargetColors = useMemo(
    () => ({
      ...defaultTargetColors,
      ...customTargetColors,
    }),
    [customTargetColors],
  );

  // Initialize from localStorage
  const [allVariables, setAllVariables] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allVariables));
  }, [allVariables]);

  // Merge common functions with notebook-specific functions (notebook overrides common)
  const functions = useMemo(
    () => ({ ...commonFunctions, ...notebookFunctions }),
    [notebookFunctions],
  );

  const groupKey = group ? group.key : null;
  const userVariables = useMemo(
    () => (groupKey ? allVariables[groupKey] || EMPTY_OBJECT : EMPTY_OBJECT),
    [allVariables, groupKey],
  );

  // Combine group info (including config variables) with user-defined variables
  const variables = useMemo(
    () => ({
      ...(group?.variables || {}), // Promote group variables to top level
      ...group,
      ...userVariables,
    }),
    [group, userVariables],
  );

  const setVariable = useCallback(
    (name, value) => {
      if (!groupKey) return;
      setAllVariables((prev) => ({
        ...prev,
        [groupKey]: { ...(prev[groupKey] || {}), [name]: value },
      }));
    },
    [groupKey],
  );

  const deleteVariable = useCallback(
    (name) => {
      if (!groupKey) return;
      setAllVariables((prev) => {
        const vars = { ...(prev[groupKey] || {}) };
        delete vars[name];
        return { ...prev, [groupKey]: vars };
      });
    },
    [groupKey],
  );

  return (
    <TargetColorsContext.Provider value={mergedTargetColors}>
      <NotebookContext.Provider
        value={{ group, variables, setVariable, deleteVariable, functions }}
      >
        <div className="h-full flex flex-col bg-white dark:bg-gray-900">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Operations
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {group
                  ? formatGroupLabel(group, groupBy)
                  : "Select a target group"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <VariablesButton
                userVariables={userVariables}
                configVariables={group?.variables}
                setVariable={setVariable}
                deleteVariable={deleteVariable}
              />
              <button
                onClick={() => setShowConsole(true)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5 text-gray-700 dark:text-gray-300"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                Console
              </button>
            </div>
          </div>

          {showConsole && (
            <ConsoleModal group={group} onClose={() => setShowConsole(false)} />
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-4xl mx-auto">{children}</div>
          </div>
        </div>
      </NotebookContext.Provider>
    </TargetColorsContext.Provider>
  );
}
