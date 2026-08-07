// ============================================================================
// Write integrity — the malformed-write rejection, and its kill switch
//
// Task #77 and master plan §7 item 4. The defect is upstream and open:
// anthropics/claude-code#49747 folds a trailing parameter into the tail of the
// preceding string argument, and the swallowed parameter's own column never
// arrives. FR-D9 measured 51 such records in this store, 31 with a field
// outright NULL, across 7 agents.
//
// The issue states that the prompt layer cannot fix it — "a decoder-level
// format switch, not something overridable from the prompt layer" — which is
// why convention #7, a prompt-layer rule, is a mitigation with a ceiling and
// the server is the only layer left.
//
// THE KILL SWITCH IS THE POINT OF THIS FILE. Task #77's accepted consequence:
// "if the validator rejects a well-formed call even once, revert immediately —
// a write path that refuses correct input is worse than one that stores
// corrupt rows, because corruption is recoverable in the text and a refused
// write is not written at all."
//
// So the false-positive tests below are not padding. They are the condition
// under which this feature is allowed to exist, and they deliberately include
// the hardest case: THIS REPOSITORY'S OWN DOCUMENTATION, which quotes the
// corruption signature constantly and must remain storable.
// ============================================================================

import { describe, it, expect } from "vitest";
import { detectMalformedWrite } from "../../src/write-integrity.js";

// Assembled, never written literally — writing the literal sequence into a
// source file truncated the write that created src/write-integrity.ts. The
// bug fires on the files that describe it.
const LT = "<";
const closeTag = (name: string) => LT + "/" + name + ">";
const openParam = (name: string) => LT + `parameter name="${name}"` + ">";

// The parameter names of engram_memory that these cases involve.
const SIBLINGS = [
    "action", "id", "content", "tags", "observation_category",
    "file_path", "decision", "rationale", "title", "description", "priority",
] as const;

const detect = (p: Record<string, unknown>) => detectMalformedWrite(p, SIBLINGS);

describe("catches the corruption that actually happened", () => {
    it("catches a closing tag naming a sibling at the tail of a string", () => {
        // The shape from the upstream issue and from all 51 measured records:
        // the text ends, its own closing tag appears, then the next parameter
        // arrives as markup instead of as a key.
        const bad = detect({
            action: "record_observation",
            content: "A long finding about the store." + closeTag("content") + "\n" + openParam("tags") + '["a","b"]',
        });
        expect(bad).not.toBeNull();
        expect(bad!.field).toBe("content");
        expect(bad!.swallowed).toBe("tags");
    });

    it("names the swallowed parameter, because the message has to be actionable", () => {
        const bad = detect({
            action: "record_decision",
            decision: "We chose X over Y." + closeTag("decision") + openParam("rationale") + "because Z",
        });
        expect(bad!.swallowed).toBe("rationale");
        expect(bad!.message).toContain("rationale");
        // It must say what to DO, or it reads as Engram being broken.
        expect(bad!.message).toMatch(/BEFORE any long free-text parameter/);
        expect(bad!.message).toContain("nothing was written");
    });

    it("catches a leaked call envelope even when it names no sibling", () => {
        const bad = detect({
            action: "create_task",
            description: "Some task text" + closeTag("antml:parameter"),
        });
        expect(bad).not.toBeNull();
        expect(bad!.field).toBe("description");
    });

    it("catches the real historical shape: a bare closing tag on the last field", () => {
        // Reproduced from what task #35's stored description actually looks
        // like in the live store — verbatim shape, not a composed example.
        const bad = detect({
            action: "create_task",
            title: "FR-D3 — fts_file_notes has no triggers",
            description: "Full detail in observations #81 and #82." + closeTag("parameter") + "\n" + closeTag("antml:invoke") + "\n",
        });
        expect(bad).not.toBeNull();
        expect(bad!.field).toBe("description");
    });
});

describe("KILL SWITCH — it must not reject a well-formed call", () => {
    it("passes an ordinary write", () => {
        expect(detect({
            action: "record_observation",
            observation_category: "finding",
            content: "The installer clobbered a git hook it did not write.",
        })).toBeNull();
    });

    it("passes text containing angle brackets, comparisons and generics", () => {
        expect(detect({
            action: "record_decision",
            decision: "Use Map<string, number> where a < b and c > d, and prefer x <= y.",
            rationale: "if (a < b) { return c > d; } — ordinary code in prose.",
        })).toBeNull();
    });

    it("passes HTML and markdown that happens to contain tags", () => {
        expect(detect({
            action: "record_observation",
            content: "The dashboard renders <div class='row'> and </div> around each entry, and <br> between them.",
        })).toBeNull();
    });

    // THE HARDEST CASE, and the one most likely to bite in this repository.
    it("passes a document that QUOTES the corruption signature mid-text", () => {
        const doc = [
            "Convention #7: the transport folds trailing parameters into the",
            "preceding string. The signature is a closing tag such as",
            closeTag("content") + " appearing where prose should be, followed by",
            openParam("tags") + " as literal markup.",
            "",
            "That is why the detector anchors to the TAIL of the value: a",
            "mid-string mention is prose, and this paragraph must remain",
            "storable or the store cannot document its own defects.",
        ].join("\n");
        expect(
            detect({ action: "record_observation", content: doc }),
            "a document explaining the bug was rejected — the store cannot describe its own defects"
        ).toBeNull();
    });

    it("passes when the tag names the field ITSELF rather than a sibling", () => {
        // A self-named closing tag mid-prose is far likelier to be someone
        // writing about the field than a fold, and the fold always names the
        // NEXT parameter. Biased toward missing rather than over-catching.
        expect(detect({
            action: "record_observation",
            content: "The " + closeTag("content") + " marker is what we look for.",
        })).toBeNull();
    });

    it("passes empty, absent and non-string parameters without throwing", () => {
        expect(detect({ action: "get_tasks", content: "", tags: undefined, id: 5, priority: null })).toBeNull();
    });

    it("passes a very long clean payload", () => {
        expect(detect({
            action: "record_observation",
            content: "Sentence about the store. ".repeat(400),
        })).toBeNull();
    });
});

describe("the tail window is what separates prose from corruption", () => {
    it("catches a tag at the very end of a long value", () => {
        const bad = detect({
            action: "record_observation",
            content: "x".repeat(5000) + closeTag("content") + openParam("tags") + "[]",
        });
        expect(bad).not.toBeNull();
    });

    it("ignores the identical tag buried far from the end", () => {
        const clean = detect({
            action: "record_observation",
            content: closeTag("content") + openParam("tags") + "[]" + " and then ".repeat(200) + "x".repeat(2000),
        });
        expect(clean, "a signature quoted early in a long document was rejected").toBeNull();
    });
});
