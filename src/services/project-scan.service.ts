// ============================================================================
// Engram MCP Server — Project Scan Service
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import type { ProjectSnapshot } from "../types.js";
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
