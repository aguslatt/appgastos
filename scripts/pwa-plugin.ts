import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Replaces each placeholder, which must appear exactly once: a silent miss would ship a broken service worker. */
function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(values)) {
    const parts = out.split(token);
    if (parts.length !== 2) throw new Error(`sw-template.js: expected "${token}" exactly once, found ${parts.length - 1}`);
    out = parts.join(value);
  }
  return out;
}

/**
 * After the build, writes `sw.js` next to index.html with the exact list of files to
 * keep for offline use. The cache name changes whenever any file does, so a new
 * deploy replaces the old cache.
 */
export function pwaPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'appgastos-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha1');
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      hash.update(template);
      const precache = ['./', ...files.map((f) => `./${f}`)];
      const sw = fill(template, { __VERSION__: hash.digest('hex').slice(0, 10), __PRECACHE__: JSON.stringify(precache, null, 2) });
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}
