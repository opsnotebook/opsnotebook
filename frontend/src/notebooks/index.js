// Auto-discover notebooks using Vite's glob import
const modules = import.meta.glob("./*.jsx", { eager: true });

export const notebooks = Object.entries(modules)
  .map(([path, module]) => {
    // Skip if no metadata exported
    if (!module.meta) {
      console.warn(
        `Notebook at ${path} is missing 'export const meta = { id, title, description }'`,
      );
      return null;
    }

    return {
      ...module.meta,
      component: module.default,
      functions: module.functions || {},
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.title.localeCompare(b.title));

export function getNotebook(id) {
  return notebooks.find((n) => n.id === id);
}
