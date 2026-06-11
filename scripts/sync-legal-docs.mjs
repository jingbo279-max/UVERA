/**
 * Mirror legal markdown sources from docs/ to public/legal/ so the
 * SPA can fetch them at runtime.
 *
 * docs/ is the editing surface (linked from COMPLIANCE.md, given to
 * the lawyer for review). public/legal/ is a build artifact served
 * to end users via Cloudflare CDN. Keeping the copies in sync via
 * this script avoids the "remember to copy after edit" bug.
 *
 * Hooked into npm run build (see package.json).
 */
import fs from 'fs';
import path from 'path';

const FILES = [
  ['docs/legal/TERMS-OF-SERVICE.md',  'public/legal/terms.md'],
  ['docs/legal/PRIVACY.md',           'public/legal/privacy.md'],
  ['docs/legal/CONTENT-LICENSE.md',   'public/legal/content-license.md'],
];

const root = process.cwd();
for (const [src, dst] of FILES) {
  const srcAbs = path.resolve(root, src);
  const dstAbs = path.resolve(root, dst);
  if (!fs.existsSync(srcAbs)) {
    console.warn(`[Build] Skipping missing source: ${src}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  // Strip leading YAML frontmatter — docs/ sources carry it (docs system
  // convention) but the public artifact is rendered raw to end users.
  let body = fs.readFileSync(srcAbs, 'utf-8');
  body = body.replace(/^---\n[\s\S]*?\n---\n?/, '');
  fs.writeFileSync(dstAbs, body);
  console.log(`[Build] Synced ${src} → ${dst} (frontmatter stripped)`);
}
