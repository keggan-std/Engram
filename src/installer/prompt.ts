// ============================================================================
// Engram MCP Server — Interactive selection
//
// The installer asked every question as "type a number and press Enter". That
// works, and it is the wrong default for a first-run experience: it gives no
// feedback about what is currently selected, it accepts 7 for a 5-item list and
// only complains afterwards, and it cannot show which option is recommended
// without spending a line of prose on it.
//
// `select()` drives an arrow-key menu and keeps number keys working, so nothing
// a user already knows how to do stops working.
//
// THREE THINGS IT MUST NOT DO, each of which is a way a CLI ruins a terminal:
//
//  - Leave the tty in raw mode. Every exit path goes through cleanup(), and
//    SIGINT is handled rather than left to kill the process mid-raw-mode.
//  - Hide the cursor without showing it again. Same cleanup path.
//  - Require a tty. Without one it falls back to the numbered prompt, and with
//    no stdin at all it returns the default rather than hanging forever — the
//    installer runs in CI, and a prompt that blocks there is a hung build.
// ============================================================================

import readline from "readline";

export interface SelectOption<T> {
    label: string;
    /** Rendered dim after the label — the "why you would pick this" line. */
    hint?: string;
    value: T;
    /** Marked as the recommended option and pre-selected. */
    recommended?: boolean;
}

export interface SelectResult<T> {
    value: T;
    /** True when the user cancelled with Esc, q or Ctrl-C. */
    cancelled: boolean;
}

function canRaw(): boolean {
    return !!(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === "function");
}

const ESC = "\x1b[";
const dim = (t: string) => (process.stdout.isTTY ? `\x1b[2m${t}\x1b[0m` : t);
const cyan = (t: string) => (process.stdout.isTTY ? `\x1b[36m${t}\x1b[0m` : t);
const bold = (t: string) => (process.stdout.isTTY ? `\x1b[1m${t}\x1b[0m` : t);

/**
 * Arrow-key menu with a numbered fallback.
 *
 * Returns the option's value, plus whether the user cancelled — those are two
 * different facts and collapsing them is how "user pressed Esc" became
 * "installation failed" in tools that get this wrong.
 */
export async function select<T>(title: string, options: SelectOption<T>[]): Promise<SelectResult<T>> {
    if (options.length === 0) throw new Error("select() called with no options");

    const startIdx = Math.max(0, options.findIndex(o => o.recommended));

    if (!canRaw()) return fallback(title, options, startIdx);

    return new Promise<SelectResult<T>>(resolve => {
        let idx = startIdx;
        let done = false;

        const stdin = process.stdin;
        const out = process.stdout;

        readline.emitKeypressEvents(stdin);
        stdin.setRawMode(true);
        stdin.resume();
        out.write(`${ESC}?25l`); // hide cursor

        const render = (first: boolean) => {
            if (!first) out.write(`${ESC}${options.length + 1}A`); // back to the title line
            out.write(`  ${bold(title)}${ESC}K\n`);
            options.forEach((o, i) => {
                const sel = i === idx;
                const marker = sel ? cyan("❯") : " ";
                const label = sel ? cyan(o.label) : o.label;
                const rec = o.recommended ? dim("  (recommended)") : "";
                const hint = o.hint ? dim(`  — ${o.hint}`) : "";
                out.write(`  ${marker} ${i + 1}. ${label}${rec}${hint}${ESC}K\n`);
            });
        };

        const cleanup = () => {
            if (done) return;
            done = true;
            stdin.removeListener("keypress", onKey);
            if (stdin.setRawMode) stdin.setRawMode(false);
            stdin.pause();
            out.write(`${ESC}?25h`); // show cursor
        };

        const finish = (cancelled: boolean) => {
            cleanup();
            out.write("\n");
            resolve({ value: options[idx].value, cancelled });
        };

        const onKey = (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
            if (done) return;
            const name = key?.name;
            if (key?.ctrl && name === "c") {
                // Restore the terminal BEFORE dying. A Ctrl-C that leaves raw
                // mode on makes the user's next shell unusable, and they will
                // blame the last thing they ran, correctly.
                cleanup();
                out.write("\n");
                process.kill(process.pid, "SIGINT");
                return;
            }
            if (name === "up" || name === "k") { idx = (idx - 1 + options.length) % options.length; render(false); return; }
            if (name === "down" || name === "j") { idx = (idx + 1) % options.length; render(false); return; }
            if (name === "home") { idx = 0; render(false); return; }
            if (name === "end") { idx = options.length - 1; render(false); return; }
            if (name === "return" || name === "enter") { finish(false); return; }
            if (name === "escape" || name === "q") { finish(true); return; }
            // Number shortcut: jump AND confirm. Someone typing "3" has already
            // decided; making them press Enter as well is the friction this
            // whole function exists to remove.
            const n = Number(key?.sequence);
            if (Number.isInteger(n) && n >= 1 && n <= options.length) { idx = n - 1; render(false); finish(false); }
        };

        stdin.on("keypress", onKey);
        render(true);
    });
}

/** Numbered prompt. Used when there is no tty, and when raw mode is refused. */
async function fallback<T>(title: string, options: SelectOption<T>[], startIdx: number): Promise<SelectResult<T>> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        // No interaction is possible. Take the recommended option and SAY SO —
        // a default applied in silence is the defect decision #42 treated.
        console.log(`  ${title}`);
        console.log(`  (non-interactive: taking "${options[startIdx].label}")`);
        return { value: options[startIdx].value, cancelled: false };
    }

    console.log(`\n  ${title}\n`);
    options.forEach((o, i) => {
        const rec = o.recommended ? "  (recommended)" : "";
        const hint = o.hint ? `  — ${o.hint}` : "";
        console.log(`    ${i + 1}. ${o.label}${rec}${hint}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(res =>
        rl.question(`\n  Select [1-${options.length}] (Enter = ${startIdx + 1}): `, a => { rl.close(); res(a); })
    );
    const trimmed = answer.trim();
    if (trimmed === "") return { value: options[startIdx].value, cancelled: false };
    const n = parseInt(trimmed, 10);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return { value: options[n - 1].value, cancelled: false };
    console.log("  Not one of the options — cancelling rather than guessing.");
    return { value: options[startIdx].value, cancelled: true };
}

/**
 * Multi-select: space toggles, `a` toggles all, Enter confirms.
 *
 * `select()` above answers "which ONE", and that was the only question the
 * installer could ask. It is the wrong question for `--check`, whose whole
 * output is a list of N outdated installs: a user looking at ten rows wants
 * six of them, and single-pick forces ten runs of the command to get there.
 *
 * Returns the chosen values plus `cancelled`, for the same reason `select()`
 * does — "picked nothing" and "pressed Esc" are different facts, and a caller
 * that cannot tell them apart will treat a deliberate empty selection as an
 * abort.
 *
 * Long lists scroll. Without a viewport the redraw walks the cursor back
 * `options.length + 1` lines, which silently corrupts the screen the moment
 * the list is taller than the terminal — and the list here is "however many
 * installs this machine has", which is not a number we control.
 */
export async function multiselect<T>(
    title: string,
    options: SelectOption<T>[],
    opts: { initiallyAll?: boolean } = {},
): Promise<{ values: T[]; cancelled: boolean }> {
    if (options.length === 0) throw new Error("multiselect() called with no options");

    const chosen = new Set<number>(opts.initiallyAll ? options.map((_, i) => i) : []);

    if (!canRaw()) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            console.log(`  ${title}`);
            console.log(`  (non-interactive: taking ${chosen.size} of ${options.length})`);
            return { values: [...chosen].map(i => options[i].value), cancelled: false };
        }
        return numberedMultiFallback(title, options, chosen);
    }

    // Leave room for the title, the help line, and the shell prompt that
    // follows. 12 rows is the floor so a small terminal still shows a list.
    const viewport = Math.max(3, Math.min(options.length, (process.stdout.rows ?? 24) - 6));

    return new Promise(resolve => {
        let idx = 0;
        let top = 0;
        let done = false;
        let painted = 0;

        const stdin = process.stdin;
        const out = process.stdout;

        readline.emitKeypressEvents(stdin);
        stdin.setRawMode(true);
        stdin.resume();
        out.write(`${ESC}?25l`);

        const render = (first: boolean) => {
            if (idx < top) top = idx;
            if (idx >= top + viewport) top = idx - viewport + 1;

            if (!first) out.write(`${ESC}${painted}A`);
            let lines = 0;
            out.write(`  ${bold(title)}${ESC}K\n`); lines++;

            for (let i = top; i < Math.min(top + viewport, options.length); i++) {
                const o = options[i];
                const cursor = i === idx ? cyan("❯") : " ";
                const box = chosen.has(i) ? cyan("[x]") : "[ ]";
                const label = i === idx ? cyan(o.label) : o.label;
                const hint = o.hint ? dim(`  — ${o.hint}`) : "";
                out.write(`  ${cursor} ${box} ${label}${hint}${ESC}K\n`); lines++;
            }

            const more = options.length - (top + viewport);
            if (top > 0 || more > 0) {
                const above = top > 0 ? `${top} above` : "";
                const below = more > 0 ? `${more} below` : "";
                out.write(`     ${dim([above, below].filter(Boolean).join(" · "))}${ESC}K\n`); lines++;
            }
            out.write(`  ${dim(`space toggle · a all/none · enter confirm (${chosen.size} selected) · esc cancel`)}${ESC}K\n`);
            lines++;
            painted = lines;
        };

        const cleanup = () => {
            if (done) return;
            done = true;
            stdin.removeListener("keypress", onKey);
            if (stdin.setRawMode) stdin.setRawMode(false);
            stdin.pause();
            out.write(`${ESC}?25h`);
        };

        const finish = (cancelled: boolean) => {
            cleanup();
            out.write("\n");
            const values = options.filter((_, i) => chosen.has(i)).map(o => o.value);
            resolve({ values: cancelled ? [] : values, cancelled });
        };

        const onKey = (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
            if (done) return;
            const name = key?.name;
            if (key?.ctrl && name === "c") { cleanup(); out.write("\n"); process.kill(process.pid, "SIGINT"); return; }
            if (name === "up" || name === "k") { idx = (idx - 1 + options.length) % options.length; render(false); return; }
            if (name === "down" || name === "j") { idx = (idx + 1) % options.length; render(false); return; }
            if (name === "home") { idx = 0; render(false); return; }
            if (name === "end") { idx = options.length - 1; render(false); return; }
            if (name === "space") {
                chosen.has(idx) ? chosen.delete(idx) : chosen.add(idx);
                render(false);
                return;
            }
            if (key?.sequence === "a") {
                if (chosen.size === options.length) chosen.clear();
                else options.forEach((_, i) => chosen.add(i));
                render(false);
                return;
            }
            if (name === "return" || name === "enter") { finish(false); return; }
            if (name === "escape" || name === "q") { finish(true); return; }
        };

        stdin.on("keypress", onKey);
        render(true);
    });
}

/** Comma-separated numbers, for a tty that refuses raw mode. */
async function numberedMultiFallback<T>(
    title: string,
    options: SelectOption<T>[],
    preselected: Set<number>,
): Promise<{ values: T[]; cancelled: boolean }> {
    console.log(`\n  ${title}\n`);
    options.forEach((o, i) => {
        console.log(`    ${i + 1}. ${o.label}${o.hint ? `  — ${o.hint}` : ""}`);
    });
    const answer = (await ask(`\n  Numbers, comma-separated — "all", or Enter for ${preselected.size ? "all" : "none"}: `)).trim();

    if (answer === "") return { values: preselected.size ? options.map(o => o.value) : [], cancelled: false };
    if (answer.toLowerCase() === "all") return { values: options.map(o => o.value), cancelled: false };
    if (answer.toLowerCase() === "none") return { values: [], cancelled: false };

    const picked: T[] = [];
    for (const part of answer.split(",")) {
        const n = parseInt(part.trim(), 10);
        // Cancel rather than guess, exactly as the single-select fallback does.
        // Silently dropping "12" from a list of 10 would update nine installs
        // and let the user believe it updated ten.
        if (!Number.isInteger(n) || n < 1 || n > options.length) {
            console.log(`  "${part.trim()}" is not one of 1-${options.length} — cancelling rather than guessing.`);
            return { values: [], cancelled: true };
        }
        if (!picked.includes(options[n - 1].value)) picked.push(options[n - 1].value);
    }
    return { values: picked, cancelled: false };
}

/** Free-text question. Returns "" when there is no tty. */
export async function ask(query: string): Promise<string> {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) return "";
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(res => rl.question(query, a => { rl.close(); res(a); }));
}

/** Yes/no. `defaultYes` is what a bare Enter means, and it is shown in the prompt. */
export async function confirm(query: string, defaultYes = true): Promise<boolean> {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = (await ask(`${query} ${suffix}: `)).trim().toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
}
