// ============================================================================
// Engram MCP Server — Event Trigger Service
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import type { ScheduledEventRow, TaskRow } from "../types.js";
import { PHASE_MAP } from "../constants.js";

// ─── Phase Detection ─────────────────────────────────────────────────────────

/**
 * Detect the current active phase by finding the lowest phase number
 * among all open tasks with a `phase:N` tag.
 *
 * @returns The phase number (1–6) or null if no phase-tagged tasks are open.
 */
export function detectCurrentPhase(repos: Repositories): number | null {
    try {
        const tasks = repos.tasks.getOpen(50);
        const phaseTasks = tasks
            .filter((t: TaskRow) => {
                const tags: string[] = t.tags ? JSON.parse(t.tags) : [];
                return tags.some((tag: string) => tag.startsWith('phase:'));
            })
            .map((t: TaskRow) => {
                const tags: string[] = JSON.parse(t.tags!);
                const phaseTag = tags.find((tag: string) => tag.startsWith('phase:'))!;
                const phaseNum = PHASE_MAP[phaseTag.split(':')[1]] ?? null;
                return { ...t, phase: phaseNum };
            })
            .filter((t: TaskRow & { phase: number | null }) => t.phase !== null);

        if (phaseTasks.length === 0) return null;
        return Math.min(...phaseTasks.map((t: { phase: number }) => t.phase));
    } catch {
        return null;
    }
}

/**
 * Handles automatic triggering of scheduled events during session start
 * and task completion.
 */
export class EventTriggerService {
    constructor(private repos: Repositories) { }

    /**
     * Trigger all session-start events: next_session, expired datetime, and every_session.
     * Returns the list of triggered events.
     */
    triggerSessionEvents(): ScheduledEventRow[] {
        try {
            const timestamp = new Date().toISOString();

            // Auto-trigger 'next_session' events
            this.repos.events.triggerNextSession(timestamp);

            // Auto-trigger 'datetime' events that have passed
            this.repos.events.triggerExpiredDatetime(timestamp);

            // Auto-trigger 'every_session' recurring events
            this.repos.events.triggerEverySession(timestamp);

            // Fetch all triggered events
            return this.repos.events.getTriggered();
        } catch {
            return []; // scheduled_events table may not exist yet
        }
    }

    /**
     * Trigger task_complete events when a task is marked as done.
     * Also auto-schedules a phase gate event if PM-Full is enabled and
     * all tasks for the completed task's phase are now done.
     */
    triggerTaskCompleteEvents(taskId: number): ScheduledEventRow[] {
        try {
            const timestamp = new Date().toISOString();
            this.repos.events.triggerTaskComplete(taskId, timestamp);
            this.schedulePhaseGateIfComplete(taskId, timestamp);
            return this.repos.events.getTriggered();
        } catch {
            return [];
        }
    }

    /**
     * If the completed task has a phase tag and all tasks for that phase are now
     * done, auto-schedule a phase gate event (next_session, high priority).
     * Only fires when PM-Full is active. Idempotent — won't duplicate if event exists.
     */
    private schedulePhaseGateIfComplete(taskId: number, timestamp: string): void {
        try {
            // PM-Full guard
            if (this.repos.config.get('pm_full_enabled') !== 'true') return;

            const task = this.repos.tasks.getById(taskId);
            if (!task) return;

            const tags: string[] = task.tags ? JSON.parse(task.tags) : [];
            const phaseTag = tags.find((t: string) => t.startsWith('phase:'));
            if (!phaseTag) return;

            const phaseNum = PHASE_MAP[phaseTag.split(':')[1]];
            if (!phaseNum) return;

            // Check if any tasks for this phase are still open
            const remaining = this.repos.tasks.getFiltered({
                tag: phaseTag,
                includeDone: false,
                limit: 1,
            });
            if (remaining.length > 0) return;

            // Idempotency: skip if gate event already exists for this phase
            const gateTag = `phase-gate-${phaseNum}`;
            const existing = this.repos.events.getFiltered({ tag: gateTag, limit: 1 });
            if (existing.length > 0) return;

            this.repos.events.create(null, timestamp, {
                title: `Phase Gate ${phaseNum}→${phaseNum + 1} — Review Required`,
                description: `All ${phaseTag} tasks are complete. Review the Phase Gate ${phaseNum} checklist before proceeding to the next phase.`,
                trigger_type: 'next_session',
                priority: 'high',
                tags: ['pm-framework', gateTag],
            });
        } catch {
            // Best-effort: never block the main task-complete flow
        }
    }

    /**
     * Mid-session check for any triggered events (datetime only).
     */
    checkEvents(): ScheduledEventRow[] {
        try {
            const timestamp = new Date().toISOString();
            this.repos.events.triggerExpiredDatetime(timestamp);
            return this.repos.events.getTriggered();
        } catch {
            return [];
        }
    }
}
