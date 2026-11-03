import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * Release builds get a CalVer version (YYYY.MM.DD.N) from the VERSION env var. Chrome requires
 * the manifest `version` to be 1-4 dot-separated integers without leading zeros, so it gets
 * "2026.11.3.1", and `version_name` (what Chrome shows) keeps the tag "2026.11.03.1".
 */
function manifestVersion(version) {
  if (!version) return { version: '0.0.0', version_name: 'dev' };
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(version)) throw new Error(`VERSION must be YYYY.MM.DD.N, got ${version}`);
  return { version: version.split('.').map(Number).join('.'), version_name: version };
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('static', 'dist', { recursive: true });
const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
writeFileSync('dist/manifest.json', JSON.stringify({ ...manifest, ...manifestVersion(process.env.VERSION) }, null, 2) + '\n');

const ctx = await esbuild.context({
  entryPoints: { content: 'src/content.ts', options: 'src/options.ts', background: 'src/background.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  loader: { '.css': 'text' },
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
