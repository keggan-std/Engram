// ============================================================================
// Universal mode must reach every action the four-tool surface advertises.
//
// WHY THIS EXISTS. Universal mode does not read the dispatchers' `z.enum`
// lists. It derives its routing sets from find.ts's MEMORY_CATALOG and
// ADMIN_CATALOG (src/modes/universal.ts:34-35). Those are two independent
// hand-maintained lists of the same thing, and an action added to the enum but
// not to the catalog is advertised by `engram_memory` and returns "unknown
// action" through `engram`. ENGRAM_CONSTITUTION.md:424 states the rule as a
// convention for whoever adds an action (D8-C5); nothing enforced it.
//
// It is now load-bearing for the public surface as well: README's Installation
// section leads with `--install --universal` and justifies that by claiming
// "39 of 39 memory actions and 37 of 37 admin actions reachable". This suite is
// where that claim is checked, so it cannot rot into folklore.
// ============================================================================

import { describe, it, expect } from "vitest";
import { MEMORY_CATALOG, ADMIN_CATALOG } from "../../src/tools/find.js";
import { MEMORY_ACTIONS } from "../../src/tools/dispatcher-memory.js";
import { ADMIN_ACTIONS } from "../../src/tools/dispatcher-admin.js";

// Mirrors src/modes/universal.ts:33 and src/tools/sessions.ts:103. Duplicated
// deliberately: if someone changes the session enum, this literal is the thing
// that has to be updated by hand, which is the point at which they notice.
const SESSION_ACTIONS = ["start", "end", "get_history", "handoff", "acknowledge_handoff"];
const FIND_ACTIONS = ["search", "lint", "discover"];

describe("universal mode / four-tool surface parity", () => {
    it("every advertised engram_memory action is routable in universal mode", () => {
        const catalog = Object.keys(MEMORY_CATALOG);
        const unreachable = MEMORY_ACTIONS.filter(a => !catalog.includes(a));
        expect(unreachable, `advertised by engram_memory but missing from find.ts MEMORY_CATALOG, so unreachable via engram({action}): ${unreachable.join(", ")}`).toEqual([]);
    });

    it("every advertised engram_admin action is routable in universal mode", () => {
        const catalog = Object.keys(ADMIN_CATALOG);
        const unreachable = ADMIN_ACTIONS.filter(a => !catalog.includes(a));
        expect(unreachable, `advertised by engram_admin but missing from find.ts ADMIN_CATALOG: ${unreachable.join(", ")}`).toEqual([]);
    });

    // The reverse direction matters too, and for a different reason: a catalog
    // entry with no dispatcher action is an inert surface — universal mode
    // routes to a dispatcher that then rejects the action, and `discover`
    // advertises it. That is the defect class the whole foundations review
    // exists to catch, so it is asserted rather than assumed harmless.
    it("no catalog entry advertises an action the dispatcher does not implement", () => {
        // Widened to string[]: the enums are literal tuples, and .includes on
        // one rejects an arbitrary key at compile time — which is the very
        // thing being tested at runtime.
        const memNames = MEMORY_ACTIONS as readonly string[];
        const admNames = ADMIN_ACTIONS as readonly string[];
        const memOrphans = Object.keys(MEMORY_CATALOG).filter(a => !memNames.includes(a));
        const admOrphans = Object.keys(ADMIN_CATALOG).filter(a => !admNames.includes(a));
        expect({ memOrphans, admOrphans }).toEqual({ memOrphans: [], admOrphans: [] });
    });

    // Guards the README's stated numbers. Not a vanity assertion: the sentence
    // "39 of 39 and 37 of 37" is in the Installation section as the reason to
    // prefer universal mode, and a silent count change makes the README wrong
    // in the paragraph a new user reads first.
    it("the counts README's Installation section quotes are still the counts", () => {
        expect(MEMORY_ACTIONS.length, "README Installation section says 39 memory actions").toBe(39);
        expect(ADMIN_ACTIONS.length, "README Installation section says 37 admin actions").toBe(37);
    });

    // resolveDispatcher (universal.ts:39-45) tests session -> memory -> admin
    // -> find and returns the FIRST match, so an action name present in two
    // sets is silently resolved by declaration order, not by intent. "search"
    // is such a name today: it is a memory action and a find action, and in
    // universal mode it always means memory search. That is documented in
    // README rather than fixed, because renaming a published action is a
    // breaking change and `discover` already reaches the find behaviour.
    //
    // This test pins the ambiguity set. A NEW collision is a real defect and
    // will fail here rather than being discovered by a confused agent.
    it("the only ambiguous action name is the one README documents", () => {
        const all = [...SESSION_ACTIONS, ...Object.keys(MEMORY_CATALOG), ...Object.keys(ADMIN_CATALOG), ...FIND_ACTIONS];
        const collisions = [...new Set(all.filter((a, i) => all.indexOf(a) !== i))].sort();
        expect(collisions).toEqual(["search"]);
    });
});
