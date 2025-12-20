/**
 * Simple Kubernetes-style label selector matcher
 * Supports equality-based selectors like: { type: "elasticsearch" }
 * And set-based selectors like: { type: ["elasticsearch", "es"] }
 */

export function matchesSelector(target, selector) {
    if (!selector || Object.keys(selector).length === 0) {
        // No selector = matches all targets
        return true
    }

    const targetLabels = target.labels || {}

    for (const [key, value] of Object.entries(selector)) {
        if (Array.isArray(value)) {
            // Set-based: any value in the array matches
            if (!targetLabels[key] || !value.includes(targetLabels[key])) {
                return false
            }
        } else {
            // Equality-based: exact match
            if (targetLabels[key] !== value) {
                return false
            }
        }
    }

    return true
}

export function filterTargetsBySelector(targets, selector) {
    return targets.filter(t => matchesSelector(t, selector))
}
