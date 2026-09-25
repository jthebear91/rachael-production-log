#!/bin/bash
# Download new wholesale pick-list PDFs into the facility drop folder.
# Does not touch Maurice mint_handoff, LaunchAgents, or the nightly pick QR.
# v1 print path is the folder drop. WHOLESALE_PULL_PRINTER is optional and
# not required. This script is not run in CI.
#
#   BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh
#   BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh --dry-run
#
# Drop folder (watched by the facility Mac):
#   ~/Documents/Wholesale Ordering/pull-sheets/
# Optional later: WHOLESALE_PULL_PRINTER="HP_something" sends the saved file
# to CUPS. Leave it unset until the queue name is known.

set -euo pipefail

BASE="${APP_BASE_URL:-https://rachael-production-log.vercel.app}"
BASE="${BASE%/}"
DEST="${HOME}/Documents/Wholesale Ordering/pull-sheets"
DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY=1
fi

if [[ -z "${BRIDGE_API_KEY:-}" ]]; then
  echo "BRIDGE_API_KEY is not set" >&2
  exit 1
fi

mkdir -p "$DEST"
payload="$(curl -fsS "${BASE}/api/wholesale-pull/sheets" -H "Authorization: Bearer ${BRIDGE_API_KEY}")"

python3 - "$payload" "$DEST" "$DRY" "$BASE" <<'PY'
import json, os, subprocess, sys, urllib.parse, urllib.request

payload, dest, dry, base = sys.argv[1:]
dry = dry == "1"
data = json.loads(payload).get("data") or []
key = os.environ["BRIDGE_API_KEY"]
printer = os.environ.get("WHOLESALE_PULL_PRINTER", "").strip()

if not data:
    print("No pending pick lists.")
    sys.exit(0)

for row in data:
    pull_key = row.get("key")
    account = row.get("account") or "pull"
    print(f"{pull_key}  {account}  {row.get('reference') or ''}")
    if dry:
        continue
    query = urllib.parse.urlencode({"format": "pdf", "key": pull_key})
    req = urllib.request.Request(
        f"{base}/api/wholesale-pull/sheets?{query}",
        headers={"Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req) as res:
        pdf = res.read()
    safe = "".join(ch if ch.isalnum() else "-" for ch in f"{account}-{pull_key}")[:80].strip("-")
    path = os.path.join(dest, f"pick-list-{safe or 'wholesale'}.pdf")
    tmp = path + ".partial"
    with open(tmp, "wb") as fh:
        fh.write(pdf)
    os.replace(tmp, path)
    print(f"saved {path}")
    if printer:
        subprocess.check_call(["lp", "-d", printer, path])
        print(f"sent to {printer}")
    mark = urllib.request.Request(
        f"{base}/api/wholesale-pull/sheets",
        data=json.dumps({"key": pull_key}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(mark) as res:
        res.read()
    print(f"marked printed {pull_key}")
PY
