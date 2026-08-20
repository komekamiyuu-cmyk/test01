"""stemsplit — 音楽をパートごとのステムに分けるツール。

    from stemsplit import Separator, SeparationOptions

    sep = Separator(SeparationOptions(model="htdemucs_6s", output_format="flac"))
    result = sep.separate_file("song.mp3")
    for stem in result.stems:
        print(stem.label, stem.path)
"""

from .config import MODELS, STEMS, Model, Stem, stem_label
from .progress import ProgressEvent, Reporter
from .separator import (
    SeparationOptions,
    SeparationResult,
    Separator,
    StemFile,
    collect_inputs,
)

__version__ = "0.1.0"

__all__ = [
    "MODELS",
    "STEMS",
    "Model",
    "ProgressEvent",
    "Reporter",
    "SeparationOptions",
    "SeparationResult",
    "Separator",
    "Stem",
    "StemFile",
    "collect_inputs",
    "stem_label",
    "__version__",
]
