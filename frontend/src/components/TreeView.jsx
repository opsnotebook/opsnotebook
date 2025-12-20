import { useState, useMemo } from 'react'
import PropTypes from 'prop-types'
import { groupTargets } from '../utils/grouping'

// Status indicator dot
function StatusDot({ status }) {
  const colors = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-gray-400',
    error: 'bg-red-500',
  }
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-400'}`} />
  )
}

StatusDot.propTypes = {
  status: PropTypes.string.isRequired
}

// Chevron icon for expand/collapse
function Chevron({ expanded }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

Chevron.propTypes = {
  expanded: PropTypes.bool.isRequired
}

// Tree node component
function TreeNode({ label, children, defaultExpanded = false, level = 0 }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const hasChildren = children && children.length > 0

  return (
    <div>
      <button
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`w-full flex items-center gap-1 px-2 py-1 text-left text-sm hover:bg-gray-100 rounded ${
          hasChildren ? 'cursor-pointer' : 'cursor-default'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {hasChildren ? (
          <Chevron expanded={expanded} />
        ) : (
          <span className="w-4" />
        )}
        <span className="text-gray-700 font-medium">{label}</span>
      </button>
      {expanded && hasChildren && (
        <div>{children}</div>
      )}
    </div>
  )
}

TreeNode.propTypes = {
  label: PropTypes.string.isRequired,
  children: PropTypes.node,
  defaultExpanded: PropTypes.bool,
  level: PropTypes.number
}

// Group leaf node - shows status for all targets in the group
function GroupNode({ group, selected, onSelect, level }) {
  const variants = Object.keys(group.targets).sort()

  return (
    <button
      onClick={() => onSelect(group)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded transition-colors ${
        selected ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-100 text-gray-700'
      }`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
    >
      <span className="truncate flex-1">{group.name}</span>
      <span className="flex items-center gap-1 text-xs text-gray-400">
        {variants.map(variant => (
          <StatusDot key={variant} status={group.targets[variant]?.status || 'disconnected'} />
        ))}
      </span>
    </button>
  )
}

GroupNode.propTypes = {
  group: PropTypes.shape({
    name: PropTypes.string.isRequired,
    targets: PropTypes.object.isRequired
  }).isRequired,
  selected: PropTypes.bool.isRequired,
  onSelect: PropTypes.func.isRequired,
  level: PropTypes.number.isRequired
}

// Build tree structure from flat target list
function buildTree(targets, envOrder) {
  // Use generic grouping utility
  const groups = groupTargets(targets)

  // Build tree: environment -> region -> groups
  const tree = {}
  groups.forEach(group => {
    const env = group.environment || 'unknown'
    const region = group.region || 'unknown'

    if (!tree[env]) tree[env] = {} 
    if (!tree[env][region]) tree[env][region] = []
    tree[env][region].push(group)
  })

  // Sort
  const sortedEnvs = Object.keys(tree).sort((a, b) => {
    const aIdx = envOrder.indexOf(a)
    const bIdx = envOrder.indexOf(b)
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    if (aIdx !== -1) return -1
    if (bIdx !== -1) return 1
    return a.localeCompare(b)
  })

  return sortedEnvs.map(env => ({
    env,
    regions: Object.keys(tree[env])
      .sort()
      .map(region => ({
        region,
        groups: tree[env][region].sort((a, b) => a.name.localeCompare(b.name))
      }))
  }))
}

export default function TreeView({ targets, selectedGroup, onSelectGroup, envOrder = ['dev', 'nonprod', 'staging', 'demo', 'prod'] }) {
  const tree = useMemo(() => buildTree(targets, envOrder), [targets, envOrder])

  const connectedCount = targets.filter(c => c.status === 'connected').length
  const totalCount = targets.length

  const selectedGroupKey = selectedGroup ? selectedGroup.key : null

  return (
    <div className="h-full flex flex-col bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Targets</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {connectedCount}/{totalCount} connected
        </p>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {tree.map(({ env, regions }) => (
          <TreeNode key={env} label={env.toUpperCase()} level={0} defaultExpanded>
            {regions.map(({ region, groups }) => (
              <TreeNode key={region} label={region.toUpperCase()} level={1} defaultExpanded>
                {groups.map(group => (
                  <GroupNode
                    key={group.key}
                    group={group}
                    selected={selectedGroupKey === group.key}
                    onSelect={onSelectGroup}
                    level={2}
                  />
                ))}
              </TreeNode>
            ))}
          </TreeNode>
        ))}

        {targets.length === 0 && (
          <p className="text-sm text-gray-500 p-2">No targets configured</p>
        )}
      </div>
    </div>
  )
}

TreeView.propTypes = {
  targets: PropTypes.arrayOf(PropTypes.object).isRequired,
  selectedGroup: PropTypes.object,
  onSelectGroup: PropTypes.func.isRequired,
  envOrder: PropTypes.arrayOf(PropTypes.string)
}
