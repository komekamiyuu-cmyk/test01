"""簡易モード: AI モデルを使わない軽量分離(numpy のみ)。

やっていること
--------------
1. ステレオの「真ん中に定位している成分」を取り出す        → ボーカルらしさ
2. スペクトログラムを時間方向/周波数方向にならして比較する → 打楽器 or 持続音
3. 低域の持続音                                            → ベース
4. 残り                                                    → その他

AI 分離ほどの精度は出ないが、インストール不要・数秒で終わるので
「とりあえずパートを確認したい」「Demucs を入れる前に試したい」用途に向く。
各ビンのマスク合計を 1 に正規化しているので、出力を全部足すと元の曲に戻る。
"""

from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from .. import dsp
from ..config import Model
from ..progress import Reporter
from .base import Engine

_EPS = 1e-10


class LiteEngine(Engine):
    name = "lite"

    #: 簡易モードが扱うサンプリングレート(入力のまま処理する)
    _sample_rate = 44100

    def __init__(self, model: Model, device: str = "auto", **options) -> None:
        super().__init__(model, device, **options)
        self._input_rate: Optional[int] = None

    @property
    def sample_rate(self) -> int:
        # 入力のレートをそのまま使えるので、リサンプル不要を示す 0 を返す
        return 0

    def separate(
        self,
        mix: np.ndarray,
        sample_rate: int,
        reporter: Optional[Reporter] = None,
    ) -> Dict[str, np.ndarray]:
        reporter = reporter or Reporter()
        mix = np.asarray(mix, dtype=np.float32)
        if mix.ndim == 1:
            mix = mix[np.newaxis, :]
        length = mix.shape[1]
        stereo = mix if mix.shape[0] >= 2 else np.repeat(mix, 2, axis=0)

        reporter.emit("separate", 0.05, "スペクトログラムを計算中")
        left = dsp.stft(stereo[0])
        right = dsp.stft(stereo[1])

        reporter.emit("separate", 0.35, "パートごとのマスクを作成中")
        masks = self._build_masks(left, right, sample_rate)

        stems: Dict[str, np.ndarray] = {}
        keys = list(masks)
        for index, key in enumerate(keys):
            mask = masks[key]
            channels = [
                dsp.istft(left * mask, length),
                dsp.istft(right * mask, length),
            ]
            if mix.shape[0] == 1:
                stems[key] = np.mean(channels, axis=0, keepdims=True).astype(np.float32)
            else:
                stems[key] = np.stack(channels).astype(np.float32)
            reporter.emit(
                "separate",
                0.5 + 0.5 * (index + 1) / len(keys),
                f"{key} を書き出し準備中",
            )
        return stems

    # ------------------------------------------------------------------
    def _build_masks(
        self, left: np.ndarray, right: np.ndarray, sample_rate: int
    ) -> Dict[str, np.ndarray]:
        """4パート分のソフトマスク(合計が 1 になる)を作る。"""
        magnitude = (np.abs(left) + np.abs(right)) * 0.5
        freqs = np.fft.rfftfreq(dsp.N_FFT, 1.0 / float(sample_rate)).astype(np.float32)
        freqs = freqs[:, np.newaxis]

        # --- 打楽器らしさ: 時間方向にならすと消える(=立ち上がりが鋭い)成分 ---
        harmonic = dsp.smooth(magnitude, 17, axis=1)   # 時間方向のならし → 持続音
        percussive = dsp.smooth(magnitude, 17, axis=0)  # 周波数方向のならし → 打撃音
        power = 2.0
        percussive_ratio = (percussive ** power) / (
            percussive ** power + harmonic ** power + _EPS
        )
        harmonic_ratio = 1.0 - percussive_ratio

        # --- 中央定位らしさ: 左右がそっくりなほどボーカル/ベースの可能性が高い ---
        similarity = 1.0 - np.abs(np.abs(left) - np.abs(right)) / (
            np.abs(left) + np.abs(right) + _EPS
        )
        centre = np.clip(similarity, 0.0, 1.0) ** 2

        # --- 帯域重み ---
        low_band = dsp.band_weight(freqs, 20.0, 220.0, 0.0, 420.0)
        vocal_band = dsp.band_weight(freqs, 220.0, 5000.0, 90.0, 11000.0)
        drum_band = 0.45 + 0.55 * dsp.band_weight(freqs, 1500.0, 16000.0, 200.0, 20000.0)

        drums = percussive_ratio * drum_band
        bass = harmonic_ratio * low_band * (0.35 + 0.65 * centre)
        vocals = harmonic_ratio * vocal_band * centre * (1.0 - low_band)
        # 残り(和音楽器・パッド・広がりのある音)は必ず正の重みを持たせる
        other = np.maximum(1.0 - (drums + bass + vocals), 0.05)

        stacked = np.stack([vocals, drums, bass, other]).astype(np.float32)
        stacked /= np.maximum(stacked.sum(axis=0, keepdims=True), _EPS)
        return {
            "vocals": stacked[0],
            "drums": stacked[1],
            "bass": stacked[2],
            "other": stacked[3],
        }
