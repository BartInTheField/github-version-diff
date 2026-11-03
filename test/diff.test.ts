import { describe, expect, it } from 'vitest';
import { displayPath, parseDiff } from '../src/diff/parse';
import { detectBaseDrift, normalizePatch, rebaseFromMergeBases } from '../src/diff/rebase';
import { fixture } from './helpers';

describe('parseDiff', () => {
  it('parses a real GitHub compare diff', () => {
    const files = parseDiff(fixture('real-6-files.diff'));
    expect(files.map((f) => [f.newPath, f.additions, f.deletions])).toEqual([
      ['go.mod', 1, 1],
      ['go.sum', 2, 2],
      ['internal/authflow/refresh.go', 5, 6],
      ['internal/authflow/refresh_test.go', 5, 5],
      ['pkg/cmd/status/status.go', 2, 1],
      ['pkg/cmd/status/status_test.go', 27, 33],
    ]);
    expect(files.reduce((n, f) => n + f.hunks.length, 0)).toBe(16);
    expect(files.map((f) => f.text).join('')).toBe(fixture('real-6-files.diff'));
  });

  it('handles renames, binaries, mode changes, adds, deletes and odd paths', () => {
    const text = [
      'diff --git a/old name.txt b/new name.txt',
      'similarity index 90%',
      'rename from old name.txt',
      'rename to new name.txt',
      'index 1111111..2222222 100644',
      '--- a/old name.txt',
      '+++ b/new name.txt',
      '@@ -1 +1 @@',
      '-hello',
      '+hello world',
      'diff --git a/logo.png b/logo.png',
      'index 3333333..4444444 100644',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/script.sh b/script.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/added.ts b/added.ts',
      'new file mode 100644',
      'index 0000000..5555555',
      '--- /dev/null',
      '+++ b/added.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      '\\ No newline at end of file',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 6666666..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"',
      'index 7777777..8888888 100644',
      '--- "a/caf\\303\\251.md"',
      '+++ "b/caf\\303\\251.md"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const files = parseDiff(text);
    expect(files.map((f) => [f.status, f.oldPath, f.newPath, f.binary, f.additions, f.deletions])).toEqual([
      ['renamed', 'old name.txt', 'new name.txt', false, 1, 1],
      ['modified', 'logo.png', 'logo.png', true, 0, 0],
      ['modified', 'script.sh', 'script.sh', false, 0, 0],
      ['added', 'added.ts', 'added.ts', false, 2, 0],
      ['deleted', 'gone.ts', 'gone.ts', false, 0, 1],
      ['modified', 'café.md', 'café.md', false, 1, 1],
    ]);
    expect(files[1]?.newBlob).toBe('4444444');
    expect(files[2]?.modeLines).toEqual(['old mode 100644', 'new mode 100755']);
    expect(displayPath(files[4]!)).toBe('gone.ts');
  });

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});

/** Build a one-file patch with a single hunk at the given line. */
function patch(path: string, at: number, body: string[], section = 'func f()'): string {
  const old = body.filter((l) => l[0] !== '+').length;
  const neu = body.filter((l) => l[0] !== '-').length;
  return [
    `diff --git a/${path} b/${path}`,
    `index ${'a'.repeat(7)}..${'b'.repeat(7)} 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${at},${old} +${at},${neu} @@ ${section}`,
    ...body,
    '',
  ].join('\n');
}

describe('normalizePatch', () => {
  const body = [' ctx', '-old', '+new', ' ctx2'];

  it('ignores line numbers and blob ids, which a rebase changes', () => {
    const [x] = parseDiff(patch('a.go', 10, body));
    const [y] = parseDiff(patch('a.go', 42, body).replace('index aaaaaaa', 'index ccccccc'));
    expect(normalizePatch(x!)).toBe(normalizePatch(y!));
  });

  it('differs when the change itself differs', () => {
    const [x] = parseDiff(patch('a.go', 10, body));
    const [y] = parseDiff(patch('a.go', 10, [' ctx', '-old', '+newer', ' ctx2']));
    expect(normalizePatch(x!)).not.toBe(normalizePatch(y!));
  });
});

describe('rebase detection', () => {
  const pr = patch('pr.go', 1, ['+mine']);
  const prMoved = patch('pr.go', 7, ['+mine']);

  it('flags files that only changed on the base branch', () => {
    const raw = parseDiff(patch('main-only.go', 1, ['+upstream']) + patch('pr.go', 1, [' x']));
    const r = detectBaseDrift(raw, parseDiff(pr), parseDiff(prMoved));
    expect(r).toEqual({ rebased: true, baseOnlyFiles: ['main-only.go', 'pr.go'], method: 'heuristic' });
  });

  it('does not flag a plain follow-up commit', () => {
    const raw = parseDiff(patch('pr.go', 1, ['+more']));
    const r = detectBaseDrift(raw, parseDiff(pr), parseDiff(patch('pr.go', 1, ['+mine', '+more'])));
    expect(r.rebased).toBe(false);
  });

  it('cannot decide when a patch is empty (e.g. merged with a merge commit)', () => {
    expect(detectBaseDrift(parseDiff(pr), parseDiff(pr), []).rebased).toBeNull();
  });

  it('uses merge-bases when available', () => {
    expect(rebaseFromMergeBases('a', 'a')).toBe(false);
    expect(rebaseFromMergeBases('a', 'b')).toBe(true);
    expect(rebaseFromMergeBases(undefined, 'b')).toBeNull();
  });
});
