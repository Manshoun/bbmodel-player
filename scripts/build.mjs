// dist/bbmodel-player.js       es module, three.js bundled
// dist/bbmodel-player.iife.js  classic script, window.BBModelPlayerLib
// dist/bbmodel-player.core.js  es module, three.js external (npm / bundlers)
// the standalone build is also copied to docs/lib for the demo page
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const banner = { js: `/*! bbmodel-player v${pkg.version} | MIT License | three.js © three.js authors (MIT) */` };
const common = { entryPoints: ['src/index.js'], bundle: true, sourcemap: true, target: 'es2020', banner, logLevel: 'info' };

const configs = [
  { ...common, format: 'esm', minify: true, outfile: 'dist/bbmodel-player.js' },
  { ...common, format: 'iife', globalName: 'BBModelPlayerLib', minify: true, outfile: 'dist/bbmodel-player.iife.js' },
  { ...common, format: 'esm', minify: false, external: ['three', 'three/*'], outfile: 'dist/bbmodel-player.core.js' },
];

if (process.argv.includes('--watch')) {
  for (const c of configs) await (await context(c)).watch();
  console.log('watching src/');
} else {
  await Promise.all(configs.map((c) => build(c)));
  mkdirSync('docs/lib', { recursive: true });
  copyFileSync('dist/bbmodel-player.js', 'docs/lib/bbmodel-player.js');
  copyFileSync('dist/bbmodel-player.js.map', 'docs/lib/bbmodel-player.js.map');
}
