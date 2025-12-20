import { useState } from "react";
import { Section, Text, Request, Script } from "../components/Notebook";

export const meta = {
  id: "es-migration",
  title: "ElasticSearch Migration",
  description: "Snapshot and SLM policy migration between clusters",
  targetLabelSelector: { type: "elasticsearch" },
  targetColors: {
    old: "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
    new: "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200",
  },
};

// Notebook-specific pipe functions (optional)
// Common functions (keys, first, join, etc.) are available automatically
// Add notebook-specific functions here if needed:
export const functions = {
  mapIndex: (arr) => (Array.isArray(arr) ? arr.map((i) => i.index) : arr),
  csv: (arr) => (Array.isArray(arr) ? arr.join(",") : arr),
  intersectExisting: (snapshotIndices, vars) => {
    if (!Array.isArray(snapshotIndices) || !Array.isArray(vars.existingIndices))
      return [];
    const existingNames = new Set(vars.existingIndices);
    return snapshotIndices.filter((name) => existingNames.has(name));
  },
  closeScript: (indices, vars) => {
    if (!Array.isArray(indices) || indices.length === 0)
      return 'echo "No indices to close"';
    const targetId = vars.targets?.new?.id;
    const chunks = [];
    for (let i = 0; i < indices.length; i += 50) {
      chunks.push(indices.slice(i, i + 50));
    }
    return chunks
      .map((chunk) => {
        const csv = chunk.map(encodeURIComponent).join(",");
        return `curl -s -X POST "http://localhost:12808/api/targets/${targetId}/proxy/${csv}/_close?ignore_unavailable=true"`;
      })
      .join(" && ");
  },
};

// Reusable table components for Script results
function IndicesTable({ data, setVariable, variableName = "selectedIndices" }) {
  const [selected, setSelected] = useState(new Set());
  const [saved, setSaved] = useState(false);

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="text-gray-400 italic">No indices found</div>;
  }
  const filtered = data
    .filter((idx) => !idx.index.startsWith("."))
    .sort((a, b) => a.index.localeCompare(b.index));
  const totalDocs = filtered.reduce(
    (sum, idx) => sum + (parseInt(idx["docs.count"]) || 0),
    0,
  );
  const allSelected = filtered.length > 0 && selected.size === filtered.length;

  const toggleSelect = (indexName) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(indexName)) next.delete(indexName);
      else next.add(indexName);
      return next;
    });
    setSaved(false);
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((idx) => idx.index)));
    }
    setSaved(false);
  };

  const handleSave = () => {
    if (setVariable && selected.size > 0) {
      setVariable(variableName, [...selected].sort());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="relative">
      <div className="mb-2 text-sm text-gray-300">
        Total:{" "}
        <span className="font-semibold text-white">{filtered.length}</span>{" "}
        indices,
        <span className="font-semibold text-white ml-1">
          {totalDocs.toLocaleString()}
        </span>{" "}
        documents
        {selected.size > 0 && (
          <span className="ml-2 text-blue-400">({selected.size} selected)</span>
        )}
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-800 border-b border-gray-700">
            {setVariable && (
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 cursor-pointer"
                />
              </th>
            )}
            <th className="text-left px-3 py-2 font-medium">Index Name</th>
            <th className="text-center px-3 py-2 font-medium">Health</th>
            <th className="text-center px-3 py-2 font-medium">Status</th>
            <th className="text-right px-3 py-2 font-medium">Docs</th>
            <th className="text-right px-3 py-2 font-medium">Size</th>
            <th className="text-right px-3 py-2 font-medium">Pri</th>
            <th className="text-right px-3 py-2 font-medium">Rep</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((idx, i) => (
            <tr
              key={i}
              className={`border-b border-gray-700 hover:bg-gray-800/50 ${selected.has(idx.index) ? "bg-blue-900/20" : ""}`}
              onClick={setVariable ? () => toggleSelect(idx.index) : undefined}
              style={setVariable ? { cursor: "pointer" } : undefined}
            >
              {setVariable && (
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(idx.index)}
                    onChange={() => toggleSelect(idx.index)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 cursor-pointer"
                  />
                </td>
              )}
              <td className="px-3 py-2 font-mono text-xs">{idx.index}</td>
              <td className="px-3 py-2 text-center">
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold inline-block ${
                    idx.health === "green"
                      ? "bg-green-900 text-green-200"
                      : idx.health === "yellow"
                        ? "bg-yellow-900 text-yellow-200"
                        : idx.health === "red"
                          ? "bg-red-900 text-red-200"
                          : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {idx.health}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <span
                  className={`text-xs ${idx.status === "open" ? "text-green-300" : "text-yellow-300"}`}
                >
                  {idx.status}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-300">
                {parseInt(idx["docs.count"] || 0).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-300">
                {idx["store.size"] || "-"}
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-300">
                {idx.pri}
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-300">
                {idx.rep}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Floating save button */}
      {setVariable && selected.size > 0 && (
        <div className="sticky bottom-2 mt-3 flex justify-end">
          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-all ${
              saved
                ? "bg-green-600 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {saved ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Saved to {`{{${variableName}}}`}
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
                Save {selected.size} indices → {`{{${variableName}}}`}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// Helper component to set indicesToClose based on whether selectedIndices is populated
function ComputeIndicesToClose({ variables, setVariable }) {
  const [saved, setSaved] = useState(false);

  const selected = variables?.selectedIndices;
  const hasSelected = selected && selected.length > 0;

  // If selectedIndices are provided, use them (already verified to exist)
  // Otherwise use snapshotIndices filtered to only those that exist in the cluster
  const indicesToUse = hasSelected
    ? selected
    : (variables?.snapshotIndices || []).filter((idx) =>
        (variables?.existingIndices || []).includes(idx),
      );

  const handleSave = () => {
    if (setVariable && indicesToUse.length > 0) {
      setVariable("indicesToClose", indicesToUse);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-gray-300">
        {hasSelected ? (
          <span>
            Using <strong>{selected.length}</strong> selected indices
          </span>
        ) : (
          <span>
            Using <strong>{indicesToUse.length}</strong> snapshot indices (that
            exist in cluster)
          </span>
        )}
      </div>
      <button
        onClick={handleSave}
        className={`px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all ${
          saved
            ? "bg-green-600 text-white"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        {saved ? (
          <>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            Saved to {"{{indicesToClose}}"}
          </>
        ) : (
          <>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            Save {indicesToUse?.length || 0} indices → {"{{indicesToClose}}"}
          </>
        )}
      </button>
    </div>
  );
}

function SnapshotsTable({ data }) {
  if (!data || !data.snapshots || data.snapshots.length === 0) {
    return <div className="text-gray-400 italic">No snapshots found</div>;
  }
  const sorted = [...data.snapshots].sort(
    (a, b) => new Date(b.start_time) - new Date(a.start_time),
  );
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gray-800 border-b border-gray-700">
          <th className="text-left px-3 py-2 font-medium">Snapshot Name</th>
          <th className="text-left px-3 py-2 font-medium">State</th>
          <th className="text-left px-3 py-2 font-medium">Started</th>
          <th className="text-right px-3 py-2 font-medium">Duration (s)</th>
          <th className="text-right px-3 py-2 font-medium">Indices</th>
          <th className="text-right px-3 py-2 font-medium">Shards</th>
          <th className="text-right px-3 py-2 font-medium">Failed</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((snap, idx) => (
          <tr
            key={idx}
            className="border-b border-gray-700 hover:bg-gray-800/50"
          >
            <td className="px-3 py-2 font-mono text-xs">{snap.snapshot}</td>
            <td className="px-3 py-2">
              <span
                className={`px-2 py-1 rounded text-xs font-semibold inline-block ${
                  snap.state === "SUCCESS"
                    ? "bg-green-900 text-green-200"
                    : snap.state === "PARTIAL"
                      ? "bg-yellow-900 text-yellow-200"
                      : snap.state === "FAILED"
                        ? "bg-red-900 text-red-200"
                        : snap.state === "IN_PROGRESS"
                          ? "bg-blue-900 text-blue-200"
                          : "bg-gray-700 text-gray-300"
                }`}
              >
                {snap.state}
              </span>
            </td>
            <td className="px-3 py-2 text-xs text-gray-300">
              {new Date(snap.start_time).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right text-xs text-gray-300">
              {(snap.duration_in_millis / 1000).toFixed(1)}
            </td>
            <td className="px-3 py-2 text-right text-xs text-gray-300">
              {snap.indices.length}
            </td>
            <td className="px-3 py-2 text-right text-xs text-gray-300">
              {snap.shards.successful}/{snap.shards.total}
            </td>
            <td className="px-3 py-2 text-right text-xs">
              {snap.shards.failed > 0 ? (
                <span className="text-red-300">{snap.shards.failed}</span>
              ) : (
                <span className="text-green-300">0</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ESMigrationNotebook() {
  return (
    <div>
      <Section title="1. Target Health">
        <Text>
          Check the health of both targets to ensure they are reachable and
          green.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_cluster/health"
          description="Old target health"
        />
        <Request
          target="new"
          method="GET"
          path="/_cluster/health"
          description="New target health"
        />
      </Section>

      <Section title="2. Review Indices">
        <Text>
          List indices on the old target to identify what needs to be migrated.
          <strong> To migrate specific indices:</strong> select them using
          checkboxes and click "Save".
          <strong> To migrate all indices:</strong> skip selection (leave{" "}
          {"{{selectedIndices}}"} unset).
        </Text>
        <Script description="Old target indices">
          {async ({ request, setVariable }) => {
            const data = await request("old", {
              path: "/_cat/indices?format=json&s=index",
            });
            return <IndicesTable data={data} setVariable={setVariable} />;
          }}
        </Script>
        <Script description="New target indices (before migration)">
          {async ({ request, setVariable }) => {
            const data = await request("new", {
              path: "/_cat/indices?format=json&s=index",
            });
            return <IndicesTable data={data} setVariable={setVariable} />;
          }}
        </Script>
      </Section>

      <Section title="2b. Recent Snapshot Activities">
        <Text>
          Check recent snapshot activities on both targets to understand what
          has been successfully snapshotted or failed.
        </Text>

        <Text>
          Step 2b.1: List all snapshots on old target with their completion
          status (SUCCESS, PARTIAL, FAILED, IN_PROGRESS).
        </Text>
        <Script description="All snapshots on old target">
          {async ({ request }) => {
            const data = await request("old", { path: "/_snapshot/gcs/_all" });
            return <SnapshotsTable data={data} />;
          }}
        </Script>

        <Text>
          Step 2b.2: Get detailed status of snapshots currently in progress on
          old target.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot/_status"
          description="In-progress snapshots on old target"
        />

        <Text>
          Step 2b.3: Check repository status on old target to see storage space
          and connectivity.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot/gcs"
          description="Repository settings and status on old target"
        />

        <Text>
          Step 2b.4: List all snapshots on new target to see what's already been
          migrated.
        </Text>
        <Script description="All snapshots on new target">
          {async ({ request }) => {
            const data = await request("new", { path: "/_snapshot/gcs/_all" });
            return <SnapshotsTable data={data} />;
          }}
        </Script>

        <Text>Step 2b.5: Get in-progress snapshots on new target.</Text>
        <Request
          target="new"
          method="GET"
          path="/_snapshot/_status"
          description="In-progress snapshots on new target"
        />
      </Section>

      <Section title="3. Snapshot Repository Setup">
        <Text>
          Step 3.1: Get snapshot repository settings from the old target.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot"
          description="Get old target snapshot repos"
          saveAs={{ varName: "oldSnapshotSettings", path: "gcs.settings" }}
        />

        <Text>
          Step 3.2: Check if the new target already has the repository
          configured.
        </Text>
        <Request
          target="new"
          method="GET"
          path="/_snapshot"
          description="Get new target snapshot repos"
        />

        <Text>
          Step 3.3: Create the repository on new target using old target's
          settings (skip if already exists).
        </Text>
        <Request
          target="new"
          method="PUT"
          path="/_snapshot/gcs"
          body={{ type: "gcs", settings: "{{oldSnapshotSettings}}" }}
          description="Create snapshot repo on new target"
        />

        <Text>Step 3.4: Verify both targets can access the repository.</Text>
        <Request
          target="old"
          method="POST"
          path="/_snapshot/gcs/_verify"
          description="Verify old target repo access"
        />
        <Request
          target="new"
          method="POST"
          path="/_snapshot/gcs/_verify"
          description="Verify new target repo access"
        />
      </Section>

      <Section title="4. Create Snapshot (Old Target)">
        <Text>Step 4.0: Generate a unique name for this migration run.</Text>
        <Request
          target="old"
          method="EXEC"
          path='echo "migration-$(date +%s)"'
          description="Generate timestamped snapshot name"
          saveAs={{ varName: "snapshot_name", path: "stdout | trim" }}
        />

        <Text>
          {
            "Step 4.1: Create a new snapshot on the old target. This uploads the data to GCS. Indices: {{selectedIndices | csv | default:* (all)}}"
          }
        </Text>
        <Request
          target="old"
          method="PUT"
          path="/_snapshot/gcs/{{snapshot_name}}?wait_for_completion=false"
          body={{
            indices: "{{selectedIndices | csv | default:*}}",
            ignore_unavailable: true,
            include_global_state: true,
          }}
          description="Create snapshot (async)"
        />

        <Text>
          Step 4.2: Monitor snapshot progress. Run this repeatedly until state
          is SUCCESS.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot/gcs/{{snapshot_name}}"
          description="Check snapshot status"
        />

        <Text>Step 4.3: Alternative - check all in-progress snapshots.</Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot/gcs/_current"
          description="Check current snapshots in progress"
        />
      </Section>

      <Section title="5. List Available Snapshots">
        <Text>
          List all snapshots in the repository. Both targets should see the same
          snapshots.
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot/gcs/_all"
          description="List all snapshots (old target view)"
        />
        <Request
          target="new"
          method="GET"
          path="/_snapshot/gcs/_all"
          description="List all snapshots (new target view)"
        />
      </Section>

      <Section title="6. Restore Snapshot (New Target)">
        <Text>
          {
            "Step 6.0 (Optional): Force Refresh Repository. If the new target cannot see the snapshot created by the old target, run these steps to force Elasticsearch to re-scan GCS. This is safe and only deletes the 'link' to the bucket, not the data."
          }
        </Text>
        <Request
          target="new"
          method="DELETE"
          path="/_snapshot/gcs"
          description="Remove repository from new target"
        />
        <Request
          target="new"
          method="PUT"
          path="/_snapshot/gcs"
          body={{ type: "gcs", settings: "{{oldSnapshotSettings}}" }}
          description="Re-register repository (forces re-scan)"
        />

        <Text>
          {
            "Step 6.1: Before restoring, you may need to close indices or delete them if they already exist. Get snapshot details to see which indices will be restored: {{snapshot_name}}"
          }
        </Text>
        <Request
          target="new"
          method="GET"
          path="/_snapshot/gcs/{{snapshot_name}}"
          description="Get snapshot details (indices list)"
          saveAs={{ varName: "snapshotIndices", path: "snapshots.0.indices" }}
        />

        <Text>
          {
            "Step 6.1b: Get currently existing indices (including hidden system indices) from the new target to compare with the snapshot."
          }
        </Text>
        <Request
          target="new"
          method="GET"
          path="/_cat/indices?h=index&format=json&expand_wildcards=all"
          description="Get existing indices on new target (including hidden)"
          saveAs={{ varName: "existingIndices", path: "| mapIndex" }}
        />

        <Script description="Compute indices to close (selectedIndices or snapshotIndices)">
          {({ variables, setVariable }) => (
            <ComputeIndicesToClose
              variables={variables}
              setVariable={setVariable}
            />
          )}
        </Script>

        <Text>
          <strong style={{ color: "red" }}>
            {
              "Step 6.2 (Optional): Close indices for re-restore. This step generates a shell script to close indices in batches to avoid 'too_long_http_line_exception'. It only closes indices that are both in the snapshot and currently exist in the cluster."
            }
          </strong>
        </Text>
        <Request
          target="new"
          method="EXEC"
          path="{{indicesToClose | closeScript}}"
          description="Close indices in batches via shell script"
        />

        <Text>
          {
            "Step 6.3: Restore the snapshot on the new target. This downloads data from GCS. Indices: {{selectedIndices | csv | default:* (all)}}"
          }
        </Text>
        <Request
          target="new"
          method="POST"
          path="/_snapshot/gcs/{{snapshot_name}}/_restore?wait_for_completion=false"
          body={{
            indices: "{{selectedIndices | csv | default:*}}",
            ignore_unavailable: true,
            include_global_state: true,
            include_aliases: true,
          }}
          description="Restore snapshot (async)"
        />

        <Text>Step 6.4: Monitor restore progress. Check recovery status.</Text>
        <Request
          target="new"
          method="GET"
          path="/_cat/recovery?v&active_only=true"
          description="Check active recoveries"
        />

        <Text>Step 6.5: Alternative - check target recovery status.</Text>
        <Request
          target="new"
          method="GET"
          path="/_cluster/health?wait_for_status=yellow&timeout=1s"
          description="Wait for target health"
        />
      </Section>

      <Section title="7. Verify Migration">
        <Text>
          Compare indices between old and new targets after migration.
        </Text>
        <Script description="Old target indices">
          {async ({ request, setVariable }) => {
            const data = await request("old", {
              path: "/_cat/indices?format=json&s=index",
            });
            return <IndicesTable data={data} setVariable={setVariable} />;
          }}
        </Script>
        <Script description="New target indices (after migration)">
          {async ({ request, setVariable }) => {
            const data = await request("new", {
              path: "/_cat/indices?format=json&s=index",
            });
            return <IndicesTable data={data} setVariable={setVariable} />;
          }}
        </Script>

        <Text>Compare document counts for specific indices.</Text>
        <Request
          target="old"
          method="GET"
          path="/_cat/count?v"
          description="Old target total doc count"
        />
        <Request
          target="new"
          method="GET"
          path="/_cat/count?v"
          description="New target total doc count"
        />
      </Section>

      <Section title="7b. Compare Indices (Script)">
        <Text>
          Run this script to see a side-by-side comparison of indices between
          old and new clusters.
        </Text>
        <Script description="Compare indices between old and new clusters">
          {async ({ request }) => {
            const [oldIndices, newIndices] = await Promise.all([
              request("old", {
                path: "/_cat/indices?format=json&h=index,health,status,docs.count,store.size",
              }),
              request("new", {
                path: "/_cat/indices?format=json&h=index,health,status,docs.count,store.size",
              }),
            ]);

            // Filter system indices and create sets
            const oldSet = new Set(
              oldIndices
                .filter((i) => !i.index.startsWith("."))
                .map((i) => i.index),
            );
            const newSet = new Set(
              newIndices
                .filter((i) => !i.index.startsWith("."))
                .map((i) => i.index),
            );

            const onlyInOld = [...oldSet].filter((n) => !newSet.has(n)).sort();
            const onlyInNew = [...newSet].filter((n) => !oldSet.has(n)).sort();
            const inBoth = [...oldSet].filter((n) => newSet.has(n)).sort();

            // Create lookup maps for doc counts
            const oldDocs = Object.fromEntries(
              oldIndices.map((i) => [i.index, i["docs.count"]]),
            );
            const newDocs = Object.fromEntries(
              newIndices.map((i) => [i.index, i["docs.count"]]),
            );

            return (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-red-900/30 rounded p-3">
                    <div className="text-2xl font-bold text-red-300">
                      {onlyInOld.length}
                    </div>
                    <div className="text-xs text-red-400">Only in Old</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3">
                    <div className="text-2xl font-bold text-gray-300">
                      {inBoth.length}
                    </div>
                    <div className="text-xs text-gray-400">In Both</div>
                  </div>
                  <div className="bg-green-900/30 rounded p-3">
                    <div className="text-2xl font-bold text-green-300">
                      {onlyInNew.length}
                    </div>
                    <div className="text-xs text-green-400">Only in New</div>
                  </div>
                </div>

                {/* Diff Table */}
                {(onlyInOld.length > 0 || onlyInNew.length > 0) && (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-800">
                        <th className="px-3 py-2 text-left text-red-400 border-b border-gray-700">
                          Only in Old ({onlyInOld.length})
                        </th>
                        <th className="px-3 py-2 text-left text-green-400 border-b border-gray-700">
                          Only in New ({onlyInNew.length})
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({
                        length: Math.max(onlyInOld.length, onlyInNew.length),
                      }).map((_, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-700/50 hover:bg-gray-800/30"
                        >
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {onlyInOld[i] && (
                              <span className="text-red-300">
                                {onlyInOld[i]}{" "}
                                <span className="text-gray-500">
                                  ({oldDocs[onlyInOld[i]] || 0} docs)
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {onlyInNew[i] && (
                              <span className="text-green-300">
                                {onlyInNew[i]}{" "}
                                <span className="text-gray-500">
                                  ({newDocs[onlyInNew[i]] || 0} docs)
                                </span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Matched indices with doc count comparison */}
                {inBoth.length > 0 &&
                  (() => {
                    // Sort: mismatched (≠) first, then matched (✓)
                    const sortedInBoth = [...inBoth].sort((a, b) => {
                      const aMatch =
                        (parseInt(oldDocs[a]) || 0) ===
                        (parseInt(newDocs[a]) || 0);
                      const bMatch =
                        (parseInt(oldDocs[b]) || 0) ===
                        (parseInt(newDocs[b]) || 0);
                      if (aMatch === bMatch) return a.localeCompare(b);
                      return aMatch ? 1 : -1; // mismatched first
                    });
                    const mismatchCount = sortedInBoth.filter(
                      (idx) =>
                        (parseInt(oldDocs[idx]) || 0) !==
                        (parseInt(newDocs[idx]) || 0),
                    ).length;

                    return (
                      <div className="mt-4">
                        <div className="text-sm text-gray-400 mb-2">
                          Indices in both clusters: {inBoth.length} total
                          {mismatchCount > 0 && (
                            <span className="text-yellow-400 ml-2">
                              ({mismatchCount} mismatched)
                            </span>
                          )}
                        </div>
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-800">
                              <th className="px-3 py-2 text-left border-b border-gray-700">
                                Index
                              </th>
                              <th className="px-3 py-2 text-right border-b border-gray-700">
                                Old Docs
                              </th>
                              <th className="px-3 py-2 text-right border-b border-gray-700">
                                New Docs
                              </th>
                              <th className="px-3 py-2 text-right border-b border-gray-700">
                                Diff
                              </th>
                              <th className="px-3 py-2 text-center border-b border-gray-700">
                                Match
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedInBoth.map((idx, i) => {
                              const oldCount = parseInt(oldDocs[idx]) || 0;
                              const newCount = parseInt(newDocs[idx]) || 0;
                              const diff = newCount - oldCount;
                              const match = oldCount === newCount;
                              return (
                                <tr
                                  key={i}
                                  className="border-b border-gray-700/50 hover:bg-gray-800/30"
                                >
                                  <td className="px-3 py-1.5 font-mono text-xs">
                                    {idx}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-xs text-gray-300">
                                    {oldCount.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-1.5 text-right text-xs text-gray-300">
                                    {newCount.toLocaleString()}
                                  </td>
                                  <td
                                    className={`px-3 py-1.5 text-right text-xs font-mono ${
                                      diff > 0
                                        ? "text-green-400"
                                        : diff < 0
                                          ? "text-red-400"
                                          : "text-gray-500"
                                    }`}
                                  >
                                    {diff > 0 ? "+" : ""}
                                    {diff.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-1.5 text-center">
                                    {match ? (
                                      <span className="text-green-400">✓</span>
                                    ) : (
                                      <span className="text-yellow-400">≠</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
              </div>
            );
          }}
        </Script>
      </Section>

      <Section title="8. Cleanup (Optional)">
        <Text>
          {
            "Delete the migration snapshot {{snapshot_name}} after successful verification (optional)."
          }
        </Text>
        <Request
          target="old"
          method="DELETE"
          path="/_snapshot/gcs/{{snapshot_name}}"
          description="Delete migration snapshot"
        />
      </Section>
    </div>
  );
}
