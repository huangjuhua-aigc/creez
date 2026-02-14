"""
为 storyboard 中指定镜头的首帧/关键帧发起图片生成任务，并写回 isloading 占位符。

本脚本不调用 LLM，所有生图参数由主流程（tool call）传入。
脚本职责：将 reference_image_list 中 file:// 转为 base64 → 调用后端异步生图接口 →
写回 isloading 占位并保存 storyboard（storyboard 内仍存 file:// 以兼容既有数据）。
"""

import os
import sys
import json
import argparse
import time
import base64
from uuid import uuid4
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from skill_utils import load_storyboard, save_storyboard, find_shot_by_id


def _file_url_to_base64_data_url(file_path: str) -> str:
    """将 file:// 路径读成 base64，返回 data:image/xxx;base64,..."""
    if not file_path.startswith("file://"):
        return file_path
    path = file_path[7:] if file_path.startswith("file:///") else file_path[5:]
    path = os.path.normpath(path)
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return file_path
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _reference_list_for_api(reference_image_list: list) -> list:
    """将 storyboard 格式的 reference_image_list 转为接口格式：file:// 转为 base64 data URL."""
    out = []
    for item in reference_image_list or []:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or ""
        if url.startswith("file://"):
            url = _file_url_to_base64_data_url(url)
        out.append({"url": url})
    return out


# 与 Creez_backend 一致：后端从 Header 的 X-User-Id 获取 user_id（见 middleware/auth.require_user_id）
USER_ID_HEADER = "X-User-Id"
# 测试用默认值，未传 --user_id 且无环境变量时使用，保证本地/Agent 调用能通过后端校验
DEFAULT_USER_ID = "cbaef461-ae6e-46d8-bd06-cb4b94d68349"


def _call_async_image_api(base_url: str, task_id: str, payload: dict, user_id: str = "") -> dict:
    """POST 到 /creez/images/async_generations（与 Creez_backend 及前端 main.js 一致），返回 {"task_id": "..."} 或抛错。
    后端要求 X-User-Id 放在 Header 中，缺失会 401。"""
    url = base_url.rstrip("/") + "/creez/images/async_generations"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if user_id and str(user_id).strip():
        req.add_header(USER_ID_HEADER, str(user_id).strip())
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError) as e:
        return {"_error": str(e)}


def run(
    storyboard_path: str,
    shot_id: int,
    prompt: str,
    model: str,
    aspect_ratio: str,
    reference_image_list: list,
    frame_index: int = 0,
    user_id: str = "",
    project_id: str = "",
    chat_id: str = "",
    backend_base_url: str = "",
) -> dict:
    """
    为指定镜头的 frame 发起生图任务：调用后端异步接口，在 storyboard 中写入 isloading 占位并保存。
    reference_image_list 在 storyboard 中保持 file://；请求接口时 file:// 转为 base64。
    user_id 未传时从环境变量 CREEZ_USER_ID 读取，再缺省则用 DEFAULT_USER_ID（测试用）。
    """
    user_id = (user_id or "").strip() or os.environ.get("CREEZ_USER_ID", "").strip() or DEFAULT_USER_ID
    storyboard = load_storyboard(storyboard_path)
    scene_board = storyboard.get("scene_board", [])
    shot = find_shot_by_id(scene_board, shot_id)
    if not shot:
        return {"success": False, "message": f"shot_id {shot_id} not found"}

    if not isinstance(reference_image_list, list):
        reference_image_list = []

    task_id = str(uuid4())
    created_at = int(time.time() * 1000)

    # storyboard 内保留原始格式（file://），兼容既有数据
    params_for_storyboard = {
        "prompt": prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "reference_image_list": reference_image_list,
    }

    placeholder = {
        "status": "isloading",
        "taskId": task_id,
        "created_at": created_at,
        "parameters": params_for_storyboard,
        "image_urls": [],
    }

    picture = shot.setdefault("picture", {})
    frames = picture.setdefault("frames", [])

    if frame_index == 0:
        if not frames:
            frames.append([])
        frames[0].append(placeholder)
    else:
        frames.append([placeholder])

    save_storyboard(storyboard, storyboard_path)

    base_url = (backend_base_url or os.environ.get("BACKEND_BASE_URL", "")).strip()
    if not base_url:
        return {
            "success": True,
            "task_id": task_id,
            "shot_id": shot_id,
            "frame_index": frame_index,
            "message": f"已写入 isloading 占位并保存；未配置 BACKEND_BASE_URL，未调用生图接口",
        }

    # 请求体：reference 中 file:// 转为 base64，供后端使用（user_id 由后端从 Header X-User-Id 读取，不放在 body）
    api_reference = _reference_list_for_api(reference_image_list)
    payload = {
        "prompt": prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "reference_image_list": api_reference,
        "project_id": project_id or "creez",
        "chat_id": chat_id or "",
    }
    api_result = _call_async_image_api(base_url, task_id, payload, user_id=user_id)
    if api_result.get("_error"):
        return {
            "success": False,
            "task_id": task_id,
            "shot_id": shot_id,
            "message": f"storyboard 已保存，但调用生图接口失败: {api_result['_error']}",
        }

    return {
        "success": True,
        "task_id": api_result.get("task_id", task_id),
        "shot_id": shot_id,
        "frame_index": frame_index,
        "message": f"已提交生图任务 task_id={task_id}，storyboard 已写入 isloading 占位并保存",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="为指定镜头发起图片生成任务并写回 isloading 占位。所有生图参数需由调用方传入。"
    )
    parser.add_argument("storyboard", help="storyboard JSON 文件路径")
    parser.add_argument("--shot_id", type=int, required=True, help="镜头 shot_id")
    parser.add_argument("--frame_index", type=int, default=0, help="0=写入 picture.frames[0]，≥1=新组")
    parser.add_argument("--prompt", required=True, help="生图 prompt")
    parser.add_argument("--model", required=True, help="生图模型")
    parser.add_argument("--aspect_ratio", required=True, help="宽高比，如 16:9")
    parser.add_argument(
        "--reference_image_list",
        required=True,
        help='参考图列表 JSON，如 [{"url":"file:///D:/path/to/image.png"}]',
    )
    parser.add_argument("--user_id", default="", help="系统级参数")
    parser.add_argument("--project_id", default="", help="系统级参数")
    parser.add_argument("--chat_id", default="", help="系统级参数")
    parser.add_argument("--backend_base_url", default="", help="后端 base URL，也可用环境变量 BACKEND_BASE_URL")
    args = parser.parse_args()

    try:
        reference_image_list = json.loads(args.reference_image_list)
    except json.JSONDecodeError:
        return_err = {"success": False, "message": "reference_image_list 格式错误，需为合法 JSON 数组"}
        print(json.dumps(return_err, ensure_ascii=False))
        sys.exit(1)

    result = run(
        args.storyboard,
        shot_id=args.shot_id,
        frame_index=args.frame_index,
        prompt=args.prompt,
        model=args.model,
        aspect_ratio=args.aspect_ratio,
        reference_image_list=reference_image_list,
        user_id=args.user_id,
        project_id=args.project_id,
        chat_id=args.chat_id,
        backend_base_url=args.backend_base_url or os.environ.get("BACKEND_BASE_URL", ""),
    )
    print(json.dumps(result, ensure_ascii=False))
