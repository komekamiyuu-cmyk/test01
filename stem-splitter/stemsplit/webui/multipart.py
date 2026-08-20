"""multipart/form-data の最小パーサ。

Python 3.13 で cgi モジュールが削除されたため、外部依存を増やさずに
ファイルアップロードを受け取れるよう自前で実装している。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional

_DISPOSITION = re.compile(rb'name="([^"]*)"')
_FILENAME = re.compile(rb'filename="([^"]*)"')


@dataclass
class Part:
    name: str
    filename: Optional[str]
    content_type: Optional[str]
    data: bytes

    @property
    def text(self) -> str:
        return self.data.decode("utf-8", "replace")


class MultipartError(ValueError):
    pass


def boundary_of(content_type: str) -> bytes:
    """Content-Type ヘッダから境界文字列を取り出す。"""
    for chunk in content_type.split(";"):
        key, _, value = chunk.strip().partition("=")
        if key.lower() == "boundary":
            return value.strip('"').encode("latin-1")
    raise MultipartError("boundary が指定されていません")


def parse(body: bytes, content_type: str) -> Dict[str, List[Part]]:
    """本文を name → Part のリストに分解する。"""
    boundary = boundary_of(content_type)
    delimiter = b"--" + boundary
    parts: Dict[str, List[Part]] = {}
    for segment in body.split(delimiter):
        if segment in (b"", b"--", b"--\r\n", b"\r\n"):
            continue
        segment = segment.lstrip(b"\r\n")
        if segment.startswith(b"--"):
            break
        head, _, data = segment.partition(b"\r\n\r\n")
        if not _:
            continue
        name, filename, ctype = _parse_headers(head)
        if name is None:
            continue
        part = Part(name=name, filename=filename, content_type=ctype,
                    data=data[:-2] if data.endswith(b"\r\n") else data)
        parts.setdefault(name, []).append(part)
    return parts


def _parse_headers(head: bytes):
    name = filename = ctype = None
    for line in head.split(b"\r\n"):
        lowered = line.lower()
        if lowered.startswith(b"content-disposition:"):
            found = _DISPOSITION.search(line)
            name = found.group(1).decode("utf-8", "replace") if found else None
            found = _FILENAME.search(line)
            if found:
                filename = found.group(1).decode("utf-8", "replace")
        elif lowered.startswith(b"content-type:"):
            ctype = line.partition(b":")[2].strip().decode("latin-1")
    return name, filename, ctype
