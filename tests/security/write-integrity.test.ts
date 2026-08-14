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

// ─── The prose heuristic was blind when the SWALLOWED field is prose ──────
//
// PROVEN 2026-08-12 by this detector missing a live corruption in the store it
// guards. A record_decision(decision, rationale) call folded `rationale` into
// `decision`; the token was found, but resumesProse() then looked at what came
// after it, saw several hundred ordinary words — because the swallowed value
// was itself a prose paragraph — and let it through. Decision #48 is
// permanently corrupt as a result, and update_decision cannot repair a
// decision's text, so it joins #23.
//
// This is not an edge case. record_decision(decision, rationale) and
// create_task(title, description) are the two most-used write shapes here, and
// both are two long text fields in a row.
//
// MEASURED against all 452 rows of the live store before shipping: the added
// rule flags 9 rows the old one missed and loses none. All 9 are genuine —
// every one ends with a closing tag followed by an opener naming a sibling, and
// in every one the swallowed column is NULL, which is proof the parameter never
// arrived. Zero false positives, so task #77's kill switch is satisfied.
describe("an opener naming a sibling beats the prose heuristic", () => {
    const DECISION_SIBLINGS = [
        "decision", "rationale", "tags", "affected_files",
        "status", "supersedes", "depends_on", "export_global",
    ];

    // The real shape of decisions #16, #17, #18, #19, #26, #27 and #48.
    const folded = (field: string, swallowed: string, tail: string) =>
        `A real decision sentence that ends normally.${LT}/${field}>\n${LT}parameter name="${swallowed}">${tail}`;

    it("rejects a long prose rationale folded into decision", () => {
        const bad = detectMalformedWrite({
            decision: folded("decision", "rationale",
                "PROVEN both directions. Without the fix the suite fails two of three rounds " +
                "with a duplicate column error, and with it every round passes cleanly, which " +
                "is many more than four ordinary words and is exactly why the old rule missed it."),
        }, DECISION_SIBLINGS);

        expect(bad, "the corruption that produced decision #48 is still not detected").not.toBeNull();
        expect(bad!.field).toBe("decision");
        expect(bad!.swallowed).toBe("rationale");
    });

    it("rejects a JSON examples array folded into rule (conventions #3 and #4)", () => {
        const bad = detectMalformedWrite({
            rule: folded("rule", "examples", '["Supersedes the branch clause of retired convention #1"]'),
        }, ["category", "rule", "examples", "enforced"]);
        expect(bad).not.toBeNull();
        expect(bad!.swallowed).toBe("examples");
    });

    it("KILL SWITCH — a backticked citation of the signature is still storable", () => {
        // Observation #88 quotes the signature in prose. That was the one
        // measured false positive when this detector was built, and the
        // backtick escape must survive the new rule.
        const clean = detectMalformedWrite({
            decision:
                "Convention #7 exists because the decoder emits `" + LT + 'parameter name="rationale">' + "` " +
                "at the tail of the preceding string, and the swallowed column then arrives NULL. " +
                "We reject such writes rather than repairing them.",
        }, DECISION_SIBLINGS);
        expect(clean, "refused a well-formed call that merely quotes the signature").toBeNull();
    });

    it("KILL SWITCH — an opener naming a NON-sibling is prose, not a fold", () => {
        // A document discussing some other tool's parameters must stay
        // storable: the name has to match a parameter of THIS call.
        const clean = detectMalformedWrite({
            decision:
                "The upstream report shows " + LT + 'parameter name="some_other_tool_field">' +
                " appearing in their traces, which matches what we see here and confirms the " +
                "decoder is the layer at fault rather than anything in our own schema.",
        }, DECISION_SIBLINGS);
        expect(clean).toBeNull();
    });

    it("KILL SWITCH — an opener naming the field itself is not a fold", () => {
        // A parameter cannot be swallowed into itself; treating that as
        // corruption would refuse a decision that quotes its own name.
        const clean = detectMalformedWrite({
            decision:
                "When the tool call carries " + LT + 'parameter name="decision">' +
                " twice the second one is the one that survives, which is worth writing down " +
                "here so the next reader does not have to rediscover it from the transcript.",
        }, DECISION_SIBLINGS);
        expect(clean).toBeNull();
    });
});
