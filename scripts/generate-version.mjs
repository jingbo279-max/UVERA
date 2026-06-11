/**
 * Generate `public/version.json` for the runtime version checker.
 *
 * Output shape:
 * {
 *   version: "1.0.5",                  // from package.json
 *   latestRelease: {                    // first entry of public/release-notes.json
 *     version, date, title, highlights
 *   }
 * }
 *
 * VersionUpdater polls /version.json periodically; when the bundled
 * version differs from the live one, it prompts the user to refresh
 * and shows the highlights so they know what's changing.
 */
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();

const pkgPath = path.resolve(cwd, 'package.json');
const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkgData.version;

let latestRelease = null;
const notesPath = path.resolve(cwd, 'public/release-notes.json');
if (fs.existsSync(notesPath)) {
  try {
    const notes = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
    if (notes.releases && notes.releases.length > 0) {
      latestRelease = notes.releases[0];
    }
  } catch (e) {
    console.warn('[Build] Could not parse release-notes.json:', e.message);
  }
}

const publicDir = path.resolve(cwd, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const versionFile = path.resolve(publicDir, 'version.json');
fs.writeFileSync(versionFile, JSON.stringify({ version, latestRelease }), 'utf8');

console.log(`[Build] Generated public/version.json -> v${version}` +
  (latestRelease ? ` (with release notes: "${latestRelease.title}")` : ' (no release notes found)'));
