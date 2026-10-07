import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
const source = 'https://game.maj-soul.com/1/v0.11.243.w/res/proto/liqi.json';
const sha256 = 'f2955c3d10cf2d42bee9309f672c062540941ea0cffe1bd62e3f436c7afc404c';
const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Protocol download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Protocol checksum mismatch; existing file was not changed.');
const schema = JSON.parse(bytes.toString('utf8'));
if (!schema.nested?.lq?.nested?.Wrapper) throw new Error('Invalid protocol schema.');
const target = new URL('../assets/liqi.json', import.meta.url);
const temporary = new URL('../assets/liqi.json.tmp', import.meta.url);
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
try {
  await writeFile(temporary, bytes);
  await rename(temporary, target);
} finally { await rm(temporary, { force: true }); }
console.log(`Protocol prepared. SHA256: ${sha256}`);
