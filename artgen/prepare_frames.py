#!/usr/bin/env python3
"""把 FD2 的「帧 + mask」合并成**自带透明通道的 RGBA PNG**，并产出动画清单。

===========================================================================
为什么要这一步
===========================================================================

`fd2_re` 解出来的帧是**两个文件**：

    FIGANI_123_f04.png        mode=P（索引色），alpha 全 255 —— 不透明
    FIGANI_123_f04_mask.png   mode=L，取值 0 / 255        —— 透明通道在这里

直接 `Assets.load` 主图会得到一个**黑底方块**（实测 52% 的像素是
"主图黑 + mask=0"）。

两种接法：
  A. 运行时同时加载帧与 mask，每帧做一次遮罩合成
  B. **预先合并成 RGBA**，运行时一个文件一次解码

选 **B**：解码次数、纹理上传次数、显存都是 A 的一半，运行期零遮罩开销。
代价只是多一份磁盘（本目录本来就在 .gitignore 里）。

===========================================================================
产出
===========================================================================

    public/fd2/rgba/<slot>/<anim>/f<NN>.png     RGBA 帧
    public/fd2/rgba/manifest.json               实体 → 动画 → 帧路径

`<slot>` 是**用途名**（player / pride / lust …），不是素材 id ——
这样接入代码里读的是"这个 Boss 的 idle"，换素材时不用改代码。

用法：
    python3 artgen/prepare_frames.py
"""

from __future__ import annotations

import glob
import json
import os
import pathlib
import sys

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FD2 = ROOT / "public" / "fd2"
SRC = FD2 / "animations"
OUT = FD2 / "rgba"

# 每个角色 3 个动画槽（`fd2_re` 已验：角色 id × 3 + k）
SLOTS = {0: "idle", 1: "attack", 2: "ult"}

# 用途名 → 素材角色 id。
# ⚠️ 素材 id 是 `fd2_re` 的 FIGANI 组号 ÷ 3；改这里的映射即可换素材，代码不用动。
ENTITIES: dict[str, int] = {
    # 玩家
    "player-linwanfeng": 0,    # 索爾
    "player-kaili": 12,        # 凱麗
    "player-daixuan": 11,      # 索菲亞
    # Boss（七宗罪）
    "boss-pride": 125,         # 火魔神
    "boss-lust": 123,          # 水魔神
    "boss-envy": 124,          # 風魔神
    "boss-gluttony": 122,      # 地魔神
    "boss-wrath": 126,         # 空魔神
    "boss-sloth": 116,         # 機甲隊長
    "boss-greed": 97,          # 盜賊頭目
}


def merge(frame: pathlib.Path, mask: pathlib.Path) -> Image.Image:
    """主图（P，不透明）+ mask（L，0/255）→ RGBA。"""
    rgb = np.asarray(Image.open(frame).convert("RGB"))
    alpha = np.asarray(Image.open(mask).convert("L"))
    if rgb.shape[:2] != alpha.shape[:2]:
        raise ValueError(f"尺寸不一致: {frame.name} {rgb.shape[:2]} vs mask {alpha.shape[:2]}")
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def frame_delays(group_dir: pathlib.Path) -> list[int]:
    """读 `animation.json` 的逐帧 `delay_native`。

    ==================================================================
    为什么需要它
    ==================================================================
    原版给**每一帧**单独设了停留时间（FIGANI 帧头 `+6`，`fd2_re` 叫它
    `delay_native`）。所以"帧数"和"时长"不成正比 —— 暴食只有 6 帧却要
    1.00s，嫉妒 22 帧要 2.40s。

    本项目的规则是「**读条时长 = 播放时长**」：动画整体缩放到读条，
    但**帧间的相对快慢按 delay 分配**。这样既保证刀落在读条结束那一刻
    （交互不受美术影响），又保住原版"哪一帧该停久"的调校。

    缺 `animation.json` 时退化成「每帧等长」。
    """
    doc = group_dir / "animation.json"
    if not doc.is_file():
        return []
    try:
        data = json.loads(doc.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out: list[int] = []
    for fr in data.get("frames", []):
        d = fr.get("delay_native")
        out.append(int(d) if isinstance(d, int) and d > 0 else 1)
    return out


def main() -> int:
    if not SRC.is_dir():
        print(f"找不到素材目录 {SRC}")
        return 2

    manifest: dict[str, dict[str, dict[str, object]]] = {}
    total = 0

    for slot, char_id in ENTITIES.items():
        anims: dict[str, dict[str, object]] = {}
        for k, aname in SLOTS.items():
            gid = char_id * 3 + k
            group = SRC / f"FIGANI_{gid:03d}"
            frames = sorted(f for f in glob.glob(str(group / "*.png")) if "_mask" not in f)
            if not frames:
                continue
            delays = frame_delays(group)
            dst = OUT / slot / aname
            dst.mkdir(parents=True, exist_ok=True)
            paths: list[str] = []
            kept: list[int] = []
            for i, f in enumerate(frames):
                fp = pathlib.Path(f)
                mk = fp.with_name(fp.stem + "_mask.png")
                if not mk.is_file():
                    continue
                out = dst / f"f{i:02d}.png"
                merge(fp, mk).save(out)
                # ⚠️ 存**相对 `public/`** 的路径 —— 这样接入侧直接
                # `assetUrl(entry)` 就能用，不需要自己拼 `fd2/` 前缀。
                paths.append((pathlib.Path("fd2") / out.relative_to(FD2)).as_posix())
                kept.append(delays[i] if i < len(delays) else 1)
                total += 1
            if paths:
                anims[aname] = {"frames": paths, "delays": kept}
        if anims:
            manifest[slot] = anims

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"合并 {total} 帧 → {OUT.relative_to(ROOT)}")
    for slot, anims in manifest.items():
        detail = "  ".join(
            f"{k}:{len(v['frames'])}帧/Σdelay={sum(v['delays'])}" for k, v in anims.items()
        )
        print(f"  {slot:<22} {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
