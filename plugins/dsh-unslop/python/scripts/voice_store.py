#!/usr/bin/env python3
"""Shared path and manifest helpers for the DSH voice wrappers.

The upstream unslop scripts own the profile, card and scorer. This module only
locates a taught voice under ``<voice-root>/<name>/`` and validates the name so
a tool argument can never escape that root.
"""

from __future__ import annotations

import json
import locale
import re
from pathlib import Path

# One path segment, no separators. The first character must be alphanumeric so
# "." and ".." are rejected before the filesystem ever sees them.
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

# Windows reserves these device names even with an extension (CON.txt).
RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
}


class VoiceError(Exception):
    """A user-facing voice path or manifest error."""


def validate_name(name):
    """Return a safe voice name or raise :class:`VoiceError`."""
    if not isinstance(name, str) or name == "":
        raise VoiceError("voice name must be a non-empty string")
    if name != name.strip():
        raise VoiceError("voice name must not have leading or trailing whitespace")
    if name.endswith("."):
        raise VoiceError("voice name must not end with a dot")
    if not NAME_RE.match(name):
        raise VoiceError(
            "invalid voice name: use 1-64 characters from A-Z, a-z, 0-9, '.', '_' or '-', "
            "starting with a letter or digit"
        )
    if name.split(".")[0].upper() in RESERVED_NAMES:
        raise VoiceError(f"voice name {name!r} is reserved on Windows")
    return name


def voice_dir(root, name):
    """Return ``<root>/<name>`` after validating the name."""
    validate_name(name)
    return Path(root).expanduser() / name


def read_text_file(path):
    """Read a generated text file without assuming one platform encoding.

    Upstream voice_card.py writes its markdown with ``Path.write_text`` and no
    explicit encoding, so on Windows a card can be cp1251/cp1252 even though the
    profile is ASCII JSON. Prefer UTF-8, then the locale encoding, then the two
    common Windows code pages, and only then replace undecodable bytes.
    """
    path = Path(path)
    encodings = []
    for encoding in ("utf-8", locale.getpreferredencoding(False), "cp1251", "cp1252"):
        if encoding and encoding.lower() not in {item.lower() for item in encodings}:
            encodings.append(encoding)
    for encoding in encodings:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
        except OSError as error:
            raise VoiceError(f"cannot read {path}: {error}") from error
    return path.read_text(encoding="utf-8", errors="replace")


def default_impostors():
    """The impostor pool vendored next to this plugin's eval fixtures."""
    return Path(__file__).resolve().parents[1] / "evals" / "fixtures" / "voice" / "impostors"


def load_voice(root, name):
    """Load a taught voice's paths and small manifest fields.

    The profile and card are required: a half-built voice is never usable.
    """
    directory = voice_dir(root, name)
    if not directory.is_dir():
        raise VoiceError(f"voice {name!r} not found at {directory}; run teach first")
    profile_path = directory / "profile.json"
    card_path = directory / "card.md"
    if not profile_path.is_file():
        raise VoiceError(f"voice {name!r} has no profile.json at {profile_path}; run teach first")
    if not card_path.is_file():
        raise VoiceError(f"voice {name!r} has no card.md at {card_path}; run teach first")
    try:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise VoiceError(f"voice {name!r}: profile.json is not readable JSON: {error}") from error
    samples = directory / "samples"
    return {
        "name": name,
        "directory": directory,
        "profile_path": profile_path,
        "card_path": card_path,
        "samples_dir": samples if samples.is_dir() else None,
        "profile": profile,
        "card": read_text_file(card_path),
    }


def list_voices(root):
    """List usable voice directories under *root*, sorted by name."""
    root = Path(root).expanduser()
    if not root.is_dir():
        return []
    voices = []
    for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        try:
            validate_name(child.name)
        except VoiceError:
            continue
        info = {
            "name": child.name,
            "path": str(child),
            "hasProfile": (child / "profile.json").is_file(),
            "hasCard": (child / "card.md").is_file(),
        }
        if info["hasProfile"]:
            try:
                profile = json.loads((child / "profile.json").read_text(encoding="utf-8"))
                metadata = profile.get("metadata", {}) if isinstance(profile, dict) else {}
                info["docs"] = metadata.get("doc_count")
                info["words"] = metadata.get("total_words")
                info["lowConfidence"] = metadata.get("low_confidence")
            except (OSError, ValueError):
                info["docs"] = None
                info["words"] = None
                info["lowConfidence"] = None
        voices.append(info)
    return voices
