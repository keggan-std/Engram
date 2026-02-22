// ============================================================================
// Engram MCP Server — Event Trigger Service
// ============================================================================

import type { Repositories } from "../repositories/index.js";
import type { ScheduledEventRow } from "../types.js";

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
     */
    triggerTaskCompleteEvents(taskId: number): ScheduledEventRow[] {
        try {
            const timestamp = new Date().toISOString();
            this.repos.events.triggerTaskComplete(taskId, timestamp);
            return this.repos.events.getTriggered();
        } catch {
            return [];
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
