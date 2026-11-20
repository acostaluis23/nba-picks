"""
apply_lines.py - one-time patch that adds the PrizePicks lines feature to your existing files.

Run it once from the nba-picks folder:
    .\\.venv\\Scripts\\python.exe apply_lines.py

It changes five of your files in small, exact places (it does not replace them):
    pregame.ps1         runs fetch_lines.py before the deploy (a failure there never stops the run)
    score_night.py      saves each day's lines inside site\\days\\<date>.json so you can grade against them later
    site\\app.js         loads props.json and shows a "PrizePicks 18.5" chip on the Check page
    site\\style.css      styles for that chip
    .gitignore, gitignore  keeps apify_token.txt and site\\props.json out of GitHub

Safe to run twice: anything already applied is skipped. Before changing a file it saves a copy next to it
in the lines-backups folder. If any spot it needs can't be found (because that file has changed since I saw it),
it changes NOTHING and tells you which one, so you can send that file to me.
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent

PREGAME_NEW = """# PrizePicks lines for the Check page and the nightly grade (fetch_lines.py).
# Optional: if this fails, carry on without lines.
& $py fetch_lines.py 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "No new PrizePicks lines this time. Carrying on." }

"""

SCORE_NEW = """    # The PrizePicks lines saved by pregame (fetch_lines.py), so any day can be graded against real lines later.
    lines_file = HERE / "archive" / f"lines-{slate['meta']['slate_date']}.json"
    day["lines"] = None
    if lines_file.exists():
        try:
            day["lines"] = json.load(open(lines_file, encoding="utf-8"))
        except Exception:  # noqa: BLE001 - a bad lines file must never stop grading
            day["lines"] = None
"""

JS_LOAD = """  function loadLines() {
    return loadJSON("props.json")
      .then(function (j) { state.pp = j && j.meta && j.lines && j.meta.slate_date ? j : null; })
      .catch(function () { state.pp = null; });
  }

"""

JS_HELPERS = """  // ----- PrizePicks lines (props.json, saved by fetch_lines.py) -----
  // Only used when the saved lines are for the same day as this page. Without them nothing changes.
  function ppLine(p, stat, date) {
    var pp = state.pp;
    if (!pp || !p || pp.meta.slate_date !== date) return null;
    var l = pp.lines[String(p.id)];
    return l && typeof l[stat] === "number" ? l[stat] : null;
  }
  function ppTime() {
    var d = new Date(state.pp.meta.fetched_at);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function ppRow(p, stat, line, date) {
    var v = ppLine(p, stat, date);
    if (v === null) return "";
    var same = line !== null && isFinite(line) && Math.abs(line - v) < 0.001;
    var t = ppTime();
    return '<div class="ppl"><span class="ppk">PrizePicks</span>' +
      (same ? '<span class="ppv">' + esc(vtxt(v, stat)) + " <i>matches your number</i></span>"
        : '<button type="button" class="ppchip" data-pp="' + v + '">Use ' + esc(vtxt(v, stat)) + "</button>") +
      (t ? '<span class="ppt">as of ' + esc(t) + "</span>" : "") + "</div>";
  }
"""

JS_CLICK = """      var pc = e.target.closest("[data-pp]");
      if (pc) { goCheck(c.id, c.stat, parseFloat(pc.dataset.pp), c.date); return; }
"""

JS_SLOT = """      '<div id="ppSlot">' + ppRow(p, stat, saved !== undefined ? saved : null, state.day) + "</div>" +
"""

JS_DETAIL_WIRE = """        applyLine(p, stat, block);
        var slot1 = $("ppSlot");
        if (slot1) slot1.innerHTML = ppRow(p, stat, isFinite(v) ? v : null, state.day);
      });
      applyLine(p, stat, block);
      var slot = $("ppSlot");
      if (slot) {
        slot.addEventListener("click", function (e) {
          var pc = e.target.closest("[data-pp]");
          if (!pc) return;
          input.value = pc.dataset.pp;
          input.dispatchEvent(new Event("input"));
        });
      }
    }"""

JS_CARD_HELPERS = """  // PrizePicks line on the Games cards and list rows (same stat as the chip that is selected).
  function ppCard(p, stat) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="rpp"><i>PrizePicks</i><b>' + esc(vtxt(v, stat)) + "</b></span>";
  }
  function ppList(p, stat) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="lpp"><small>PrizePicks</small><b>' + esc(vtxt(v, stat)) + "</b></span>";
  }
  function ppTick(p, stat, scale) {
    var v = ppLine(p, stat, state.data.meta.slate_date);
    return v === null ? "" : '<span class="lppt" style="left:' + barPct(v, scale) + '%"></span>';
  }
"""

CSS_CARDS = """.rpp { display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--muted); }
.rpp i { font-style: normal; }
.rpp b { color: var(--amber); font-weight: 700; }
.lpp { display: flex; align-items: baseline; gap: 5px; }
.lpp small { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.lpp b { font-family: var(--display); font-weight: 700; font-size: 18px; line-height: 1; color: var(--amber); }
.lppt { position: absolute; top: -4px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: var(--amber); }
"""

CSS_NEW = """
/* PrizePicks line on the Check page */
.ppl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; font-size: 13px; color: var(--muted); }
.ppk { font-weight: 600; color: var(--text-2); }
.ppchip { height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--amber); background: var(--amber-soft); color: var(--amber); font-size: 14px; font-weight: 700; cursor: pointer; }
.ppchip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ppv { color: var(--text); font-weight: 600; }
.ppv i { font-style: normal; font-weight: 400; color: var(--accent); }
.ppt { margin-left: auto; font-size: 12px; }
"""

# Each edit: file, marker (present = already applied), then either
#   before: insert `new` just before the one line/text `anchor`
#   replace: swap `anchor` for `new`
#   append: add `new` at the end of the file
EDITS = [
    ("pregame.ps1", "fetch_lines.py", "before", '& (Join-Path $root "deploy.ps1") | Out-Host', PREGAME_NEW),
    ("score_night.py", "lines-{slate['meta']", "before",
     '    path = days_dir / f"{slate[\'meta\'][\'slate_date\']}.json"', SCORE_NEW),
    ("site/app.js", "pp: null }", "replace", 'chk: null, shown: "" };', 'chk: null, shown: "", pp: null };'),
    ("site/app.js", "function loadLines", "before", '  fetch("slate.json", { cache: "no-cache" })', JS_LOAD),
    ("site/app.js", "loadPreview(), loadLines()]).then(function () { start", "replace",
     "loadPreview()]).then(function () { start(data); });", "loadPreview(), loadLines()]).then(function () { start(data); });"),
    ("site/app.js", "Promise.all([loadInjuries(), loadResults(), loadPreview(), loadLines()])", "replace",
     "Promise.all([loadInjuries(), loadResults(), loadPreview()]).then(function () {\n      var onPreview",
     "Promise.all([loadInjuries(), loadResults(), loadPreview(), loadLines()]).then(function () {\n      var onPreview"),
    ("site/app.js", "function ppRow", "before", "  function goCheck(id, stat, line, date) {", JS_HELPERS),
    ("site/app.js", "ppRow(p, stat, line, state.day)", "replace",
     '<p class="cerr" id="ckErr" role="alert" hidden></p></form>\';\n\n    state.chk = {',
     '<p class="cerr" id="ckErr" role="alert" hidden></p></form>\';\n    h += ppRow(p, stat, line, state.day);\n\n    state.chk = {'),
    ("site/app.js", "[data-pp]", "before", '      var s = e.target.closest("[data-cstat]");', JS_CLICK),
    ("site/style.css", ".ppchip", "append", None, CSS_NEW),
    # Games cards and list rows
    ("site/app.js", "function ppCard", "before", "  function ppRow(p, stat, line, date) {", JS_CARD_HELPERS),
    ("site/app.js", "ppCard(p, state.stat)", "replace", "'<div class=\"foot\"><span class=\"r1\">'",
     "'<div class=\"foot\">' + ppCard(p, state.stat) + '<span class=\"r1\">'"),
    ("site/app.js", "ppList(p, stat) + (special", "replace", "'<div class=\"lproj\">' + (special ? \"\" : changeHtml(b))",
     "'<div class=\"lproj\">' + ppList(p, stat) + (special ? \"\" : changeHtml(b))"),
    ("site/app.js", "ppTick(p, stat, scale) +", "replace",
     "'<span class=\"ltick\" style=\"left:' + barPct(b.proj, scale) + '%\"></span>' +",
     "'<span class=\"ltick\" style=\"left:' + barPct(b.proj, scale) + '%\"></span>' +\n        ppTick(p, stat, scale) +"),
    ("site/style.css", ".lppt", "append", None, CSS_CARDS),
    # player page ("Compare to a line" box): the same PrizePicks button
    ("site/app.js", 'id="ppSlot"', "before", "      '<div class=\"probs\" id=\"lineResult\">", JS_SLOT),
    ("site/app.js", "slot1", "replace",
     "        applyLine(p, stat, block);\n      });\n      applyLine(p, stat, block);\n    }",
     JS_DETAIL_WIRE),
]
IGNORE_LINES = ["apify_token.txt", "site/props.json"]


def read(path):
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    return text, bom


def main():
    results = {}      # path -> (text, bom, changed)
    problems = []
    notes = []

    def get(rel):
        p = ROOT / rel
        if rel not in results:
            if not p.exists():
                return None
            t, b = read(p)
            results[rel] = [t, b, False]
        return results[rel]

    for rel, marker, how, anchor, new in EDITS:
        st = get(rel)
        if st is None:
            problems.append(f"{rel}: file not found")
            continue
        text = st[0]
        nl = "\r\n" if "\r\n" in text else "\n"
        fix = lambda s: s.replace("\r\n", "\n").replace("\n", nl)  # noqa: E731
        if marker in text:
            notes.append(f"{rel}: already has this change ({marker[:30]!r}), skipped")
            continue
        if how == "append":
            st[0] = text.rstrip("\r\n") + nl + fix(new)
            st[2] = True
            continue
        a, n = fix(anchor), fix(new)
        if text.count(a) == 0 and n in text:
            notes.append(f"{rel}: already has this change, skipped")
            continue
        if text.count(a) != 1:
            problems.append(f"{rel}: expected to find this exactly once but found {text.count(a)}: {anchor.strip()[:70]!r}")
            continue
        st[0] = text.replace(a, n) if how == "replace" else text.replace(a, n + a)
        st[2] = True

    # .gitignore files (either or both may exist)
    for rel in (".gitignore", "gitignore"):
        st = get(rel)
        if st is None:
            continue
        have = set(x.strip() for x in st[0].splitlines())
        add = [x for x in IGNORE_LINES if x not in have]
        if add:
            nl = "\r\n" if "\r\n" in st[0] else "\n"
            st[0] = st[0].rstrip("\r\n") + nl + nl.join(add) + nl
            st[2] = True

    if problems:
        print("NOTHING WAS CHANGED. These spots could not be found, so one of your files has changed since I saw it:")
        for x in problems:
            print("  -", x)
        print("Send me the file(s) named above and I'll adjust the patch.")
        return 1

    changed = 0
    for rel, (text, bom, did) in results.items():
        if not did:
            continue
        p = ROOT / rel
        bdir = ROOT / "lines-backups"
        bdir.mkdir(exist_ok=True)
        bak = bdir / (rel.replace("/", "_") + ".bak")
        if not bak.exists():
            shutil.copy2(p, bak)
        p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
        print(f"Updated {rel}  (backup: lines-backups\\{bak.name})")
        changed += 1
    for n in notes:
        print("Note:", n)
    if not changed:
        print("Nothing to do: everything was already applied.")
    else:
        print("\nDone. Next: make sure apify_token.txt exists, then run  python fetch_lines.py  to try it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
