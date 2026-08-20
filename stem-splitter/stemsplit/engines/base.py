"""分離エンジンの共通インターフェース。

新しい分離手法を足すときは、このクラスを継承して ``ENGINES`` に登録するだけ。
呼び出し側(separator.py / CLI / Web UI)は一切変更しなくてよい。
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

import numpy as np

from ..config import Model
from ..progress import Reporter


class EngineUnavailable(RuntimeError):
    """必要なライブラリやモデルが無くてエンジンを使えないとき。"""


class Engine:
    #: エンジン識別子(config.Model.engine と対応)
    name = "base"

    def __init__(self, model: Model, device: str = "auto", **options) -> None:
        self.model = model
        self.device = device
        self.options = options

    # -- 情報 -------------------------------------------------------------
    @property
    def stems(self) -> Tuple[str, ...]:
        return self.model.stems

    @property
    def sample_rate(self) -> int:
        raise NotImplementedError

    @property
    def audio_channels(self) -> int:
        return 2

    @classmethod
    def availability(cls) -> Tuple[bool, str]:
        """(使えるか, 使えない理由) を返す。"""
        return True, ""

    # -- 本体 -------------------------------------------------------------
    def prepare(self, reporter: Optional[Reporter] = None) -> None:
        """モデル読み込みなど、重い準備処理(任意)。"""

    def separate(
        self,
        mix: np.ndarray,
        sample_rate: int,
        reporter: Optional[Reporter] = None,
    ) -> Dict[str, np.ndarray]:
        """``(チャンネル, サンプル)`` のミックスをステム名→波形の辞書にする。"""
        raise NotImplementedError
