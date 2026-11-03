import appCss from './styles.css';

type Attrs = Record<string, string | number | boolean | undefined | EventListener>;
type Child = Node | string | false | null | undefined;

/** Tiny hyperscript helper. `on*` attributes become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export type Theme = 'light' | 'dark';
export type Site = 'github' | 'linear';

/** Follow GitHub's theme setting (`data-color-mode` = light | dark | auto). */
export function githubTheme(): Theme {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Resolve any CSS color (rgb, lch, oklch, …) to RGBA via a 1px canvas. */
export function toRgba(color: string): [number, number, number, number] | undefined {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return undefined;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255];
}

export function isDark(color: string): boolean | undefined {
  const rgba = toRgba(color);
  if (!rgba) return undefined;
  const [r, g, b] = rgba;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/**
 * The page's own surface around a point: first non-transparent background walking up from
 * the element there, plus its text color and font. Linear has user-defined themes and no
 * public tokens, so sampling is the reliable way to blend in.
 */
function pageSurface(x: number, y: number, exclude: Element): { bg: string; fg: string; font: string } | undefined {
  const stack = document.elementsFromPoint(x, y).filter((el) => el !== exclude && !exclude.contains(el));
  let el: Element | null = stack[0] ?? document.body;
  const fgFrom = el ? getComputedStyle(el) : undefined;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    const rgba = toRgba(bg);
    if (rgba && rgba[3] > 0.5) return { bg, fg: fgFrom?.color ?? '', font: fgFrom?.fontFamily ?? '' };
    el = el.parentElement;
  }
  return undefined;
}

const hosts = new Map<HTMLElement, Site>();

/** Re-read the host page's theme. Cheap; called on mount, on theme changes and when opening. */
export function applyTheme(host: HTMLElement): void {
  const site = hosts.get(host);
  if (site === 'github') {
    host.setAttribute('data-theme', githubTheme());
    return;
  }
  const r = host.getBoundingClientRect();
  const surface = pageSurface(r.left + r.width / 2, r.top + r.height / 2, host);
  const dark = surface ? isDark(surface.bg) : undefined;
  host.setAttribute('data-theme', dark ?? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (surface) {
    host.style.setProperty('--prv-page-bg', surface.bg);
    if (surface.fg) host.style.setProperty('--prv-page-fg', surface.fg);
    if (surface.font) host.style.setProperty('--prv-page-font', surface.font);
  }
}

function applyAll(): void {
  hosts.forEach((_, host) => applyTheme(host));
}

let themeWatching = false;
function watchTheme(): void {
  if (themeWatching) return;
  themeWatching = true;
  // GitHub: data-color-mode & co. Linear: theme classes/styles on <html> or <body>.
  const opts = { attributes: true, attributeFilter: ['data-color-mode', 'data-light-theme', 'data-dark-theme', 'class', 'style'] };
  new MutationObserver(applyAll).observe(document.documentElement, opts);
  new MutationObserver(applyAll).observe(document.body, opts);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAll);
}

/** A host element with an open shadow root and the extension's styles, isolated from the page's CSS. */
export function createShadowHost(site: Site): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.className = 'prv-host';
  host.setAttribute('data-site', site);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = appCss;
  root.append(style);
  hosts.set(host, site);
  watchTheme();
  host.setAttribute('data-theme', site === 'github' ? githubTheme() : 'dark');
  return { host, root };
}

export function releaseHost(host: HTMLElement): void {
  hosts.delete(host);
  host.remove();
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const secs = (t - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return rtf.format(0, 'minute');
}
