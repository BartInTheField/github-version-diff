// Renders assets/icon.svg to the extension icons (static/icons/) and the Chrome Web Store promo tile (docs/store/).
// Usage: node scripts/icons.mjs. Rerun after editing the SVG and commit the PNGs.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('assets/icon.svg', 'utf8');
mkdirSync('static/icons', { recursive: true });
mkdirSync('docs/store', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (html, width, height, path) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  await page.screenshot({ path, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  console.log(path);
};

try {
  for (const size of [16, 32, 48]) {
    await render(svg.replace('<svg ', `<svg width="${size}" height="${size}" `), size, size, `static/icons/icon-${size}.png`);
  }
  // The store wants 96×96 art with 16px of transparent padding in the 128 icon.
  await render(svg.replace('<svg ', '<svg width="96" height="96" style="margin:16px;display:block" '), 128, 128, 'static/icons/icon-128.png');
  // 440×280, the small promo tile the store requires.
  await render(
    `<div style="width:440px;height:280px;display:flex;align-items:center;gap:24px;padding:0 36px;box-sizing:border-box;
       background:#f6f8fa;font:600 30px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328">
       ${svg.replace('<svg ', '<svg width="112" height="112" style="flex:none" ')}
       <div>PR Versions<div style="font-weight:400;font-size:17px;color:#59636e;margin-top:8px">Compare any two pushes of a pull request</div></div>
     </div>`,
    440,
    280,
    'docs/store/promo-440x280.png',
  );
} finally {
  await browser.close();
}
