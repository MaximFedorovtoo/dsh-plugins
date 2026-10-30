"""
GigaAM-v3 e2e ASR worker (Python, JSON lines over stdin/stdout).

The upstream model code loads audio through `ffmpeg`; we replace that loader
with `soundfile` and keep everything else untouched. Model loading needs an
ASCII-only HF cache path on Windows because sentencepiece cannot open
`tokenizer.model` under a Cyrillic path.

Protocol: one JSON object per line in, one JSON object per line out.
  {"id":1,"op":"load","model":"ai-sage/GigaAM-v3","revision":"e2e_rnnt","hfHome":"C:\\\\hf-cache"}
  {"id":2,"op":"transcribe","wavPath":"C:\\\\tmp\\\\rec.wav"}
"""
import json
import os
import sys
import tempfile
import time
import traceback

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

STATE = {"model": None, "key": None}

CHUNK_SECONDS = 20.0


def _configure_cache(hf_home):
    if hf_home:
        os.environ["HF_HOME"] = hf_home
        os.environ["HF_HUB_CACHE"] = os.path.join(hf_home, "hub")


def _load_wave(path):
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(path, dtype="float32", always_2d=True)
    return data.mean(axis=1).astype(np.float32), int(rate)


def _resample(mono, rate, target=16000):
    import numpy as np

    if rate == target:
        return mono
    from math import gcd

    from scipy.signal import resample_poly

    divisor = gcd(int(rate), int(target))
    return resample_poly(mono, target // divisor, rate // divisor).astype(np.float32)


def _make_loader():
    """Return a drop-in replacement for modeling_gigaam.load_audio."""
    import numpy as np
    import soundfile as sf
    import torch

    def load_audio(path, sample_rate=16000):
        data, rate = sf.read(path, dtype="float32", always_2d=True)
        mono = _resample(data.mean(axis=1).astype(np.float32), int(rate), int(sample_rate))
        return torch.from_numpy(np.ascontiguousarray(mono, dtype=np.float32))

    return load_audio


def ensure_model(model_id, revision, hf_home):
    key = (model_id, revision, hf_home)
    if STATE["model"] is not None and STATE["key"] == key:
        return STATE["model"]
    _configure_cache(hf_home)
    from transformers import AutoModel

    model = AutoModel.from_pretrained(model_id, revision=revision, trust_remote_code=True)
    model.eval()
    inner = getattr(model, "model", None)
    target = inner if inner is not None and hasattr(type(inner), "prepare_wav") else model
    prepare = getattr(type(target), "prepare_wav")
    prepare.__globals__["load_audio"] = _make_loader()
    STATE["model"] = model
    STATE["key"] = key
    return model


def transcribe_file(model, wav_path):
    import numpy as np
    import soundfile as sf

    info = sf.info(wav_path)
    duration = float(info.frames) / float(info.samplerate) if info.samplerate else 0.0
    started = time.time()
    if duration <= CHUNK_SECONDS:
        text = model.transcribe(wav_path)
        return str(text).strip(), duration, time.time() - started

    samples, rate = _load_wave(wav_path)
    samples = _resample(samples, rate)
    pieces = []
    step = int(CHUNK_SECONDS * 16000)
    for offset in range(0, len(samples), step):
        chunk = samples[offset : offset + step]
        if len(chunk) < 1600:
            continue
        handle, path = tempfile.mkstemp(suffix=".wav", prefix="gigaam-chunk-")
        os.close(handle)
        try:
            sf.write(path, chunk, 16000, subtype="PCM_16")
            pieces.append(str(model.transcribe(path)).strip())
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
    return " ".join(piece for piece in pieces if piece).strip(), duration, time.time() - started


def reply(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError as error:
            reply({"id": None, "ok": False, "error": f"bad request: {error}"})
            continue
        request_id = request.get("id")
        try:
            operation = request.get("op")
            if operation == "ping":
                reply({"id": request_id, "ok": True})
                continue
            if operation == "load":
                ensure_model(str(request.get("model")), str(request.get("revision")), str(request.get("hfHome") or ""))
                reply({"id": request_id, "ok": True})
                continue
            if operation == "transcribe":
                model = ensure_model(str(request.get("model")), str(request.get("revision")), str(request.get("hfHome") or ""))
                text, seconds, inference = transcribe_file(model, str(request.get("wavPath")))
                reply({"id": request_id, "ok": True, "text": text, "audioSeconds": seconds, "inferenceSeconds": inference})
                continue
            reply({"id": request_id, "ok": False, "error": f"unknown op {operation}"})
        except Exception as error:  # noqa: BLE001 - report any failure to the host
            traceback.print_exc(file=sys.stderr)
            reply({"id": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
