"""ブラウザから使うための簡易サーバー(標準ライブラリのみ)。"""

from .server import build_server, serve

__all__ = ["build_server", "serve"]
