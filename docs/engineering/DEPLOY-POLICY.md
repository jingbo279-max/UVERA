---
title: Deploy Policy
type: doc
status: active
owner: fei
created: 2026-05-22
updated: 2026-05-22
tags: [engineering, deploy]
---

# Deploy Policy

**TL;DR**: Only deploy from `main`. Feature work goes through PR → merge → deploy.

---

## The rule

```
✅ git checkout main && git pull && npm run deploy
❌ git checkout my-feature && npm run deploy
```

`npm run deploy` now runs `scripts/check-deploy-branch.mjs` before
building. If the branch isn't `main`, the script bails with instructions.

Emergency override (don't use unless main is broken):
```
FORCE_DEPLOY=1 npm run deploy
```

## Why this exists

**§2026-05-22 incident**:

- fei was working on a long feature branch (`claude/brave-brattain-d35d64`) — 139 commits over ~2 weeks. Storyboard pipeline, BytePlus fallback, videoType-curated styles, admin test cards, ~all the storyboard/pricing/genre work.
- Leon was independently making design-system tweaks on `main` (Round-68 through Round-70, material classes + glass tokens).
- Leon ran `npm run deploy` from `main`. Wrangler ships whatever's on disk. Leon's local `main` was 4 commits ahead of the previous deploy + missing all 139 of fei's commits.
- Production now had Leon's design tweaks AND **none of fei's storyboard work**. fei caught it 30 min later:
  > "9/8 Characters again, style 不对了, 刚才有其他人提交吗?"
- Recovery: `git merge feifeixp/main` into fei's branch, redeploy. No code lost (commits were safe in git, just absent from prod for 30 min).

**The deeper problem**: two people deploying from different branches = whoever deployed last wins. There's no merge — wrangler just overwrites.

## The policy

1. **`main` is the single source of truth for what's in prod.**
2. **Feature branches MUST PR-merge to main before deploying.**
3. **`npm run deploy` runs only on main.** The guard script enforces this.
4. **Push your branch + open a PR even for solo work**, so other people see what's coming.

## What the guard does

`scripts/check-deploy-branch.mjs` runs before every `npm run deploy`:

- **On main**: ✅ passes. Also warns if local is dirty or behind origin.
- **On any other branch**: ✘ bails with explicit instructions to PR-merge first.
- **With `FORCE_DEPLOY=1` on any branch**: passes with a loud warning. Use only for emergencies.

The guard is a Node script wired into the npm `deploy` script (not a git hook), so it's automatic for every clone with no per-machine setup.

## Workflow examples

### Solo feature work (most common)
```bash
git checkout -b my-feature
# ... edit, commit ...
git push -u origin my-feature
gh pr create --base main --title "feat: my thing"
# Wait for review (or self-merge if solo)
gh pr merge --squash  # or merge / rebase
git checkout main && git pull
npm run deploy
```

### Hotfix when prod is broken
```bash
git checkout -b hotfix/fix-the-thing
# ... fix, commit ...
git push -u origin hotfix/fix-the-thing
# Need to ship NOW, can't wait for PR review:
FORCE_DEPLOY=1 npm run deploy
# Then immediately:
gh pr create --base main --title "hotfix: ..." --body "Shipped via FORCE_DEPLOY"
gh pr merge --squash
```
Don't forget step 2 — the prod state must match `main` eventually, or the next person's deploy from main will undo your hotfix.

### Coordinating with teammates
If you're about to do a long-running feature branch:
1. Tell the team in chat (use the team-chat channel or wherever).
2. Push the branch + open a draft PR early so others can see it.
3. Rebase / merge `main` into your branch periodically so the eventual PR is clean.

## What this policy does NOT do

- It does NOT prevent merge conflicts on `main`. You still need to coordinate big refactors.
- It does NOT enforce code review (we don't have a CI gate yet — PR review is on the honor system).
- It does NOT prevent someone from disabling the guard intentionally. It's a guardrail, not a vault.

## Future improvements (not done yet)

- CI gate that prevents direct push to main (force PRs)
- Auto-deploy on merge to main (via GitHub Actions + wrangler deploy)
- Production deployment notifications to team chat
- Rollback button in admin dashboard

For now, the manual guard + this policy is sufficient.
