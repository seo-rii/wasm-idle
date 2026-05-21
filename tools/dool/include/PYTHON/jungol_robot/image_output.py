import base64
import io
import json
import os
import threading
import time

try:
    from PIL import Image

    _RESAMPLE = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
except Exception:
    Image = None
    _RESAMPLE = None

_OUT_DIR = None
_LOG_PATH = None
_LOCK = threading.Lock()
_SEQ = 0

_MAX_WIDTH = 1280
_MAX_HEIGHT = 720
_WEBP_QUALITY = 85


def _read_int_env(name, default):
    try:
        return int(os.environ.get(name, default))
    except Exception:
        return default


_MAX_WIDTH = _read_int_env("IMG_MAX_WIDTH", _MAX_WIDTH)
_MAX_HEIGHT = _read_int_env("IMG_MAX_HEIGHT", _MAX_HEIGHT)
_WEBP_QUALITY = _read_int_env("IMG_WEBP_QUALITY", _WEBP_QUALITY)


def _ensure_output():
    global _OUT_DIR, _LOG_PATH
    if _OUT_DIR is not None:
        return _OUT_DIR

    out_dir = os.environ.get("IMG_OUT_DIR")
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    else:
        default_dir = os.path.join(os.getcwd(), "__img__")
        if os.path.isdir(default_dir):
            out_dir = default_dir

    if not out_dir:
        _OUT_DIR = ""
        return _OUT_DIR

    _OUT_DIR = out_dir
    _LOG_PATH = os.path.join(out_dir, "images.jsonl")
    return _OUT_DIR


def _to_webp(raw):
    if Image is None or _RESAMPLE is None:
        return None
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
        if _MAX_WIDTH > 0 and _MAX_HEIGHT > 0:
            img.thumbnail((_MAX_WIDTH, _MAX_HEIGHT), _RESAMPLE)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.mode else "RGB")
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=_WEBP_QUALITY, method=6)
        return buf.getvalue()
    except Exception:
        return None


def emit_image(raw, mime="image/png"):
    global _SEQ
    out_dir = _ensure_output()
    if not out_dir or raw is None:
        return False

    if isinstance(raw, str):
        raw = raw.encode("utf-8")

    webp = _to_webp(raw)
    if webp:
        raw = webp
        mime = "image/webp"

    ts = int(time.time() * 1000)
    payload = {
        "mime": mime,
        "b64": base64.b64encode(raw).decode("ascii"),
        "ts": ts
    }
    try:
        with _LOCK:
            _SEQ += 1
            if _LOG_PATH:
                with open(_LOG_PATH, "a", encoding="utf-8") as fp:
                    fp.write(json.dumps(payload))
                    fp.write("\n")
            file_name = f"img_{ts}_{_SEQ}.json"
            file_path = os.path.join(out_dir, file_name)
            with open(file_path, "w", encoding="utf-8") as fp:
                json.dump(payload, fp)
        return True
    except Exception:
        return False
