import { baseCompareHtmlUrl, compareHtmlUrl } from '../github/urls';
import { cachedVersions, checkRange, loadVersions, type RangeCheck } from '../load';
import { getLastViewed, setLastViewed } from '../storage';
import type { PrRef, Version, VersionList } from '../types';
import { defaultRange, newSinceLastViewed, sameSha } from '../versions';
import { applyTheme, createShadowHost, h, releaseHost, shortSha, type Site } from './dom';
import { findMountTarget } from './mount-targets';
import { canPickFrom, canPickTo, rangeLabel, type Range } from './range';

const REVALIDATE_MS = 30_000;
const lastLoaded = new Map<string, number>();

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export interface Picker {
  key: string;
  host: HTMLElement;
  destroy(): void;
}

function formatDate(iso: string | undefined): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? undefined : dateFmt.format(t);
}

function rangeStatus(check: RangeCheck): HTMLElement | undefined {
  if (check.rawError === 'not-found') {
    return h('div', { class: 'note error' }, 'One of these versions is no longer available on GitHub (garbage-collected).');
  }
  if (check.rawError === 'too-large' || check.rawError === 'timeout') {
    return h('div', { class: 'note muted' }, 'Range too large to check for a rebase.');
  }
  if (check.rebased) {
    const files = check.baseOnlyFiles;
    const title = files.length
      ? `Changed only on the base branch:\n${files.slice(0, 15).join('\n')}${files.length > 15 ? `\n…and ${files.length - 15} more` : ''}`
      : 'The merge-base with the base branch differs between these versions.';
    return h('div', { class: 'note warn', title }, '⚠ This range includes a rebase. Base-branch changes are mixed in.');
  }
  return undefined;
}

/** A trigger button in the Files toolbar plus a Graphite-style version popover. */
/**
 * - `toolbar`: in GitHub's Files toolbar, falling back to `floating` if it is not found.
 * - `floating`: a small card in the bottom-right corner.
 * - `corner-left`: a bare button bottom-left, next to Linear's help button, clear of its AI bar.
 */
export type Placement = 'toolbar' | 'floating' | 'corner-left';

export function mountPicker(pr: PrRef, key: string, site: Site, placement: Placement = 'toolbar'): Picker {
  const { host, root } = createShadowHost(site);
  const found = placement === 'toolbar' ? findMountTarget() : undefined;
  if (found) {
    host.setAttribute('data-mount', found.target.name);
    found.el.insertAdjacentElement(found.target.position, host);
  } else {
    const corner = placement === 'corner-left' ? 'corner-left' : 'floating';
    host.setAttribute('data-mount', corner);
    host.classList.add(`prv-${corner}`);
    document.body.append(host);
  }

  const triggerLabel = h('span', {}, 'Versions');
  const triggerBadge = h('span', { class: 'count', hidden: true });
  const trigger = h(
    'button',
    { class: 'trigger', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', disabled: true },
    h('span', { class: 'icon', 'aria-hidden': 'true' }, '⧉'),
    triggerLabel,
    triggerBadge,
    h('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'),
  );
  const rows = h('div', { class: 'rows', role: 'radiogroup', 'aria-label': 'Versions' });
  const notes = h('div', { class: 'notes' });
  const open = h('a', { class: 'btn primary', target: '_blank', rel: 'noopener' }, 'Open diff ↗');
  const popover = h(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': 'Compare versions', hidden: true },
    h('div', { class: 'header' }, h('span', { class: 'title' }, 'Versions'), h('span', { class: 'hint' }, 'from · to')),
    rows,
    h('div', { class: 'footer' }, notes, open),
  );
  const listStatus = h('span', { class: 'status' });
  const barClass = found ? 'bar' : placement === 'corner-left' ? 'bar corner-left' : 'bar floating';
  root.append(h('div', { class: barClass }, trigger, listStatus), popover);

  let list: (VersionList & { apiError?: string }) | undefined;
  let lastViewed: string | undefined;
  let range: Range = { from: 0, to: 1 };
  let checkSeq = 0;

  const version = (row: number): Version | undefined => list?.versions[row - 1];

  /** The newest of: the user's last submitted review, the last diff they opened here. */
  const lastSeen = (l: VersionList): string | undefined => {
    const idx = (sha?: string) => (sha ? l.versions.findIndex((v) => sameSha(v.sha, sha)) : -1);
    return idx(l.meta.viewerReviewSha) >= idx(lastViewed) ? l.meta.viewerReviewSha ?? lastViewed : lastViewed;
  };

  type Cell = { side: 'from' | 'to'; row: number; input: HTMLInputElement; label: HTMLElement };
  let cells: Cell[] = [];

  /** Reflect the current range in the radios without rebuilding them (keeps focus). */
  const syncRows = () => {
    for (const c of cells) {
      const enabled = c.side === 'from' ? canPickFrom(c.row, range) : canPickTo(c.row, range);
      c.input.checked = c.side === 'from' ? range.from === c.row : range.to === c.row;
      c.input.disabled = !enabled;
      c.label.classList.toggle('off', !enabled);
    }
  };

  const renderRows = () => {
    if (!list) return;
    cells = [];
    const latest = list.versions.length;
    const reviewSha = list.meta.viewerReviewSha;
    const radio = (side: 'from' | 'to', row: number) => {
      const input = h('input', {
        type: 'radio',
        name: side,
        'aria-label': `${side === 'from' ? 'Compare from' : 'Compare to'} ${row === 0 ? 'base' : `v${row}`}`,
      });
      input.addEventListener('change', () => {
        range = side === 'from' ? { ...range, from: row } : { ...range, to: row };
        void update();
      });
      const label = h('label', { class: `cell ${side}` }, input, h('span', { class: 'dot' }));
      cells.push({ side, row, input, label });
      return label;
    };
    const empty = (side: string) => h('span', { class: `cell ${side} off` });

    const baseRow = h(
      'div',
      { class: 'row' },
      radio('from', 0),
      empty('to'),
      h('div', { class: 'info' }, h('div', { class: 'line' }, h('span', { class: 'name' }, 'Base')),
        h('div', { class: 'meta' }, list.meta.baseBranch ?? '')),
    );

    const versionRows = list.versions.map((v) => {
      const copy = h('button', { class: 'copy', type: 'button', title: `Copy ${v.sha}`, 'aria-label': `Copy SHA of v${v.n}` }, '⧉');
      copy.addEventListener('click', async (e) => {
        e.preventDefault();
        await navigator.clipboard.writeText(v.sha).catch(() => {});
        copy.textContent = '✓';
        setTimeout(() => (copy.textContent = '⧉'), 1200);
      });
      const tags: HTMLElement[] = [];
      if (v.n !== latest) {
        if (sameSha(v.sha, reviewSha)) tags.push(h('span', { class: 'tag accent' }, 'Your last review'));
        else if (sameSha(v.sha, lastViewed)) tags.push(h('span', { class: 'tag accent' }, 'Last viewed'));
      }
      if (v.n === latest) tags.push(h('span', { class: 'tag' }, 'Latest'));
      const meta = [formatDate(v.at) ?? 'before force-push', v.actor, v.forcePushed ? 'force-push' : undefined]
        .filter(Boolean)
        .join(' · ');
      return h(
        'div',
        { class: 'row', title: v.message ?? '' },
        radio('from', v.n),
        radio('to', v.n),
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'line' }, h('span', { class: 'name' }, `v${v.n}`), h('code', {}, shortSha(v.sha)), copy, ...tags),
          h('div', { class: 'meta' }, meta),
        ),
      );
    });
    rows.replaceChildren(baseRow, ...versionRows);
    syncRows();
  };

  const update = async () => {
    if (!list) return;
    const latest = list.versions.length;
    triggerLabel.textContent = rangeLabel(range, latest);
    syncRows();

    const to = version(range.to);
    const from = version(range.from);
    const baseRef = list.meta.baseBranch ?? list.meta.baseSha;
    if (to && from) open.setAttribute('href', compareHtmlUrl(pr, from.sha, to.sha));
    else if (to && baseRef) open.setAttribute('href', baseCompareHtmlUrl(pr, baseRef, to.sha));

    const seq = ++checkSeq;
    notes.replaceChildren();
    if (list.incomplete) {
      notes.append(
        h('div', { class: 'note warn', title: 'Add a token in the extension options to load the full history.' },
          '⚠ GitHub hides part of this timeline; some versions may be missing.'),
      );
    }
    if (list.apiError) notes.append(h('div', { class: 'note warn', title: list.apiError }, '⚠ Token failed; used page data.'));
    if (!from || !to) return;
    const checking = h('div', { class: 'note muted' }, 'Checking for rebase…');
    notes.append(checking);
    const check = await checkRange(pr, list, from, to).catch(
      (): RangeCheck => ({ rebased: null, baseOnlyFiles: [], method: 'none' }),
    );
    if (seq !== checkSeq) return;
    const status = rangeStatus(check);
    if (status) checking.replaceWith(status);
    else checking.remove();
  };

  const render = (l: VersionList & { apiError?: string }) => {
    list = l;
    listStatus.replaceChildren();
    const seen = lastSeen(l);
    const def = defaultRange(l.versions, seen);
    if (l.versions.length === 0) {
      trigger.disabled = true;
      listStatus.append(h('span', { class: 'muted' }, 'No versions found'));
      return;
    }
    trigger.disabled = false;
    range = def ? { from: def[0].n, to: def[1].n } : { from: 0, to: 1 };
    renderRows();
    const fresh = newSinceLastViewed(l.versions, seen);
    triggerBadge.hidden = fresh === 0;
    triggerBadge.textContent = `${fresh} new`;
    triggerBadge.title = `${fresh} new version${fresh === 1 ? '' : 's'} since you last looked`;
    void update();
  };

  const load = async () => {
    lastViewed = await getLastViewed(pr);
    const cached = cachedVersions(pr);
    if (cached) render(cached);
    else listStatus.replaceChildren(h('span', { class: 'muted' }, 'Loading versions…'));
    if (cached && Date.now() - (lastLoaded.get(key) ?? 0) < REVALIDATE_MS) return;
    try {
      const fresh = await loadVersions(pr);
      lastLoaded.set(key, Date.now());
      // Re-render only on first load or when a new head appeared (keeps the user's selection).
      if (!cached || !sameSha(fresh.versions.at(-1)?.sha, cached.versions.at(-1)?.sha) || fresh.apiError) render(fresh);
    } catch (e) {
      if (!cached) {
        listStatus.replaceChildren(
          h('span', { class: 'error' }, `Versions unavailable: ${(e as Error).message}`),
          h('button', { class: 'btn link', type: 'button', onclick: () => void load() }, 'Retry'),
        );
      }
    }
  };

  // Popover open/close and positioning. Fixed positioning escapes GitHub's sticky toolbar.
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 16);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    const below = r.bottom + 6;
    const spaceBelow = window.innerHeight - below - 8;
    if (spaceBelow >= 240 || spaceBelow >= r.top) {
      popover.style.top = `${below}px`;
      popover.style.bottom = '';
      popover.style.maxHeight = `${spaceBelow}px`;
    } else {
      popover.style.top = '';
      popover.style.bottom = `${window.innerHeight - r.top + 6}px`;
      popover.style.maxHeight = `${r.top - 14}px`;
    }
  };
  const onOutside = (e: Event) => {
    if (!e.composedPath().includes(host)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      trigger.focus();
    }
  };
  const show = () => {
    applyTheme(host);
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place();
    rows.scrollTop = rows.scrollHeight;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  };
  function close() {
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  trigger.addEventListener('click', () => (popover.hidden ? show() : close()));

  open.addEventListener('click', () => {
    const to = version(range.to);
    if (!list || !to) return;
    // Remember the newest version the user has opened, for "last viewed → latest".
    const idx = (sha?: string) => list!.versions.findIndex((v) => sameSha(v.sha, sha));
    if (idx(to.sha) > idx(lastViewed)) {
      lastViewed = to.sha;
      void setLastViewed(pr, to.sha);
    }
    close();
  });

  // Sample the page once we are in the DOM and laid out.
  requestAnimationFrame(() => applyTheme(host));
  void load();

  return {
    key,
    host,
    destroy: () => {
      close();
      releaseHost(host);
    },
  };
}
