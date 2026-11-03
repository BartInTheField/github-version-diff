// Loads dist/ into Chromium, opens a PR's Files tab, opens the version picker and saves screenshots.
// Usage: npm run screenshot [-- <pr-url>] [--headed]
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const prUrl = (args.find((a) => a.startsWith('https://')) ?? 'https://github.com/cli/cli/pull/14768').replace(/\/(files)?$/, '');
const extension = resolve('dist');
const out = resolve('docs/images');
mkdirSync(out, { recursive: true });
mkdirSync(resolve('docs/store'), { recursive: true });

const context = await chromium.launchPersistentContext(join(tmpdir(), `prv-profile-${Date.now()}`), {
  channel: 'chromium', // the full Chromium build: headless_shell can't load extensions
  headless: !headed,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

const shoot = async (scheme) => {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`${prUrl}/files`, { waitUntil: 'domcontentloaded' });

  const trigger = page.locator('.prv-host button.trigger');
  await trigger.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.prv-host')?.shadowRoot?.querySelector('button.trigger')?.disabled, null, { timeout: 30_000 });
  await trigger.click();
  const popover = page.locator('.prv-host .popover');
  await popover.waitFor();
  await page.waitForTimeout(500); // let the rebase check settle

  const mount = await page.locator('.prv-host').getAttribute('data-mount');
  const file = join(out, `screenshot-${scheme}.png`);
  const box = await popover.boundingBox();
  const triggerBox = await trigger.boundingBox();
  const top = Math.max(0, Math.min(box.y, triggerBox.y) - 80);
  await page.screenshot({
    path: file,
    clip: { x: 0, y: top, width: 1280, height: Math.min(800 - top, box.y + box.height - top + 40) },
  });
  console.log(`${scheme}: mounted at ${mount} → ${file}`);
  if (scheme === 'light') {
    // The Chrome Web Store wants exactly 1280×800, so this one is the whole viewport at CSS scale.
    const store = resolve('docs/store/screenshot-1280x800.png');
    await page.screenshot({ path: store, scale: 'css' });
    console.log(`store: ${store}`);
  }
  await page.close();
};

try {
  await shoot('light');
  await shoot('dark');
} finally {
  await context.close();
}
