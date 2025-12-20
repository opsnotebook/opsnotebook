// Common pipe functions available to all notebooks
// Usage in templates: {{myVar | keys}}, {{myVar | first}}, {{arr | join}}

export const commonFunctions = {
  // Object functions
  keys: (obj) => (obj ? Object.keys(obj) : []),
  values: (obj) => (obj ? Object.values(obj) : []),
  entries: (obj) => (obj ? Object.entries(obj) : []),

  // Array functions
  first: (arr) => (Array.isArray(arr) ? arr[0] : arr),
  last: (arr) => (Array.isArray(arr) ? arr[arr.length - 1] : arr),
  length: (arr) =>
    Array.isArray(arr) ? arr.length : typeof arr === "string" ? arr.length : 0,
  join: (arr) => (Array.isArray(arr) ? arr.join(", ") : arr),
  sort: (arr) => (Array.isArray(arr) ? [...arr].sort() : arr),
  reverse: (arr) => (Array.isArray(arr) ? [...arr].reverse() : arr),
  unique: (arr) => (Array.isArray(arr) ? [...new Set(arr)] : arr),

  // String functions
  upper: (str) => String(str).toUpperCase(),
  lower: (str) => String(str).toLowerCase(),
  trim: (str) => String(str).trim(),

  // Formatting
  json: (val) => JSON.stringify(val, null, 2),
  compact: (val) => JSON.stringify(val),
  parse: (val) => {
    if (typeof val !== "string") return val;
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  },
};
