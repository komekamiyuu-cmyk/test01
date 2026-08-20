import numpy as np

from stemsplit import dsp


def test_stft_istft_reconstructs_signal():
    signal = np.random.default_rng(0).normal(size=44100).astype(np.float32) * 0.2
    spectrum = dsp.stft(signal)
    restored = dsp.istft(spectrum, len(signal))
    assert restored.shape == signal.shape
    assert np.max(np.abs(restored - signal)) < 1e-4


def test_smooth_preserves_shape_and_averages():
    matrix = np.ones((4, 20), dtype=np.float32)
    assert dsp.smooth(matrix, 5, axis=1).shape == matrix.shape
    assert np.allclose(dsp.smooth(matrix, 5, axis=1), 1.0, atol=1e-5)


def test_band_weight_shape_of_curve():
    freqs = np.array([0, 150, 300, 1000, 9000, 20000], dtype=np.float32)
    weight = dsp.band_weight(freqs, 200.0, 5000.0, 100.0, 12000.0)
    assert weight[0] == 0.0                 # 帯域外は 0
    assert weight[2] == 1.0 and weight[3] == 1.0  # 通過帯域は 1
    assert 0.0 < weight[1] < 1.0            # 立ち上がりの途中はなだらか
    assert weight[5] == 0.0
