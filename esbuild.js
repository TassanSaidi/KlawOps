const esbuild = require('esbuild');

const args    = process.argv.slice(2);
const isWatch = args.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle:      true,
  outfile:     'out/extension.js',
  external:    ['vscode'],
  format:      'cjs',
  platform:    'node',
  target:      'node18',
  sourcemap:   true,
};

const webviewConfigs = [
  {
    entryPoints: ['src/webview/unified/index.tsx'],
    bundle:      true,
    outfile:     'out/webview/unified.js',
    format:      'iife',
    platform:    'browser',
    target:      'es2020',
    sourcemap:   true,
    define:      { 'process.env.NODE_ENV': '"production"' },
  },
];

const all = [extensionConfig, ...webviewConfigs];

if (isWatch) {
  Promise.all(all.map(c => esbuild.context(c).then(ctx => ctx.watch())))
    .then(() => console.log('Watching…'));
} else {
  Promise.all(all.map(c => esbuild.build(c))).catch(() => process.exit(1));
}
