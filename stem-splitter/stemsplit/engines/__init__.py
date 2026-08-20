"""エンジンの登録所。"""

from __future__ import annotations

from typing import Dict, Type

from ..config import Model
from .base import Engine, EngineUnavailable
from .demucs_engine import DemucsEngine
from .lite_engine import LiteEngine

ENGINES: Dict[str, Type[Engine]] = {
    DemucsEngine.name: DemucsEngine,
    LiteEngine.name: LiteEngine,
}


def create_engine(model: Model, device: str = "auto", **options) -> Engine:
    """モデル定義から対応するエンジンを組み立てる。"""
    try:
        engine_cls = ENGINES[model.engine]
    except KeyError:
        raise EngineUnavailable(f"未知のエンジンです: {model.engine}") from None
    ok, reason = engine_cls.availability()
    if not ok:
        raise EngineUnavailable(reason)
    return engine_cls(model, device=device, **options)


def engine_status() -> Dict[str, tuple]:
    """エンジンごとの (使えるか, 理由)。CLI の --check 用。"""
    return {name: cls.availability() for name, cls in ENGINES.items()}


__all__ = ["ENGINES", "Engine", "EngineUnavailable", "create_engine", "engine_status"]
