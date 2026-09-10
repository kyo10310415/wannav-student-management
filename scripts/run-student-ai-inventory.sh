#!/usr/bin/env bash
# Run from the application cwd so dotenv resolution remains unchanged.
set -u
umask 077
inventory_state=${1:?Usage: bash run-student-ai-inventory.sh /absolute/state-directory}
case "$inventory_state" in /*) ;; *) echo 'State directory must be absolute' >&2; exit 2;; esac
for inventory_command in node timeout flock; do
  command -v "$inventory_command" >/dev/null || exit 2
done
inventory_script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 2
mkdir -p "$inventory_state/checkpoints" || exit 2
exec 9>"$inventory_state/run.lock"
flock -n 9 || { echo 'Another measurement is running in this state directory' >&2; exit 2; }
inventory_run=$(mktemp -d "$inventory_state/run.XXXXXX") || exit 2
echo "$inventory_run" > "$inventory_state/latest-run.txt"
echo "開始: $(date -Is)" > "$inventory_run/status.txt"
timeout --kill-after=30s 12h node "$inventory_script_dir/student-ai-inventory.js" \
  --text-limit=all --checkpoint-dir="$inventory_state/checkpoints" \
  > "$inventory_run/result.partial.json" 2> "$inventory_run/progress.log"
inventory_code=$?
if [ "$inventory_code" -eq 0 ]; then
  mv "$inventory_run/result.partial.json" "$inventory_run/result.json" || inventory_code=1
fi
echo "終了: $(date -Is)" >> "$inventory_run/status.txt"
echo "終了コード: $inventory_code" >> "$inventory_run/status.txt"
echo "$inventory_code" > "$inventory_run/exit-code.txt"
exit "$inventory_code"
