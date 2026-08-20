"""ブラウザ用のローカルサーバー。

`stemsplit --web` で起動し、http://127.0.0.1:7860 を開くと
ドラッグ&ドロップでステム分解できる。標準ライブラリだけで動く。
"""

from __future__ import annotations

import io
import json
import mimetypes
import shutil
import tempfile
import threading
import time
import traceback
import uuid
import webbrowser
import zipfile
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote, unquote, urlparse

from .. import audio_io
from ..config import MODELS, OUTPUT_FORMATS, STEM_ORDER, STEMS, stem_label
from ..progress import ProgressEvent
from ..separator import SeparationOptions, Separator, safe_name
from .multipart import parse as parse_multipart

STATIC_DIR = Path(__file__).parent / "static"
MAX_UPLOAD = 1024 * 1024 * 1024  # 1GB


@dataclass
class Job:
    id: str
    filename: str
    model: str
    status: str = "queued"          # queued / running / done / error
    fraction: float = 0.0
    message: str = "待機中"
    error: Optional[str] = None
    started: float = field(default_factory=time.time)
    finished: Optional[float] = None
    stems: List[dict] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    directory: Optional[Path] = None

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "model": self.model,
            "status": self.status,
            "fraction": round(self.fraction, 4),
            "message": self.message,
            "error": self.error,
            "elapsed": round((self.finished or time.time()) - self.started, 1),
            "stems": self.stems,
            "warnings": self.warnings,
        }


class JobStore:
    """実行中/完了したジョブの置き場。1プロセス内で共有する。"""

    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, filename: str, model: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], filename=filename, model=model)
        job.directory = self.workdir / job.id
        job.directory.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def all(self) -> List[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda job: job.started, reverse=True)

    def remove(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        if job.directory and job.directory.exists():
            shutil.rmtree(job.directory, ignore_errors=True)
        return True


def run_job(job: Job, source: Path, options: SeparationOptions) -> None:
    """1曲分の分離をワーカースレッドで実行する。"""

    def on_progress(event: ProgressEvent) -> None:
        job.fraction = event.fraction
        job.message = event.message

    job.status = "running"
    try:
        separator = Separator(options)
        result = separator.separate_file(
            source, progress=on_progress, output_dir=job.directory
        )
        job.stems = [
            {
                "key": stem.key,
                "label": stem_label(stem.key),
                "file": stem.path.name,
                "size": stem.size,
                "url": f"/api/jobs/{job.id}/files/{stem.path.name}",
            }
            for stem in result.stems
        ]
        job.warnings = result.warnings
        job.status = "done"
        job.fraction = 1.0
        job.message = f"完了({result.elapsed:.1f}秒)"
    except Exception as exc:
        job.status = "error"
        job.error = str(exc)
        job.message = "エラー"
        traceback.print_exc()
    finally:
        job.finished = time.time()
        try:
            source.unlink()
        except OSError:
            pass


def _disposition(filename: str) -> str:
    """日本語ファイル名でも壊れない Content-Disposition を作る。

    HTTP ヘッダは latin-1 しか通らないので、ASCII に落とした名前を書きつつ
    RFC 5987 の filename* で本来の名前を渡す。
    """
    ascii_name = filename.encode("ascii", "ignore").decode("ascii").strip() or "download"
    ascii_name = ascii_name.replace('"', "")
    quoted = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quoted}"


class Handler(BaseHTTPRequestHandler):
    server_version = "stemsplit"
    store: JobStore
    base_options: SeparationOptions

    # -- 共通 -------------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:  # アクセスログは静かに
        pass

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, data: bytes, content_type: str, filename=None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if filename:
            self.send_header("Content-Disposition", _disposition(filename))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, message: str, status: int = 400) -> None:
        self._send_json({"error": message}, status)

    # -- GET --------------------------------------------------------------
    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path in ("/", "/index.html"):
            return self._send_static("index.html")
        if path.startswith("/static/"):
            return self._send_static(path[len("/static/"):])
        if path == "/api/config":
            return self._send_json(self._config())
        if path == "/api/jobs":
            return self._send_json({"jobs": [j.snapshot() for j in self.store.all()]})
        if path.startswith("/api/jobs/"):
            return self._job_get(path[len("/api/jobs/"):])
        return self._error("見つかりません", 404)

    def _job_get(self, rest: str) -> None:
        job_id, _, tail = rest.partition("/")
        job = self.store.get(job_id)
        if job is None:
            return self._error("そのジョブはありません", 404)
        if not tail:
            return self._send_json(job.snapshot())
        if tail == "zip":
            return self._send_zip(job)
        if tail.startswith("files/"):
            return self._send_stem(job, tail[len("files/"):])
        return self._error("見つかりません", 404)

    def _send_stem(self, job: Job, name: str) -> None:
        target = (job.directory / safe_name(name)).resolve()
        if job.directory is None or job.directory.resolve() not in target.parents:
            return self._error("不正なパスです", 400)
        if not target.is_file():
            return self._error("ファイルがありません", 404)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send_bytes(target.read_bytes(), ctype, filename=target.name)

    def _send_zip(self, job: Job) -> None:
        if job.status != "done":
            return self._error("まだ完了していません", 409)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
            for stem in job.stems:
                path = job.directory / stem["file"]
                if path.is_file():
                    archive.write(path, arcname=path.name)
        stem_name = safe_name(Path(job.filename).stem) or "stems"
        self._send_bytes(buffer.getvalue(), "application/zip",
                         filename=f"{stem_name}_stems.zip")

    def _send_static(self, name: str) -> None:
        target = (STATIC_DIR / name).resolve()
        if STATIC_DIR.resolve() not in target.parents or not target.is_file():
            return self._error("見つかりません", 404)
        ctype = mimetypes.guess_type(target.name)[0] or "text/plain"
        charset = "; charset=utf-8" if ctype.startswith("text/") or "javascript" in ctype else ""
        self._send_bytes(target.read_bytes(), ctype + charset)

    def _config(self) -> dict:
        from ..engines import engine_status

        status = engine_status()
        return {
            "models": [
                {
                    "name": model.name,
                    "engine": model.engine,
                    "stems": [
                        {"key": key, "label": stem_label(key)} for key in model.stems
                    ],
                    "quality": model.quality,
                    "speed": model.speed,
                    "description": model.description,
                    "available": status.get(model.engine, (True, ""))[0],
                    "reason": status.get(model.engine, (True, ""))[1],
                }
                for model in MODELS.values()
            ],
            "formats": list(OUTPUT_FORMATS),
            "stems": [
                {"key": key, "label": STEMS[key].label_ja,
                 "description": STEMS[key].description}
                for key in STEM_ORDER
            ],
            "capabilities": audio_io.capabilities(),
            "defaults": {
                "model": self.base_options.model,
                "format": self.base_options.output_format,
            },
        }

    # -- POST / DELETE ----------------------------------------------------
    def do_POST(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path != "/api/jobs":
            return self._error("見つかりません", 404)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self._error("ファイルが送られていません")
        if length > MAX_UPLOAD:
            return self._error("ファイルが大きすぎます(最大1GB)", 413)
        body = self.rfile.read(length)
        try:
            parts = parse_multipart(body, self.headers.get("Content-Type", ""))
        except ValueError as exc:
            return self._error(f"送信内容を読めませんでした: {exc}")

        uploads = parts.get("file") or []
        if not uploads or not uploads[0].filename:
            return self._error("音声ファイルを選んでください")

        settings = {}
        if parts.get("options"):
            try:
                settings = json.loads(parts["options"][0].text or "{}")
            except json.JSONDecodeError:
                return self._error("設定の形式が不正です")

        upload = uploads[0]
        try:
            options = self._options_from(settings)
        except ValueError as exc:
            return self._error(str(exc))

        job = self.store.create(filename=upload.filename, model=options.model)
        source = job.directory / ("input_" + safe_name(upload.filename))
        source.write_bytes(upload.data)
        thread = threading.Thread(
            target=run_job, args=(job, source, options), daemon=True
        )
        thread.start()
        self._send_json(job.snapshot(), 202)

    def do_DELETE(self) -> None:
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/api/jobs/"):
            return self._error("見つかりません", 404)
        job_id = path[len("/api/jobs/"):].strip("/")
        if self.store.remove(job_id):
            return self._send_json({"deleted": job_id})
        return self._error("そのジョブはありません", 404)

    def _options_from(self, settings: dict) -> SeparationOptions:
        base = self.base_options
        model = settings.get("model") or base.model
        if model not in MODELS:
            raise ValueError(f"知らないモデルです: {model}")
        fmt = settings.get("format") or base.output_format
        if fmt not in OUTPUT_FORMATS:
            raise ValueError(f"知らない形式です: {fmt}")
        only = tuple(
            key for key in settings.get("only", []) if key in STEMS
        )
        options = SeparationOptions(
            model=model,
            device=base.device,
            output_format=fmt,
            bitrate=int(settings.get("bitrate", base.bitrate)),
            bit_depth=base.bit_depth,
            only=only,
            instrumental=bool(settings.get("instrumental", False)),
            shifts=int(settings.get("shifts", base.shifts)),
            overlap=base.overlap,
            segment=base.segment,
            jobs=base.jobs,
            block_seconds=base.block_seconds,
            models_dir=base.models_dir,
            flat=True,
        )
        options.validate()
        return options


def build_server(
    options: Optional[SeparationOptions] = None,
    host: str = "127.0.0.1",
    port: int = 7860,
    workdir: Optional[Path] = None,
) -> ThreadingHTTPServer:
    """サーバーを組み立てて返す(まだ待ち受けはしない)。

    port に 0 を渡すと空きポートが自動で選ばれる(テスト用)。
    """
    options = options or SeparationOptions()
    root = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="stemsplit-"))
    root.mkdir(parents=True, exist_ok=True)
    store = JobStore(root)
    handler = type("BoundHandler", (Handler,),
                   {"store": store, "base_options": options})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.job_store = store
    httpd.workdir = root
    httpd.owns_workdir = workdir is None
    return httpd


def serve(
    options: Optional[SeparationOptions] = None,
    host: str = "127.0.0.1",
    port: int = 7860,
    open_browser: bool = True,
    workdir: Optional[Path] = None,
) -> None:
    """サーバーを起動して待ち受ける(Ctrl+C で終了)。"""
    httpd = build_server(options, host, port, workdir)
    url = f"http://{host}:{httpd.server_address[1]}/"
    print(f"stemsplit の画面を開きます: {url}")
    print("終了するには Ctrl+C を押してください。")
    if open_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します。")
    finally:
        httpd.server_close()
        if httpd.owns_workdir:
            shutil.rmtree(httpd.workdir, ignore_errors=True)
