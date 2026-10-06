import { readFileSync } from 'node:fs';

const t = readFileSync(process.argv[2], 'utf8');
const re = /vp-video__control-bar--button[^"]*"[^>]{0,80}/g;
let m;
while ((m = re.exec(t))) {
  console.log(m[0].slice(0, 120));
}
console.log('--- is-icon contexts ---');
let idx = 0;
let from = 0;
while ((from = t.indexOf('is-icon', from)) !== -1 && idx < 8) {
  console.log(idx++, t.slice(from - 80, from + 80).replace(/\s+/g, ' '));
  from += 7;
}
