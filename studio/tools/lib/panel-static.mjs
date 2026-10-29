import {existsSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';

const inside = (root, target) => {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export function resolvePanelStatic(pathname, {repoRoot, publicRoot}) {
  const relativePath = String(pathname).replace(/^\/+/, '');
  if (relativePath.split('/').some(part => part.startsWith('.') || /\.(secret|pem|key|p12|pfx)$/i.test(part))) return null;
  if (!relativePath || relativePath.includes('\0') || relativePath.split('/').some((part) => part === '..')) return null;
  for (const root of [repoRoot, publicRoot]) {
    const target = resolve(root, relativePath);
    if (!inside(root, target) || !existsSync(target) || statSync(target).isDirectory()) continue;
    const actual = realpathSync(target);
    if (inside(realpathSync(root), actual)) return actual;
  }
  return null;
}
