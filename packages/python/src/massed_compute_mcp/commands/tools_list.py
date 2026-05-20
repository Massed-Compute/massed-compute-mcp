"""`massed-compute-mcp tools` — print the tool catalog."""

import json

from ..tools import TOOLS, TOOL_SPEC_VERSION


def run_tools(argv: list[str]) -> int:
    if "--json" in argv:
        print(json.dumps({"specVersion": TOOL_SPEC_VERSION, "tools": TOOLS}, indent=2))
        return 0
    print(f"Tool spec {TOOL_SPEC_VERSION} — {len(TOOLS)} tools")
    print()
    for t in TOOLS:
        ann = t.get("annotations") or {}
        if ann.get("destructiveHint"):
            mark = " ⚠ destructive"
        elif ann.get("readOnlyHint"):
            mark = "  read-only"
        else:
            mark = "  mutates"
        print(f" {mark}  {t['name']}")
        u = t.get("upstream") or {}
        print(f"            {u.get('method', '?')} {u.get('path', '?')}")
    return 0
