"""把 `public/fd2/animations/FDOTHER_*` 的帧**合上 alpha**（RGB + mask → RGBA）。

==================================================================
为什么需要这一步
==================================================================
导出物是"RGB 帧 + 独立的 `_mask.png`"（`animation.json` 里两两成对）。
直接拿来画会带着**白底/黑框** —— 我核对帧组时拼的第一张对照图就是这样翻车的。

角色动画（`FIGANI`）那边已经有一条同样的合并（`artgen/prepare_frames.py`
的 `merge()`），这里只是把同一件事套到 `FDOTHER` 上。

用法：

    python3 artgen/prepare_fdother.py 028        # 只做 028（圣光弹）
    python3 artgen/prepare_fdother.py 028 020    # 做多个

⚠️ 产出**落在 `public/fd2/` 里**（那是 gitignore 的第三方素材目录）——
所以**不要**指望它们在 CI / 新检出里存在；运行时缺了就是"不放这段动画"，
不是报错（见 `src/render/spellBurst.ts` 的降级说明）。
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
from PIL import Image

FD2 = pathlib.Path("public/fd2/animations")


def merge(frame: pathlib.Path, mask: pathlib.Path) -> Image.Image:
    """RGB 帧 + 灰度 mask → RGBA。两者尺寸必须一致（不一致直接报错）。"""
    rgb = np.asarray(Image.open(frame).convert("RGB"))
    alpha = np.asarray(Image.open(mask).convert("L"))
    if rgb.shape[:2] != alpha.shape[:2]:
        raise ValueError(f"尺寸不一致: {frame.name} {rgb.shape[:2]} vs {alpha.shape[:2]}")
    out = np.dstack([rgb, alpha])
    return Image.fromarray(out, mode="RGBA")


def prepare(group: pathlib.Path) -> int:
    doc = json.loads((group / "animation.json").read_text(encoding="utf-8"))
    written = 0
    for frame in doc.get("frames", []):
        src = group / frame["path"]
        mask = group / frame["mask_path"]
        if not src.is_file() or not mask.is_file():
            continue
        # 输出名：f00.png …（与 FIGANI 的产物同名规律，方便调试）
        dst = group / f"f{int(str(frame['frame_id']).split('/')[-1]):02d}.png"
        merge(src, mask).save(dst)
        written += 1
    return written


def main(argv: list[str]) -> int:
    ids = argv[1:] or ["028"]
    total = 0
    for raw in ids:
        group = FD2 / f"FDOTHER_{raw}"
        if not group.is_dir():
            print(f"找不到 {group}")
            continue
        n = prepare(group)
        print(f"FDOTHER_{raw}: 合并 {n} 帧")
        total += n
    print(f"共 {total} 帧")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
