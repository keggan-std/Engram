// ============================================================================
// Engram MCP Server — Repository Barrel Export
// ============================================================================

export { SessionsRepo } from "./sessions.repo.js";
export { ChangesRepo } from "./changes.repo.js";
export { DecisionsRepo } from "./decisions.repo.js";
export { FileNotesRepo } from "./file-notes.repo.js";
export { ConventionsRepo } from "./conventions.repo.js";
export { TasksRepo } from "./tasks.repo.js";
export { MilestonesRepo } from "./milestones.repo.js";
export { EventsRepo } from "./events.repo.js";
export { ConfigRepo } from "./config.repo.js";
export { SnapshotRepo } from "./snapshot.repo.js";

import type { Database as DatabaseType } from "better-sqlite3";
import { SessionsRepo } from "./sessions.repo.js";
import { ChangesRepo } from "./changes.repo.js";
import { DecisionsRepo } from "./decisions.repo.js";
import { FileNotesRepo } from "./file-notes.repo.js";
import { ConventionsRepo } from "./conventions.repo.js";
import { TasksRepo } from "./tasks.repo.js";
import { MilestonesRepo } from "./milestones.repo.js";
import { EventsRepo } from "./events.repo.js";
import { ConfigRepo } from "./config.repo.js";
import { SnapshotRepo } from "./snapshot.repo.js";

export interface Repositories {
    sessions: SessionsRepo;
    changes: ChangesRepo;
    decisions: DecisionsRepo;
    fileNotes: FileNotesRepo;
    conventions: ConventionsRepo;
    tasks: TasksRepo;
    milestones: MilestonesRepo;
    events: EventsRepo;
    config: ConfigRepo;
    snapshot: SnapshotRepo;
}

/**
 * Create all repository instances from a single database connection.
 */
export function createRepositories(db: DatabaseType): Repositories {
    return {
        sessions: new SessionsRepo(db),
        changes: new ChangesRepo(db),
        decisions: new DecisionsRepo(db),
        fileNotes: new FileNotesRepo(db),
        conventions: new ConventionsRepo(db),
        tasks: new TasksRepo(db),
        milestones: new MilestonesRepo(db),
        events: new EventsRepo(db),
        config: new ConfigRepo(db),
        snapshot: new SnapshotRepo(db),
    };
}
