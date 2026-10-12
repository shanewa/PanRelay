import fs from 'node:fs';

const t = fs.readFileSync(process.argv[2], 'utf8');
const keys = ['vp-video-page-card__video-name', 'is-playing', '论文专题', '.mp4'];
for (const key of keys) {
  const i = t.indexOf(key);
  console.log('\n==', key, i);
  if (i >= 0) console.log(t.slice(Math.max(0, i - 120), i + 180).replace(/\s+/g, ' '));
}
