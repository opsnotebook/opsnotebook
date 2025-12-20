// Utility functions for group keys

/**
 * Generate a unique key for a group
 * @param {Object} group - The group object with values
 * @param {string[]} groupBy - The keys to use for the key
 * @returns {string|null} Unique key or null if group is falsy
 */
export function getPairKey(group, groupBy = ["environment", "region", "name"]) {
  if (!group?.values) return null;
  return groupBy.map((k) => group.values[k] || "unknown").join("|");
}

/**
 * Parse a pair key back into components
 * @param {string} key - The pair key (e.g., "staging|us|my-cluster")
 * @param {string[]} groupBy - The keys that correspond to each part
 * @returns {Object|null} Parsed object or null if invalid
 */
export function parsePairKey(key, groupBy = ["environment", "region", "name"]) {
  if (!key) return null;
  const parts = key.split("|");
  if (parts.length !== groupBy.length) return null;
  const result = {};
  groupBy.forEach((k, i) => {
    result[k] = parts[i];
  });
  return result;
}
