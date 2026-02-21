# Scheduled Events — Feature Documentation

Engram v1.2.0 introduces **Scheduled Events**, allowing AI agents to defer work to specific trigger conditions. Events fire automatically and are presented to the user for review.

---

## Quick Start

### Schedule for next session
```
User: "Refactor the auth module next session"
Agent → engram_schedule_event({
  title: "Refactor auth module",
  trigger_type: "next_session",
  action_summary: "Refactor auth module as discussed"
})
```

### Schedule for a specific time
```
User: "After 5pm, run the lint cleanup"
Agent → engram_schedule_event({
  title: "Run lint cleanup",
  trigger_type: "datetime",
  trigger_value: "2025-03-15T17:00:00Z"
})
```

### Schedule after a task completes
```
User: "Once task #3 is done, deploy to staging"
Agent → engram_schedule_event({
  title: "Deploy to staging",
  trigger_type: "task_complete",
  trigger_value: "3"
})
```

---

## Tools Reference

### `engram_schedule_event`
Create a deferred event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | ✅ | Short event title |
| `description` | string | | Detailed description |
| `trigger_type` | enum | ✅ | `next_session`, `datetime`, `task_complete`, `manual` |
| `trigger_value` | string | depends | ISO datetime for `datetime`, task ID for `task_complete` |
| `action_summary` | string | | Brief for agent when event fires |
| `action_data` | string | | JSON context for execution |
| `priority` | enum | | `critical` / `high` / `medium` / `low` |
| `requires_approval` | boolean | | User must approve? (default: true) |
| `recurrence` | enum | | `once` / `every_session` / `daily` / `weekly` |
| `tags` | string[] | | Tags |

### `engram_get_scheduled_events`
List events with optional filters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | enum | | Filter by status |
| `trigger_type` | enum | | Filter by trigger |
| `include_done` | boolean | false | Include executed/cancelled |
| `limit` | number | 20 | Max results |

### `engram_update_scheduled_event`
Update event fields: status, trigger, title, priority, etc.

### `engram_acknowledge_event`
After an event fires, the user reviews and approves or declines.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | ✅ | Event ID |
| `approved` | boolean | ✅ | Approve or decline |
| `note` | string | | User's note |

### `engram_check_events`
Mid-session polling. Checks datetime triggers and returns all events needing attention.

---

## How Triggers Work

| Trigger | Fires at... | Checked by... |
|---------|-------------|---------------|
| `next_session` | The very next `start_session` call | `start_session` |
| `datetime` | First `start_session` or `check_events` after the time | `start_session`, `check_events` |
| `task_complete` | When the referenced task is marked `done` | `update_task` |
| `manual` | Only when `check_events` is called | `check_events` |

### Event Lifecycle

```
pending → triggered → acknowledged → executed
                    ↘ cancelled
pending → snoozed → pending (reschedule)
```

---

## Recurrence

| Value | Behavior |
|-------|----------|
| `null` / `"once"` | Single-fire (default) |
| `"every_session"` | Fires on every `start_session` |
| `"daily"` | Fires once per day |
| `"weekly"` | Fires once per week |

When a recurring event is acknowledged, Engram automatically creates the next occurrence.

---

## Limitations

- **MCP servers are passive**: `datetime` events fire on the *next session after* the time, not at the exact moment. Engram is a memory system, not a cron scheduler.
- **No push notifications**: Events are only checked during tool calls (`start_session`, `check_events`, `update_task`).
- **Agent cooperation required**: The agent must call `engram_acknowledge_event` after presenting the event to the user.

---

## Database Schema

```sql
CREATE TABLE scheduled_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'next_session',
  trigger_value TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  triggered_at TEXT,
  acknowledged_at TEXT,
  requires_approval INTEGER DEFAULT 1,
  action_summary TEXT,
  action_data TEXT,
  priority TEXT DEFAULT 'medium',
  tags TEXT,
  recurrence TEXT
);
```

Indexes: `status`, `(trigger_type, status)`  
FTS5: Full-text search on `title`, `description`, `action_summary`
