/** Minimal git unified-diff parser: enough for file lists, interdiff and rebase detection. */

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the closing `@@` (usually the enclosing function). */
  section: string;
  /** Body lines including their ' ', '+', '-' or '\' prefix. */
  lines: string[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  binary: boolean;
  /** Blob ids from the `index` line, when present. */
  oldBlob?: string;
  newBlob?: string;
  /** Mode lines (`new file mode`, `old mode`, …), kept verbatim. */
  modeLines: string[];
  additions: number;
  deletions: number;
  hunks: Hunk[];
  /** The file's full section of the original diff, from `diff --git` on. */
  text: string;
}

/** Path to show for a file: the new path, or the old one if the file was deleted. */
export function displayPath(f: Pick<FileDiff, 'oldPath' | 'newPath' | 'status'>): string {
  return f.status === 'deleted' ? f.oldPath : f.newPath;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Undo git's C-style quoting of paths with unusual characters. */
function unquote(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== '\\') {
      bytes.push(...new TextEncoder().encode(ch));
      continue;
    }
    const next = body[++i] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(({ n: 10, t: 9, '"': 34, '\\': 92 } as Record<string, number>)[next] ?? next.charCodeAt(0));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function stripPrefix(p: string): string {
  const u = unquote(p.trim());
  return u.replace(/^[ab]\//, '');
}

/** `diff --git a/x b/y`: split the two paths. Ambiguous with spaces; header lines win later. */
function pathsFromGitLine(line: string): [string, string] {
  const rest = line.slice('diff --git '.length);
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest);
  if (quoted) return [stripPrefix(quoted[1] as string), stripPrefix(quoted[2] as string)];
  // Unquoted paths with spaces: if both sides are the same path, split in the middle.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) {
    return [rest.slice(2, half), rest.slice(half + 3)];
  }
  const idx = rest.indexOf(' b/');
  return [stripPrefix(rest.slice(0, idx)), stripPrefix(rest.slice(idx + 1))];
}

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  let cur: FileDiff | undefined;
  let start = 0;
  let hunk: Hunk | undefined;

  const finish = (end: number) => {
    if (!cur) return;
    cur.text = lines.slice(start, end).join('\n') + '\n';
    files.push(cur);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('diff --git ')) {
      finish(i);
      const [oldPath, newPath] = pathsFromGitLine(line);
      cur = { oldPath, newPath, status: 'modified', binary: false, modeLines: [], additions: 0, deletions: 0, hunks: [], text: '' };
      start = i;
      hunk = undefined;
      continue;
    }
    if (!cur) continue;

    const h = HUNK_RE.exec(line);
    if (h) {
      hunk = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        section: h[5] ?? '',
        lines: [],
      };
      cur.hunks.push(hunk);
      continue;
    }

    if (hunk) {
      const c = line[0];
      if (c === '+') cur.additions++;
      else if (c === '-') cur.deletions++;
      if (c === '+' || c === '-' || c === ' ' || c === '\\' || line === '') hunk.lines.push(line === '' ? ' ' : line);
      continue;
    }

    // Extended header lines.
    if (line.startsWith('new file mode')) {
      cur.status = 'added';
      cur.modeLines.push(line);
    } else if (line.startsWith('deleted file mode')) {
      cur.status = 'deleted';
      cur.modeLines.push(line);
    } else if (line.startsWith('old mode') || line.startsWith('new mode')) {
      cur.modeLines.push(line);
    } else if (line.startsWith('rename from ')) {
      cur.status = 'renamed';
      cur.oldPath = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      cur.status = 'renamed';
      cur.newPath = unquote(line.slice('rename to '.length));
    } else if (line.startsWith('copy from ')) {
      cur.status = 'copied';
      cur.oldPath = unquote(line.slice('copy from '.length));
    } else if (line.startsWith('copy to ')) {
      cur.status = 'copied';
      cur.newPath = unquote(line.slice('copy to '.length));
    } else if (line.startsWith('index ')) {
      const m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line);
      if (m) {
        cur.oldBlob = m[1];
        cur.newBlob = m[2];
      }
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      cur.binary = true;
    } else if (line.startsWith('--- ') && !line.startsWith('--- /dev/null')) {
      cur.oldPath = stripPrefix(line.slice(4).replace(/\t.*$/, ''));
    } else if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) {
      cur.newPath = stripPrefix(line.slice(4).replace(/\t.*$/, ''));
    }
  }
  finish(lines.length);
  return files;
}
