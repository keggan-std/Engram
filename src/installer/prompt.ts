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
