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

_OUT_DIR = os.environ.get("IMG_OUT_DIR") or os.path.join(os.getcwd(), "__img__")
os.makedirs(_OUT_DIR, exist_ok=True)
_lock = threading.Lock()
_seq = 0
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


def _rasterize_svg(raw):
    try:
        import cairosvg

        return cairosvg.svg2png(bytestring=raw)
    except Exception:
        return None


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


def _emit_image(mime, raw):
    global _seq
    try:
        if raw is None:
            return
        if isinstance(raw, str):
            raw = raw.encode("utf-8")
        if mime == "image/svg+xml":
            raster = _rasterize_svg(raw)
            if raster:
                raw = raster
                mime = "image/png"
        webp = _to_webp(raw)
        if webp:
            raw = webp
            mime = "image/webp"
        b64 = base64.b64encode(raw).decode("ascii")
        payload = {"mime": mime, "b64": b64, "ts": int(time.time() * 1000)}
        with _lock:
            _seq += 1
            name = f"img_{int(time.time() * 1000)}_{_seq}.json"
            path = os.path.join(_OUT_DIR, name)
            with open(path, "w", encoding="utf-8") as fp:
                json.dump(payload, fp)
    except Exception:
        pass


def _capture_fig(fig):
    try:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        _emit_image("image/png", buf.getvalue())
        buf.close()
    except Exception:
        pass


try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.figure import Figure

    _orig_show = plt.show

    def _show(*args, **kwargs):
        try:
            figs = [plt.figure(num) for num in plt.get_fignums()]
            if not figs:
                figs = [plt.gcf()]
            for fig in figs:
                _capture_fig(fig)
            plt.close("all")
        except Exception:
            pass
        try:
            return _orig_show(*args, **kwargs)
        except Exception:
            return None

    plt.show = _show

    _orig_fig_show = Figure.show

    def _fig_show(self, *args, **kwargs):
        try:
            _capture_fig(self)
        except Exception:
            pass
        try:
            return _orig_fig_show(self, *args, **kwargs)
        except Exception:
            return None

    Figure.show = _fig_show
except Exception:
    pass


try:
    from IPython import display as _ip_display

    _orig_display = _ip_display.display

    def _display(*objs, **kwargs):
        for obj in objs:
            try:
                if hasattr(obj, "_repr_png_"):
                    data = obj._repr_png_()
                    if data:
                        _emit_image("image/png", data)
                        continue
                if hasattr(obj, "_repr_svg_"):
                    data = obj._repr_svg_()
                    if data:
                        _emit_image("image/svg+xml", data)
                        continue
            except Exception:
                pass
        try:
            return _orig_display(*objs, **kwargs)
        except Exception:
            return None

    _ip_display.display = _display
except Exception:
    pass

# TODO: cs1robots needs a custom renderer; handle later.
