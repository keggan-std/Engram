// ============================================================================
// Engram MCP Server — Project Scan Service
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import type { ProjectSnapshot, ProjectSnapshotDigest } from "../types.js";
import { scanFileTree, detectLayer, minutesSince, safeJsonParse } from "../utils.js";
import { SNAPSHOT_TTL_MINUTES, MAX_FILE_TREE_DEPTH } from "../constants.js";

/**
 * Manages cached project scanning and snapshot generation.
 */
export class ProjectScanService {
    constructor(private repos: Repositories) { }

    /**
     * Get the project snapshot from cache or perform a fresh scan.
     * Returns null if scanning fails (best-effort).
     */
    getOrRefresh(projectRoot: string, forceRefresh: boolean = false, maxDepth?: number): ProjectSnapshot | null {
        try {
            if (!forceRefresh) {
                const cached = this.repos.snapshot.getCached("project_structure");
                if (cached) {
                    const age = minutesSince(cached.updated_at);
                    if (age < SNAPSHOT_TTL_MINUTES) {
                        return safeJsonParse<ProjectSnapshot>(cached.value, null as unknown as ProjectSnapshot);
                    }
                }
            }

            return this.buildFreshSnapshot(projectRoot, maxDepth);
        } catch {
            return null; // scan is best-effort
        }
    }

    /**
     * A bounded description of the project, for the session-start replay.
     *
     * TASK #68. `engram_session(start, verbosity:"full")` embedded the ENTIRE
     * snapshot, and the snapshot embeds `fileNotes.getAll()` — every note, in
     * full. MEASURED by docs/foundations/measurements/measure-session-cost.mjs:
     * 59,721 tokens against a documented ~730, an 81.8x overstatement, of which
     * project_snapshot alone was 153,194 of 246,118 characters.
     *
     * The growth is the finding, not the absolute number: the payload scales
     * with how much the store remembers, so a memory tool got more expensive to
     * orient in the more it had remembered.
     *
     * TWO KINDS OF WASTE ARE REMOVED HERE.
     *   1. Bulk. The note bodies become a count and a layer histogram. An agent
     *      that wants a note calls get_file_notes, which is the action for it
     *      and which now filters properly (task #103).
     *   2. DUPLICATION. The snapshot carries recent_decisions and
     *      active_conventions, and the session-start response already returns
     *      both as top-level siblings. They were shipped twice, in one object,
     *      to be read once.
     *
     * `scan_project` still returns the full snapshot — it is the action whose
     * entire purpose is that payload, and a caller reaching for it has asked.
     * This is only the auto-replayed copy nobody requested.
     */
    digest(projectRoot: string): ProjectSnapshotDigest | null {
        const snap = this.getOrRefresh(projectRoot);
        if (!snap) return null;

        const notes = snap.file_notes ?? [];
        const byLayer: Record<string, number> = {};
        for (const n of notes) {
            const key = (n.layer as string | null) ?? "unclassified";
            byLayer[key] = (byLayer[key] ?? 0) + 1;
        }

        // Top-level directories only. The full tree is up to
        // MAX_FILE_TREE_ENTRIES paths and answers a question nobody asked at
        // session start; the shape of the repo answers the one they did.
        const topLevel = [...new Set(
            (snap.file_tree ?? [])
                .map(f => f.split("/")[0])
                .filter(Boolean)
        )].sort().slice(0, 40);

        return {
            project_root: snap.project_root,
            total_files: snap.total_files,
            layer_distribution: snap.layer_distribution,
            top_level_entries: topLevel,
            file_notes_count: notes.length,
            file_notes_by_layer: byLayer,
            generated_at: snap.generated_at,
            // Say what was left out and how to get it. A digest that does not
            // name its own omission reads as the whole thing.
            hint: `File notes are summarised, not included. engram_memory(action:"get_file_notes", file_path_filter:"…") for the ones you need, or engram_admin(action:"scan_project") for the full snapshot.`,
        };
    }

    /**
     * Build a fresh project snapshot and cache it.
     */
    buildFreshSnapshot(projectRoot: string, maxDepth?: number): ProjectSnapshot {
        const fileTree = scanFileTree(projectRoot, maxDepth ?? MAX_FILE_TREE_DEPTH);
        const layerDist: Record<string, number> = {};
        for (const f of fileTree) {
            if (f.endsWith("/")) continue;
            const layer = detectLayer(f);
            layerDist[layer] = (layerDist[layer] || 0) + 1;
        }

        const fileNotes = this.repos.fileNotes.getAll();
        const decisions = this.repos.decisions.getActive(20);
        const conventions = this.repos.conventions.getActive();
        const timestamp = new Date().toISOString();

        const snapshot: ProjectSnapshot = {
            project_root: projectRoot,
            file_tree: fileTree,
            total_files: fileTree.filter((f: string) => !f.endsWith("/")).length,
            file_notes: fileNotes,
            recent_decisions: decisions,
            active_conventions: conventions,
            layer_distribution: layerDist,
            generated_at: timestamp,
        };

        // Persist to cache
        this.repos.snapshot.upsert(
            "project_structure",
            JSON.stringify(snapshot),
            timestamp,
            SNAPSHOT_TTL_MINUTES
        );

        return snapshot;
    }
}
