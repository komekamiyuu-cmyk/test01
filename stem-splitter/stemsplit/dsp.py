"""簡易モードで使う信号処理(numpy のみ)。

STFT / ISTFT は「窓の二乗で正規化する重み付きオーバーラップ加算」なので、
マスクを掛けずに往復すれば元の波形に戻る。さらに各ステムのマスクの合計を
1 に揃えているため、**分離後のステムを全部足すと元の曲に戻る**。
"""

from __future__ import annotations

import numpy as np

N_FFT = 4096
HOP = 1024
_EPS = 1e-10


def stft(signal: np.ndarray, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    """1チャンネル分の STFT。戻り値は (周波数ビン, フレーム) の複素配列。"""
    signal = np.asarray(signal, dtype=np.float32)
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    pad = n_fft // 2
    padded = np.pad(signal, (pad, pad + n_fft), mode="constant")
    frames = 1 + (len(padded) - n_fft) // hop
    strided = np.lib.stride_tricks.as_strided(
        padded,
        shape=(frames, n_fft),
        strides=(padded.strides[0] * hop, padded.strides[0]),
        writeable=False,
    )
    return np.fft.rfft(strided * window, axis=1).T


def istft(spec: np.ndarray, length: int, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    """STFT の逆変換。``length`` サンプルに切り詰めて返す。"""
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    frames = np.fft.irfft(spec.T, n=n_fft, axis=1).astype(np.float32)
    total = (frames.shape[0] - 1) * hop + n_fft
    out = np.zeros(total, dtype=np.float32)
    norm = np.zeros(total, dtype=np.float32)
    windowed = frames * window
    square = window ** 2
    for i in range(frames.shape[0]):
        start = i * hop
        out[start:start + n_fft] += windowed[i]
        norm[start:start + n_fft] += square
    pad = n_fft // 2
    out = out[pad:pad + length]
    norm = norm[pad:pad + length]
    return np.where(norm > _EPS, out / np.maximum(norm, _EPS), out).astype(np.float32)


def smooth(matrix: np.ndarray, size: int, axis: int) -> np.ndarray:
    """移動平均(累積和を使うので長さに依らず高速)。"""
    if size <= 1:
        return matrix
    swapped = np.swapaxes(matrix, axis, -1)
    half = size // 2
    padded = np.pad(swapped, [(0, 0)] * (swapped.ndim - 1) + [(half, size - half)],
                    mode="edge")
    cumulative = np.cumsum(padded, axis=-1, dtype=np.float64)
    cumulative = np.concatenate(
        [np.zeros(cumulative.shape[:-1] + (1,)), cumulative], axis=-1
    )
    averaged = (cumulative[..., size:] - cumulative[..., :-size]) / float(size)
    averaged = averaged[..., : swapped.shape[-1]]
    return np.swapaxes(averaged.astype(np.float32), axis, -1)


def band_weight(
    freqs: np.ndarray, low: float, high: float, low_edge: float, high_edge: float
) -> np.ndarray:
    """low〜high をなだらかに通す帯域重み(0〜1)。

    low_edge / high_edge は「そこまでに 0 に落ちる」周波数。
    """
    weight = np.ones_like(freqs, dtype=np.float32)
    if low_edge < low:
        rising = (freqs - low_edge) / max(low - low_edge, _EPS)
        weight = np.where(freqs < low, np.clip(rising, 0.0, 1.0), weight)
    if high_edge > high:
        falling = (high_edge - freqs) / max(high_edge - high, _EPS)
        weight = np.where(freqs > high, np.clip(falling, 0.0, 1.0), weight)
    return weight.astype(np.float32)
