# Notebooks

Notebooks are the primary way end users define workflows in OpsNotebook.

They are implemented as React components under `frontend/src/notebooks/` and are **auto-discovered** by the frontend at build/dev time.

## Auto-discovery mechanism

The frontend uses Vite's glob import to auto-load all notebook modules:

- Implementation: `frontend/src/notebooks/index.js`
- Pattern: `import.meta.glob('./*.jsx', { eager: true })`

This means:

- Any new `*.jsx` file placed directly under `frontend/src/notebooks/` is picked up automatically.
- The notebook list and routing are generated from the module exports.

## Creating a new notebook

1. Create a new file: `frontend/src/notebooks/MyNotebook.jsx`
2. Export `meta` (required)
3. Export a default React component (required)
4. Optionally export `functions` (pipe functions)

### Required exports

`meta` is required and must include:

- `id`: used in the URL (`/notebooks/:id`)
- `title`: shown in the UI
- `description`: shown in the UI (optional but recommended)

### Optional exports in `meta`

- `targetLabelSelector`: Kubernetes-style label selector object (e.g., `{ type: "elasticsearch" }`). Filters which targets are shown in this notebook. If omitted, all targets are visible.
- `targetColors`: Custom color mapping for targets (e.g., `{ old: "bg-orange-100 ...", new: "bg-purple-100 ..." }`). Allows per-notebook styling of target labels.

`functions` is optional. If present, it is merged with the common pipe functions (and can override them).

## Minimal example

```jsx
import { Section, Text, Request } from "../components/Notebook";

export const meta = {
  id: "example",
  title: "Example Notebook",
  description: "A simple GET against both targets",
  targetLabelSelector: { type: "elasticsearch" }, // Optional: filter which targets appear
  targetColors: {
    // Optional: custom colors for targets
    old: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
    new: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
  },
};

export const functions = {
  // customFn: v => v,
};

export default function ExampleNotebook() {
  return (
    <Section title="Health">
      <Text>Check both targets.</Text>
      <Request target="old" method="GET" path="/_cluster/health" />
      <Request target="new" method="GET" path="/_cluster/health" />
    </Section>
  );
}
```

## Notes / constraints

- Notebooks are currently discovered only one level deep (`./*.jsx`). If you want nested folders, adjust the glob in `frontend/src/notebooks/index.js`.
- Keep `meta.id` unique. Duplicate ids will cause ambiguous routing.

## Label Selectors and Target Filtering

The `targetLabelSelector` in a notebook's `meta` object allows you to filter which targets appear when that notebook is active.

### How it works

1. Targets in `config.json` can have a `labels` property (e.g., `{ "type": "elasticsearch" }`).
2. A notebook can declare `targetLabelSelector: { type: "elasticsearch" }` in its meta.
3. Only targets whose labels match the selector are shown in the sidebar and available for use in that notebook.
4. If a notebook omits `targetLabelSelector`, all targets are visible.

### Label Selector Syntax

Supports both **equality-based** and **set-based** selectors (Kubernetes-style):

```javascript
// Equality-based: exact match
targetLabelSelector: { type: "elasticsearch" }

// Set-based: any value in the array matches
targetLabelSelector: { type: ["elasticsearch", "es"] }

// Multiple labels: all must match
targetLabelSelector: { type: "elasticsearch", region: "us-east" }
```

### Example: ElasticSearch Migration Notebook

```jsx
export const meta = {
  id: "es-migration",
  title: "ElasticSearch Migration",
  description: "Snapshot and migration between clusters",
  targetLabelSelector: { type: "elasticsearch" }, // Only show ES targets
  targetColors: {
    old: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
    new: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
  },
};
```

## Notebook-Specific Target Colors

The `targetColors` in a notebook's `meta` allows you to customize how targets are color-coded in that notebook.

### How it works

1. Define `targetColors` as an object mapping target identifiers or keys to Tailwind CSS class strings.
2. When a `<Request>` component displays a target label, it uses the color from this map (if available).
3. Falls back to global colors if a target has no custom color defined for this notebook.

### Example

```jsx
targetColors: {
  old: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
  new: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
  primary: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
}
```

If your targets use variant-based identifiers (e.g., "old", "new"), match those keys. The color will be applied to any `<Request>` that references that target variant.
