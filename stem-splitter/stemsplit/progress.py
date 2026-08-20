"""進捗の通知。CLI・Web UI・ライブラリ利用で同じ仕組みを使う。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, Optional


@dataclass(frozen=True)
class ProgressEvent:
    """進捗1件。``fraction`` は処理全体に対する 0.0〜1.0。"""

    stage: str          # "load" / "model" / "separate" / "export" / "done"
    fraction: float
    message: str
    detail: Dict[str, object] = field(default_factory=dict)


ProgressCallback = Callable[[ProgressEvent], None]


class Reporter:
    """進捗コールバックの薄いラッパ。

    ``scoped()`` で「全体の 20%〜80% を担当する子レポーター」を作れるので、
    各工程は自分の中での 0.0〜1.0 だけ気にすればよい。
    """

    def __init__(
        self,
        callback: Optional[ProgressCallback] = None,
        start: float = 0.0,
        end: float = 1.0,
    ) -> None:
        self._callback = callback
        self._start = float(start)
        self._end = float(end)

    def emit(self, stage: str, fraction: float, message: str, **detail) -> None:
        if self._callback is None:
            return
        local = min(max(float(fraction), 0.0), 1.0)
        overall = self._start + (self._end - self._start) * local
        self._callback(ProgressEvent(stage=stage, fraction=overall, message=message,
                                     detail=detail))

    def scoped(self, start: float, end: float) -> "Reporter":
        span = self._end - self._start
        return Reporter(
            self._callback,
            self._start + span * float(start),
            self._start + span * float(end),
        )
