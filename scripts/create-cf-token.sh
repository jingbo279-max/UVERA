#!/usr/bin/env bash
# Manage Cloudflare API tokens for UVERA CI deploy.
#
# What this does:
#   1. List all existing custom API tokens
#   2. Delete tokens with names that suggest they're old uvera deploy attempts
#      (uvera-ci-deploy / debug-test / still-brook-* / etc.)
#   3. Create a fresh token with the broadest reasonable scope for Workers
#      deploys (15+ permission groups) — eliminates the "missing one perm
#      we didn't know about" failure mode
#   4. Verify the new token can hit /workers/services/uvera (the endpoint
#      that's been 10000-erroring in CI)
#   5. Output the token for GitHub secret update
#
# Prerequisites:
#   1. https://dash.cloudflare.com/profile/api-tokens (in longvv.dev account)
#   2. Scroll to bottom → "Global API Key" → View → enter password → copy
#   3. export CLOUDFLARE_EMAIL=longvv.dev@gmail.com
#      export CF_GLOBAL_KEY='<the global api key>'
#   4. bash scripts/create-cf-token.sh
#
# Note: CLOUDFLARE_EMAIL replaces the older CF_EMAIL (still accepted by
# wrangler but emits a deprecation warning).

set -euo pipefail

# Accept either CLOUDFLARE_EMAIL (preferred, current) or CF_EMAIL (legacy).
CF_EMAIL="${CLOUDFLARE_EMAIL:-${CF_EMAIL:-}}"
: "${CF_EMAIL:?Need CLOUDFLARE_EMAIL — see header}"
: "${CF_GLOBAL_KEY:?Need CF_GLOBAL_KEY — see header}"

ACCOUNT_ID="d2acf946d8f80f382be77437a71c4832"
API="https://api.cloudflare.com/client/v4"

curl_cf() {
  curl -sS \
    -H "X-Auth-Email: $CF_EMAIL" \
    -H "X-Auth-Key: $CF_GLOBAL_KEY" \
    -H "Content-Type: application/json" \
    "$@"
}

# ─── Step 1: identify user + zone ─────────────────────────────────────────────
echo "→ Step 1: identify user + zone…"
USER_ID=$(curl_cf "$API/user" | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["id"])')
ZONE_ID=$(curl_cf "$API/zones?name=uvera.ai" | python3 -c '
import sys, json
r = json.load(sys.stdin)
if not r.get("success") or not r.get("result"):
    sys.stderr.write("Could not find zone uvera.ai. Response: " + json.dumps(r) + "\n")
    sys.exit(1)
print(r["result"][0]["id"])
')
echo "  USER_ID=$USER_ID"
echo "  ZONE_ID=$ZONE_ID"

# ─── Step 2: list & clean up old custom uvera tokens ──────────────────────────
echo
echo "→ Step 2: list existing tokens, delete uvera-related ones…"
TOKENS_JSON=$(curl_cf "$API/user/tokens")
echo "$TOKENS_JSON" | python3 <<'PY'
import sys, json
data = json.loads(sys.stdin.read())
if not data.get("success"):
    print("Could not list tokens:", data)
    sys.exit(1)
print(f"  found {len(data['result'])} token(s):")
for t in data["result"]:
    print(f"    - {t['name']:40s}  id={t['id']}  status={t['status']}")
PY

# Delete tokens matching known transient/test names
TO_DELETE=$(echo "$TOKENS_JSON" | python3 <<'PY'
import sys, json, re
data = json.loads(sys.stdin.read())
patterns = [
    r"^uvera-ci-deploy",
    r"^uvera-deploy",
    r"^debug-test",
    r"^still-brook-",
    r"^test-with-policy",
    r"^test-debug-token",
]
ids = []
for t in data["result"]:
    name = t.get("name", "")
    if any(re.match(p, name) for p in patterns):
        ids.append((t["id"], name))
for tid, name in ids:
    print(f"{tid}\t{name}")
PY
)

if [ -n "$TO_DELETE" ]; then
  echo "  deleting old uvera tokens:"
  echo "$TO_DELETE" | while IFS=$'\t' read -r tid name; do
    echo "    - $name (id=$tid)"
    curl_cf -X DELETE "$API/user/tokens/$tid" >/dev/null
  done
else
  echo "  no old uvera tokens to delete"
fi

# ─── Step 3: fetch all permission group IDs ───────────────────────────────────
echo
echo "→ Step 3: resolve permission group IDs…"
PGROUPS_JSON=$(curl_cf "$API/user/tokens/permission_groups")

pid() {
  local name="$1"
  local id
  id=$(echo "$PGROUPS_JSON" | python3 -c "
import sys, json
groups = json.load(sys.stdin)['result']
matches = [g['id'] for g in groups if g['name'] == '$name']
print(matches[0] if matches else '')
")
  if [ -z "$id" ]; then
    echo "  ⚠️  permission group not found: $name (skipping)" >&2
    return 1
  fi
  echo "$id"
}

# Comprehensive: include every Workers-related permission + reads paired with writes.
# Goal: eliminate "we didn't include the permission Cloudflare wants" as a failure mode.
declare -a ACCT_PGS=()
for name in \
  "Workers Scripts Write" \
  "Workers Scripts Read" \
  "Workers R2 Storage Write" \
  "Workers R2 Storage Read" \
  "Workers KV Storage Write" \
  "Workers KV Storage Read" \
  "Workers Tail Read" \
  "Workers Observability Write" \
  "Workers Observability Read" \
  "Workers AI Write" \
  "Workers AI Read" \
  "Workers Pipelines Write" \
  "Workers Pipelines Read" \
  "Workers CI Write" \
  "Workers CI Read" \
  "Account Custom Asset Write" \
  "Account Custom Asset Read" \
  "Account Settings Read"
do
  if id=$(pid "$name"); then
    ACCT_PGS+=("{ \"id\": \"$id\" }")
  fi
done

declare -a ZONE_PGS=()
for name in "Workers Routes Write" "Workers Routes Read"; do
  if id=$(pid "$name"); then
    ZONE_PGS+=("{ \"id\": \"$id\" }")
  fi
done

declare -a USER_PGS=()
for name in "User Details Read"; do
  if id=$(pid "$name"); then
    USER_PGS+=("{ \"id\": \"$id\" }")
  fi
done

echo "  account-level: ${#ACCT_PGS[@]} permission groups"
echo "  zone-level:    ${#ZONE_PGS[@]} permission groups"
echo "  user-level:    ${#USER_PGS[@]} permission groups"

ACCT_PGS_JSON=$(IFS=,; echo "${ACCT_PGS[*]}")
ZONE_PGS_JSON=$(IFS=,; echo "${ZONE_PGS[*]}")
USER_PGS_JSON=$(IFS=,; echo "${USER_PGS[*]}")

# ─── Step 4: create token ─────────────────────────────────────────────────────
echo
echo "→ Step 4: create new token…"
TOKEN_NAME="uvera-ci-deploy-$(date -u +%Y%m%d-%H%M%S)"
PAYLOAD=$(cat <<JSON
{
  "name": "$TOKEN_NAME",
  "policies": [
    {
      "effect": "allow",
      "resources": { "com.cloudflare.api.account.${ACCOUNT_ID}": "*" },
      "permission_groups": [ ${ACCT_PGS_JSON} ]
    },
    {
      "effect": "allow",
      "resources": { "com.cloudflare.api.account.zone.${ZONE_ID}": "*" },
      "permission_groups": [ ${ZONE_PGS_JSON} ]
    },
    {
      "effect": "allow",
      "resources": { "com.cloudflare.api.user.${USER_ID}": "*" },
      "permission_groups": [ ${USER_PGS_JSON} ]
    }
  ]
}
JSON
)

RESP_FILE=$(mktemp -t cf-token-resp.XXXXXX)
trap "rm -f '$RESP_FILE'" EXIT
curl_cf -X POST "$API/user/tokens" -d "$PAYLOAD" -o "$RESP_FILE"

NEW_TOKEN=$(python3 <"$RESP_FILE" <<'PY'
import sys, json
raw = sys.stdin.read()
try:
    r = json.loads(raw)
except json.JSONDecodeError:
    sys.stderr.write("❌ Non-JSON response from Cloudflare:\n" + raw + "\n")
    sys.exit(1)
if r.get("success"):
    print(r["result"]["value"])
else:
    sys.stderr.write("❌ Cloudflare rejected the token request:\n")
    sys.stderr.write(json.dumps(r.get("errors", r), indent=2, ensure_ascii=False) + "\n")
    sys.exit(1)
PY
)

echo "  token name: $TOKEN_NAME"
echo "  token created."

# ─── Step 5: verify token works against the failing endpoint ──────────────────
echo
echo "→ Step 5: verify token can reach /workers/services/uvera (the endpoint CI fails on)…"
VERIFY_RESP=$(curl -sS -H "Authorization: Bearer $NEW_TOKEN" \
  "$API/accounts/$ACCOUNT_ID/workers/services/uvera")

echo "$VERIFY_RESP" | python3 <<'PY'
import sys, json
r = json.loads(sys.stdin.read())
if r.get("success"):
    print("  ✅ token has access to /workers/services/uvera")
else:
    print("  ❌ token still cannot reach the endpoint:")
    print(json.dumps(r.get("errors", r), indent=2, ensure_ascii=False))
    sys.exit(1)
PY

# ─── Step 6: output token for GitHub secret ───────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════════════"
echo "✅ All checks passed. Copy the token below into GitHub Settings →"
echo "   Secrets → Repository secrets → CLOUDFLARE_API_TOKEN (replace existing):"
echo
echo "$NEW_TOKEN"
echo
echo "════════════════════════════════════════════════════════════════════════"
