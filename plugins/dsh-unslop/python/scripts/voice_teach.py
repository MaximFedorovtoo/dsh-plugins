#!/usr/bin/env python3
"""Teach a reusable voice from .txt/.md samples (DSH wrapper).

This is the deterministic half of ``/unslop teach``: it builds
``profile.json`` (voice_profile.py), the layered ``card.md`` + ``card/*.md``
sheets (voice_card.py) and ``provenance.json`` under
``<voice-root>/<name>/``.

Safety contract:
  * dry-run is the default and writes nothing;
  * files are written only with ``--apply`` **and** ``--yes``;
  * an existing voice is replaced only with ``--overwrite`` as well;
  * source samples are copied, never edited.

The voice root is chosen by the caller (``dsh-unslop`` picks the project
``.unslop/voice`` directory, or a per-session cache directory for chat scope).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import voice_card  # noqa: E402
import voice_profile  # noqa: E402
import voice_store  # noqa: E402

LOW_CONFIDENCE_WORDS = 2000
RECOMMENDED_DOCS = 5


def _read(path):
    return voice_store.read_text_file(path)


def _sample_docs(samples_dir):
    return sorted(voice_profile.iter_docs(samples_dir))


def _coverage(samples_dir):
    docs = voice_card.collect(samples_dir)
    matrix, _ = voice_card.coverage_matrix(docs)
    return matrix


def _planned_files(docs, samples_dir, matrix):
    planned = []
    for doc in docs:
        rel = doc.relative_to(samples_dir).as_posix()
        planned.append(f"samples/{rel}")
    planned.extend(["profile.json", "card.md"])
    for dim in voice_card.TAXONOMY:
        if matrix[dim]["covered"]:
            planned.append(f"card/{dim}.md")
    planned.append("provenance.json")
    return planned


def build_plan(name, root, samples_dir, background):
    """Return the JSON-safe dry-run plan; performs no writes."""
    docs = _sample_docs(samples_dir)
    if not docs:
        raise voice_store.VoiceError(
            f"no .txt/.md sample documents in {samples_dir}; teach reads only those "
            "extensions recursively"
        )

    profile = voice_profile.build_profile(samples_dir, background)
    matrix = _coverage(samples_dir)
    target = voice_store.voice_dir(root, name)
    total_words = int(profile.get("total_words", 0))
    low_confidence = bool(profile.get("metadata", {}).get("low_confidence", total_words < LOW_CONFIDENCE_WORDS))
    uncovered = [dim for dim in voice_card.TAXONOMY if not matrix[dim]["covered"]]

    warnings = []
    if low_confidence:
        warnings.append(
            f"low confidence: {total_words} words is below the {LOW_CONFIDENCE_WORDS}-word "
            "recommendation; add same-genre samples before trusting mimic scores"
        )
    if len(docs) < RECOMMENDED_DOCS:
        warnings.append(
            f"only {len(docs)} document(s); at least {RECOMMENDED_DOCS} same-genre documents "
            "are recommended"
        )
    if uncovered:
        warnings.append("uncovered situations: " + ", ".join(uncovered))

    target_exists = target.exists()
    non_empty = target_exists
    if target_exists and target.is_dir():
        non_empty = any(target.iterdir())
    if target_exists:
        warnings.append(f"voice {name!r} already exists at {target}; apply needs --overwrite")

    return {
        "ok": True,
        "tool": "voice_teach",
        "dry_run": True,
        "applied": False,
        "name": name,
        "root": str(Path(root).expanduser().resolve()),
        "voice_dir": str(target.resolve()),
        "samples_dir": str(Path(samples_dir).expanduser().resolve()),
        "docs": len(docs),
        "total_words": total_words,
        "low_confidence": low_confidence,
        "profile_metadata": profile.get("metadata", {}),
        "coverage": matrix,
        "uncovered": uncovered,
        "planned_files": _planned_files(docs, samples_dir, matrix),
        "target_exists": target_exists,
        "target_non_empty": bool(non_empty),
        "overwrite_required": bool(non_empty),
        "warnings": warnings,
    }


def _copy_samples(docs, samples_dir, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for doc in docs:
        relative = doc.relative_to(samples_dir)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(doc, target)


def _stage_voice(stage, name, docs, samples_dir, background):
    """Build a complete voice inside *stage*; returns the profile dict."""
    _copy_samples(docs, samples_dir, stage / "samples")
    profile = voice_profile.build_profile(stage / "samples", background)
    (stage / "profile.json").write_text(
        json.dumps(profile, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    result = voice_card.main([
        "--profile", str(stage / "profile.json"),
        "--samples", str(stage / "samples"),
        "--out", str(stage),
        "--name", name,
        "--provenance",
    ])
    if result != 0:
        raise voice_store.VoiceError(
            f"voice_card.py failed with exit {result}; the profile does not describe "
            "the copied samples"
        )
    # voice_card.py writes markdown with the platform default encoding. Store
    # the generated cards as UTF-8 so a voice is portable across machines.
    for card in [stage / "card.md", *sorted((stage / "card").glob("*.md"))]:
        text = voice_store.read_text_file(card)
        with card.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    return profile


def apply_voice(name, root, samples_dir, background, overwrite):
    """Build and atomically install a voice. Returns (profile, voice_dir)."""
    docs = _sample_docs(samples_dir)
    if not docs:
        raise voice_store.VoiceError(f"no .txt/.md sample documents in {samples_dir}")

    root = Path(root).expanduser()
    if root.exists() and not root.is_dir():
        raise voice_store.VoiceError(f"voices root exists and is not a directory: {root}")
    target = voice_store.voice_dir(root, name)
    if target.is_symlink():
        raise voice_store.VoiceError(f"refusing to replace a symlinked voice path: {target}")
    if target.exists() and not target.is_dir():
        raise voice_store.VoiceError(f"voice path exists and is not a directory: {target}")
    if target.is_dir() and any(target.iterdir()) and not overwrite:
        raise voice_store.VoiceError(
            f"voice {name!r} already exists at {target}; pass --overwrite to replace it"
        )

    root.mkdir(parents=True, exist_ok=True)
    stage = root / f".{name}.tmp-{uuid.uuid4().hex}"
    stage.mkdir()
    backup = None
    try:
        profile = _stage_voice(stage, name, docs, samples_dir, background)
        if target.exists():
            backup = root / f".{name}.bak-{uuid.uuid4().hex}"
            target.rename(backup)
            try:
                stage.rename(target)
            except Exception:
                backup.rename(target)
                backup = None
                raise
        else:
            stage.rename(target)
        if backup is not None:
            shutil.rmtree(backup)
        return profile, target
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)


def build_result(name, root, samples_dir, profile, target, overwrite):
    card_path = target / "card.md"
    card = _read(card_path)
    provenance_path = target / "provenance.json"
    provenance = None
    if provenance_path.is_file():
        try:
            provenance = json.loads(_read(provenance_path))
        except (OSError, ValueError):
            provenance = None
    matrix = _coverage(target / "samples")
    uncovered = [dim for dim in voice_card.TAXONOMY if not matrix[dim]["covered"]]
    files = {
        "profile": str(target / "profile.json"),
        "card": str(card_path),
        "card_sheets": [
            str(target / "card" / f"{dim}.md")
            for dim in voice_card.TAXONOMY
            if (target / "card" / f"{dim}.md").is_file()
        ],
        "provenance": str(provenance_path) if provenance_path.is_file() else None,
        "samples": str(target / "samples"),
    }
    warnings = []
    metadata = profile.get("metadata", {})
    if metadata.get("low_confidence"):
        warnings.append(
            f"low confidence: {metadata.get('total_words', 0)} words is below the "
            f"{LOW_CONFIDENCE_WORDS}-word recommendation"
        )
    if uncovered:
        warnings.append("uncovered situations: " + ", ".join(uncovered))
    return {
        "ok": True,
        "tool": "voice_teach",
        "dry_run": False,
        "applied": True,
        "name": name,
        "root": str(Path(root).expanduser().resolve()),
        "voice_dir": str(target.resolve()),
        "samples_dir": str(Path(samples_dir).expanduser().resolve()),
        "docs": int(metadata.get("doc_count", 0)),
        "total_words": int(metadata.get("total_words", 0)),
        "low_confidence": bool(metadata.get("low_confidence", False)),
        "profile_metadata": metadata,
        "coverage": matrix,
        "uncovered": uncovered,
        "card_words": voice_card.card_word_count(card),
        "files": files,
        "provenance": provenance,
        "overwrote": bool(overwrite),
        "warnings": warnings,
    }


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Teach a voice profile + layered card (dry-run by default).",
    )
    parser.add_argument("name", help="voice name: [A-Za-z0-9][A-Za-z0-9._-]{0,63}")
    parser.add_argument("--samples", required=True, help="directory with .txt/.md samples")
    parser.add_argument("--root", default=str(Path.cwd() / ".unslop" / "voice"),
                        help="voices root (default: ./.unslop/voice)")
    parser.add_argument("--background", help="same-genre background corpus for function-word z-scores")
    parser.add_argument("--apply", action="store_true", help="write the voice (requires --yes)")
    parser.add_argument("--yes", action="store_true", help="confirm writing")
    parser.add_argument("--overwrite", action="store_true", help="replace an existing voice")
    parser.add_argument("--dry-run", action="store_true", help="explicit dry-run (the default)")
    return parser.parse_args(argv)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args(argv)
    try:
        name = voice_store.validate_name(args.name)
        samples_dir = Path(args.samples).expanduser()
        if not samples_dir.is_dir():
            raise voice_store.VoiceError(f"samples directory not found: {samples_dir}")
        if args.apply and not args.yes:
            raise voice_store.VoiceError(
                "--apply writes files and needs --yes; run without --apply for a dry-run"
            )
        if args.apply and args.dry_run:
            raise voice_store.VoiceError("--apply and --dry-run are mutually exclusive")
        if args.background:
            background = Path(args.background).expanduser()
            if not background.is_dir():
                raise voice_store.VoiceError(f"background directory not found: {background}")
            args.background = str(background)

        if not args.apply:
            result = build_plan(name, args.root, samples_dir, args.background)
        else:
            profile, target = apply_voice(
                name, args.root, samples_dir, args.background, args.overwrite
            )
            result = build_result(name, args.root, samples_dir, profile, target, args.overwrite)
        print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False))
        return 0
    except voice_store.VoiceError as error:
        print(json.dumps({"ok": False, "tool": "voice_teach", "error": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    except OSError as error:
        print(json.dumps({"ok": False, "tool": "voice_teach", "error": f"filesystem error: {error}"},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
