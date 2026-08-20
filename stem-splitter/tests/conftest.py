"""テスト共通の道具。"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SAMPLE_RATE = 44100


def make_song(seconds: float = 2.0, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """ベース・ドラム・ボーカル・ギターらしき成分を混ぜたテスト用の音。"""
    frames = int(seconds * sample_rate)
    time = np.arange(frames) / sample_rate
    rng = np.random.default_rng(7)

    bass = 0.4 * np.sin(2 * np.pi * 55 * time)
    drums = np.zeros(frames)
    for beat in range(int(seconds * 4)):
        start = int(beat * sample_rate * 0.25)
        envelope = np.exp(-np.arange(min(3000, frames - start)) / 500)
        drums[start:start + len(envelope)] += rng.normal(size=len(envelope)) * envelope * 0.4
    vocal = 0.35 * np.sin(2 * np.pi * 330 * time)
    guitar = 0.15 * np.sin(2 * np.pi * 196 * time)

    left = bass + drums + vocal + guitar
    right = bass + drums + vocal + guitar * 0.2
    mix = np.stack([left, right]).astype(np.float32)
    return mix / (np.max(np.abs(mix)) * 1.05)


@pytest.fixture
def song() -> np.ndarray:
    return make_song()


@pytest.fixture
def song_file(tmp_path, song) -> Path:
    from stemsplit import audio_io

    path = tmp_path / "テスト曲.wav"
    audio_io.save_audio(path, song, SAMPLE_RATE, "wav")
    return path
