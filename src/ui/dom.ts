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

/** Follow GitHub's theme setting (`data-color-mode` = light | dark | auto). */
export function currentTheme(): Theme {
  const mode = document.documentElement.getAttribute('data-color-mode');
  if (mode === 'light' || mode === 'dark') return mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const hosts = new Set<HTMLElement>();

function applyTheme(): void {
  const t = currentTheme();
  hosts.forEach((host) => host.setAttribute('data-theme', t));
}

let themeWatching = false;
function watchTheme(): void {
  if (themeWatching) return;
  themeWatching = true;
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-light-theme', 'data-dark-theme'],
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

/** A host element with an open shadow root and the extension's styles, isolated from GitHub's CSS. */
export function createShadowHost(tag = 'div'): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag);
  host.className = 'prv-host';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = appCss;
  root.append(style);
  hosts.add(host);
  watchTheme();
  host.setAttribute('data-theme', currentTheme());
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
