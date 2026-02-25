// ============================================================================
// Engram MCP Server - Project Report Tool
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRepos } from "../database.js";
import { TOOL_PREFIX } from "../constants.js";
import { success } from "../response.js";
import { truncate } from "../utils.js";
import type { TaskRow, DecisionRow, ConventionRow, MilestoneRow } from "../types.js";

const ALL_SECTIONS = ["tasks", "decisions", "changes", "conventions", "milestones"] as const;
type Section = typeof ALL_SECTIONS[number];

export function registerReportTools(server: McpServer): void {
  server.registerTool(
    `${TOOL_PREFIX}_generate_report`,
    {
      title: "Generate Project Report",
      description: "Generate a Markdown report summarizing the current project state: open tasks, active decisions, recent changes, active conventions, and milestones.",
      inputSchema: {
        title: z.string().optional().describe("Custom report title"),
        include_sections: z.array(
          z.enum(["tasks", "decisions", "changes", "conventions", "milestones"])
        ).optional().describe("Sections to include (defaults to all)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ title, include_sections }) => {
      const repos = getRepos();
      const generatedAt = new Date().toISOString();
      const sections: Section[] = (include_sections as Section[] | undefined) ?? [...ALL_SECTIONS];
      const reportTitle = title ?? "Engram Project Report";

      const lines: string[] = [];
      lines.push(`# ${reportTitle}`);
      lines.push(`*Generated: ${generatedAt}*`);
      lines.push("");

      // Open Tasks
      if (sections.includes("tasks")) {
        const tasks: TaskRow[] = repos.tasks.getOpen(50);
        lines.push("## Open Tasks");
        lines.push("");
        if (tasks.length === 0) {
          lines.push("*No open tasks.*");
        } else {
          lines.push("| ID | Title | Priority | Status |");
          lines.push("|---|---|---|---|");
          for (const t of tasks) {
            lines.push(`| ${t.id} | ${truncate(t.title, 60)} | ${t.priority} | ${t.status} |`);
          }
        }
        lines.push("");
      }

      // Active Decisions
      if (sections.includes("decisions")) {
        const decisions: DecisionRow[] = repos.decisions.getActive(100);
        lines.push("## Active Decisions");
        lines.push("");
        if (decisions.length === 0) {
          lines.push("*No active decisions.*");
        } else {
          const groups: Record<string, DecisionRow[]> = {};
          for (const d of decisions) {
            let groupKey = "General";
            if (d.tags) {
              try {
                const parsed = JSON.parse(d.tags) as string[];
                if (parsed.length > 0) groupKey = parsed[0];
              } catch { /* ignore */ }
            }
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(d);
          }
          for (const [groupName, groupDecisions] of Object.entries(groups)) {
            lines.push(`### ${groupName}`);
            lines.push("");
            for (const d of groupDecisions) {
              lines.push(`**Decision #${d.id}** — ${truncate(d.decision, 100)}`);
              if (d.rationale) {
                lines.push(`> ${truncate(d.rationale, 200)}`);
              }
              lines.push("");
            }
          }
        }
        lines.push("");
      }

      // Recent Changes (last 7 days)
      if (sections.includes("changes")) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const recentChanges = repos.changes.getSince(sevenDaysAgo);
        lines.push("## Recent Changes (last 7 days)");
        lines.push("");
        if (recentChanges.length === 0) {
          lines.push("*No changes recorded in the last 7 days.*");
        } else {
          for (const c of recentChanges.slice(0, 50)) {
            const filePart = "`" + c.file_path + "`";
            lines.push(`- ${filePart} — ${truncate(c.description, 100)}`);
          }
          if (recentChanges.length > 50) {
            lines.push(`- ...and ${recentChanges.length - 50} more change(s)`);
          }
        }
        lines.push("");
      }

      // Active Conventions
      if (sections.includes("conventions")) {
        const conventions: ConventionRow[] = repos.conventions.getActive();
        lines.push("## Active Conventions");
        lines.push("");
        if (conventions.length === 0) {
          lines.push("*No active conventions.*");
        } else {
          const convGroups: Record<string, ConventionRow[]> = {};
          for (const c of conventions) {
            if (!convGroups[c.category]) convGroups[c.category] = [];
            convGroups[c.category].push(c);
          }
          for (const [cat, convs] of Object.entries(convGroups)) {
            lines.push(`### ${cat}`);
            lines.push("");
            for (const c of convs) {
              lines.push(`- ${truncate(c.rule, 120)}`);
            }
            lines.push("");
          }
        }
        lines.push("");
      }

      // Milestones
      if (sections.includes("milestones")) {
        const milestones: MilestoneRow[] = repos.milestones.getAll(50);
        lines.push("## Milestones");
        lines.push("");
        if (milestones.length === 0) {
          lines.push("*No milestones recorded.*");
        } else {
          for (const m of milestones) {
            const version = m.version ? ` (v${m.version})` : "";
            const date = m.timestamp.slice(0, 10);
            lines.push(`- **${truncate(m.title, 80)}**${version} — ${date}`);
          }
        }
        lines.push("");
      }

      const report = lines.join("\n");

      return success({
        report,
        sections_included: sections,
        generated_at: generatedAt,
      });
    }
  );
}
