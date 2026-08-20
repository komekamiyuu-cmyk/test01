"""ステム(楽器パート)とモデルの定義。

ここが「どんなパートに分けられるか」「どのモデルが何を出力するか」の
単一の情報源。新しいモデルを足すときは MODELS に1行追加する。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple

# --------------------------------------------------------------------------
# ステム(パート)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Stem:
    """出力される1パートの情報。"""

    key: str          # ファイル名やAPIで使う識別子(ASCII)
    label_ja: str     # 画面表示用(日本語)
    label_en: str
    description: str


STEMS: Dict[str, Stem] = {
    "vocals": Stem("vocals", "ボーカル", "Vocals", "歌声(メイン/コーラス)"),
    "drums": Stem("drums", "ドラム", "Drums", "キック・スネア・ハイハットなど打楽器"),
    "bass": Stem("bass", "ベース", "Bass", "ベースギター・シンセベースなど低音"),
    "guitar": Stem("guitar", "ギター", "Guitar", "エレキ/アコースティックギター"),
    "piano": Stem("piano", "キーボード", "Piano / Keys", "ピアノ・エレピ・シンセなど鍵盤"),
    "other": Stem("other", "その他", "Other", "上記に当てはまらない音(ストリングス等)"),
    # 2ステム分離のときに出る「歌以外ぜんぶ」
    "instrumental": Stem(
        "instrumental", "カラオケ", "Instrumental", "ボーカルを除いた伴奏ミックス"
    ),
}

#: 出力やUIでの並び順(この順で表示・書き出しする)
STEM_ORDER: Tuple[str, ...] = (
    "vocals",
    "drums",
    "bass",
    "guitar",
    "piano",
    "other",
    "instrumental",
)

FOUR_STEMS: Tuple[str, ...] = ("vocals", "drums", "bass", "other")
SIX_STEMS: Tuple[str, ...] = ("vocals", "drums", "bass", "guitar", "piano", "other")


def stem_label(key: str, lang: str = "ja") -> str:
    """ステム識別子を人が読めるラベルにする。未知のキーはそのまま返す。"""
    stem = STEMS.get(key)
    if stem is None:
        return key
    return stem.label_ja if lang == "ja" else stem.label_en


def sort_stems(keys) -> list:
    """STEM_ORDER の順に並べ替える(未知のキーは末尾)。"""
    order = {key: i for i, key in enumerate(STEM_ORDER)}
    return sorted(keys, key=lambda k: (order.get(k, len(order)), k))


# --------------------------------------------------------------------------
# モデル
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Model:
    """分離モデル1つ分のカタログ情報。"""

    name: str
    engine: str                   # "demucs" | "lite"
    stems: Tuple[str, ...]
    quality: str                  # 目安(★の数)
    speed: str
    description: str
    needs_download: bool = True
    extras: Dict[str, str] = field(default_factory=dict)

    @property
    def stem_count(self) -> int:
        return len(self.stems)


MODELS: Dict[str, Model] = {
    "htdemucs_6s": Model(
        name="htdemucs_6s",
        engine="demucs",
        stems=SIX_STEMS,
        quality="★★★★",
        speed="ふつう",
        description="6パート(ギター・キーボードまで分離)。楽器ごとに分けたいならこれ。",
    ),
    "htdemucs": Model(
        name="htdemucs",
        engine="demucs",
        stems=FOUR_STEMS,
        quality="★★★★★",
        speed="ふつう",
        description="4パート。もっとも安定した既定モデル。",
    ),
    "htdemucs_ft": Model(
        name="htdemucs_ft",
        engine="demucs",
        stems=FOUR_STEMS,
        quality="★★★★★+",
        speed="とても遅い(約4倍)",
        description="4パート。htdemucs の追加学習版で最高品質だが時間がかかる。",
    ),
    "hdemucs_mmi": Model(
        name="hdemucs_mmi",
        engine="demucs",
        stems=FOUR_STEMS,
        quality="★★★★",
        speed="ふつう",
        description="4パート。Hybrid Demucs v3 系。htdemucs が合わない曲の代替に。",
    ),
    "mdx_extra": Model(
        name="mdx_extra",
        engine="demucs",
        stems=FOUR_STEMS,
        quality="★★★★",
        speed="遅い",
        description="4パート。MDX コンペ版。ボーカルの抜けが良いことがある。",
    ),
    "mdx_extra_q": Model(
        name="mdx_extra_q",
        engine="demucs",
        stems=FOUR_STEMS,
        quality="★★★",
        speed="遅い",
        description="4パート。mdx_extra の量子化版(ダウンロード容量が小さい)。",
    ),
    "lite": Model(
        name="lite",
        engine="lite",
        stems=FOUR_STEMS,
        quality="★★",
        speed="とても速い",
        description=(
            "追加インストール不要の簡易モード(numpy のみ)。"
            "AI モデルは使わず、周波数とステレオ定位から大まかに分けるだけ。下書き/確認用。"
        ),
        needs_download=False,
    ),
}

#: 何も指定しなかったときのモデル
DEFAULT_MODEL = "htdemucs"

#: --stems の指定からモデルを選ぶための表
STEM_COUNT_TO_MODEL: Dict[int, str] = {4: "htdemucs", 6: "htdemucs_6s"}

#: Demucs が想定するサンプリングレート
DEMUCS_SAMPLE_RATE = 44100

#: 読み込みに対応する拡張子(ffmpeg があればこれ以外も読める)
INPUT_EXTENSIONS: Tuple[str, ...] = (
    ".wav", ".flac", ".mp3", ".ogg", ".oga", ".opus", ".m4a", ".aac",
    ".aiff", ".aif", ".aifc", ".wma", ".alac", ".mp4", ".webm",
)

#: 書き出しに対応する形式
OUTPUT_FORMATS: Tuple[str, ...] = ("wav", "flac", "mp3")


def resolve_model(name: str) -> Model:
    """モデル名を Model に解決する。未知ならエラー。"""
    try:
        return MODELS[name]
    except KeyError:
        known = ", ".join(MODELS)
        raise ValueError(f"未知のモデルです: {name}(使えるモデル: {known})") from None
