#!/usr/bin/env python3
"""Retro Diffusion 生成器 —— 独立于游戏代码，不影响 src/。

用途：为 raid-simulator 生成像素美术素材（玩家 / Boss / 场景）。

设计约束（与仓库约定一致）：
  * 不 import、不修改 `src/` 下任何东西；本目录是独立工具。
  * key 只从 `artgen/.env` 或环境变量读，**绝不写进代码或提交**。
  * 产物落在 `artgen/out/`（已 gitignore），不改动现有资源。

用法：
    python3 artgen/generate.py balance
    python3 artgen/generate.py styles [模型名，如 rd_plus]
    python3 artgen/generate.py estimate --prompt "..." --style rd_plus__game_asset
    python3 artgen/generate.py gen --prompt "..." --style rd_plus__game_asset \
        --width 64 --height 64 --num 1 --seed 42
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API_BASE = os.environ.get("RD_API_BASE", "https://api.retrodiffusion.ai/v2")
HERE = pathlib.Path(__file__).resolve().parent
ENV_FILE = HERE / ".env"
OUT_DIR = HERE / "out"
POLL_INTERVAL_S = 3
POLL_TIMEOUT_S = 600


def load_api_key() -> str:
    """从环境变量或 `artgen/.env` 取 key。

    `.env` 的格式刻意只支持 `KEY=VALUE` 单行，避免引入 dotenv 依赖。
    """
    key = os.environ.get("RD_API_KEY", "").strip()
    if key:
        return key
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if name.strip() == "RD_API_KEY":
                return value.strip().strip('"').strip("'")
    raise SystemExit(
        "缺少 API key：请设置环境变量 RD_API_KEY，或写入 artgen/.env（已 gitignore）"
    )


def ssl_context() -> ssl.SSLContext:
    """优先用 certifi 的 CA 包。

    为什么需要：本机走代理（MITM 证书），而 Python.org 版 Python 不读 macOS
    钥匙串，默认上下文会直接 `CERTIFICATE_VERIFY_FAILED`。`requests` 能通正是
    因为它自带 certifi。这里复刻同一行为，同时保留零第三方依赖的退路。
    """
    try:
        import certifi  # noqa: PLC0415 — 可选依赖，只在可用时使用

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def request_json(
    method: str,
    path: str,
    key: str,
    payload: dict | None = None,
    extra_headers: dict | None = None,
) -> dict:
    """发一次请求并解析 JSON。HTTP 错误会把响应体带出来，便于定位。"""
    url = f"{API_BASE}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"X-RD-Token": key, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60, context=ssl_context()) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {err.code} {url}\n{detail}") from err
    except urllib.error.URLError as err:
        raise SystemExit(f"网络错误 {url}: {err.reason}") from err

    if not body.strip():
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        raise SystemExit(f"响应不是 JSON：{body[:500]}")


def cmd_balance(key: str, _args: argparse.Namespace) -> None:
    data = request_json("GET", "/inferences/credits", key)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_styles(key: str, args: argparse.Namespace) -> None:
    """拉风格目录 —— 这是 `prompt_style` 合法取值的权威来源。"""
    params = ""
    if args.model:
        params = f"?model={urllib.parse.quote(args.model)}"
    data = request_json("GET", f"/styles/selector{params}", key)
    print(json.dumps(data, indent=2, ensure_ascii=False))


def build_payload(args: argparse.Namespace, check_cost: bool) -> dict:
    payload: dict = {
        "prompt": args.prompt,
        "prompt_style": args.style,
        "width": args.width,
        "height": args.height,
        "num_images": args.num,
    }
    if args.seed is not None:
        payload["seed"] = args.seed
    if args.negative:
        # ⚠️ 字段名是 `negative`（不是 `negative_prompt`）。
        #
        # ⚠️ 更要紧的是：RD 官方文档明确写着这个字段
        #   "is a placeholder — no current model uses it".
        # 也就是**当前它不生效**。保留只是为了将来它接上时能直接用；
        # 真正管用的手段是**重写正向 prompt**（"只描述你想要的东西"）。
        # 别指望它能把两个人改成一个人 —— 实测无效。
        payload["negative"] = args.negative
    if args.remove_bg:
        payload["remove_bg"] = True
    if args.palette:
        palette_path = pathlib.Path(args.palette)
        payload["input_palette"] = base64.b64encode(palette_path.read_bytes()).decode()
    if args.reference:
        payload["reference_images"] = [
            base64.b64encode(pathlib.Path(p).read_bytes()).decode()
            for p in args.reference
        ]
    if check_cost:
        payload["check_cost"] = True
    return payload


def cmd_estimate(key: str, args: argparse.Namespace) -> None:
    """免费试算：只返回价格，不出图、不扣费。"""
    data = request_json("POST", "/inferences", key, build_payload(args, check_cost=True))
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_gen(key: str, args: argparse.Namespace) -> None:
    """提交生成任务 → 轮询 → 落盘 PNG。"""
    payload = build_payload(args, check_cost=False)
    # Idempotency-Key 必须在 POST 前生成并保留：重复提交同一 key 不会重复扣费。
    idem = str(uuid.uuid4())
    accepted = request_json(
        "POST", "/inferences", key, payload, {"Idempotency-Key": idem}
    )
    task_id = accepted.get("task_id")
    if not task_id:
        raise SystemExit(f"未返回 task_id：{accepted}")
    print(f"accepted task_id={task_id}\n  idempotency-key={idem}（保留至拿到结果）")

    deadline = time.time() + POLL_TIMEOUT_S
    while True:
        task = request_json("GET", f"/inferences/tasks/{task_id}", key)
        status = task.get("status")
        if status in ("pending", "running"):
            if time.time() > deadline:
                raise SystemExit(f"轮询超时（{POLL_TIMEOUT_S}s），task_id={task_id}")
            time.sleep(POLL_INTERVAL_S)
            continue
        if status == "failed":
            raise SystemExit(f"任务失败：{task.get('error')}\n{json.dumps(task, ensure_ascii=False)}")
        break

    result = task.get("result") or {}
    images = result.get("base64_images") or []
    if not images:
        raise SystemExit(f"结果里没有图片：{json.dumps(task, ensure_ascii=False)[:800]}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    written = []
    for i, b64 in enumerate(images):
        dest = OUT_DIR / f"{stamp}-{args.name}-{i}.png"
        dest.write_bytes(base64.b64decode(b64))
        written.append(dest)

    print(f"\n模型 {result.get('model')}  本次花费 ${result.get('balance_cost')}"
          f"  余额 ${result.get('remaining_balance')}")
    for p in written:
        print(f"  → {p}")


def add_common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--prompt", required=True, help="只描述【主体】，风格交给 prompt_style")
    p.add_argument("--style", required=True, help="如 rd_plus__game_asset")
    p.add_argument("--width", type=int, default=64)
    p.add_argument("--height", type=int, default=64)
    p.add_argument("--num", type=int, default=1)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--negative", default=None,
                   help="⚠️ 当前**无效**：RD 文档说该字段是占位、没有模型使用它。"
                        "想排除什么就改写正向 prompt")
    p.add_argument("--remove-bg", action="store_true", help="输出透明背景")
    p.add_argument("--palette", default=None, help="调色板图片路径（锁色板）")
    p.add_argument("--reference", action="append", default=None,
                   help="参考图路径，可重复（锁角色；RD Pro 风格最多 9 张）")
    p.add_argument("--name", default="gen", help="输出文件名前缀")


def main() -> None:
    parser = argparse.ArgumentParser(description="Retro Diffusion 独立生成器")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("balance", help="查余额")

    ps = sub.add_parser("styles", help="拉风格目录（权威取值）")
    ps.add_argument("model", nargs="?", default=None)

    pe = sub.add_parser("estimate", help="免费试算价格")
    add_common(pe)

    pg = sub.add_parser("gen", help="生成图片")
    add_common(pg)

    args = parser.parse_args()
    key = load_api_key()

    if args.cmd == "balance":
        cmd_balance(key, args)
    elif args.cmd == "styles":
        cmd_styles(key, args)
    elif args.cmd == "estimate":
        cmd_estimate(key, args)
    elif args.cmd == "gen":
        cmd_gen(key, args)
    else:
        parser.error(f"未知子命令 {args.cmd}")


if __name__ == "__main__":
    sys.exit(main())
