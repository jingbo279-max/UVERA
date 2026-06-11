#!/usr/bin/env node
/**
 * Release helper — bump version + add release notes in one step.
 *
 * Usage:
 *   npm run release -- patch "Title of release" "Highlight 1" "Highlight 2" ...
 *   npm run release -- minor "Title of release" "Highlight 1" ...
 *   npm run release -- major "Title of release" "Highlight 1" ...
 *   npm run release -- 1.2.3 "Explicit version" "Highlight 1" ...
 *
 * What it does:
 *   1. Reads current package.json version (e.g. "1.0.7")
 *   2. Bumps based on first arg (patch/minor/major) or sets to explicit value
 *   3. Writes the new version back to package.json
 *   4. Prepends a new release entry to public/release-notes.json with
 *      today's date, the title, and the supplied highlights
 *   5. Prints next steps (git commit + push)
 *
 * NOT done automatically (so you can review before committing):
 *   - git add / commit / push
 *
 * Why a script: 3 files have to change in sync to make a release visible
 * to users (package.json bump → __APP_VERSION__ injection at build →
 * version.json regenerated → VersionUpdater detects mismatch). Doing
 * this manually is forgettable; centralising it removes that whole class
 * of "I forgot to bump" bugs.
 */

import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: npm run release -- <patch|minor|major|x.y.z> "<title>" "<highlight1>" "<highlight2>" ...');
  console.error('Example:');
  console.error('  npm run release -- patch "Bug fixes" "Fix series publish error" "Fix episode reorder"');
  process.exit(1);
}

const [bumpKind, title, ...highlights] = args;

if (!title || title.trim().length === 0) {
  console.error('Error: title is required (second argument)');
  process.exit(1);
}
if (highlights.length === 0) {
  console.error('Error: at least one highlight is required');
  process.exit(1);
}

// ── Bump version ────────────────────────────────────────────────────
const pkgPath = path.resolve(cwd, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

const computeNextVersion = (current, kind) => {
  if (/^\d+\.\d+\.\d+$/.test(kind)) {
    return kind;  // explicit semver
  }
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  console.error(`Unknown bump kind: ${kind}. Use patch / minor / major / x.y.z.`);
  process.exit(1);
};

const newVersion = computeNextVersion(currentVersion, bumpKind);

if (newVersion === currentVersion) {
  console.error(`Refusing to release: new version ${newVersion} is the same as current. Use a different bump kind.`);
  process.exit(1);
}

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✓ Bumped package.json: ${currentVersion} → ${newVersion}`);

// ── Prepend release notes entry ─────────────────────────────────────
const notesPath = path.resolve(cwd, 'public/release-notes.json');
let notes;
try {
  notes = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
} catch (err) {
  console.error(`Could not read ${notesPath}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(notes.releases)) {
  notes.releases = [];
}

// Refuse to clobber if the new version already has an entry
if (notes.releases.some(r => r.version === newVersion)) {
  console.error(`Refusing to release: version ${newVersion} already has a release-notes entry.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

const newEntry = {
  version: newVersion,
  date: today,
  title: title.trim(),
  highlights: highlights.map(h => h.trim()).filter(Boolean),
};

notes.releases.unshift(newEntry);
fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2) + '\n', 'utf8');
console.log(`✓ Prepended release-notes.json entry for v${newVersion}`);

// ── Confirmation + next steps ───────────────────────────────────────
console.log('');
console.log('─────────────────────────────────────────────────────');
console.log(`v${newVersion} · ${today}`);
console.log(`  ${title.trim()}`);
for (const h of highlights) {
  console.log(`  • ${h.trim()}`);
}
console.log('─────────────────────────────────────────────────────');
console.log('');
console.log('Next steps:');
console.log(`  git add package.json public/release-notes.json`);
console.log(`  git commit -m "release: v${newVersion} — ${title.trim()}"`);
console.log(`  git push`);
console.log('');
console.log('CI will deploy and existing users will see the in-app update toast');
console.log('within ~10 minutes (poll interval, see VersionUpdater.jsx).');
