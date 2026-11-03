/**
 * Where to put the picker on the Files tab. All GitHub DOM knowledge for injection lives here.
 * Candidates are tried in order; if none matches, the picker floats in the bottom-right corner.
 */

export interface MountTarget {
  selector: string;
  position: InsertPosition;
  /** Short name for debugging (shown in the host's data-mount attribute). */
  name: string;
}

export const MOUNT_TARGETS: MountTarget[] = [
  // Classic Files tab: the sticky toolbar row ("Changes from all commits", file filter, …).
  // Verified against the recorded page in test/fixtures/pr14768-files-classic.html.
  { name: 'classic-diffbar', selector: '.pr-toolbar .diffbar', position: 'beforeend' },
  { name: 'classic-toolbar', selector: '.pr-toolbar', position: 'beforeend' },
  // Newer "Files changed" experience (React). Class names there are hashed, so match on
  // stable-looking test ids and partial names. Best effort: see NOTES.md.
  { name: 'react-toolbar-testid', selector: '[data-testid="pr-files-changed-toolbar"]', position: 'beforeend' },
  { name: 'react-toolbar-class', selector: '[class*="PullRequestFilesToolbar-module__toolbar"]', position: 'beforeend' },
  { name: 'react-diff-header', selector: '[class*="prc-PageHeader"] [class*="Actions"]', position: 'afterbegin' },
  { name: 'classic-files-bucket', selector: '#files_bucket', position: 'afterbegin' },
];

export function findMountTarget(doc: ParentNode = document): { el: Element; target: MountTarget } | undefined {
  for (const target of MOUNT_TARGETS) {
    const el = doc.querySelector(target.selector);
    if (el) return { el, target };
  }
  return undefined;
}
