#!/bin/bash
# Download new wholesale pick-list PDFs into the facility drop folder.
# Does not touch Maurice mint_handoff, LaunchAgents, or the nightly pick QR.
# This script is not run in CI.
#
# Run this on the Trey laptop only:
#   hostname Trey-s-A25
#   user rachaelsseafood
# Do not run it on the Mac mini.
#
# Folder drop still works with WHOLESALE_PULL_PRINTER unset:
#   ~/Documents/Wholesale Ordering/pull-sheets/
#
# Recommended CUPS queue (exact name) on that laptop:
#   WHOLESALE_PULL_PRINTER=Brother_HL_L3280CDW_series
# Model: Brother HL-L3280CDW
# Device URI: dnssd://Brother%20HL-L3280CDW%20series._ipps._tcp.local./?uuid=e3248000-80ce-11db-8000-94ddf83ac040
# Leave the variable unset for folder-drop only. Never send wholesale to the
# Maurice cafe queue Brother_MFC_L5915DW_series.
#
#   BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh --dry-run
#   BRIDGE_API_KEY=... bash scripts/wholesale-pull-mac-poll.sh

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
HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"
RUN_USER="$(id -un)"

python3 - "$payload" "$DEST" "$DRY" "$BASE" "$HOST_SHORT" "$RUN_USER" <<'PY'
import json, os, subprocess, sys, urllib.parse, urllib.request

payload, dest, dry, base, host_short, run_user = sys.argv[1:]
dry = dry == "1"
data = json.loads(payload).get("data") or []
key = os.environ["BRIDGE_API_KEY"]
# Recommended queue. Unset stays folder-drop only; do not fill this in when the env is empty.
RECOMMENDED_QUEUE = "Brother_HL_L3280CDW_series"
MAURICE_CAFE_QUEUE = "Brother_MFC_L5915DW_series"
printer = os.environ.get("WHOLESALE_PULL_PRINTER", "").strip()
on_trey = host_short.lower().split(".")[0] == "trey-s-a25" and run_user == "rachaelsseafood"

if printer:
    folded = printer.lower()
    if printer == MAURICE_CAFE_QUEUE or "mfc_l5915" in folded or "mfc-l5915" in folded:
        print(
            "Refusing Maurice cafe queue Brother_MFC_L5915DW_series. "
            "Wholesale CUPS target is Brother_HL_L3280CDW_series on the Trey laptop.",
            file=sys.stderr,
        )
        sys.exit(1)
    if printer != RECOMMENDED_QUEUE:
        print(
            f"WHOLESALE_PULL_PRINTER must be {RECOMMENDED_QUEUE}, or unset for folder-drop only.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not on_trey:
        print(
            "Wholesale CUPS print runs only on the Trey laptop "
            "(hostname Trey-s-A25, user rachaelsseafood), not the Mac mini.",
            file=sys.stderr,
        )
        sys.exit(1)

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
