import { Section, Text, Request } from '../components/Notebook'

export const meta = {
  id: 'es-migration',
  title: 'ElasticSearch Migration',
  description: 'Snapshot and SLM policy migration between clusters'
}

// Notebook-specific pipe functions (optional)
// Common functions (keys, first, join, etc.) are available automatically
// Add notebook-specific functions here if needed:
export const functions = {
  csv: arr => Array.isArray(arr) ? arr.join(',') : arr,
  filterSystem: arr => Array.isArray(arr) ? arr.filter(i => !i.startsWith('.')) : arr,
  mapIndex: arr => Array.isArray(arr) ? arr.map(i => i.index) : arr,
  intersectExisting: (snapshotIndices, vars) => {
    if (!Array.isArray(snapshotIndices) || !Array.isArray(vars.existingIndices)) return []
    const existingNames = new Set(vars.existingIndices)
    return snapshotIndices.filter(name => existingNames.has(name))
  },
  shellJoin: arr => Array.isArray(arr) ? arr.join(' ') : arr,
  closeScript: (indices, vars) => {
    if (!Array.isArray(indices) || indices.length === 0) return 'echo "No indices to close"'
    const targetId = vars.targets?.new?.id
    const chunks = []
    for (let i = 0; i < indices.length; i += 50) {
      chunks.push(indices.slice(i, i + 50))
    }
    return chunks.map(chunk => {
      const csv = chunk.map(encodeURIComponent).join(',')
      return `curl -s -X POST "http://localhost:12808/api/targets/${targetId}/proxy/${csv}/_close?ignore_unavailable=true"`
    }).join(' && ')
  }
}

export default function ESMigrationNotebook() {
  return (
    <div>
      <Section title="1. Target Health">
        <Text>Check the health of both targets to ensure they are reachable and green.</Text>
        <Request target="old" method="GET" path="/_cluster/health" description="Old target health" />
        <Request target="new" method="GET" path="/_cluster/health" description="New target health" />
      </Section>

      <Section title="2. Review Indices">
        <Text>List indices on the old target to identify what needs to be migrated.</Text>
        <Request target="old" method="GET" path="/_cat/indices?v&s=index" description="Old target indices" />
        <Request target="new" method="GET" path="/_cat/indices?v&s=index" description="New target indices (before migration)" />
      </Section>

      <Section title="3. Snapshot Repository Setup">
        <Text>Step 3.1: Get snapshot repository settings from the old target.</Text>
        <Request
          target="old"
          method="GET"
          path="/_snapshot"
          description="Get old target snapshot repos"
          saveAs={{ varName: "oldSnapshotSettings", path: "gcs.settings" }}
        />

        <Text>Step 3.2: Check if the new target already has the repository configured.</Text>
        <Request target="new" method="GET" path="/_snapshot" description="Get new target snapshot repos" />

        <Text>Step 3.3: Create the repository on new target using old target's settings (skip if already exists).</Text>
        <Request
          target="new"
          method="PUT"
          path="/_snapshot/gcs"
          body={{ type: "gcs", settings: "{{oldSnapshotSettings}}" }}
          description="Create snapshot repo on new target"
        />

        <Text>Step 3.4: Verify both targets can access the repository.</Text>
        <Request target="old" method="POST" path="/_snapshot/gcs/_verify" description="Verify old target repo access" />
        <Request target="new" method="POST" path="/_snapshot/gcs/_verify" description="Verify new target repo access" />
      </Section>

      <Section title="4. Create Snapshot (Old Target)">
        <Text>
          Step 4.0: Generate a unique name for this migration run.
        </Text>
        <Request
          target="old"
          method="EXEC"
          path='echo "migration-$(date +%s)"'
          description="Generate timestamped snapshot name"
          saveAs={{ varName: "snapshot_name", path: "stdout | trim" }}
        />

        <Text>
          {"Step 4.1: Create a new snapshot on the old target. This uploads the data to GCS. The snapshot name is: {{snapshot_name}}"}
        </Text>
        <Request
          target="old"
          method="PUT"
          path="/_snapshot/gcs/{{snapshot_name}}?wait_for_completion=false"
          body={{
            indices: "{{index_list | default:*}}",
            ignore_unavailable: true,
            include_global_state: false
          }}
          description="Create snapshot (async)"
        />

        <Text>Step 4.2: Monitor snapshot progress. Run this repeatedly until state is SUCCESS.</Text>
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
        <Text>List all snapshots in the repository. Both targets should see the same snapshots.</Text>
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
          {"Step 6.0 (Optional): Force Refresh Repository. If the new target cannot see the snapshot created by the old target, run these steps to force Elasticsearch to re-scan GCS. This is safe and only deletes the 'link' to the bucket, not the data."}
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
          {"Step 6.1: Before restoring, you may need to close indices or delete them if they already exist. Get snapshot details to see which indices will be restored: {{snapshot_name}}"}
        </Text>
        <Request
          target="new"
          method="GET"
          path="/_snapshot/gcs/{{snapshot_name}}"
          description="Get snapshot details (indices list)"
          saveAs={{ varName: "snapshotIndices", path: "snapshots.0.indices" }}
        />

        <Text>
          {"Step 6.1b: Get currently existing indices (including hidden system indices) from the new target to compare with the snapshot."}
        </Text>
        <Request
          target="new"
          method="GET"
          path="/_cat/indices?h=index&format=json&expand_wildcards=all"
          description="Get existing indices on new target (including hidden)"
          saveAs={{ varName: "existingIndices", path: "| mapIndex" }}
        />

        <Text>
          <strong style={{ color: 'red' }}>
            {"Step 6.2 (Optional): Close indices for re-restore. This step generates a shell script to close indices in batches to avoid 'too_long_http_line_exception'. It only closes indices that are both in the snapshot and currently exist in the cluster."}
          </strong>
        </Text>
        <Request
          target="new"
          method="EXEC"
          path="{{snapshotIndices | intersectExisting | closeScript}}"
          description="Close indices in batches via shell script"
        />

        <Text>
          Step 6.3: Restore the snapshot on the new target. This downloads data from GCS.
          Use rename_pattern/rename_replacement to restore to different index names if needed.
        </Text>
        <Request
          target="new"
          method="POST"
          path="/_snapshot/gcs/{{snapshot_name}}/_restore?wait_for_completion=false"
          body={{
            indices: "{{index_list | default:*}}",
            ignore_unavailable: true,
            include_global_state: false,
            include_aliases: true
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
        <Text>Compare indices between old and new targets after migration.</Text>
        <Request target="old" method="GET" path="/_cat/indices?v&s=index" description="Old target indices" />
        <Request target="new" method="GET" path="/_cat/indices?v&s=index" description="New target indices (after migration)" />

        <Text>Compare document counts for specific indices.</Text>
        <Request target="old" method="GET" path="/_cat/count?v" description="Old target total doc count" />
        <Request target="new" method="GET" path="/_cat/count?v" description="New target total doc count" />
      </Section>

      <Section title="8. Cleanup (Optional)">
        <Text>{"Delete the migration snapshot {{snapshot_name}} after successful verification (optional)."}</Text>
        <Request
          target="old"
          method="DELETE"
          path="/_snapshot/gcs/{{snapshot_name}}"
          description="Delete migration snapshot"
        />
      </Section>
    </div>
  )
}
