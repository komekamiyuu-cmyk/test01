import numpy as np
import pytest

from stemsplit.config import MODELS
from stemsplit.engines import create_engine
from stemsplit.engines.lite_engine import LiteEngine
from stemsplit.progress import Reporter

SR = 44100


@pytest.fixture
def engine():
    return LiteEngine(MODELS["lite"])


def test_lite_engine_is_always_available():
    assert LiteEngine.availability()[0] is True
    assert isinstance(create_engine(MODELS["lite"]), LiteEngine)


def test_produces_four_stems_with_same_shape(engine, song):
    stems = engine.separate(song, SR)
    assert list(stems) == ["vocals", "drums", "bass", "other"]
    for data in stems.values():
        assert data.shape == song.shape
        assert np.isfinite(data).all()


def test_stems_sum_back_to_original(engine, song):
    """マスクの合計が 1 なので、足し戻すと元の曲になる。"""
    total = np.sum(list(engine.separate(song, SR).values()), axis=0)
    assert np.max(np.abs(total - song)) < 1e-4


def test_bass_stem_is_low_frequency(engine, song):
    stems = engine.separate(song, SR)

    def centroid(data):
        mono = data.mean(axis=0)
        spectrum = np.abs(np.fft.rfft(mono))
        freqs = np.fft.rfftfreq(len(mono), 1 / SR)
        return float((spectrum * freqs).sum() / max(spectrum.sum(), 1e-9))

    assert centroid(stems["bass"]) < centroid(stems["vocals"])
    assert centroid(stems["vocals"]) < centroid(stems["drums"])


def test_mono_input_stays_mono(engine, song):
    mono = song.mean(axis=0, keepdims=True)
    stems = engine.separate(mono, SR)
    assert all(data.shape == mono.shape for data in stems.values())


def test_progress_is_reported_in_order(engine, song):
    events = []
    engine.separate(song, SR, Reporter(events.append))
    assert events
    fractions = [event.fraction for event in events]
    assert fractions == sorted(fractions)
    assert fractions[-1] == pytest.approx(1.0)
