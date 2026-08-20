"""分離処理の全体の流れ(読み込み → 分離 → 加工 → 書き出し)。

CLI も Web UI もライブラリ利用も、すべてこの ``Separator`` を呼ぶ。
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from . import audio_io
from .config import (
    DEFAULT_MODEL,
    INPUT_EXTENSIONS,
    OUTPUT_FORMATS,
    Model,
    resolve_model,
    sort_stems,
    stem_label,
)
from .engines import Engine, create_engine
from .progress import ProgressCallback, Reporter

#: ボーカル以外をまとめた「カラオケ」トラックの識別子
INSTRUMENTAL = "instrumental"


@dataclass
class SeparationOptions:
    """分離1回分の設定。CLI の引数と1対1で対応する。"""

    model: str = DEFAULT_MODEL
    device: str = "auto"
    output_dir: Path = Path("separated")
    output_format: str = "wav"
    bitrate: int = 320
    bit_depth: int = 24
    only: Tuple[str, ...] = ()
    instrumental: bool = False
    shifts: int = 0
    overlap: float = 0.25
    segment: Optional[float] = None
    jobs: int = 0
    block_seconds: float = 90.0
    crossfade_seconds: float = 3.0
    models_dir: Optional[str] = None
    filename_template: str = "{stem}"
    flat: bool = False
    overwrite: bool = True
    jp_names: bool = False

    def engine_options(self) -> dict:
        return {
            "shifts": self.shifts,
            "overlap": self.overlap,
            "segment": self.segment,
            "jobs": self.jobs,
            "block_seconds": self.block_seconds,
            "crossfade_seconds": self.crossfade_seconds,
            "models_dir": self.models_dir,
        }

    def validate(self) -> None:
        if self.output_format not in OUTPUT_FORMATS:
            raise ValueError(
                f"未対応の出力形式です: {self.output_format}"
                f"(使えるのは {', '.join(OUTPUT_FORMATS)})"
            )
        if not 0.0 <= self.overlap < 1.0:
            raise ValueError("--overlap は 0 以上 1 未満で指定してください")
        if self.shifts < 0:
            raise ValueError("--shifts は 0 以上で指定してください")
        resolve_model(self.model)


@dataclass
class StemFile:
    """書き出した1ファイルの情報。"""

    key: str
    label: str
    path: Path
    peak: float
    gain: float = 1.0

    @property
    def size(self) -> int:
        try:
            return self.path.stat().st_size
        except OSError:
            return 0


@dataclass
class SeparationResult:
    source: Path
    model: str
    engine: str
    sample_rate: int
    duration: float
    elapsed: float
    stems: List[StemFile] = field(default_factory=list)
    output_dir: Optional[Path] = None
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "source": str(self.source),
            "model": self.model,
            "engine": self.engine,
            "sample_rate": self.sample_rate,
            "duration": round(self.duration, 3),
            "elapsed": round(self.elapsed, 3),
            "output_dir": str(self.output_dir) if self.output_dir else None,
            "warnings": list(self.warnings),
            "stems": [
                {
                    "key": stem.key,
                    "label": stem.label,
                    "path": str(stem.path),
                    "file": stem.path.name,
                    "peak": round(stem.peak, 4),
                    "gain": round(stem.gain, 4),
                    "size": stem.size,
                }
                for stem in self.stems
            ],
        }


class Separator:
    """モデルを1回だけ読み込み、複数ファイルを続けて処理できる分離器。"""

    def __init__(self, options: Optional[SeparationOptions] = None) -> None:
        self.options = options or SeparationOptions()
        self.options.validate()
        self.model: Model = resolve_model(self.options.model)
        self._engine: Optional[Engine] = None

    # -- エンジン ---------------------------------------------------------
    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._engine = create_engine(
                self.model, device=self.options.device, **self.options.engine_options()
            )
        return self._engine

    def prepare(self, progress: Optional[ProgressCallback] = None) -> None:
        """モデルを先に読み込んでおく(Web UI の起動時などに使う)。"""
        self.engine.prepare(Reporter(progress))

    # -- 本体 -------------------------------------------------------------
    def separate_file(
        self,
        path,
        progress: Optional[ProgressCallback] = None,
        output_dir=None,
    ) -> SeparationResult:
        started = time.time()
        reporter = Reporter(progress)
        source = Path(path)
        warnings: List[str] = []

        reporter.emit("load", 0.0, f"{source.name} を読み込み中")
        engine = self.engine
        target_rate = engine.sample_rate or None
        clip = audio_io.load_audio(source, sample_rate=target_rate)
        sample_rate = clip.sample_rate
        reporter.emit("load", 0.08, f"読み込み完了({clip.duration:.1f} 秒)")

        raw = engine.separate(clip.data, sample_rate, reporter.scoped(0.08, 0.88))

        stems, extra_warnings = self._post_process(raw)
        warnings.extend(extra_warnings)

        destination = Path(output_dir) if output_dir else self._destination(source)
        files = self._export(
            stems, destination, source, sample_rate, reporter.scoped(0.88, 1.0)
        )

        reporter.emit("done", 1.0, "完了", output_dir=str(destination))
        return SeparationResult(
            source=source,
            model=self.model.name,
            engine=self.model.engine,
            sample_rate=sample_rate,
            duration=clip.duration,
            elapsed=time.time() - started,
            stems=files,
            output_dir=destination,
            warnings=warnings,
        )

    def separate_files(
        self,
        paths: Sequence,
        progress: Optional[ProgressCallback] = None,
    ) -> List[SeparationResult]:
        """複数ファイルを順に処理する(モデルの読み込みは1回だけ)。"""
        files = list(paths)
        results: List[SeparationResult] = []
        for index, path in enumerate(files):
            # 進捗は「何曲目か」を含めて全体の 0〜1 になるように詰め替える
            scoped = Reporter(progress, index / len(files), (index + 1) / len(files))
            forward = None if progress is None else (
                lambda event, s=scoped: s.emit(
                    event.stage, event.fraction, event.message, **event.detail
                )
            )
            results.append(self.separate_file(path, progress=forward))
        return results

    # -- 内部処理 ---------------------------------------------------------
    def _post_process(
        self, raw: Dict[str, np.ndarray]
    ) -> Tuple[Dict[str, np.ndarray], List[str]]:
        """カラオケトラックの合成と、--only による絞り込み。"""
        stems = dict(raw)
        warnings: List[str] = []
        requested = list(self.options.only)
        wants_instrumental = self.options.instrumental or INSTRUMENTAL in requested

        if wants_instrumental:
            backing = [value for key, value in raw.items() if key != "vocals"]
            if backing:
                stems[INSTRUMENTAL] = np.sum(backing, axis=0).astype(np.float32)
            else:
                warnings.append("ボーカル以外のパートが無いためカラオケを作れませんでした")

        if requested:
            missing = [key for key in requested if key not in stems]
            if missing:
                available = ", ".join(sort_stems(stems))
                warnings.append(
                    f"このモデルは {', '.join(missing)} を出力しません(出せるのは {available})"
                )
            stems = {key: stems[key] for key in requested if key in stems}
            if not stems:
                raise ValueError(
                    "指定されたパートを1つも出力できません。--stems や --only を見直してください"
                )
        return stems, warnings

    def _destination(self, source: Path) -> Path:
        base = Path(self.options.output_dir)
        if self.options.flat:
            return base
        return base / self.model.name / safe_name(source.stem)

    def _export(
        self,
        stems: Dict[str, np.ndarray],
        destination: Path,
        source: Path,
        sample_rate: int,
        reporter: Reporter,
    ) -> List[StemFile]:
        options = self.options
        keys = sort_stems(stems)
        files: List[StemFile] = []
        for index, key in enumerate(keys):
            data = stems[key]
            peak = float(np.max(np.abs(data))) if data.size else 0.0
            limited = audio_io.peak_limit(data)
            gain = float(np.max(np.abs(limited)) / peak) if peak > 0 else 1.0
            name = self._filename(key, source)
            path = destination / f"{name}.{options.output_format}"
            if path.exists() and not options.overwrite:
                path = _unique_path(path)
            reporter.emit(
                "export",
                index / max(len(keys), 1),
                f"{stem_label(key)} を書き出し中",
                stem=key,
            )
            audio_io.save_audio(
                path,
                limited,
                sample_rate,
                fmt=options.output_format,
                bitrate=options.bitrate,
                bit_depth=options.bit_depth,
            )
            files.append(
                StemFile(key=key, label=stem_label(key), path=path, peak=peak, gain=gain)
            )
        reporter.emit("export", 1.0, "書き出し完了")
        return files

    def _filename(self, key: str, source: Path) -> str:
        label = stem_label(key, "ja") if self.options.jp_names else key
        raw = self.options.filename_template.format(
            stem=label,
            stem_key=key,
            label_ja=stem_label(key, "ja"),
            label_en=stem_label(key, "en"),
            track=source.stem,
            model=self.model.name,
        )
        return safe_name(raw)


# ----------------------------------------------------------------------
# ユーティリティ
# ----------------------------------------------------------------------

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(name: str) -> str:
    """ファイル名に使えない文字を落とす(Windows でも安全な形にする)。"""
    cleaned = _UNSAFE.sub("_", str(name)).strip().strip(".")
    return cleaned or "untitled"


def _unique_path(path: Path) -> Path:
    stem, suffix, parent = path.stem, path.suffix, path.parent
    for index in range(2, 1000):
        candidate = parent / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
    return path


def collect_inputs(paths: Iterable, recursive: bool = True) -> List[Path]:
    """ファイル/フォルダの指定を、実際に処理する音声ファイルの一覧に変換する。"""
    found: List[Path] = []
    for entry in paths:
        path = Path(entry)
        if path.is_dir():
            pattern = "**/*" if recursive else "*"
            for child in sorted(path.glob(pattern)):
                if child.is_file() and child.suffix.lower() in INPUT_EXTENSIONS:
                    found.append(child)
        else:
            found.append(path)
    # 重複を消しつつ順序は保つ
    seen, unique = set(), []
    for path in found:
        key = str(path.resolve()) if path.exists() else str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique
