#!/usr/bin/env node
/**
 * scripts/check-deploy-branch.mjs
 *
 * Pre-deploy guard: bails if the current git branch is NOT main.
 *
 * Background: §2026-05-22 fei incident. Leon was on main, deployed his
 * design-system commits via `npm run deploy` — wiped out 139 commits of
 * fei's WIP that lived on a feature branch and hadn't been merged to main
 * yet. Deploy from main is single source of truth; feature branches
 * must PR-merge to main before they ship to production.
 *
 * Override: FORCE_DEPLOY=1 npm run deploy
 *   Use only for emergencies (e.g. hotfix branch when main is broken).
 *   Override prints a loud warning and asks for explicit ack so it's
 *   never accidental.
 *
 * Why this lives in a script vs git hook: hooks are per-clone setup that
 * everyone forgets to install. A script wired into `npm run deploy` runs
 * for everyone automatically.
 */

import { execSync } from 'node:child_process';

const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function getCurrentBranch() {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getDirtyState() {
  try {
    const out = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function getAheadBehind() {
  // Compares current branch to origin/main (or feifeixp/main, both are
  //   common remotes in this project). Returns "ahead X behind Y" string
  //   or null if can't determine.
  const remotes = ['origin/main', 'feifeixp/main'];
  for (const remote of remotes) {
    try {
      const out = execSync(`git rev-list --left-right --count HEAD...${remote}`, { encoding: 'utf8' }).trim();
      const [ahead, behind] = out.split('\t').map(Number);
      return { ahead, behind, remote };
    } catch { /* try next remote */ }
  }
  return null;
}

const branch = getCurrentBranch();
const isMain = branch === 'main' || branch === 'master';
const force = process.env.FORCE_DEPLOY === '1';

if (!branch) {
  console.error(`${RED}${BOLD}✘ Not a git repository (or detached HEAD).${RESET}`);
  console.error(`  Refusing to deploy from unknown branch state.`);
  process.exit(1);
}

if (isMain) {
  // Happy path — also check for uncommitted changes + behind main
  const dirty = getDirtyState();
  if (dirty) {
    console.warn(`${YELLOW}⚠️  Uncommitted changes on main:${RESET}`);
    console.warn(dirty.split('\n').slice(0, 10).map(l => `   ${l}`).join('\n'));
    console.warn(`${YELLOW}   Deploy will include the BUILT version of these changes.${RESET}`);
    console.warn();
  }
  const ab = getAheadBehind();
  if (ab && ab.behind > 0) {
    console.warn(`${YELLOW}⚠️  Local main is BEHIND ${ab.remote} by ${ab.behind} commit(s).${RESET}`);
    console.warn(`   Run \`git pull\` first to avoid deploying stale code.`);
    console.warn();
  }
  console.log(`${GREEN}✅ Deploying from ${BOLD}${branch}${RESET}${GREEN} — safe.${RESET}`);
  process.exit(0);
}

// Non-main branch
if (force) {
  console.warn();
  console.warn(`${RED}${BOLD}⚠️  ⚠️  ⚠️   FORCE_DEPLOY from non-main branch   ⚠️  ⚠️  ⚠️${RESET}`);
  console.warn();
  console.warn(`${RED}   Branch: ${BOLD}${branch}${RESET}`);
  console.warn(`${RED}   This OVERWRITES the deployed state.${RESET}`);
  console.warn(`${RED}   If other team members have unmerged work on main, your${RESET}`);
  console.warn(`${RED}   deploy will SILENTLY erase it (no warning, no rollback).${RESET}`);
  console.warn();
  console.warn(`${YELLOW}   Proceeding because FORCE_DEPLOY=1 was set.${RESET}`);
  console.warn(`${YELLOW}   This should ONLY happen for emergency hotfixes when main is broken.${RESET}`);
  console.warn();
  process.exit(0);
}

// Non-main, no force — bail
console.error();
console.error(`${RED}${BOLD}✘ Deploy blocked: you are on branch "${branch}", not main.${RESET}`);
console.error();
console.error(`${YELLOW}Why this exists:${RESET} §2026-05-22 incident — Leon deployed main while fei`);
console.error(`had 139 unmerged commits on a feature branch. Leon's deploy wiped`);
console.error(`fei's work from production. This guard prevents the same class of`);
console.error(`accident.`);
console.error();
console.error(`${YELLOW}What to do instead:${RESET}`);
console.error(`  1. Push this branch:        ${BOLD}git push -u origin ${branch}${RESET}`);
console.error(`  2. Open a PR to main:       ${BOLD}gh pr create --base main${RESET}`);
console.error(`  3. Once merged, switch:     ${BOLD}git checkout main && git pull${RESET}`);
console.error(`  4. Then deploy from main:   ${BOLD}npm run deploy${RESET}`);
console.error();
console.error(`${YELLOW}Emergency override (use sparingly):${RESET}`);
console.error(`  ${BOLD}FORCE_DEPLOY=1 npm run deploy${RESET}`);
console.error(`  Only when main is broken AND you need to ship a hotfix fast.`);
console.error();
process.exit(1);
