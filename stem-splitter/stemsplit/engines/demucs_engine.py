"""高品質モード: Demucs(Hybrid Transformer Demucs)による分離。

`htdemucs_6s` を選ぶと ボーカル / ドラム / ベース / ギター / キーボード / その他 の
6パートに分かれる。それ以外のモデルは4パート。

長い曲は数十秒のブロックに区切ってクロスフェードしながら処理する。
こうするとメモリ使用量が曲の長さに依らず一定になり、進捗も出せる。
ブロック内の細かい分割(seams 対策)は Demucs 側が面倒を見てくれる。
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np

from ..config import Model
from ..progress import Reporter
from .base import Engine, EngineUnavailable

#: Demucs のソース名 → 本ツールのステム識別子
SOURCE_ALIASES = {
    "vocals": "vocals",
    "drums": "drums",
    "bass": "bass",
    "guitar": "guitar",
    "piano": "piano",
    "other": "other",
}

DEFAULT_BLOCK_SECONDS = 90.0
DEFAULT_CROSSFADE_SECONDS = 3.0


class DemucsEngine(Engine):
    name = "demucs"

    def __init__(self, model: Model, device: str = "auto", **options) -> None:
        super().__init__(model, device, **options)
        self._net = None
        self._torch = None
        self._resolved_device: Optional[str] = None

    # -- 情報 -------------------------------------------------------------
    @classmethod
    def availability(cls) -> Tuple[bool, str]:
        try:
            import torch
            import demucs.apply

            del torch, demucs  # 読み込めるかどうかだけ確認したい
        except Exception as exc:
            return False, (
                "Demucs が入っていません。`pip install \"stemsplit[hq]\"` "
                f"または `pip install demucs torch` を実行してください({exc})"
            )
        return True, ""

    @property
    def sample_rate(self) -> int:
        if self._net is not None:
            return int(self._net.samplerate)
        from ..config import DEMUCS_SAMPLE_RATE

        return DEMUCS_SAMPLE_RATE

    @property
    def audio_channels(self) -> int:
        return int(self._net.audio_channels) if self._net is not None else 2

    @property
    def stems(self) -> Tuple[str, ...]:
        if self._net is not None:
            return tuple(SOURCE_ALIASES.get(s, s) for s in self._net.sources)
        return self.model.stems

    # -- 準備 -------------------------------------------------------------
    def prepare(self, reporter: Optional[Reporter] = None) -> None:
        if self._net is not None:
            return
        reporter = reporter or Reporter()
        ok, reason = self.availability()
        if not ok:
            raise EngineUnavailable(reason)

        import torch
        from demucs.pretrained import get_model

        self._torch = torch
        self._resolved_device = resolve_device(self.device)
        reporter.emit("model", 0.2, f"モデル {self.model.name} を読み込み中")
        repo = self.options.get("models_dir")
        try:
            net = get_model(self.model.name, repo=Path(repo) if repo else None)
        except Exception as exc:
            raise EngineUnavailable(_download_hint(self.model.name, exc)) from exc
        net.to(self._resolved_device)
        net.eval()
        self._net = net
        reporter.emit("model", 1.0, f"モデル準備完了({self._resolved_device})")

    # -- 分離 -------------------------------------------------------------
    def separate(
        self,
        mix: np.ndarray,
        sample_rate: int,
        reporter: Optional[Reporter] = None,
    ) -> Dict[str, np.ndarray]:
        reporter = reporter or Reporter()
        self.prepare(reporter.scoped(0.0, 0.05))
        torch = self._torch
        assert torch is not None and self._net is not None

        wav = torch.from_numpy(np.ascontiguousarray(mix, dtype=np.float32))
        if wav.dim() == 1:
            wav = wav[None]
        wav = _match_channels(wav, self.audio_channels)

        # Demucs は学習時と同じ正規化を前提にしている(曲全体で平均0・分散1)
        reference = wav.mean(0)
        mean, std = float(reference.mean()), float(reference.std()) or 1.0
        normalized = (wav - mean) / std

        block = int(float(self.options.get("block_seconds", DEFAULT_BLOCK_SECONDS))
                    * self.sample_rate)
        fade = int(float(self.options.get("crossfade_seconds", DEFAULT_CROSSFADE_SECONDS))
                   * self.sample_rate)
        total = normalized.shape[-1]
        if block <= 0 or total <= block:
            blocks = [(0, total)]
        else:
            step = max(block - fade, 1)
            starts = list(range(0, max(total - fade, 1), step))
            blocks = [(s, min(s + block, total)) for s in starts]

        sources = self._net.sources
        accumulator = torch.zeros(len(sources), wav.shape[0], total)
        weights = torch.zeros(total)

        for index, (start, stop) in enumerate(blocks):
            reporter.emit(
                "separate",
                0.05 + 0.9 * index / len(blocks),
                f"分離中 {index + 1}/{len(blocks)} ブロック",
                block=index + 1,
                blocks=len(blocks),
            )
            chunk = normalized[:, start:stop]
            separated = self._apply(chunk)
            envelope = _fade_envelope(
                torch, stop - start,
                fade_in=fade if index > 0 else 0,
                fade_out=fade if index < len(blocks) - 1 else 0,
            )
            accumulator[..., start:stop] += separated * envelope
            weights[start:stop] += envelope

        accumulator /= weights.clamp(min=1e-8)
        accumulator = accumulator * std + mean

        reporter.emit("separate", 1.0, "分離完了")
        result: Dict[str, np.ndarray] = {}
        for source, tensor in zip(sources, accumulator):
            key = SOURCE_ALIASES.get(source, source)
            result[key] = tensor.numpy().astype(np.float32)
        return result

    def _apply(self, chunk):
        from demucs.apply import apply_model

        torch = self._torch
        with torch.no_grad():
            out = apply_model(
                self._net,
                chunk[None],
                device=self._resolved_device,
                shifts=int(self.options.get("shifts", 0) or 0),
                split=True,
                overlap=float(self.options.get("overlap", 0.25)),
                segment=self.options.get("segment") or None,
                num_workers=int(self.options.get("jobs", 0) or 0),
                progress=False,
            )
        return out[0].to("cpu")


# ----------------------------------------------------------------------
# ヘルパー
# ----------------------------------------------------------------------


def resolve_device(device: str = "auto") -> str:
    """"auto" なら GPU があれば GPU、無ければ CPU を選ぶ。"""
    import torch

    if device and device != "auto":
        return device
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def _match_channels(wav, channels: int):
    if wav.shape[0] == channels:
        return wav
    if wav.shape[0] == 1:
        return wav.repeat(channels, 1)
    if channels == 1:
        return wav.mean(0, keepdim=True)
    if wav.shape[0] > channels:
        return wav[:channels]
    reps = int(math.ceil(channels / wav.shape[0]))
    return wav.repeat(reps, 1)[:channels]


def _fade_envelope(torch, length: int, fade_in: int, fade_out: int):
    """ブロック境界をなめらかにつなぐための重み(前後で線形フェード)。"""
    envelope = torch.ones(length)
    fade_in = min(fade_in, length // 2)
    fade_out = min(fade_out, length // 2)
    if fade_in > 0:
        envelope[:fade_in] = torch.linspace(0.0, 1.0, fade_in)
    if fade_out > 0:
        envelope[length - fade_out:] = torch.linspace(1.0, 0.0, fade_out)
    return envelope


def _download_hint(name: str, exc: Exception) -> str:
    return (
        f"モデル {name} を読み込めませんでした({exc})。\n"
        "初回は学習済みモデル(数十MB〜1GB)のダウンロードが必要です。\n"
        "  ・ネットに繋がる環境で一度実行するとキャッシュされます\n"
        "  ・社内ネットワークなどで弾かれる場合は、別環境で取得した .th ファイルを置いた\n"
        "    フォルダを --models-dir で指定してください\n"
        "  ・すぐ試したいだけなら --model lite(簡易モード・追加DL不要)が使えます"
    )
