#!/bin/bash
# Download new wholesale pick-list PDFs into the facility drop folder.
# Does not touch Maurice mint_handoff, LaunchAgents, or the nightly pick QR.
# This script is not run in CI.
#
# Run this on the wholesale Mac only:
#   user rachaelsseafood
#   machineId 1c85823c-2c30-4ffb-b905-0241b4daebfe
# The Mac network name may show as Trey-s-A25. That is the network name, not the printer.
# Do not run it on the Mac mini.
#
# Folder drop (always, including when CUPS is skipped):
#   ~/Documents/Wholesale Ordering/pull-sheets/
#
# Default CUPS queue (exact). Model: Brother HL-L3280CDW.
# WHOLESALE_PULL_PRINTER=Brother_HL_L3280CDW_series
# When CUPS is armed, that queue is the only wholesale target.
# Device URI: dnssd://Brother%20HL-L3280CDW%20series._ipps._tcp.local./?uuid=e3248000-80ce-11db-8000-94ddf83ac040
# Set WHOLESALE_PULL_PRINTER to empty for folder-drop only.
# MFC-L5915DW is Maurice-only and must never be used for wholesale.
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
RUN_USER="$(id -un)"
MACHINE_ID=""
if command -v ioreg >/dev/null 2>&1; then
  MACHINE_ID="$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4; exit}')"
fi

python3 - "$payload" "$DEST" "$DRY" "$BASE" "$RUN_USER" "$MACHINE_ID" <<'PY'
import json, os, subprocess, sys, urllib.parse, urllib.request

payload, dest, dry, base, run_user, machine_id = sys.argv[1:]
dry = dry == "1"
data = json.loads(payload).get("data") or []
key = os.environ["BRIDGE_API_KEY"]
WHOLESALE_QUEUE = "Brother_HL_L3280CDW_series"
WHOLESALE_USER = "rachaelsseafood"
WHOLESALE_MACHINE_ID = "1c85823c-2c30-4ffb-b905-0241b4daebfe"
# Unset defaults to the wholesale queue. An explicit empty value is folder-drop only.
if "WHOLESALE_PULL_PRINTER" not in os.environ:
    printer = WHOLESALE_QUEUE
else:
    printer = os.environ.get("WHOLESALE_PULL_PRINTER", "").strip()
on_wholesale_mac = (
    run_user == WHOLESALE_USER
    and machine_id.lower() == WHOLESALE_MACHINE_ID
)

if printer:
    folded = printer.lower()
    if "mfc-l5915" in folded or "mfc_l5915" in folded:
        print(
            "MFC-L5915DW is Maurice-only and must never be used for wholesale. "
            f"Wholesale CUPS target is {WHOLESALE_QUEUE}.",
            file=sys.stderr,
        )
        sys.exit(1)
    if printer != WHOLESALE_QUEUE:
        print(
            f"When CUPS is armed, WHOLESALE_PULL_PRINTER must be {WHOLESALE_QUEUE}. "
            "Leave it empty for folder-drop only.",
            file=sys.stderr,
        )
        sys.exit(1)
if not dry and not on_wholesale_mac:
    print(
        "This poll runs on the wholesale Mac only "
        f"(user {WHOLESALE_USER}, machineId {WHOLESALE_MACHINE_ID}), not the Mac mini. "
        "Nothing was printed or marked.",
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
