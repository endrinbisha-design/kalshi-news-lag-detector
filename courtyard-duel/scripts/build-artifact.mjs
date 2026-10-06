// Turns the ARTIFACT=1 Vite build into a claude.ai artifact page: the platform wraps the page in its own
// <!doctype>/<head>/<body> skeleton, so we keep only <title>, the stylesheet link, the body markup and the module script.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const dir = 'dist/artifact';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const title = /<title>[^<]*<\/title>/.exec(html)[0].replace(/<title>[^<]*/, '<title>Courtyard Duel');
const links = [...html.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*><\/script>/g)].map((m) => m[0]).join('\n');
const preload = [...html.matchAll(/<link rel="modulepreload"[^>]*>/g)].map((m) => m[0]).join('\n');
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const page = `${title}\n<style>html,body{height:100%;margin:0;background:#000;overflow:hidden}:root{padding:0!important}</style>\n${links}\n${preload}\n${body}\n${scripts}\n`;
writeFileSync(join(dir, 'page.html'), page);
const files = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else { const r = relative(dir, p); if (r !== 'index.html' && r !== 'page.html') files[r] = p; } } };
walk(dir);
writeFileSync(join(dir, 'files.json'), JSON.stringify(files, null, 1));
console.log(page); console.log(Object.keys(files).length, 'files');
