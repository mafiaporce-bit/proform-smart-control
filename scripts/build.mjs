// Production build: esbuild bundles the React + TypeScript app, Tailwind's
// core compiler generates the CSS, and the service worker gets its file list.
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const out = path.join(root, 'dist');
const twDir = path.join(root, 'node_modules', 'tailwindcss');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

// 1. JavaScript
const js = await build({
  entryPoints: [path.join(src, 'main.tsx')],
  bundle: true,
  format: 'esm',
  target: ['chrome110'],
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  write: false,
});
const jsCode = js.outputFiles[0].contents;
const jsName = `assets/app-${hash(jsCode)}.js`;
fs.writeFileSync(path.join(out, jsName), jsCode);

// 2. CSS: collect every class-like token from the source and let Tailwind
// keep the ones it recognises.
const candidates = new Set();
for (const f of walk(src).filter((f) => /\.(tsx?|html)$/.test(f))) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/[^\s"'`<>{}=;]+/g)) candidates.add(m[0]);
}
const compiler = await compile(fs.readFileSync(path.join(src, 'index.css'), 'utf8'), {
  base: src,
  loadStylesheet: async (id, base) => {
    const p =
      id === 'tailwindcss'
        ? path.join(twDir, 'index.css')
        : id.startsWith('tailwindcss/')
          ? path.join(twDir, id.slice('tailwindcss/'.length))
          : path.resolve(base, id);
    return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
  },
});
const rawCss = compiler.build([...candidates]);
const css = await build({
  stdin: { contents: rawCss, loader: 'css' },
  minify: true,
  write: false,
  logLevel: 'error',
});
const cssCode = css.outputFiles[0].contents;
const cssName = `assets/app-${hash(cssCode)}.css`;
fs.writeFileSync(path.join(out, cssName), cssCode);

// 3. Static files
for (const f of walk(path.join(root, 'public'))) {
  const rel = path.relative(path.join(root, 'public'), f);
  if (rel === 'sw.js') continue;
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.copyFileSync(f, path.join(out, rel));
}

// 4. index.html
const html = fs
  .readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('<!--APP_CSS-->', `<link rel="stylesheet" href="/${cssName}">`)
  .replace('<!--APP_JS-->', `<script type="module" src="/${jsName}"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);

// 5. Service worker with the list of files to keep for offline use
const files = walk(out)
  .map((f) => '/' + path.relative(out, f).split(path.sep).join('/'))
  .filter((f) => !f.startsWith('/_') && f !== '/sw.js' && !f.endsWith('.glb')) // the 3D person is cached on first use instead
  .map((f) => (f !== '/index.html' && f.endsWith('/index.html') ? f.slice(0, -'index.html'.length) : f)); // sub-pages by folder URL
// The version changes whenever any shipped file changes (names AND contents), so phones pick up every update.
const contentSum = crypto.createHash('sha256');
for (const f of walk(out).sort()) if (!f.endsWith('sw.js')) contentSum.update(path.relative(out, f)).update(fs.readFileSync(f));
const version = hash(Buffer.from(files.join('|') + jsName + cssName + html + contentSum.digest('hex')));
const sw = fs
  .readFileSync(path.join(root, 'public', 'sw.js'), 'utf8')
  .replace('__VERSION__', version)
  .replace('"__FILES__"', JSON.stringify(['/', ...files.filter((f) => f !== '/index.html')]));
fs.writeFileSync(path.join(out, 'sw.js'), sw);

const kb = (b) => (b.length / 1024).toFixed(1) + ' kB';
console.log(`built ${jsName} (${kb(jsCode)}), ${cssName} (${kb(cssCode)}), sw ${version}`);
