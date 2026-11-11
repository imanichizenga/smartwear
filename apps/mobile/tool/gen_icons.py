"""Regenerate lib/ui/icons.dart: a tiny Lucide subset (300 weight) so the app never imports the
20k-line icon libraries. Usage: python3 tool/gen_icons.py <path-to lucide_icons_flutter package> name…"""
import re
import sys
from pathlib import Path

pkg, names = Path(sys.argv[1]), sys.argv[2:]
src = (pkg / "lib" / "lucide_icons_300.dart").read_text()
lines = ["/// Lucide (300 weight) — only the glyphs SmartWear uses. Codepoints from lucide_icons_flutter;",
         "/// the font (ISC licence) is bundled as assets/fonts/Lucide300.ttf. Regenerate with tool/gen_icons.py.",
         "import 'package:flutter/widgets.dart';", "", "abstract final class Ic {"]
for n in names:
    m = re.search(r"static const IconData %s = const IconData\((\d+)" % re.escape(n), src)
    if not m:
        sys.exit(f"unknown icon {n}")
    lines.append(f"  static const IconData {n} = IconData({m.group(1)}, fontFamily: 'Lucide300');")
lines.append("}")
Path(__file__).resolve().parents[1].joinpath("lib/ui/icons.dart").write_text("\n".join(lines) + "\n")
