import json

import pytest

from stemsplit import cli


class Args:
    """resolve_selection に渡す最小限の引数オブジェクト。"""

    def __init__(self, stems="4", model=None, only=None):
        self.stems, self.model, self.only = stems, model, only


def test_stems_presets_pick_models():
    assert cli.resolve_selection(Args("4")) == ("htdemucs", ())
    assert cli.resolve_selection(Args("6"))[0] == "htdemucs_6s"
    assert cli.resolve_selection(Args("vocals")) == ("htdemucs", ("vocals", "instrumental"))
    assert cli.resolve_selection(Args("karaoke"))[1] == ("vocals", "instrumental")


def test_stem_list_selects_six_stem_model_when_needed():
    model, only = cli.resolve_selection(Args("vocals,guitar"))
    assert model == "htdemucs_6s"
    assert only == ("vocals", "guitar")
    # ギター・キーボードが要らなければ 4パートモデルで足りる
    assert cli.resolve_selection(Args("vocals,drums"))[0] == "htdemucs"


def test_explicit_model_wins():
    assert cli.resolve_selection(Args("6", model="lite"))[0] == "lite"


def test_only_overrides_stems():
    assert cli.resolve_selection(Args("4", only="bass"))[1] == ("bass",)


def test_unknown_stem_name_is_rejected():
    with pytest.raises(SystemExit):
        cli.resolve_selection(Args("ぎたー"))


def test_list_models_and_check(capsys):
    assert cli.main(["--list-models"]) == 0
    assert "htdemucs_6s" in capsys.readouterr().out
    assert cli.main(["--check"]) == 0
    assert "分離エンジン" in capsys.readouterr().out


def test_no_arguments_shows_help(capsys):
    assert cli.main([]) == 1
    assert "stemsplit" in capsys.readouterr().out


def test_missing_file_returns_error(tmp_path, capsys):
    assert cli.main([str(tmp_path / "ない.mp3"), "--model", "lite"]) == 2
    assert "見つからない" in capsys.readouterr().err


def test_bad_option_returns_error(song_file, capsys):
    assert cli.main([str(song_file), "--only", "ぎたー"]) == 2


def test_end_to_end_writes_files(tmp_path, song_file, capsys):
    code = cli.main([
        str(song_file), "--model", "lite", "-o", str(tmp_path), "-f", "flac", "-q",
    ])
    assert code == 0
    written = sorted(path.name for path in (tmp_path / "lite" / song_file.stem).iterdir())
    assert written == ["bass.flac", "drums.flac", "other.flac", "vocals.flac"]


def test_json_output_is_machine_readable(tmp_path, song_file, capsys):
    assert cli.main([str(song_file), "--model", "lite", "-o", str(tmp_path), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["results"][0]["model"] == "lite"
    assert len(payload["results"][0]["stems"]) == 4
    assert payload["failures"] == []


def test_folder_input_processes_every_song(tmp_path, song, capsys):
    from stemsplit import audio_io

    album = tmp_path / "album"
    album.mkdir()
    for name in ("a.wav", "b.wav"):
        audio_io.save_audio(album / name, song, 44100, "wav")
    assert cli.main([str(album), "--model", "lite", "-o", str(tmp_path / "out"), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert len(payload["results"]) == 2


def test_jp_names_option(tmp_path, song_file):
    assert cli.main([
        str(song_file), "--model", "lite", "-o", str(tmp_path), "--jp-names", "-q",
    ]) == 0
    assert (tmp_path / "lite" / song_file.stem / "ボーカル.wav").exists()


def test_selection_warning_when_model_cannot_split_six(capsys, song_file, tmp_path):
    code = cli.main([
        str(song_file), "--model", "lite", "--stems", "6", "-o", str(tmp_path), "-q",
    ])
    assert code == 0
    assert "htdemucs_6s" in capsys.readouterr().err


def test_failed_file_returns_non_zero(tmp_path, capsys):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"not audio at all")
    assert cli.main([str(broken), "--model", "lite", "-o", str(tmp_path), "-q"]) == 1
