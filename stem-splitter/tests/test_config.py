import pytest

from stemsplit import config


def test_stem_order_covers_all_stems():
    assert set(config.STEM_ORDER) == set(config.STEMS)


def test_sort_stems_uses_display_order():
    assert config.sort_stems(["other", "vocals", "bass"]) == ["vocals", "bass", "other"]
    # 知らないキーは末尾にまとめられる
    assert config.sort_stems(["zzz", "vocals"]) == ["vocals", "zzz"]


def test_stem_label_falls_back_to_key():
    assert config.stem_label("vocals") == "ボーカル"
    assert config.stem_label("vocals", "en") == "Vocals"
    assert config.stem_label("unknown") == "unknown"


def test_six_stem_model_lists_guitar_and_piano():
    model = config.resolve_model("htdemucs_6s")
    assert model.stem_count == 6
    assert {"guitar", "piano"} <= set(model.stems)


def test_every_model_declares_known_stems():
    for model in config.MODELS.values():
        assert set(model.stems) <= set(config.STEMS)
        assert model.engine in {"demucs", "lite"}


def test_resolve_model_rejects_unknown():
    with pytest.raises(ValueError):
        config.resolve_model("なにこれ")
