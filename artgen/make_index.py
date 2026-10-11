#!/usr/bin/env python3
"""从 FD2 抽取出来的素材生成**人物对照表**(HTML)。

用途：挑素材时要知道"哪个文件是谁"。产出 `public/fd2/INDEX.html`，
浏览器里直接翻，每格显示 **缩略图 + 组号 + 角色名 + 相对路径**。

用法：
    python3 artgen/make_index.py [fd2_re 路径]

`fd2_re` 路径默认取 `$FD2_RE` 或 `/tmp/fd2_re`。

⚠️ 依赖 `fd2_re` 的两个数据文件（**本仓库不 vendored**，避免 RRSAL-1.0 的
再散布义务）：
    docs/data/exe_tables/characters.json   32 个可玩角色的 sprite_group → 名字
    docs/data/portrait_names.json          136 个 id → 名字（含怪物，部分未知）
取法见 THIRD-PARTY-NOTICES.md。

三套素材的 id 空间**不是**同一个，本脚本各按各的规则映射：

  units/     1680 张 = 140 组 × 12 帧（4 方向 × 3 帧）→ 组号即 portrait id
  portraits/ DATO_NNN_mN.png                          → NNN 即 portrait id
  animations/FIGANI_NNN/                              → 角色 id = NNN // 3
             （`fd2_re` 已验：索爾 0→FIGANI0、亞雷斯 4→12、盜賊 96→288）
"""

from __future__ import annotations

import glob
import html
import json
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FD2 = ROOT / "public" / "fd2"

# 单位小人的每组件数：4 方向 × 3 帧。见 `fd2_re` 的 `export_sprites.py`。
FRAMES_PER_UNIT_GROUP = 12
# FIGANI 每角色 3 组动画。
FIGANI_PER_CHARACTER = 3


def load_names(repo: pathlib.Path) -> tuple[dict[int, str], dict[int, str]]:
    """返回 (id → 名字, id → 备注)。

    三个来源按覆盖率合并，**后者不覆盖前者**：

      1. `characters.json`       32 个**可玩角色**，带职业/等级 → 用来写备注
      2. `entities.json` 的 `battle_names`  **94 个 id**，取自游戏自己的字符串表
         （`FDTXT_000/string_NNNN`，`status: original_confirmed`）—— 主力来源
      3. `portrait_names.json`   136 个 id，但只有 39 个有名字（靠对话反推）

    ⚠️ `battle_names` 是覆盖率最高的那个：它包含**敌人与 NPC**
    （沼澤怪物 / 地魔神…空魔神 / 暗黑龍 / 村民 / 國王），
    而 `characters.json` 只有 32 个可玩角色。
    """
    names: dict[int, str] = {}
    notes: dict[int, str] = {}

    # --- 3（最低优先，先填）---
    pn = repo / "docs" / "data" / "portrait_names.json"
    if pn.is_file():
        for key, val in json.loads(pn.read_text(encoding="utf-8")).items():
            nm = (val or {}).get("name")
            if nm:
                names[int(key)] = nm

    # --- 2（主力：游戏字符串表）---
    ents = repo / "remake" / "assets" / "locales" / "zh-Hant" / "entities.json"
    if ents.is_file():
        data = json.loads(ents.read_text(encoding="utf-8"))
        for key, val in (data.get("battle_names") or {}).items():
            nm = (val or {}).get("name")
            if nm:
                names[int(key)] = nm

    # --- 1（可玩角色：名字 + 职业/等级备注）---
    chars = repo / "docs" / "data" / "exe_tables" / "characters.json"
    if chars.is_file():
        for row in json.loads(chars.read_text(encoding="utf-8")):
            gid = row.get("sprite_group")
            if not isinstance(gid, int):
                continue
            if row.get("name"):
                names[gid] = row["name"]
            cls = row.get("cls_name") or ""
            lv = row.get("lv")
            if cls:
                notes[gid] = f"可玩 · {cls} Lv{lv}"

    return names, notes


def rel(path: pathlib.Path) -> str:
    return path.relative_to(FD2).as_posix()


def section(title: str, hint: str, cards: list[str]) -> str:
    return f"""
<h2>{html.escape(title)} <span class="count">{len(cards)}</span></h2>
<p class="hint">{html.escape(hint)}</p>
<div class="grid">
{''.join(cards)}
</div>
"""


def card(thumb: str, idx: int, name: str, note: str, path: str, size: str = "") -> str:
    known = "" if name.startswith("未知") or name.startswith("未命名") else " known"
    return f"""  <figure class="card{known}">
    <img src="{html.escape(thumb)}" alt="{html.escape(name)}" loading="lazy">
    <figcaption>
      <b>#{idx:03d}</b> <span class="name">{html.escape(name)}</span>
      {f'<span class="note">{html.escape(note)}</span>' if note else ''}
      {f'<span class="note">{html.escape(size)}</span>' if size else ''}
      <code>{html.escape(path)}</code>
    </figcaption>
  </figure>
"""


def main(argv: list[str]) -> int:
    repo = pathlib.Path(argv[1] if len(argv) > 1 else os.environ.get("FD2_RE", "/tmp/fd2_re"))
    if not (repo / "docs").is_dir():
        print(f"找不到 fd2_re 数据：{repo}\n用法：python3 artgen/make_index.py <fd2_re 路径>")
        return 2

    names, notes = load_names(repo)
    print(f"载入名字 {len(names)} 条")

    # ---------- 1. 战斗画面人物（FIGANI）----------
    fig_cards = []
    for d in sorted(glob.glob(str(FD2 / "animations" / "FIGANI_*"))):
        p = pathlib.Path(d)
        if not p.is_dir():
            continue
        num = int(p.name.split("_")[1])
        cid = num // FIGANI_PER_CHARACTER
        frames = sorted(p.glob("*_f00.png"))
        if not frames:
            continue
        name = names.get(cid, f"未知 (角色 {cid})")
        # GIF 走原始路径（不缩略），PNG 用首帧
        gif = FD2 / "animations" / f"{p.name}.gif"
        thumb = rel(frames[0])
        fig_cards.append(card(thumb, num, name, notes.get(cid, ""), rel(gif if gif.is_file() else frames[0])))

    # ---------- 2. 地图小人（units）----------
    unit_cards = []
    files = sorted((FD2 / "units").glob("icon_*.png"))
    for i in range(0, len(files), FRAMES_PER_UNIT_GROUP):
        gid = i // FRAMES_PER_UNIT_GROUP
        first = files[i]
        name = names.get(gid, f"未知 ({gid})")
        unit_cards.append(card(rel(first), gid, name, notes.get(gid, ""), rel(first)))

    # ---------- 3. 对话头像（portraits）----------
    port_cards = []
    for f in sorted((FD2 / "portraits").glob("*_m0.png")):
        pid = int(f.stem.split("_")[1])
        name = names.get(pid, f"未知 ({pid})")
        port_cards.append(card(rel(f), pid, name, notes.get(pid, ""), rel(f)))

    body = (
        section(
            "战斗画面人物（FIGANI）",
            "战斗演出里的全身人物。⚠️ 每 3 个编号是同一角色的 3 个动画槽，"
            "但**很多槽本来是空的**（原版就没做），所以只有 125 个角色有动画。"
            "没有动画的基本是国王 / 王后这类 NPC。",
            fig_cards,
        )
        + section("地图小人（units）", "24×24 Q 版，每 12 帧一组（下/左/上/右 × 站/抬左/抬右）。本表每格是该组「朝下站姿」。", unit_cards)
        + section("对话头像（portraits）", "80×80，每角色 4 张嘴型帧（_m0.._m3）。本表取 _m0。", port_cards)
    )

    doc = f"""<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>《炎龍騎士團2》素材对照表</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin:0; padding:24px 28px 64px; background:#181820; color:#e8e8f0;
         font:14px/1.5 -apple-system,"PingFang TC","Noto Sans CJK TC",sans-serif; }}
  h1 {{ margin:0 0 4px; font-size:22px; }}
  .warn {{ margin:0 0 22px; padding:10px 14px; border-left:3px solid #c9a227;
           background:#241f10; color:#e6d9a8; font-size:13px; }}
  h2 {{ margin:34px 0 2px; font-size:17px;
        border-bottom:1px solid #333; padding-bottom:6px; }}
  h2 .count {{ color:#8b8ba3; font-weight:400; font-size:13px; }}
  .hint {{ margin:4px 0 14px; color:#8b8ba3; font-size:12.5px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:12px; }}
  .card {{ margin:0; padding:8px 8px 10px; background:#22222c;
           border:1px solid #2e2e3a; border-radius:8px; }}
  .card.known {{ border-color:#3c4a6b; }}
  .card img {{ display:block; width:100%; height:96px; object-fit:contain;
               image-rendering:pixelated; background:#14141b; border-radius:4px; }}
  figcaption {{ margin-top:6px; font-size:11.5px; line-height:1.45; }}
  figcaption b {{ color:#8b8ba3; font-weight:600; }}
  figcaption .name {{ color:#f0f0f8; }}
  figcaption .note {{ display:block; color:#7c7c96; font-size:10.5px; }}
  figcaption code {{ display:block; margin-top:3px; color:#6f7f9f;
                     font-size:10px; word-break:break-all; }}
</style>
<h1>《炎龍騎士團2》素材对照表</h1>
<div class="warn">
  ⚠️ 本表列的素材**版权属漢堂國際資訊（1995）**，仅作本项目（非商业个人作品）
  的开发期占位。<b>不得商用、不得再散布</b>。详见仓库根目录
  <code>THIRD-PARTY-NOTICES.md</code>。
</div>
<p class="hint">在浏览器里翻这张表，找到想要的图 → 把 <code>&lt;路径&gt;</code> 那行告诉我即可。</p>
{body}
</html>
"""
    out = FD2 / "INDEX.html"
    out.write_text(doc, encoding="utf-8")
    print(f"写出 {out}")
    print(f"  战斗人物 {len(fig_cards)} 组 / 地图小人 {len(unit_cards)} 组 / 头像 {len(port_cards)} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
