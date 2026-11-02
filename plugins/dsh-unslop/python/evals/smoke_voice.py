#!/usr/bin/env python3
"""Smoke tests for the DSH voice wrappers on the vendored unslop corpus.

Run with the DSH-bundled Python (or any Python 3.8+):

    python python/evals/smoke_voice.py

Covers:
  * teach dry-run writes nothing; apply needs --apply --yes; overwrite is guarded;
  * the written voice has profile.json, card.md + sheets, provenance.json, samples/;
  * voice_score.py is deterministic on the vendored impostor pool and copy gate;
  * voice_mimic.py prepare/score read-only paths and uncovered-situation warnings;
  * voice_card.py --coverage has the full taxonomy.

No network and no model call: these are the deterministic parts of teach/mimic.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "evals" / "fixtures"
SAMPLES = FIXTURES / "silhouette" / "corpus" / "human"
AI_CANDIDATE = FIXTURES / "silhouette" / "corpus" / "ai" / "01_linkedin.txt"
CANDIDATE = SAMPLES / "01_linkedin.txt"
IMPOSTORS = FIXTURES / "voice" / "impostors"
PYTHON = sys.executable

failures = []


def check(name, condition, detail=""):
    if condition:
        print(f"PASS {name}")
    else:
        failures.append(name)
        print(f"FAIL {name}" + (f": {detail}" if detail else ""))


def run(args, stdin=None):
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    completed = subprocess.run(
        [PYTHON, *[str(item) for item in args]],
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(SCRIPTS),
        env=env,
    )
    return completed


def parse(result, name):
    try:
        return json.loads(result.stdout)
    except ValueError as error:
        failures.append(name)
        print(f"FAIL {name}: invalid JSON ({error}); stderr={result.stderr!r}")
        return None


def main():
    if not SAMPLES.is_dir():
        print(f"missing fixture corpus: {SAMPLES}", file=sys.stderr)
        return 2
    if not IMPOSTORS.is_dir():
        print(f"missing impostor corpus: {IMPOSTORS}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="dsh-unslop-smoke-") as tmp:
        work = Path(tmp)
        voices = work / "voices"
        name = "demo"

        # 1. Dry-run: full plan, no filesystem writes.
        dry = run([SCRIPTS / "voice_teach.py", name, "--samples", SAMPLES, "--root", voices])
        check("teach dry-run exits 0", dry.returncode == 0, dry.stderr)
        plan = parse(dry, "teach dry-run JSON")
        if plan is not None:
            check("teach dry-run reports dry_run", plan.get("dry_run") is True and plan.get("applied") is False)
            check("teach dry-run counts 8 docs", plan.get("docs") == 8, str(plan.get("docs")))
            check("teach dry-run flags low confidence", plan.get("low_confidence") is True)
            check("teach dry-run coverage has openings", plan.get("coverage", {}).get("openings", {}).get("covered") is True)
            check("teach dry-run names uncovered praise", "praise" in plan.get("uncovered", []))
            check("teach dry-run plans card sheets", "card/openings.md" in plan.get("planned_files", []))
        check("teach dry-run writes nothing", not voices.exists())

        # 2. Apply is refused without --yes.
        no_yes = run([SCRIPTS / "voice_teach.py", name, "--samples", SAMPLES, "--root", voices, "--apply"])
        check("teach apply without --yes exits 2", no_yes.returncode == 2, str(no_yes.returncode))
        check("teach apply without --yes writes nothing", not (voices / name).exists())

        # 3. Apply writes a complete voice.
        applied = run([
            SCRIPTS / "voice_teach.py", name, "--samples", SAMPLES, "--root", voices,
            "--apply", "--yes",
        ])
        check("teach apply exits 0", applied.returncode == 0, applied.stderr)
        result = parse(applied, "teach apply JSON") or {}
        voice = voices / name
        check("teach apply reports applied", result.get("applied") is True)
        check("profile.json written", (voice / "profile.json").is_file())
        check("card.md written", (voice / "card.md").is_file())
        check("card sheets written", (voice / "card" / "openings.md").is_file())
        check("provenance.json written", (voice / "provenance.json").is_file())
        check("samples copied", (voice / "samples" / "01_linkedin.txt").is_file())
        card_text = (voice / "card.md").read_text(encoding="utf-8")
        check("card is UTF-8 and labelled", card_text.startswith(f"# Voice card: {name}"))
        check("card names uncovered praise", "praise" in card_text and "Uncovered" in card_text)
        provenance = json.loads((voice / "provenance.json").read_text(encoding="utf-8"))
        check("provenance doc count", provenance.get("doc_count") == 8, str(provenance.get("doc_count")))
        check("no staging leftovers", not any(voices.glob(".demo.*")))

        # 4. Re-teach is refused without --overwrite, then accepted with it.
        refuse = run([
            SCRIPTS / "voice_teach.py", name, "--samples", SAMPLES, "--root", voices,
            "--apply", "--yes",
        ])
        check("teach refuses overwrite without flag", refuse.returncode == 2, str(refuse.returncode))
        overwritten = run([
            SCRIPTS / "voice_teach.py", name, "--samples", SAMPLES, "--root", voices,
            "--apply", "--yes", "--overwrite",
        ])
        check("teach overwrite exits 0", overwritten.returncode == 0, overwritten.stderr)

        # 5. Name guard.
        escape_root = work / "escape-root"
        bad = run([SCRIPTS / "voice_teach.py", "../escape", "--samples", SAMPLES, "--root", escape_root])
        check("teach rejects path traversal name", bad.returncode == 2, str(bad.returncode))
        check("teach wrote nothing outside root", not (work / "escape").exists())

        # 6. voice_card --coverage exposes the full taxonomy.
        coverage = run([
            SCRIPTS / "voice_card.py", "--profile", voice / "profile.json",
            "--samples", SAMPLES, "--coverage",
        ])
        check("coverage exits 0", coverage.returncode == 0, coverage.stderr)
        matrix = parse(coverage, "coverage JSON")
        if matrix is not None:
            check("coverage has 10 situations", len(matrix) == 10, str(len(matrix)))
            check("coverage marks openings structural", matrix.get("openings", {}).get("structural") is True)

        # 7. voice_score is deterministic and flags a copied sample.
        score_cmd = [
            SCRIPTS / "voice_score.py", "--profile", voice / "profile.json",
            "--impostors", IMPOSTORS, "--samples", SAMPLES, "--seed", "7", CANDIDATE,
        ]
        first = run(score_cmd)
        second = run(score_cmd)
        check("voice_score exits 0", first.returncode == 0, first.stderr)
        one = parse(first, "voice_score JSON")
        two = parse(second, "voice_score JSON")
        if one is not None and two is not None:
            check("voice_score deterministic", one == two)
            check("composite is a number", isinstance(one.get("composite"), (int, float)))
            check("GI is a rank", isinstance(one.get("gi"), (int, float)) and 0 <= one["gi"] <= 1)
            check("copy gate flags the sample", one.get("copy_gate", {}).get("violation") is True)

        # 8. A foreign candidate is not a copy violation.
        foreign = run([
            SCRIPTS / "voice_score.py", "--profile", voice / "profile.json",
            "--impostors", IMPOSTORS, "--samples", SAMPLES, "--seed", "7", AI_CANDIDATE,
        ])
        foreign_data = parse(foreign, "foreign score JSON")
        if foreign_data is not None:
            check("foreign candidate copy gate is clean",
                  foreign_data.get("copy_gate", {}).get("violation") is False,
                  str(foreign_data.get("copy_gate")))

        # 9. Mimic prepare is read-only and warns on an uncovered situation.
        prepared = run([
            SCRIPTS / "voice_mimic.py", "prepare", "--name", name, "--root", voices,
            "--situation", "praise", "--instruction", "Explain the tradeoff in one paragraph.",
        ])
        check("mimic prepare exits 0", prepared.returncode == 0, prepared.stderr)
        prep = parse(prepared, "mimic prepare JSON") or {}
        check("mimic prepare says uncovered", prep.get("covered") is False)
        check("mimic prepare warns", any("uncovered" in warning for warning in prep.get("warnings", [])))
        check("mimic prepare embeds the card", "VOICE CARD" in prep.get("system", ""))
        check("mimic prepare carries the instruction", "Explain the tradeoff" in prep.get("user", ""))
        check("mimic prepare wrote nothing", not (voice / "prepared.md").exists())

        # 10. A covered situation loads its sheet.
        covered = run([
            SCRIPTS / "voice_mimic.py", "prepare", "--name", name, "--root", voices,
            "--situation", "openings", "--instruction", "Open a short note.",
        ])
        covered_data = parse(covered, "mimic covered JSON") or {}
        check("mimic covered situation has a sheet", covered_data.get("covered") is True)
        check("mimic covered system has a sheet section", "SITUATION SHEET: openings" in covered_data.get("system", ""))

        # 11. Mimic score returns the composite and copy gate.
        mimic_score = run([
            SCRIPTS / "voice_mimic.py", "score", "--name", name, "--root", voices,
            "--candidate", CANDIDATE,
        ])
        check("mimic score exits 0", mimic_score.returncode == 0, mimic_score.stderr)
        mimic_data = parse(mimic_score, "mimic score JSON") or {}
        check("mimic score has a composite", isinstance(mimic_data.get("score", {}).get("composite"), (int, float)))
        check("mimic score has a copy gate", mimic_data.get("copy_gate", {}).get("violation") is True)

        # 12. Missing voice is a clean, non-traceback error.
        missing = run([SCRIPTS / "voice_mimic.py", "prepare", "--name", "nope", "--root", voices,
                       "--instruction", "Write."])
        check("missing voice exits 2", missing.returncode == 2, str(missing.returncode))
        check("missing voice error is JSON", "not found" in missing.stderr and "Traceback" not in missing.stderr)

    if failures:
        print(f"{len(failures)} CHECK(S) FAILED")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
