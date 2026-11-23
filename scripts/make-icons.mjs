// Renders the PNG app icons from public/icons/icon.svg.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
// Maskable icon: square background, artwork kept inside the safe zone.
const maskable = svg
  .replace('rx="112"', 'rx="0"')
  .replace(/(<rect[^>]*\/>)/, '$1<g transform="translate(64 64) scale(0.75)">')
  .replace('</svg>', '</g></svg>');

await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(path.join(dir, 'icon-192.png'));
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(path.join(dir, 'maskable-512.png'));
console.log('icons written');
