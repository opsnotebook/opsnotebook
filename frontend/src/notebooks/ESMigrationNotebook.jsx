import { Section, Text, Request } from "../components/Notebook";

export const meta = {
  id: "es-migration",
  title: "ElasticSearch Migration",
  description: "Snapshot and SLM policy migration between clusters",
};

// Notebook-specific pipe functions (optional)
// Common functions (keys, first, join, etc.) are available automatically
// Add notebook-specific functions here if needed:
export const functions = {
  csv: (arr) => (Array.isArray(arr) ? arr.join(",") : arr),
  filterSystem: (arr) =>
    Array.isArray(arr) ? arr.filter((i) => !i.startsWith(".")) : arr,
  mapIndex: (arr) => (Array.isArray(arr) ? arr.map((i) => i.index) : arr),
  simplifySnapshots: (snapshotsData) => {
    if (!snapshotsData || !snapshotsData.snapshots) return [];
    return snapshotsData.snapshots.map((snap) => ({
      snapshot: snap.snapshot,
      state: snap.state,
      start_time: snap.start_time,
      duration_sec: (snap.duration_in_millis / 1000).toFixed(1),
      indices_count: snap.indices.length,
      shards: `${snap.shards.successful}/${snap.shards.total}`,
      failed_shards: snap.shards.failed,
      failures:
        snap.failures && snap.failures.length > 0 ? snap.failures.length : 0,
    }));
  },
  snapshotsTable: (snapshotsData) => {
    if (
      !snapshotsData ||
      !snapshotsData.snapshots ||
      snapshotsData.snapshots.length === 0
    ) {
      return <div className="p-3 text-gray-400 italic">No snapshots found</div>;
    }

    // Sort by start_time descending (most recent first)
    const sortedSnapshots = [...snapshotsData.snapshots].sort((a, b) => {
      return new Date(b.start_time) - new Date(a.start_time);
    });

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
          {sortedSnapshots.map((snap, idx) => (
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
                {snap.shards.failed > 0 && (
                  <span className="text-red-400 ml-1">
                    ({snap.shards.failed} failed)
                  </span>
                )}
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
  },
  intersectExisting: (snapshotIndices, vars) => {
    if (!Array.isArray(snapshotIndices) || !Array.isArray(vars.existingIndices))
      return [];
    const existingNames = new Set(vars.existingIndices);
    return snapshotIndices.filter((name) => existingNames.has(name));
  },
  shellJoin: (arr) => (Array.isArray(arr) ? arr.join(" ") : arr),
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
        </Text>
        <Request
          target="old"
          method="GET"
          path="/_cat/indices?v&s=index"
          description="Old target indices"
        />
        <Request
          target="new"
          method="GET"
          path="/_cat/indices?v&s=index"
          description="New target indices (before migration)"
        />
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
        <Request
          target="old"
          method="GET"
          path="/_snapshot/gcs/_all"
          description="All snapshots on old target"
          transformOutput="snapshotsTable"
        />

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
        <Request
          target="new"
          method="GET"
          path="/_snapshot/gcs/_all"
          description="All snapshots on new target"
          transformOutput="snapshotsTable"
        />

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
            "Step 4.1: Create a new snapshot on the old target. This uploads the data to GCS. The snapshot name is: {{snapshot_name}}"
          }
        </Text>
        <Request
          target="old"
          method="PUT"
          path="/_snapshot/gcs/{{snapshot_name}}?wait_for_completion=false"
          body={{
            indices: "{{index_list | default:*}}",
            ignore_unavailable: true,
            include_global_state: false,
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
          path="{{snapshotIndices | intersectExisting | closeScript}}"
          description="Close indices in batches via shell script"
        />

        <Text>
          Step 6.3: Restore the snapshot on the new target. This downloads data
          from GCS. Use rename_pattern/rename_replacement to restore to
          different index names if needed.
        </Text>
        <Request
          target="new"
          method="POST"
          path="/_snapshot/gcs/{{snapshot_name}}/_restore?wait_for_completion=false"
          body={{
            indices: "{{index_list | default:*}}",
            ignore_unavailable: true,
            include_global_state: false,
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
        <Request
          target="old"
          method="GET"
          path="/_cat/indices?v&s=index"
          description="Old target indices"
        />
        <Request
          target="new"
          method="GET"
          path="/_cat/indices?v&s=index"
          description="New target indices (after migration)"
        />

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
