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

### Optional exports

`functions` is optional. If present, it is merged with the common pipe functions (and can override them).

## Minimal example

```jsx
import { Section, Text, Request } from '../components/Notebook'

export const meta = {
  id: 'example',
  title: 'Example Notebook',
  description: 'A simple GET against both targets',
}

export const functions = {
  // customFn: v => v,
}

export default function ExampleNotebook() {
  return (
    <Section title="Health">
      <Text>Check both targets.</Text>
      <Request target="old" method="GET" path="/_cluster/health" />
      <Request target="new" method="GET" path="/_cluster/health" />
    </Section>
  )
}
```

## Notes / constraints

- Notebooks are currently discovered only one level deep (`./*.jsx`). If you want nested folders, adjust the glob in `frontend/src/notebooks/index.js`.
- Keep `meta.id` unique. Duplicate ids will cause ambiguous routing.

