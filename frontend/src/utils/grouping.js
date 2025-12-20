// Helper to group targets based on configurable group_by keys

export function groupTargets(
  targets,
  groupBy = ["environment", "region", "name"],
) {
  const groups = {};

  targets.forEach((target) => {
    // Extract grouping values from tags
    const values = {};
    const keyParts = [];
    for (const key of groupBy) {
      const val = target.tags?.[key] || "unknown";
      values[key] = val;
      keyParts.push(val);
    }

    // Extract variant (the differentiator within the group)
    const variant = target.tags?.variant || "default";

    // Create unique group key
    const groupKey = keyParts.join("|");

    if (!groups[groupKey]) {
      groups[groupKey] = {
        key: groupKey,
        values: values,
        targets: {},
        variables: {},
      };
    }

    // Add target to group
    groups[groupKey].targets[variant] = target;

    // Merge variables (for easy access in notebook)
    groups[groupKey].variables = {
      ...groups[groupKey].variables,
      ...(target.variables || {}),
    };
  });

  return Object.values(groups);
}

// Find a specific group by matching values
export function findGroup(
  groups,
  params,
  groupBy = ["environment", "region", "name"],
) {
  if (!params) return null;

  return (
    groups.find((g) => groupBy.every((key) => g.values[key] === params[key])) ||
    null
  );
}

// Convert internal group structure to public Group object
export function toGroup(group) {
  if (!group) return null;
  return {
    key: group.key,
    values: group.values,
    targets: group.targets,
    variables: group.variables,
  };
}
