#!/bin/bash
# Publish the NEAR entry repo to GitHub as a PUBLIC repository.
#
#   GITHUB_TOKEN=ghp_xxx sh tools/earning/publish-github-repo.sh [repo-name]
#
# Why this exists: the DAiL NEAR bounties say "public GitHub repo" in the description.
# There is NO GitHub credential on this box, so the entry was published to
# https://near-entry.surge.sh/ as the fallback public home. The moment a token
# exists, this script creates the public repo and pushes the IDENTICAL tree, so both
# URLs can be cited in the (immutable) submission body.
#
# Reads the token from $GITHUB_TOKEN or ~/.openwork/github-token (mode 600).
# It never prints the token.
set -euo pipefail

WORKSPACE="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$(cd "$(dirname "$0")/../.." && pwd)"   # the tree this script lives in
NAME="${1:-near-passport}"
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.openwork/github-token" ]; then
  TOKEN="$(tr -d '\r\n' < "$HOME/.openwork/github-token")"
fi
[ -n "$TOKEN" ] || { echo "ABORT: no GITHUB_TOKEN and no ~/.openwork/github-token" >&2; exit 1; }
[ -d "$SRC/.git" ] || { echo "ABORT: $SRC is not a git repo" >&2; exit 1; }

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "== who am i =="
LOGIN=$(curl -s "${AUTH[@]}" "$API/user" | python3 -c "import json,sys; print(json.load(sys.stdin).get('login','?'))")
echo "login: $LOGIN"

echo "== create (or reuse) the public repo =="
EXISTING=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$API/repos/$LOGIN/$NAME")
if [ "$EXISTING" = "200" ]; then
  echo "repo $LOGIN/$NAME already exists - reusing"
else
  curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"description\":\"PASSPORT - a portable agent reputation passport with escrow history. A vector of category scores, a conjunction gate, and a signed, chained passport card. Deployed on NEAR testnet (orbit-passport.testnet). Built for the DAiL NEAR bounty bnty_0415.\",\"private\":false,\"has_issues\":false,\"has_wiki\":false,\"auto_init\":false}" \
    "$API/user/repos" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d.get('full_name'): print('created', d['full_name'], 'private=', d.get('private'))
else: print('CREATE FAILED:', json.dumps(d)[:400]); raise SystemExit(1)
"
fi

echo "== push =="
cd "$SRC"
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/$LOGIN/$NAME.git"
# never let the token end up in the repo config after the push
git push -u origin main
git remote set-url origin "https://github.com/$LOGIN/$NAME.git"
echo
echo "public repo: https://github.com/$LOGIN/$NAME"
echo "clone: git clone https://github.com/$LOGIN/$NAME.git"
