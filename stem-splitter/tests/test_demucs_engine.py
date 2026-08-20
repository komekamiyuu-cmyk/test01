"""Demucs エンジンのテスト。

学習済みの重みは数百MBあり、ダウンロードできない環境も多いので、
ここでは同じ構造のランダム初期化モデルを差し込んで
「ブロック分割・クロスフェード・ソース名の対応付け」が正しいかを確認する。
"""

import numpy as np
import pytest

from stemsplit.config import MODELS
from stemsplit.progress import Reporter

torch = pytest.importorskip("torch", reason="Demucs(torch)が入っていません")
pytest.importorskip("demucs", reason="Demucs が入っていません")

from stemsplit.engines.demucs_engine import (  # noqa: E402
    DemucsEngine,
    _fade_envelope,
    resolve_device,
)

SR = 44100


@pytest.fixture
def tiny_engine(monkeypatch):
    """重みをダウンロードしない小さなモデルを使うエンジン。"""
    from demucs.htdemucs import HTDemucs
    import demucs.pretrained as pretrained

    def fake_get_model(name, repo=None):
        return HTDemucs(
            sources=list(MODELS[name].stems), audio_channels=2,
            channels=8, depth=4, t_layers=1, segment=6, samplerate=SR,
        )

    monkeypatch.setattr(pretrained, "get_model", fake_get_model)
    return DemucsEngine(
        MODELS["htdemucs_6s"], device="cpu",
        block_seconds=4, crossfade_seconds=1, segment=6,
    )


def test_availability_reports_ready():
    assert DemucsEngine.availability()[0] is True


def test_resolve_device_returns_something_usable():
    assert resolve_device("auto") in {"cpu", "cuda", "mps"}
    assert resolve_device("cpu") == "cpu"


def test_fade_envelope_partitions_unity():
    """隣り合うブロックの重みを足すと 1 になる(音量が変わらない)。"""
    length, fade = 100, 20
    first = _fade_envelope(torch, length, fade_in=0, fade_out=fade)
    second = _fade_envelope(torch, length, fade_in=fade, fade_out=0)
    overlap = first[length - fade:] + second[:fade]
    assert torch.allclose(overlap, torch.ones(fade), atol=0.02)


@pytest.mark.slow
def test_six_stems_have_input_shape(tiny_engine):
    mix = (np.random.default_rng(0).normal(size=(2, SR * 10)) * 0.1).astype(np.float32)
    stems = tiny_engine.separate(mix, SR)
    assert list(stems) == list(MODELS["htdemucs_6s"].stems)
    for data in stems.values():
        assert data.shape == mix.shape
        assert np.isfinite(data).all()


@pytest.mark.slow
def test_progress_covers_every_block(tiny_engine):
    mix = (np.random.default_rng(1).normal(size=(2, SR * 10)) * 0.1).astype(np.float32)
    events = []
    tiny_engine.separate(mix, SR, Reporter(events.append))
    blocks = [event.detail.get("blocks") for event in events if "blocks" in event.detail]
    assert blocks and len(set(blocks)) == 1 and blocks[0] > 1
    assert [event.fraction for event in events] == sorted(
        event.fraction for event in events
    )


@pytest.mark.slow
def test_mono_input_is_upmixed(tiny_engine):
    mono = (np.random.default_rng(2).normal(size=(1, SR * 5)) * 0.1).astype(np.float32)
    stems = tiny_engine.separate(mono, SR)
    # Demucs はステレオ前提のモデルなので、モノラル入力は左右に複製されて
    # ステレオのステムとして返る(Demucs 公式 CLI と同じ挙動)
    assert all(data.shape == (2, mono.shape[1]) for data in stems.values())
