import numpy as np
import pytest

from stemsplit import audio_io
from stemsplit.separator import (
    SeparationOptions,
    Separator,
    collect_inputs,
    safe_name,
)

SR = 44100


def lite(**kwargs) -> SeparationOptions:
    return SeparationOptions(model="lite", **kwargs)


def test_separate_file_writes_all_stems(tmp_path, song_file):
    result = Separator(lite(output_dir=tmp_path)).separate_file(song_file)
    names = {stem.key for stem in result.stems}
    assert names == {"vocals", "drums", "bass", "other"}
    assert all(stem.path.exists() and stem.size > 0 for stem in result.stems)
    assert result.output_dir == tmp_path / "lite" / song_file.stem
    assert result.duration == pytest.approx(2.0, abs=0.05)


@pytest.mark.parametrize("fmt", ["wav", "flac", "mp3"])
def test_output_formats(tmp_path, song_file, fmt):
    if fmt == "mp3" and not audio_io.capabilities()["mp3_write"]:
        pytest.skip("この環境では MP3 を書き出せません")
    result = Separator(lite(output_dir=tmp_path, output_format=fmt)).separate_file(song_file)
    assert all(stem.path.suffix == f".{fmt}" for stem in result.stems)
    assert audio_io.load_audio(result.stems[0].path).frames > 0


@pytest.mark.parametrize("suffix", ["wav", "flac", "mp3"])
def test_reads_every_input_format(tmp_path, song, suffix):
    if suffix == "mp3" and not audio_io.capabilities()["mp3_write"]:
        pytest.skip("この環境では MP3 を扱えません")
    source = tmp_path / f"in.{suffix}"
    audio_io.save_audio(source, song, SR, suffix)
    result = Separator(lite(output_dir=tmp_path / "out")).separate_file(source)
    assert len(result.stems) == 4


def test_only_limits_written_stems(tmp_path, song_file):
    options = lite(output_dir=tmp_path, only=("vocals", "drums"))
    result = Separator(options).separate_file(song_file)
    assert [stem.key for stem in result.stems] == ["vocals", "drums"]


def test_instrumental_is_sum_of_backing_tracks(tmp_path, song_file):
    options = lite(output_dir=tmp_path, instrumental=True)
    result = Separator(options).separate_file(song_file)
    written = {stem.key: stem.path for stem in result.stems}
    assert "instrumental" in written
    backing = sum(
        audio_io.load_audio(written[key]).data
        for key in ("drums", "bass", "other")
    )
    karaoke = audio_io.load_audio(written["instrumental"]).data
    assert np.max(np.abs(karaoke - backing)) < 1e-3


def test_karaoke_pair_only(tmp_path, song_file):
    options = lite(output_dir=tmp_path, only=("vocals", "instrumental"))
    result = Separator(options).separate_file(song_file)
    assert {stem.key for stem in result.stems} == {"vocals", "instrumental"}


def test_requesting_missing_stem_warns_but_continues(tmp_path, song_file):
    # 簡易モードはギターを出せない
    options = lite(output_dir=tmp_path, only=("vocals", "guitar"))
    result = Separator(options).separate_file(song_file)
    assert [stem.key for stem in result.stems] == ["vocals"]
    assert any("guitar" in warning for warning in result.warnings)


def test_requesting_only_impossible_stems_raises(tmp_path, song_file):
    options = lite(output_dir=tmp_path, only=("guitar", "piano"))
    with pytest.raises(ValueError):
        Separator(options).separate_file(song_file)


def test_japanese_filenames_and_template(tmp_path, song_file):
    options = lite(output_dir=tmp_path, jp_names=True)
    result = Separator(options).separate_file(song_file)
    assert {stem.path.stem for stem in result.stems} == {
        "ボーカル", "ドラム", "ベース", "その他"
    }


def test_filename_template(tmp_path, song_file):
    options = lite(output_dir=tmp_path, filename_template="{track}_{stem}_{model}")
    result = Separator(options).separate_file(song_file)
    assert all(
        stem.path.stem == f"{song_file.stem}_{stem.key}_lite" for stem in result.stems
    )


def test_flat_output_skips_subfolders(tmp_path, song_file):
    options = lite(output_dir=tmp_path, flat=True)
    result = Separator(options).separate_file(song_file)
    assert result.output_dir == tmp_path
    assert (tmp_path / "vocals.wav").exists()


def test_no_overwrite_creates_new_names(tmp_path, song_file):
    options = lite(output_dir=tmp_path, flat=True, overwrite=False)
    Separator(options).separate_file(song_file)
    second = Separator(options).separate_file(song_file)
    assert any("_2" in stem.path.stem for stem in second.stems)


def test_batch_reports_monotonic_progress(tmp_path, song_file, song):
    other = tmp_path / "song2.wav"
    audio_io.save_audio(other, song, SR, "wav")
    events = []
    results = Separator(lite(output_dir=tmp_path / "out")).separate_files(
        [song_file, other], progress=events.append
    )
    assert len(results) == 2
    fractions = [event.fraction for event in events]
    assert fractions == sorted(fractions)
    assert fractions[-1] == pytest.approx(1.0)


def test_result_as_dict_is_json_friendly(tmp_path, song_file):
    import json

    result = Separator(lite(output_dir=tmp_path)).separate_file(song_file)
    payload = json.loads(json.dumps(result.as_dict(), ensure_ascii=False))
    assert payload["model"] == "lite"
    assert len(payload["stems"]) == 4


def test_invalid_options_are_rejected():
    with pytest.raises(ValueError):
        Separator(lite(output_format="ogg"))
    with pytest.raises(ValueError):
        Separator(lite(overlap=1.5))
    with pytest.raises(ValueError):
        Separator(SeparationOptions(model="存在しない"))


def test_safe_name_strips_dangerous_characters():
    assert safe_name('a/b:c*d?"e') == "a_b_c_d__e"
    assert safe_name("   ") == "untitled"
    assert safe_name("日本語 タイトル") == "日本語 タイトル"


def test_collect_inputs_walks_folders(tmp_path, song):
    folder = tmp_path / "album"
    (folder / "disc1").mkdir(parents=True)
    audio_io.save_audio(folder / "a.wav", song, SR, "wav")
    audio_io.save_audio(folder / "disc1" / "b.flac", song, SR, "flac")
    (folder / "memo.txt").write_text("音声ではない")
    found = collect_inputs([folder])
    assert sorted(path.name for path in found) == ["a.wav", "b.flac"]
