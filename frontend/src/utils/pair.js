// Utility functions for cluster pairs

/**
 * Generate a unique key for a cluster pair
 * @param {Object} pair - The cluster pair object
 * @returns {string|null} Unique key or null if pair is falsy
 */
export function getPairKey(pair) {
  return pair ? `${pair.environment}|${pair.region}|${pair.name}` : null
}

/**
 * Parse a pair key back into components
 * @param {string} key - The pair key (e.g., "staging|us|my-cluster")
 * @returns {Object|null} Parsed object or null if invalid
 */
export function parsePairKey(key) {
  if (!key) return null
  const parts = key.split('|')
  if (parts.length !== 3) return null
  return { environment: parts[0], region: parts[1], name: parts[2] }
}
