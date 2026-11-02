#!/usr/bin/env python3
"""Prepare and score a taught voice (DSH wrapper around voice_score.py).

Two deterministic, read-only subcommands:

    prepare  assemble the always-on card + one situation sheet into a prompt
             for a generator (no model call, nothing written);
    score    run voice_score.py against the voice profile and the vendored
             impostor pool, optionally with the copy gate.

Writing the generated draft is the DSH tool's job: it requires explicit
confirmation and an output path. This CLI never edits or creates prose.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import voice_card  # noqa: E402
import voice_store  # noqa: E402

DEFAULT_SEED = 7


def _read(path):
    return voice_store.read_text_file(path)


def _uncovered_from_card(card):
    for line in card.splitlines():
        if line.startswith("Uncovered ("):
            _, _, rest = line.partition(":")
            return [item.strip() for item in rest.rstrip(".").split(",") if item.strip()]
    return []


def _load(name, root):
    voice = voice_store.load_voice(root, name)
    profile = voice["profile"]
    metadata = profile.get("metadata", {}) if isinstance(profile, dict) else {}
    return voice, metadata


def build_system(voice, metadata, situation, sheet_text):
    """Build the system prompt used by the DSH mimic tool."""
    lines = [
        "You are UNSLOP's mimic: you write or rewrite prose in a taught author's voice.",
        "Match how the author writes, not what the samples are about.",
        "Do not copy sample sentences verbatim; reuse habits, rhythm and diction.",
        "Facts are a hard boundary: keep every number, name, date, unit, quote,",
        "negation and scope word. Do not add facts, examples or claims.",
        "The voice card is evidence, not inspiration: do not invent a habit the",
        "samples cannot support. Everything on the card comes from measured facts",
        "or verbatim snippets.",
        "Output only the requested prose. No preamble, no commentary, no code fences.",
        "",
        "=== ALWAYS-ON VOICE CARD ===",
        voice["card"].strip(),
    ]
    if sheet_text:
        lines.extend([
            "",
            f"=== SITUATION SHEET: {situation} ===",
            sheet_text.strip(),
        ])
    elif situation:
        lines.extend([
            "",
            f"NOTE: the samples have no coverage for {situation!r}. Do not invent a voice "
            "for it; write plainly and keep the always-on card's habits.",
        ])
    if metadata.get("low_confidence"):
        lines.extend([
            "",
            "NOTE: this profile is low-confidence (thin or cross-genre samples).",
            "Write carefully and do not overclaim the author's habits.",
        ])
    return "\n".join(lines)


def build_user(instruction, draft):
    parts = []
    if instruction:
        parts.append("Task: " + instruction.strip())
    if draft:
        parts.append(
            "Rewrite the draft in the taught voice. Preserve its meaning and every fact.\n\n"
            "--- DRAFT ---\n" + draft.strip()
        )
    if not parts:
        parts.append("Write a short passage in this voice.")
    return "\n\n".join(parts)


def prepare(args):
    voice, metadata = _load(args.name, args.root)
    situation = args.situation
    sheet_text = None
    sheet_path = None
    warnings = []
    if situation:
        candidate = voice["directory"] / "card" / f"{situation}.md"
        if candidate.is_file():
            sheet_text = _read(candidate)
            sheet_path = str(candidate)
        else:
            warnings.append(
                f"situation {situation!r} is uncovered for this voice; no sheet exists. "
                "Do not fabricate its voice."
            )
    if metadata.get("low_confidence"):
        warnings.append(
            f"low confidence: {metadata.get('total_words', 0)} words; "
            "add same-genre samples before trusting mimic scores"
        )
    draft = ""
    if args.draft:
        draft_path = Path(args.draft).expanduser()
        if not draft_path.is_file():
            raise voice_store.VoiceError(f"draft not found: {draft_path}")
        draft = _read(draft_path)
    instruction = args.instruction or ""
    if not draft and not instruction.strip():
        raise voice_store.VoiceError("prepare needs --instruction or --draft")

    impostors = Path(args.impostors).expanduser() if args.impostors else voice_store.default_impostors()
    if not impostors.is_dir():
        raise voice_store.VoiceError(
            f"impostor corpus not found: {impostors}; pass --impostors DIR"
        )
    samples = voice["samples_dir"]
    return {
        "ok": True,
        "tool": "voice_mimic",
        "mode": "prepare",
        "voice": voice["name"],
        "voice_dir": str(voice["directory"].resolve()),
        "profile_path": str(voice["profile_path"]),
        "samples_dir": str(samples) if samples else None,
        "impostors": str(impostors.resolve()),
        "seed": args.seed,
        "situation": situation,
        "sheet_path": sheet_path,
        "covered": bool(sheet_text),
        "uncovered": _uncovered_from_card(voice["card"]),
        "low_confidence": bool(metadata.get("low_confidence", False)),
        "profile_metadata": metadata,
        "card": voice["card"],
        "sheet": sheet_text,
        "system": build_system(voice, metadata, situation, sheet_text),
        "user": build_user(instruction, draft),
        "warnings": warnings,
    }


def _run_scorer(command, stdin_text):
    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    completed = subprocess.run(
        command,
        input=stdin_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise voice_store.VoiceError(
            f"voice_score.py failed with exit {completed.returncode}: {detail or 'no output'}"
        )
    try:
        return json.loads(completed.stdout)
    except ValueError as error:
        raise voice_store.VoiceError(f"voice_score.py returned invalid JSON: {error}") from error


def score(args):
    voice, _ = _load(args.name, args.root)
    impostors = Path(args.impostors).expanduser() if args.impostors else voice_store.default_impostors()
    if not impostors.is_dir():
        raise voice_store.VoiceError(
            f"impostor corpus not found: {impostors}; pass --impostors DIR"
        )
    samples = Path(args.samples).expanduser() if args.samples else voice["samples_dir"]
    if samples is not None and not samples.is_dir():
        raise voice_store.VoiceError(f"samples directory not found: {samples}")

    stdin_text = None
    candidate = args.candidate
    if candidate == "-":
        stdin_text = sys.stdin.buffer.read().decode("utf-8", errors="replace")

    command = [
        sys.executable,
        str(SCRIPT_DIR / "voice_score.py"),
        "--profile", str(voice["profile_path"]),
        "--impostors", str(impostors),
        "--seed", str(args.seed),
    ]
    if samples is not None:
        command.extend(["--samples", str(samples)])
    command.append(candidate)
    result = _run_scorer(command, stdin_text)

    return {
        "ok": True,
        "tool": "voice_mimic",
        "mode": "score",
        "voice": voice["name"],
        "voice_dir": str(voice["directory"].resolve()),
        "candidate": candidate,
        "impostors": str(impostors.resolve()),
        "samples_dir": str(samples) if samples else None,
        "score": result,
        "copy_gate": result.get("copy_gate"),
        "interpretation": {
            "lower_composite_is_better": True,
            "gi": "fraction of random feature-subset trials where the candidate beats "
                  "the sampled impostors; higher is more author-like",
            "note": "composite is a guide, not an oracle; slop and preservation gates "
                    "remain separate hard checks",
        },
    }


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Prepare or score a taught voice (read-only; no prose is written).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    prep = sub.add_parser("prepare", help="assemble the card + sheet prompt")
    prep.add_argument("--name", required=True)
    prep.add_argument("--root", default=str(Path.cwd() / ".unslop" / "voice"))
    prep.add_argument("--situation", choices=voice_card.TAXONOMY)
    prep.add_argument("--instruction", default="")
    prep.add_argument("--draft", help="draft file to rewrite (read-only)")
    prep.add_argument("--impostors", help="impostor corpus (default: vendored pool)")
    prep.add_argument("--seed", type=int, default=DEFAULT_SEED)

    score_cmd = sub.add_parser("score", help="score a candidate with voice_score.py")
    score_cmd.add_argument("--name", required=True)
    score_cmd.add_argument("--root", default=str(Path.cwd() / ".unslop" / "voice"))
    score_cmd.add_argument("--candidate", required=True, help="candidate file, or - for stdin")
    score_cmd.add_argument("--impostors", help="impostor corpus (default: vendored pool)")
    score_cmd.add_argument("--samples", help="samples for the copy gate (default: voice samples)")
    score_cmd.add_argument("--seed", type=int, default=DEFAULT_SEED)

    return parser.parse_args(argv)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args(argv)
    try:
        result = prepare(args) if args.command == "prepare" else score(args)
        print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
        return 0
    except voice_store.VoiceError as error:
        print(json.dumps({"ok": False, "tool": "voice_mimic", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    except OSError as error:
        print(json.dumps({"ok": False, "tool": "voice_mimic", "error": f"filesystem error: {error}"},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
