#!/usr/bin/env bash
# Low-memory Flutter test runner: compile with the frontend server alone, then run the kernel with
# flutter_tester. Equivalent to `flutter test <file>` but never holds the tool, the compiler and the
# engine in memory at once (useful on small CI runners / constrained sandboxes).
#   tool/run_tests.sh test/screenshots_test.dart
set -euo pipefail
cd "$(dirname "$0")/.."
FLUTTER_ROOT="${FLUTTER_ROOT:-$(dirname "$(dirname "$(command -v flutter)")")}"
C="$FLUTTER_ROOT/bin/cache"
OUT="$(mktemp -d)/test.dill"
entry="${1:?test file}"
coproc FE { "$C/dart-sdk/bin/dartaotruntime" "$C/dart-sdk/bin/snapshots/frontend_server_aot.dart.snapshot" \
  --sdk-root "$C/artifacts/engine/common/flutter_patched_sdk/" --target=flutter --packages .dart_tool/package_config.json \
  --output-dill "$OUT" -Ddart.vm.product=false --enable-asserts "$entry" 2>&1; }
B=""; errors=0
while IFS= read -r line <&"${FE[0]}"; do
  if [ -z "$B" ] && [[ "$line" == result* ]]; then B="${line#result }"; continue; fi
  if [ -n "$B" ] && [[ "$line" == "$B"* ]]; then break; fi
  [[ "$line" == *": Error: "* ]] && errors=$((errors + 1))
  echo "$line"
done
kill "$FE_PID" 2>/dev/null || true
[ "$errors" = "0" ] || { echo "compile failed ($errors errors)"; exit 1; }
FLUTTER_TEST=true "$C/artifacts/engine/linux-x64/flutter_tester" --disable-vm-service --non-interactive --enable-checked-mode \
  --enable-software-rendering --skia-deterministic-rendering --packages=.dart_tool/package_config.json \
  --icu-data-file-path="$C/artifacts/engine/linux-x64/icudtl.dat" "$OUT"
