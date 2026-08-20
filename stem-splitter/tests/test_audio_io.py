import numpy as np
import pytest

from stemsplit import audio_io

SR = 44100


def test_as_2d_accepts_mono_and_transposed():
    mono = np.zeros(100, dtype=np.float32)
    assert audio_io.as_2d(mono).shape == (1, 100)
    # soundfile 形式 (サンプル, チャンネル) は転置される
    assert audio_io.as_2d(np.zeros((100, 2), dtype=np.float32)).shape == (2, 100)


def test_to_channels_up_and_down_mix():
    mono = np.ones((1, 10), dtype=np.float32)
    assert audio_io.to_channels(mono, 2).shape == (2, 10)
    stereo = np.stack([np.ones(10), np.zeros(10)]).astype(np.float32)
    assert np.allclose(audio_io.to_channels(stereo, 1), 0.5)


@pytest.mark.parametrize("fmt", ["wav", "flac"])
def test_round_trip_keeps_audio(tmp_path, song, fmt):
    path = tmp_path / f"song.{fmt}"
    audio_io.save_audio(path, song, SR, fmt)
    clip = audio_io.load_audio(path)
    assert clip.sample_rate == SR
    assert clip.data.shape == song.shape
    assert clip.duration == pytest.approx(song.shape[1] / SR, abs=1e-3)
    assert np.max(np.abs(clip.data - song)) < 1e-4


def test_mp3_round_trip(tmp_path, song):
    if not audio_io.capabilities()["mp3_write"]:
        pytest.skip("この環境では MP3 を書き出せません")
    path = tmp_path / "song.mp3"
    audio_io.save_audio(path, song, SR, "mp3", bitrate=192)
    clip = audio_io.load_audio(path)
    assert clip.sample_rate == SR
    # 非可逆圧縮なので長さは多少前後する
    assert abs(clip.frames - song.shape[1]) < SR * 0.2


def test_load_missing_file_reports_clearly(tmp_path):
    with pytest.raises(audio_io.AudioError):
        audio_io.load_audio(tmp_path / "ない.wav")


def test_unsupported_output_format(tmp_path, song):
    with pytest.raises(audio_io.AudioError):
        audio_io.save_audio(tmp_path / "song.ogg", song, SR, "ogg")


def test_resample_keeps_pitch_and_length():
    time = np.arange(SR) / SR
    tone = np.sin(2 * np.pi * 440 * time).astype(np.float32)[None, :]
    out = audio_io.resample(tone, SR, 22050)
    assert out.shape[1] == pytest.approx(SR // 2, abs=2)
    spectrum = np.abs(np.fft.rfft(out[0]))
    peak = np.fft.rfftfreq(out.shape[1], 1 / 22050)[int(np.argmax(spectrum))]
    assert peak == pytest.approx(440, abs=5)


def test_sinc_resampler_matches_length():
    signal = np.zeros((2, 1000), dtype=np.float32)
    out = audio_io._sinc_resample(signal, 44100, 48000)
    assert out.shape[0] == 2 and out.shape[1] == pytest.approx(1088, abs=2)


def test_peak_limit_only_lowers_when_needed():
    loud = np.array([[2.0, -2.0]], dtype=np.float32)
    assert np.max(np.abs(audio_io.peak_limit(loud))) <= 1.0
    quiet = np.array([[0.5, -0.5]], dtype=np.float32)
    assert np.allclose(audio_io.peak_limit(quiet), quiet)
