"""Fixed NAJD script for najd_office_review: the Office kit's lint (decks) and a bounded inspect, as one JSON line.
Usage: python -I -B kit_report.py <pack site-packages> <kit parent folder> <file>"""
import json
import site
import sys

site.addsitedir(sys.argv[1])
sys.path.append(sys.argv[2])
from najd_office import inspect, lint  # noqa: E402

path = sys.argv[3]
report = {}
try:
    if path.lower().endswith(".pptx"):
        checked = lint(path)
        report["lint"] = {"issues": checked["issues"][:40], "issueCount": len(checked["issues"]), "slides": checked["slides"], "motion": checked["motion"]}
    view = inspect(path, limit=160)
    if view.get("kind") == "pptx":
        # Compact structure: names, text and animations per slide; boxes only when asked through python.
        view["slides"] = [{"slide": slide["slide"], "shapes": [{key: shape[key] for key in ("name", "text", "rtl", "chart", "table") if key in shape} for shape in slide["shapes"][:25]],
                           "animations": slide["animations"], "transition": slide["transition"]} for slide in view["slides"][:40]]
    report["inspect"] = view
except Exception as error:  # reported, never hidden
    report["error"] = "%s: %s" % (type(error).__name__, str(error)[:300])
print("NAJD-KIT " + json.dumps(report, ensure_ascii=False, separators=(",", ":"), default=str))
