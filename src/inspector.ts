import { AgentObserver } from './observer';
import type { AgentEvent } from './observer';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
    reset:      '\x1b[0m',
    bold:       '\x1b[1m',
    dim:        '\x1b[2m',
    yellow:     '\x1b[33m',
    green:      '\x1b[32m',
    red:        '\x1b[31m',
    cyan:       '\x1b[36m',
    blue:       '\x1b[34m',
    magenta:    '\x1b[35m',
    gray:       '\x1b[90m',
    boldGreen:  '\x1b[1m\x1b[32m',
    boldRed:    '\x1b[1m\x1b[31m',
    boldCyan:   '\x1b[1m\x1b[36m',
};

function color(s: string, ...codes: string[]): string {
    return codes.join('') + s + C.reset;
}

function trunc(s: string, max: number): string {
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    if (str.length <= max) return str;
    return str.slice(0, max) + color('…', C.gray);
}

// ─── Inspector Options ────────────────────────────────────────────────────────

export interface InspectorOptions {
    /** Stream LLM tokens inline as they arrive. Default: true. */
    showTokens?: boolean;
    /** Max chars for tool args display. Default: 80. */
    maxArgChars?: number;
    /** Max chars for tool result/skill result display. Default: 120. */
    maxResultChars?: number;
    /** Output stream. Default: process.stderr (keeps stdout clean for piping). */
    output?: NodeJS.WriteStream;
}

// ─── Execution graph ──────────────────────────────────────────────────────────

type NodeKind = 'think' | 'tool' | 'collapse';
type NodeStatus = 'running' | 'ok' | 'failed' | 'done';

interface GraphNode {
    id: string;
    parentId: string | null;
    kind: NodeKind;
    label: string;     // human-readable name
    status: NodeStatus;
    depth: number;
    skillStack: string[];
    displayNum: number;
}

// ─── createInspector ─────────────────────────────────────────────────────────

/**
 * Creates an AgentObserver that pretty-prints every internal agent event
 * to the terminal in real time. Pass the returned observer to client.chat():
 *
 *   const inspector = createInspector();
 *   client.chat(task, { treeConfig: {...}, observer: inspector });
 *
 * Output goes to stderr by default so it doesn't interfere with stdout pipelines.
 */
export function createInspector(options: InspectorOptions = {}): AgentObserver {
    const showTokens     = options.showTokens     ?? true;
    const maxArgChars    = options.maxArgChars     ?? 80;
    const maxResultChars = options.maxResultChars  ?? 120;
    const out            = options.output          ?? process.stderr;

    const observer = new AgentObserver();

    // ── Live display state ─────────────────────────────────────────────────────
    let midToken = false;
    const toolStartTimes = new Map<string, number>();
    const skillStartTimes = new Map<string, number>();

    // ── Graph state ────────────────────────────────────────────────────────────
    const graphNodes = new Map<string, GraphNode>();
    let nodeCounter = 0;
    let graphPrinted = false;

    // ── Helpers ────────────────────────────────────────────────────────────────

    function write(s: string): void { out.write(s); }
    function writeln(s: string = ''): void { out.write(s + '\n'); }

    function flushToken(): void {
        if (midToken) { writeln(); midToken = false; }
    }

    /** Prefix for all lines: skill box walls + indent. */
    function prefix(skillStack: string[]): string {
        if (skillStack.length === 0) return '';
        return color('│', C.cyan) + '  '.repeat(skillStack.length - 1) + ' ';
    }

    function fmtArgs(args: unknown): string {
        const s = typeof args === 'string' ? args : JSON.stringify(args);
        return color(trunc(s, maxArgChars), C.gray);
    }

    function fmtResult(result: unknown): string {
        const s = typeof result === 'string' ? result : JSON.stringify(result);
        return trunc(s, maxResultChars);
    }

    function fmtDuration(ms: number): string {
        return color(`[${ms}ms]`, C.gray);
    }

    function skillKey(skillStack: string[]): string {
        return skillStack.join('/');
    }

    // ── Graph helpers ──────────────────────────────────────────────────────────

    function addGraphNode(
        id: string,
        parentId: string | null,
        kind: NodeKind,
        label: string,
        depth: number,
        skillStack: string[]
    ): void {
        if (graphNodes.has(id)) return;
        graphNodes.set(id, {
            id, parentId, kind, label, status: 'running',
            depth, skillStack, displayNum: ++nodeCounter,
        });
    }

    function setGraphStatus(id: string, status: NodeStatus): void {
        const n = graphNodes.get(id);
        if (n) n.status = status;
    }

    function printExecutionGraph(): void {
        if (graphPrinted) return;
        graphPrinted = true;

        writeln();

        const LINE_WIDTH = 58;
        const hdr = '─── execution graph ';
        writeln(color(hdr + '─'.repeat(Math.max(4, LINE_WIDTH - hdr.length)), C.bold));

        // Build children map
        const children = new Map<string | null, GraphNode[]>();
        for (const node of graphNodes.values()) {
            const key = node.parentId;
            if (!children.has(key)) children.set(key, []);
            children.get(key)!.push(node);
        }

        // Sort each children list by displayNum (insertion order)
        for (const list of children.values()) {
            list.sort((a, b) => a.displayNum - b.displayNum);
        }

        function statusIcon(n: GraphNode): string {
            switch (n.status) {
                case 'done':    return color(' ✅', C.boldGreen);
                case 'ok':      return color(' ✓',  C.green);
                case 'failed':  return color(' ✗',  C.boldRed);
                default:        return '';
            }
        }

        function kindColor(n: GraphNode): string {
            switch (n.kind) {
                case 'think':    return C.blue;
                case 'tool':     return C.yellow;
                case 'collapse': return C.cyan;
            }
        }

        function skillTag(n: GraphNode): string {
            if (n.skillStack.length === 0) return '';
            return color(` [${n.skillStack.join(' › ')}]`, C.dim);
        }

        function printNode(node: GraphNode, linePrefix: string, childPrefix: string): void {
            const num   = color(`#${node.displayNum}`, C.dim);
            const lbl   = color(node.label, kindColor(node));
            const depth = color(`@${node.depth}`, C.gray);
            writeln(linePrefix + num + ' ' + lbl + depth + skillTag(node) + statusIcon(node));

            const kids = children.get(node.id) ?? [];
            for (let i = 0; i < kids.length; i++) {
                const isLast = i === kids.length - 1;
                printNode(
                    kids[i],
                    childPrefix + (isLast ? '└─ ' : '├─ '),
                    childPrefix + (isLast ? '   ' : '│  ')
                );
            }
        }

        const roots = children.get(null) ?? [];
        for (const root of roots) {
            printNode(root, '', '');
        }

        writeln(color('─'.repeat(LINE_WIDTH), C.bold));
        writeln();
    }

    // ── Event Handler ──────────────────────────────────────────────────────────

    observer.on((event: AgentEvent) => {
        const { type, nodeId, nodeDepth, parentId, skillStack, data } = event;
        const p = prefix(skillStack);

        switch (type) {

            case 'think:start': {
                flushToken();
                addGraphNode(nodeId, parentId, 'think', 'think', nodeDepth, skillStack);
                write(p + color(`[${nodeId.slice(0, 8)} d:${nodeDepth}] `, C.dim));
                midToken = false;
                break;
            }

            case 'think:token': {
                if (showTokens) {
                    write(String(data.token ?? ''));
                    midToken = true;
                }
                break;
            }

            case 'think:complete': {
                flushToken();
                if (data.reason !== 'toolCalls') {
                    setGraphStatus(nodeId, 'ok');
                }
                break;
            }

            case 'tool:start': {
                flushToken();
                const toolName = String(data.toolName ?? '');
                const args = data.args;
                addGraphNode(nodeId, parentId, 'tool', `tool: ${toolName}`, nodeDepth, skillStack);
                toolStartTimes.set(`${nodeId}:${toolName}`, Date.now());
                writeln(
                    p +
                    color('→ tool  ', C.yellow) +
                    color(toolName, C.bold) +
                    '  ' + fmtArgs(args)
                );
                break;
            }

            case 'tool:complete': {
                flushToken();
                const toolName = String(data.toolName ?? '');
                const result   = data.result;
                const dur      = (Date.now() - (toolStartTimes.get(`${nodeId}:${toolName}`) ?? Date.now()));
                const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                const lenInfo  = color(`(${resultStr.length} chars)`, C.gray);
                setGraphStatus(nodeId, 'ok');
                writeln(
                    p +
                    color('← ok    ', C.green) +
                    color(toolName, C.bold) +
                    '  ' + fmtResult(result) +
                    '  ' + lenInfo + '  ' + fmtDuration(dur)
                );
                break;
            }

            case 'tool:error': {
                flushToken();
                const toolName = String(data.toolName ?? '');
                const error    = String(data.error ?? '');
                const attempts = Number(data.attempts ?? 1);
                setGraphStatus(nodeId, 'failed');
                writeln(
                    p +
                    color('✗ err   ', C.boldRed) +
                    color(toolName, C.bold) +
                    '  ' + color(trunc(error, maxResultChars), C.red) +
                    color(` [after ${attempts} attempt(s)]`, C.gray)
                );
                break;
            }

            case 'tool:retry': {
                flushToken();
                const toolName    = String(data.toolName ?? '');
                const attempt     = Number(data.attempt ?? 1);
                const maxAttempts = Number(data.maxAttempts ?? '?');
                const error       = String(data.error ?? '');
                const delayMs     = Number(data.nextDelayMs ?? 0);
                writeln(
                    p +
                    color(`↻ retry  `, C.yellow) +
                    color(toolName, C.bold) +
                    color(`  attempt ${attempt}/${maxAttempts}: `, C.dim) +
                    color(trunc(error, 60), C.yellow) +
                    color(` (retrying in ${delayMs}ms)`, C.gray)
                );
                break;
            }

            case 'collapse:start': {
                flushToken();
                addGraphNode(nodeId, parentId, 'collapse', 'collapse', nodeDepth, skillStack);
                const count     = Number(data.toolResultCount ?? 0);
                const chars     = Number(data.totalChars ?? 0);
                const threshold = Number(data.threshold ?? 0);
                const willCompress = chars > threshold;
                writeln(
                    p +
                    color('[collapse] ', C.cyan) +
                    color(`${count} result(s) · ${chars} chars`, C.dim) +
                    (willCompress
                        ? color(' · compressing…', C.cyan)
                        : color(' · no compression', C.gray))
                );
                break;
            }

            case 'collapse:complete': {
                setGraphStatus(nodeId, 'ok');
                const compressed = Boolean(data.compressed);
                if (compressed) {
                    const before = Number(data.charsBefore ?? 0);
                    const after  = Number(data.charsAfter ?? 0);
                    writeln(
                        p +
                        color('[collapse] ', C.cyan) +
                        color(`${before} → ${after} chars`, C.dim) +
                        color(' (compressed)', C.cyan)
                    );
                }
                break;
            }

            case 'skill:start': {
                flushToken();
                const skillName = String(data.skillName ?? '');
                const task      = String(data.task ?? '');
                const parentP   = prefix(skillStack.slice(0, -1));
                const width     = 66;
                const header    = `─ skill: ${skillName} `;
                const bar       = '─'.repeat(Math.max(4, width - header.length));
                writeln(parentP + color('┌' + header + bar, C.boldCyan));
                writeln(parentP + color('│', C.cyan) + '  ' + color('task: ', C.dim) + color(trunc(task, 80), C.gray));
                writeln(parentP + color('│', C.cyan));
                skillStartTimes.set(skillKey(skillStack), Date.now());
                break;
            }

            case 'skill:complete': {
                flushToken();
                const dur       = Date.now() - (skillStartTimes.get(skillKey(skillStack)) ?? Date.now());
                const parentP   = prefix(skillStack.slice(0, -1));
                const width     = 66;
                const durStr    = ` ${(dur / 1000).toFixed(1)}s `;
                const bar       = '─'.repeat(Math.max(4, width - durStr.length));
                writeln(parentP + color('│', C.cyan));
                writeln(parentP + color('└' + bar + durStr + '─', C.boldCyan));
                break;
            }

            case 'budget:exhausted': {
                flushToken();
                const reason  = String(data.reason ?? '');
                const limit   = Number(data.limit ?? 0);
                const current = Number(data.current ?? 0);
                setGraphStatus(nodeId, 'ok');
                writeln(
                    p +
                    color('⚠ budget exhausted: ', C.magenta) +
                    color(`${reason} (${current}/${limit}) — stopping`, C.magenta)
                );
                break;
            }

            case 'loop:detected': {
                flushToken();
                const toolName = String(data.toolName ?? '');
                const args     = data.args;
                writeln(
                    p +
                    color('⚠ loop: ', C.magenta) +
                    color(toolName, C.bold) +
                    '  ' + fmtArgs(args) +
                    color(' already in path — pruned', C.magenta)
                );
                break;
            }

            case 'task:complete': {
                flushToken();
                const result = String(data.result ?? '');
                setGraphStatus(nodeId, 'done');
                writeln(
                    p +
                    color('✅ DONE  ', C.boldGreen) +
                    color(trunc(result, maxResultChars), C.green)
                );
                // Print execution graph only once, at top-level completion
                if (skillStack.length === 0) {
                    printExecutionGraph();
                }
                break;
            }
        }
    });

    return observer;
}
