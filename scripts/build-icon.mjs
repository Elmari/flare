import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/flare.svg'), 'utf8');

const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } });
const png = resvg.render().asPng();
const out = join(root, 'assets/flare.png');
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
