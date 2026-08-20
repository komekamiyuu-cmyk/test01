"""音声ファイルの読み書きとリサンプリング。

音の配列は常に float32 の 2次元 ndarray ``(チャンネル数, サンプル数)`` で扱う。
Demucs も同じ並びなので、途中で転置が発生しない。

読み込みは soundfile(libsndfile)を第一候補にし、対応していない形式は
ffmpeg にデコードさせる。どちらかがあれば mp3 / wav / flac / m4a / ogg などを扱える。
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from .config import OUTPUT_FORMATS

try:  # soundfile は必須依存だが、無い環境でも ffmpeg だけで動けるようにする
    import soundfile as sf
except Exception:  # pragma: no cover - 実行環境依存
    sf = None


class AudioError(RuntimeError):
    """読み込み・書き出しに失敗したときに投げる。"""


# --------------------------------------------------------------------------
# 外部ツールの有無
# --------------------------------------------------------------------------


def ffmpeg_path() -> Optional[str]:
    """ffmpeg の実行パス。無ければ None。"""
    return os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")


def ffprobe_path() -> Optional[str]:
    return os.environ.get("FFPROBE_BINARY") or shutil.which("ffprobe")


def _lameenc():
    try:
        import lameenc  # type: ignore

        return lameenc
    except Exception:
        return None


def capabilities() -> dict:
    """使える機能の一覧(CLI の `--check` と Web UI の表示に使う)。"""
    formats = set()
    if sf is not None:
        formats.update(fmt.lower() for fmt in sf.available_formats())
    caps = {
        "soundfile": None if sf is None else sf.__version__,
        "libsndfile": None if sf is None else sf.__libsndfile_version__,
        "soundfile_formats": sorted(formats),
        "ffmpeg": ffmpeg_path(),
        "lameenc": _lameenc() is not None,
    }
    caps["mp3_write"] = bool(
        ("mp3" in formats) or caps["lameenc"] or caps["ffmpeg"]
    )
    return caps


# --------------------------------------------------------------------------
# 読み込み
# --------------------------------------------------------------------------


@dataclass
class AudioClip:
    """読み込んだ音。``data`` は (チャンネル, サンプル) の float32。"""

    data: np.ndarray
    sample_rate: int
    source: Optional[Path] = None

    @property
    def channels(self) -> int:
        return int(self.data.shape[0])

    @property
    def frames(self) -> int:
        return int(self.data.shape[1])

    @property
    def duration(self) -> float:
        return self.frames / float(self.sample_rate) if self.sample_rate else 0.0


def as_2d(data: np.ndarray) -> np.ndarray:
    """1次元(モノラル)なら (1, N) に、(N, ch) なら (ch, N) に整える。"""
    array = np.asarray(data)
    if array.ndim == 1:
        array = array[np.newaxis, :]
    elif array.ndim == 2:
        # soundfile は (サンプル, チャンネル) を返すので、縦長なら転置する
        if array.shape[0] > array.shape[1]:
            array = array.T
    else:
        raise AudioError(f"想定外の次元数の音声データです: {array.shape}")
    return np.ascontiguousarray(array, dtype=np.float32)


def to_channels(data: np.ndarray, channels: int) -> np.ndarray:
    """チャンネル数を合わせる(モノ→ステレオは複製、多チャンネル→2は平均)。"""
    data = as_2d(data)
    current = data.shape[0]
    if current == channels:
        return data
    if current == 1:
        return np.repeat(data, channels, axis=0)
    if channels == 1:
        return data.mean(axis=0, keepdims=True)
    if current > channels:
        # 5.1ch などは前2chを使いつつ、残りを薄く混ぜる
        head = data[:channels].copy()
        tail = data[channels:].mean(axis=0, keepdims=True)
        return np.ascontiguousarray(head + tail * 0.5, dtype=np.float32)
    reps = int(math.ceil(channels / current))
    return np.ascontiguousarray(np.tile(data, (reps, 1))[:channels], dtype=np.float32)


def load_audio(
    path,
    sample_rate: Optional[int] = None,
    channels: Optional[int] = None,
) -> AudioClip:
    """音声ファイルを読み込む。

    Parameters
    ----------
    sample_rate: 指定するとそのレートに変換する(None なら元のまま)
    channels:    指定するとそのチャンネル数に揃える
    """
    path = Path(path)
    if not path.exists():
        raise AudioError(f"ファイルが見つかりません: {path}")
    if path.is_dir():
        raise AudioError(f"フォルダは読み込めません: {path}")

    data, src_rate, errors = None, None, []
    if sf is not None:
        try:
            raw, src_rate = sf.read(str(path), dtype="float32", always_2d=True)
            data = as_2d(raw)
        except Exception as exc:  # 未対応コーデックなど
            errors.append(f"soundfile: {exc}")
    if data is None:
        try:
            data, src_rate = _decode_with_ffmpeg(path)
        except AudioError as exc:
            errors.append(str(exc))
    if data is None:
        hint = " / ".join(errors) if errors else "利用可能なデコーダがありません"
        raise AudioError(
            f"{path.name} を読み込めませんでした({hint})。"
            " ffmpeg をインストールすると対応形式が増えます。"
        )

    if data.size == 0:
        raise AudioError(f"{path.name} は中身が空です")

    if channels is not None:
        data = to_channels(data, channels)
    if sample_rate is not None and src_rate != sample_rate:
        data = resample(data, src_rate, sample_rate)
        src_rate = sample_rate
    return AudioClip(data=data, sample_rate=int(src_rate), source=path)


def _decode_with_ffmpeg(path: Path) -> Tuple[np.ndarray, int]:
    exe = ffmpeg_path()
    if not exe:
        raise AudioError("ffmpeg が見つかりません")
    rate, channels = _probe_with_ffprobe(path)
    cmd = [
        exe, "-nostdin", "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le",
    ]
    if rate:
        cmd += ["-ar", str(rate)]
    if channels:
        cmd += ["-ac", str(channels)]
    cmd += ["-"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0 or not proc.stdout:
        message = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise AudioError(
            "ffmpeg でのデコードに失敗しました: " + (message[-1] if message else "原因不明")
        )
    flat = np.frombuffer(proc.stdout, dtype="<f4")
    channels = channels or 2
    usable = (flat.size // channels) * channels
    interleaved = flat[:usable].reshape(-1, channels)
    return np.ascontiguousarray(interleaved.T, dtype=np.float32), int(rate or 44100)


def _probe_with_ffprobe(path: Path) -> Tuple[Optional[int], Optional[int]]:
    exe = ffprobe_path()
    if not exe:
        return None, None
    cmd = [
        exe, "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels",
        "-of", "json", str(path),
    ]
    try:
        out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             timeout=30).stdout
        streams = json.loads(out or b"{}").get("streams") or [{}]
        info = streams[0]
        rate = int(info["sample_rate"]) if info.get("sample_rate") else None
        channels = int(info["channels"]) if info.get("channels") else None
        return rate, channels
    except Exception:
        return None, None


# --------------------------------------------------------------------------
# リサンプリング
# --------------------------------------------------------------------------


def resample(data: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """サンプリングレートを変換する。

    scipy があれば polyphase を使い、無ければ窓関数付き sinc 補間で代用する。
    どちらも折り返し(エイリアス)対策込み。
    """
    data = as_2d(data)
    if src_rate == dst_rate or data.shape[1] == 0:
        return data

    try:  # 高品質かつ高速な既製品があるなら使う
        from scipy.signal import resample_poly  # type: ignore

        gcd = math.gcd(int(src_rate), int(dst_rate))
        up, down = int(dst_rate) // gcd, int(src_rate) // gcd
        out = resample_poly(data, up, down, axis=1)
        return np.ascontiguousarray(out, dtype=np.float32)
    except Exception:
        pass
    return _sinc_resample(data, src_rate, dst_rate)


def _sinc_resample(
    data: np.ndarray, src_rate: int, dst_rate: int, taps: int = 32, chunk: int = 1 << 18
) -> np.ndarray:
    """窓関数付き sinc によるリサンプル(numpy だけで動く実装)。

    出力を chunk 個ずつ作るのでメモリ使用量は入力長に依らず一定。
    """
    ratio = float(dst_rate) / float(src_rate)
    n_in = data.shape[1]
    n_out = max(1, int(math.floor(n_in * ratio)))
    # ダウンサンプル時はナイキストが下がるので sinc の帯域も下げる
    cutoff = min(1.0, ratio)
    half = taps // 2
    padded = np.pad(data, ((0, 0), (half, half + 2)), mode="edge")
    out = np.empty((data.shape[0], n_out), dtype=np.float32)

    offsets = np.arange(-half + 1, half + 1, dtype=np.float64)
    for start in range(0, n_out, chunk):
        stop = min(start + chunk, n_out)
        positions = np.arange(start, stop, dtype=np.float64) / ratio
        base = np.floor(positions).astype(np.int64)
        frac = positions - base
        # 各出力サンプルについて taps 個の入力サンプルを重み付き合計する
        delta = frac[:, None] - offsets[None, :]
        weights = np.sinc(delta * cutoff) * cutoff
        weights *= np.hanning(taps + 2)[1:-1][None, :]  # 端が 0 にならないよう内側を使う
        weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
        idx = base[:, None] + offsets[None, :].astype(np.int64) + half
        np.clip(idx, 0, padded.shape[1] - 1, out=idx)
        for ch in range(data.shape[0]):
            out[ch, start:stop] = np.einsum("ij,ij->i", padded[ch][idx], weights)
    return out


# --------------------------------------------------------------------------
# 書き出し
# --------------------------------------------------------------------------


_WAV_SUBTYPES = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}
_FLAC_SUBTYPES = {16: "PCM_16", 24: "PCM_24"}


def save_audio(
    path,
    data: np.ndarray,
    sample_rate: int,
    fmt: Optional[str] = None,
    bitrate: int = 320,
    bit_depth: int = 24,
) -> Path:
    """ステムを1本書き出す。``fmt`` 省略時は拡張子から判断する。"""
    path = Path(path)
    fmt = (fmt or path.suffix.lstrip(".") or "wav").lower()
    if fmt not in OUTPUT_FORMATS:
        raise AudioError(
            f"未対応の書き出し形式です: {fmt}(使えるのは {', '.join(OUTPUT_FORMATS)})"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    data = as_2d(data)

    if fmt == "mp3":
        return _save_mp3(path, data, sample_rate, bitrate)
    if sf is None:
        raise AudioError("soundfile が無いため wav/flac を書き出せません")
    subtype = (
        _WAV_SUBTYPES.get(bit_depth, "PCM_24")
        if fmt == "wav"
        else _FLAC_SUBTYPES.get(bit_depth, "PCM_24")
    )
    sf.write(str(path), data.T, int(sample_rate), format=fmt.upper(), subtype=subtype)
    return path


def _save_mp3(path: Path, data: np.ndarray, sample_rate: int, bitrate: int) -> Path:
    """MP3 書き出し。lameenc → libsndfile → ffmpeg の順で使えるものを試す。"""
    errors = []

    lameenc = _lameenc()
    if lameenc is not None:
        try:
            encoder = lameenc.Encoder()
            encoder.set_bit_rate(int(bitrate))
            encoder.set_in_sample_rate(int(sample_rate))
            encoder.set_channels(int(data.shape[0]))
            encoder.set_quality(2)
            pcm = _to_int16_interleaved(data)
            payload = encoder.encode(pcm.tobytes()) + encoder.flush()
            path.write_bytes(bytes(payload))
            return path
        except Exception as exc:
            errors.append(f"lameenc: {exc}")

    if sf is not None and "mp3" in {f.lower() for f in sf.available_formats()}:
        try:
            # libsndfile は VBR 品質(0=高音質 .. 1=低音質)で指定する
            quality = float(np.clip(1.0 - (bitrate - 64) / (320 - 64), 0.0, 1.0))
            with sf.SoundFile(
                str(path), mode="w", samplerate=int(sample_rate),
                channels=int(data.shape[0]), format="MP3", subtype="MPEG_LAYER_III",
                compression_level=quality,
            ) as handle:
                handle.write(data.T)
            return path
        except Exception as exc:
            errors.append(f"libsndfile: {exc}")

    exe = ffmpeg_path()
    if exe:
        cmd = [
            exe, "-nostdin", "-v", "error", "-y",
            "-f", "f32le", "-ar", str(int(sample_rate)), "-ac", str(int(data.shape[0])),
            "-i", "-", "-b:a", f"{int(bitrate)}k", str(path),
        ]
        proc = subprocess.run(
            cmd, input=np.ascontiguousarray(data.T, dtype="<f4").tobytes(),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        if proc.returncode == 0:
            return path
        errors.append("ffmpeg: " + proc.stderr.decode("utf-8", "replace").strip())

    raise AudioError(
        "MP3 を書き出せませんでした。`pip install lameenc` か ffmpeg の導入が必要です。"
        + ("(" + " / ".join(errors) + ")" if errors else "")
    )


def _to_int16_interleaved(data: np.ndarray) -> np.ndarray:
    clipped = np.clip(data.T, -1.0, 1.0)
    return np.ascontiguousarray((clipped * 32767.0).astype("<i2"))


def peak_limit(data: np.ndarray, ceiling: float = 0.999) -> np.ndarray:
    """クリップ防止。ピークが天井を超えるときだけ全体を下げる。"""
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    if peak > ceiling:
        return np.ascontiguousarray(data * (ceiling / peak), dtype=np.float32)
    return np.ascontiguousarray(data, dtype=np.float32)
