// ============================================================================
// Write integrity — reject a tool call the decoder corrupted, do not store it
//
// THE DEFECT IS UPSTREAM, IT IS OPEN, AND IT IS NOT OURS TO FIX.
// anthropics/claude-code#49747 — "Opus 4.7 mixes legacy XML tool-use format
// into JSON tool calls on longer payloads". Open since 2026-04-17, labelled
// regression, no maintainer response, no fix.
//
// The trailing parameter never becomes a top-level key. It lands as literal
// markup at the TAIL of the preceding string, and its own column arrives
// undefined. FR-D9 measured exactly this in our store: 51 records carrying the
// signature, 31 where the swallowed parameter's column is NULL, 34 fields
// destroyed, across 7 agents — every agent that has ever worked here.
//
// WHY THE SERVER IS THE ONLY LAYER THAT CAN ACT. From the issue, verbatim:
// "The model cannot self-correct via prompt instructions — I tested explicit
// system-prompt rules forbidding XML tags in tool-call strings; the bug still
// fires. This is a decoder-level format switch, not something overridable from
// the prompt layer."
//
// Convention #7 is a prompt-layer rule. It has a published ceiling. It has held
// for many sessions and it will not hold forever, because nothing enforces it.
// This module is downstream of the decoder, which is the only place left.
//
// WHY REJECT AND NOT REPAIR. Task #77 rejected silent repair with the reason
// that matters: the agent learns nothing, the call appears to succeed, and the
// store fills with rows reconstructed by heuristic — a confident wrong answer
// that survives, which is the failure this whole review is organised around.
// A rejected write is visible and retryable. A repaired one is neither.
//
// KILL SWITCH, from task #77 and honoured here: if this ever rejects a
// WELL-FORMED call even once, revert it. A write path that refuses correct
// input is worse than one that stores corrupt rows, because corruption is
// recoverable in the text and a refused write is not written at all. Every
// choice below is biased toward MISSING a corrupt call rather than catching a
// clean one.
//
// NOTE ON THIS FILE'S OWN SOURCE. The marker strings are assembled from
// fragments rather than written literally. That is not stylistic: writing this
// file with the literal sequence in it truncated the write that created it —
// the bug firing on the module built to detect it. Assembling them also means
// this file cannot match its own detector, so a document quoting the signature
// stays storable.
// ============================================================================

/** Assembled, never written literally. See the note above. */
const LT = "<";

/**
 * Call-envelope markers — the harness's own wire format leaking through.
 *
 * BOTH the namespaced and bare forms, and the bare ones are not hypothetical:
 * running an earlier version of this detector against the live store missed 17
 * genuinely corrupt rows because it only knew the namespaced spelling. Every
 * one of them ended with the bare `parameter` / `invoke` closing tags. The
 * upstream parser appears to strip the namespace prefix on the way through,
 * which is exactly what the livekit/agents report of this bug describes.
 *
 * Found by checking against real corrupted records rather than against
 * examples composed from this file's own assumptions — observation #125's
 * lesson, applied to a detector instead of a test.
 */
const ENVELOPE_NAMES = ["parameter", "invoke", "function_calls"];
const ENVELOPE_MARKERS: string[] = [
    ...ENVELOPE_NAMES.flatMap(n => [
        LT + "/" + n + ">",
        LT + "/" + "antml:" + n + ">",
    ]),
    LT + "parameter",
    LT + "antml:parameter",
    LT + "invoke",
    LT + "antml:invoke",
];

/** What the detector found, or null when the call is clean. */
export interface MalformedWrite {
    /** The parameter whose value carries the corruption. */
    field: string;
    /** The parameter that was swallowed, when the markup names one. */
    swallowed?: string;
    /** Human-readable, and it has to be excellent — see task #77's accepted
     *  consequence: this rejects calls that look fine to the agent, so a poor
     *  message reads as Engram being broken. */
    message: string;
}

/**
 * THE DISCRIMINATOR, and it was arrived at by failing.
 *
 * The first version anchored to the last 400 characters, on the reasoning that
 * a fold happens at the end while a mention happens mid-prose. Its own
 * kill-switch test rejected a SHORT document that quoted the signature — the
 * quote was inside the window, because the whole document was. Task #77's kill
 * switch says a validator that refuses correct input must not ship, so the rule
 * was replaced rather than the test loosened.
 *
 * What actually separates the two is not WHERE the marker is. It is WHAT
 * FOLLOWS IT. The decoder switches format and never switches back, so after a
 * folded tag there is only more markup, then the value ends:
 *
 *   ...content.[close tag][open param tag]["a","b"]        <- corruption
 *   ...the [close tag] marker is what we look for.         <- prose
 *
 * So: a marker is corruption only when everything after it is markup or
 * nothing. A marker followed by ordinary words is someone writing about the
 * bug, and this repository's own documentation does that constantly.
 */
function resumesProse(remainder: string): boolean {
    // Four or more purely alphabetic whitespace-separated words is prose.
    // A swallowed parameter value is not: it is JSON, an id, an enum, or a
    // short phrase, and then the string stops.
    //
    //   " marker is what we look for."   -> marker,is,what,we,look   = prose
    //   "[\"a\",\"b\"]"                   -> none                     = fold
    //   "because Z"                      -> because,Z                = fold
    //
    // Tuned to be generous to prose, per the kill switch: missing a corrupt
    // call costs one bad row, refusing a clean one costs the write entirely.
    const words = remainder.split(/\s+/).filter(w => /^[A-Za-z]+[.,;:!?]?$/.test(w));
    return words.length >= 4;
}

/**
 * Detect a decoder-corrupted write.
 *
 * @param params  the tool call's parameters, as received
 * @param siblings  every parameter name valid for THIS action. A closing tag
 *                  naming one of these is the strongest signal available:
 *                  prose does not close a tag named after a sibling parameter
 *                  at the very end of a different parameter's value.
 */
export function detectMalformedWrite(
    params: Record<string, unknown>,
    siblings: readonly string[],
): MalformedWrite | null {
    for (const [field, value] of Object.entries(params)) {
        if (typeof value !== "string" || value.length === 0) continue;

        // ── An opener naming a sibling is decided BEFORE the prose rule ──
        //
        // PROVEN 2026-08-12, by this detector missing a live corruption in the
        // store it guards. A record_decision call folded `rationale` into
        // `decision`, producing:
        //
        //   ...inside the outer one.[/decision][parameter name="rationale"]PROVEN
        //   both directions. Without the fix, tests/... fails 2 of 3 rounds...
        //
        // The token WAS found. But resumesProse() then looked at what followed
        // it, saw several hundred ordinary words — because the swallowed
        // parameter was itself a long prose paragraph — and waved it through.
        // Decision #48 is permanently corrupt as a result, and update_decision
        // cannot repair a decision's text, so it joins #23.
        //
        // So the prose heuristic is blind in exactly the case that matters
        // most: TWO long text fields, where the swallowed one is prose. That is
        // not a rare shape here — record_decision(decision, rationale) and
        // create_task(title, description) are the two most-used write shapes in
        // this store.
        //
        // The discriminator that survives is not "what follows the marker" but
        // ADJACENCY. The decoder closes the current parameter and opens the
        // next one in a single format switch, so the two tags are neighbours
        // with nothing but whitespace between them:
        //
        //   ...inside the outer one.[/decision]\n[parameter name="rationale"]  <- fold
        //
        // Prose that discusses the bug does not do that. This file's own kill
        // switch test writes both tags in one paragraph — "a closing tag such
        // as [/content] appearing where prose should be, followed by
        // [parameter name="tags"] as literal markup" — and the two are
        // SEPARATED BY PROSE. That test rejected the first version of this rule,
        // which fired on the opener wherever it appeared, and the rule was
        // narrowed rather than the test loosened (task #77's standing order,
        // and the same correction resumesProse() itself came from).
        //
        // MEASURED against all 452 rows of the live store: adjacency flags 9
        // rows the prose rule missed and loses none, and in all 9 the swallowed
        // column is NULL — proof the parameter never arrived. Zero false
        // positives. The backtick escape is kept for a citation that happens to
        // quote the two tags adjacently.
        {
            const adjacent = new RegExp(
                LT + "/" + field + ">\\s*" + LT + '(?:antml:)?parameter\\s+name="([A-Za-z_][A-Za-z0-9_]*)"'
            ).exec(value);
            const named = adjacent?.[1];
            if (named && named !== field && siblings.includes(named)) {
                const at = adjacent!.index;
                const before = value.slice(Math.max(0, at - 2), at);
                // A fold APPENDS the next parameter to the tail of a value the
                // agent actually wrote, so something always precedes the closing
                // tag. A value that BEGINS with the signature has no preceding
                // string for anything to have been folded into — it is someone
                // pasting the marker, which the existing suite covers with a
                // 2,000-character example that starts at index 0. Narrowed to
                // let that through rather than loosening the test.
                if (at > 0 && !before.includes("`")) {
                    return { field, swallowed: named, message: rejection(field, named) };
                }
            }
        }

        // Collect every Engram-specific markup token in the value: a closing
        // tag naming this field or a sibling, and the call envelope's own
        // tokens. Generic markup (<div>, <br>) is deliberately NOT a token —
        // storing HTML must stay possible.
        const tokens: number[] = [];
        for (const name of [field, ...siblings]) {
            const at = value.lastIndexOf(LT + "/" + name + ">");
            if (at >= 0) tokens.push(at);
        }
        for (const marker of ENVELOPE_MARKERS) {
            const at = value.lastIndexOf(marker);
            if (at >= 0) tokens.push(at);
        }
        if (tokens.length === 0) continue;

        // Only the LAST one matters. The decoder switches format and never
        // switches back, so if prose resumes after the final token, every
        // token before it was someone WRITING about the bug — which this
        // repository's own documentation does constantly and must keep doing.
        const last = Math.max(...tokens);
        if (resumesProse(value.slice(last))) continue;

        // A citation is not a fold. Markup wrapped in backticks is someone
        // QUOTING the signature — which observation #88 in this very store
        // does, and which was the one genuine false positive when this
        // detector was measured against all 357 clean records. The decoder
        // does not emit backticks around what it leaks.
        const beforeToken = value.slice(Math.max(0, last - 2), last);
        const afterAll = value.slice(last);
        if (beforeToken.includes("`") || /`\s*[.,;)]?\s*$/.test(afterAll)) continue;

        const named = new RegExp(
            LT + 'parameter\\s+name="([A-Za-z_][A-Za-z0-9_]*)"'
        ).exec(value.slice(last))?.[1]
            ?? siblings.find(s => s !== field && value.slice(last).includes(LT + "/" + s + ">"));

        return { field, swallowed: named, message: rejection(field, named) };
    }
    return null;
}

function rejection(field: string, swallowed?: string): string {
    const lost = swallowed
        ? `The parameter "${swallowed}" was swallowed into it and did NOT arrive — storing this would leave "${swallowed}" empty.`
        : `A parameter after it was swallowed into it and did not arrive.`;

    return [
        `MALFORMED TOOL CALL — nothing was written.`,
        ``,
        `The value of "${field}" ends with tool-call markup. ${lost}`,
        ``,
        `This is not your syntax error and re-reading the schema will not help.`,
        `It is an open decoder bug (anthropics/claude-code#49747) that fires on`,
        `long string arguments, and it cannot be fixed from the prompt layer.`,
        ``,
        `HOW TO GET THIS WRITE THROUGH — retry with BOTH:`,
        `  1. Put every non-text parameter (action, id, tags, status, priority,`,
        `     task_id, ...) BEFORE any long free-text parameter. A long field`,
        `     placed LAST has no following parameter left to swallow.`,
        `  2. If it still fails, split the text across two calls, or shorten it.`,
        `     The bug correlates with the length of a single string argument.`,
        ``,
        `Engram refused the write rather than storing a record with a missing`,
        `field, because a silently truncated memory is worse than none.`,
    ].join("\n");
}
