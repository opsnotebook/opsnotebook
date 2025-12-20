import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { groupTargets } from "../utils/grouping";
import { useConfig } from "../App";

// Status indicator dot
function StatusDot({ status }) {
  const colors = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    disconnected: "bg-gray-400",
    error: "bg-red-500",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] || "bg-gray-400"}`}
    />
  );
}

StatusDot.propTypes = {
  status: PropTypes.string.isRequired,
};

// Chevron icon for expand/collapse
function Chevron({ expanded }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

Chevron.propTypes = {
  expanded: PropTypes.bool.isRequired,
};

// Tree node component
function TreeNode({ label, children, defaultExpanded = false, level = 0 }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = children && children.length > 0;

  return (
    <div>
      <button
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`w-full flex items-center gap-1 px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren ? (
          <Chevron expanded={expanded} />
        ) : (
          <span className="w-4" />
        )}
        <span className="text-gray-700 dark:text-gray-300 font-medium">
          {label}
        </span>
      </button>
      {expanded && hasChildren && <div>{children}</div>}
    </div>
  );
}

TreeNode.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node,
  defaultExpanded: PropTypes.bool,
  level: PropTypes.number,
};

// Group leaf node - shows status for all targets in the group
function GroupNode({ group, selected, onSelect, level, labelKey }) {
  const variants = Object.keys(group.targets).sort();
  const label = group.values[labelKey] || "unknown";

  return (
    <button
      onClick={() => onSelect(group)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded transition-colors ${
        selected
          ? "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100"
          : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
      }`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
    >
      <span className="truncate flex-1">{label}</span>
      <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
        {variants.map((variant) => (
          <StatusDot
            key={variant}
            status={group.targets[variant]?.status || "disconnected"}
          />
        ))}
      </span>
    </button>
  );
}

GroupNode.propTypes = {
  group: PropTypes.shape({
    values: PropTypes.object.isRequired,
    targets: PropTypes.object.isRequired,
  }).isRequired,
  selected: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
  level: PropTypes.number.isRequired,
  labelKey: PropTypes.string.isRequired,
};

// Recursively render tree nodes
function renderTree(
  node,
  level,
  selectedKey,
  onSelectGroup,
  labelKey,
  envOrder,
) {
  if (node.groups) {
    // Leaf level - render groups
    return node.groups.map((group) => (
      <GroupNode
        key={group.key}
        group={group}
        selected={selectedKey === group.key}
        onSelect={onSelectGroup}
        level={level}
        labelKey={labelKey}
      />
    ));
  }

  // Sort keys - use envOrder for first level, alphabetical for rest
  const sortedKeys = Object.keys(node).sort((a, b) => {
    if (level === 0) {
      const aIdx = envOrder.indexOf(a);
      const bIdx = envOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
    }
    return a.localeCompare(b);
  });

  return sortedKeys.map((key) => (
    <TreeNode key={key} label={key.toUpperCase()} level={level} defaultExpanded>
      {renderTree(
        node[key],
        level + 1,
        selectedKey,
        onSelectGroup,
        labelKey,
        envOrder,
      )}
    </TreeNode>
  ));
}

// Build nested tree structure dynamically from groups
function buildTree(targets, groupBy) {
  const groups = groupTargets(targets, groupBy);

  // For a groupBy of [a, b, c], we build: a -> b -> [groups labeled by c]
  const nestKeys = groupBy.slice(0, -1); // Keys to nest by
  const labelKey = groupBy[groupBy.length - 1]; // Key for leaf label

  const tree = {};

  groups.forEach((group) => {
    let current = tree;
    for (let i = 0; i < nestKeys.length; i++) {
      const key = group.values[nestKeys[i]] || "unknown";
      if (i === nestKeys.length - 1) {
        // Last nesting level - add groups array
        if (!current[key]) current[key] = { groups: [] };
        current[key].groups.push(group);
      } else {
        // Intermediate level
        if (!current[key]) current[key] = {};
        current = current[key];
      }
    }
    // Handle case where there's only 1 groupBy key (no nesting)
    if (nestKeys.length === 0) {
      if (!tree.groups) tree.groups = [];
      tree.groups.push(group);
    }
  });

  // Sort groups at leaf level
  function sortLeafGroups(node) {
    if (node.groups) {
      node.groups.sort((a, b) => {
        const aVal = a.values[labelKey] || "unknown";
        const bVal = b.values[labelKey] || "unknown";
        return aVal.localeCompare(bVal);
      });
    } else {
      Object.values(node).forEach(sortLeafGroups);
    }
  }
  sortLeafGroups(tree);

  return { tree, labelKey };
}

export default function TreeView({
  targets,
  selectedGroup,
  onSelectGroup,
  envOrder = ["dev", "nonprod", "staging", "demo", "prod"],
}) {
  const { groupBy } = useConfig();
  const { tree, labelKey } = useMemo(
    () => buildTree(targets, groupBy),
    [targets, groupBy],
  );

  const connectedCount = targets.filter((c) => c.status === "connected").length;
  const totalCount = targets.length;

  const selectedGroupKey = selectedGroup ? selectedGroup.key : null;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white">Targets</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {connectedCount}/{totalCount} connected
        </p>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {tree.groups
          ? // Flat list (single groupBy key)
            tree.groups.map((group) => (
              <GroupNode
                key={group.key}
                group={group}
                selected={selectedGroupKey === group.key}
                onSelect={onSelectGroup}
                level={0}
                labelKey={labelKey}
              />
            ))
          : // Nested tree
            renderTree(
              tree,
              0,
              selectedGroupKey,
              onSelectGroup,
              labelKey,
              envOrder,
            )}

        {targets.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 p-2">
            No targets configured
          </p>
        )}
      </div>
    </div>
  );
}

TreeView.propTypes = {
  targets: PropTypes.arrayOf(PropTypes.object).isRequired,
  selectedGroup: PropTypes.object,
  onSelectGroup: PropTypes.func.isRequired,
  envOrder: PropTypes.arrayOf(PropTypes.string),
};
