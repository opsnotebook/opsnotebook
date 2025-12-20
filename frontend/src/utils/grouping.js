// Helper to group targets based on common tags
// Currently supports grouping by 'environment', 'region', 'name'
// and separating by 'variant' (old/new)

export function groupTargets(targets) {
  const groups = {}

  targets.forEach(target => {
    // 1. Extract Grouping Keys (Metadata)
    const env = target.tags?.environment || target.environment || 'unknown'
    const region = target.tags?.region || target.region || 'unknown'
    const name = target.tags?.name || target.name || 'unknown'
    
    // 2. Extract Variant (The differentiator within the group)
    const variant = target.tags?.variant || target.variant || 'default'

    // 3. Create unique group key
    const groupKey = `${env}|${region}|${name}`

    if (!groups[groupKey]) {
      groups[groupKey] = {
        key: groupKey,
        environment: env,
        region: region,
        name: name,
        targets: {},
        variables: {} // Merged variables
      }
    }

    // 4. Add target to group
    groups[groupKey].targets[variant] = target
    
    // 5. Merge variables (for easy access in notebook)
    groups[groupKey].variables = {
      ...groups[groupKey].variables,
      ...(target.variables || {})
    }
  })

  return Object.values(groups)
}

// Find a specific group by looking for matching targets
export function findGroup(groups, params) {
  if (!params) return null
  
  return groups.find(g => 
    g.environment === params.environment &&
    g.region === params.region &&
    g.name === params.name
  ) || null
}

// Convert internal group structure to public Group object
export function toGroup(group) {
  if (!group) return null
  return {
    key: group.key,
    environment: group.environment,
    region: group.region,
    name: group.name,
    targets: group.targets, // Map of variant -> target
    variables: group.variables
  }
}
