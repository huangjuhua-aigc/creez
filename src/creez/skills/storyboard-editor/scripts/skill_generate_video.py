"""
为 storyboard 中指定镜头发起视频生成任务，并写回 isloading 占位符。

脚本职责：将 first_frame_image / last_frame_image 若为 file:// 转为 base64 →
调用后端异步生视频接口 → 写回 isloading 占位并保存 storyboard（storyboard 内仍存 file:// 以兼容既有数据）。
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
    if not file_path or not file_path.strip().startswith("file://"):
        return file_path
    path = file_path.strip()
    path = path[7:] if path.startswith("file:///") else path[5:]
    path = os.path.normpath(path)
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return file_path
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


# 与 Creez_backend 一致：后端从 Header 的 X-User-Id 获取 user_id（见 middleware/auth.require_user_id）
USER_ID_HEADER = "X-User-Id"
# 测试用默认值，未传 --user_id 且无环境变量时使用，保证本地/Agent 调用能通过后端校验
DEFAULT_USER_ID = "cbaef461-ae6e-46d8-bd06-cb4b94d68349"


def _call_async_video_api(base_url: str, payload: dict, user_id: str = "") -> dict:
    """POST 到 /creez/videos/async_generations（与 Creez_backend 及前端 main.js 一致），返回 {"task_id": "..."} 或抛错。后端要求 X-User-Id 在 Header。"""
    url = base_url.rstrip("/") + "/creez/videos/async_generations"
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
    duration: int,
    first_frame_image: str,
    frame_index: int = 0,
    last_frame_image: str = "",
    user_id: str = "",
    project_id: str = "",
    chat_id: str = "",
    backend_base_url: str = "",
) -> dict:
    """
    为指定镜头发起生视频任务：调用后端异步接口，在 storyboard 中写入 isloading 占位并保存。
    first_frame_image / last_frame_image 在 storyboard 中保持 file://；请求接口时 file:// 转为 base64。
    user_id 未传时从环境变量 CREEZ_USER_ID 读取，再缺省则用 DEFAULT_USER_ID（测试用）。
    """
    user_id = (user_id or "").strip() or os.environ.get("CREEZ_USER_ID", "").strip() or DEFAULT_USER_ID
    storyboard = load_storyboard(storyboard_path)
    scene_board = storyboard.get("scene_board", [])
    shot = find_shot_by_id(scene_board, shot_id)
    if not shot:
        return {"success": False, "message": f"shot_id {shot_id} not found"}

    if not (first_frame_image or "").strip():
        return {"success": False, "message": f"shot_id {shot_id} 无可用首帧图，请先生成首帧图"}

    task_id = str(uuid4())
    created_at = int(time.time() * 1000)

    placeholder = {
        "status": "isloading",
        "taskId": task_id,
        "created_at": created_at,
        "parameters": {
            "prompt": prompt,
            "model": model,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "first_frame_image": first_frame_image,
            "last_frame_image": last_frame_image or "",
        },
        "video_urls": [],
    }

    videos = shot.setdefault("videos", [])
    videos.append(placeholder)
    save_storyboard(storyboard, storyboard_path)

    base_url = (backend_base_url or os.environ.get("BACKEND_BASE_URL", "")).strip()
    if not base_url:
        return {
            "success": True,
            "task_id": task_id,
            "shot_id": shot_id,
            "message": "已写入 isloading 占位并保存；未配置 BACKEND_BASE_URL，未调用生视频接口",
        }

    # 请求体：file:// 转为 base64 供后端使用（user_id 由后端从 Header X-User-Id 读取，不放在 body）
    first_for_api = _file_url_to_base64_data_url(first_frame_image) if first_frame_image else ""
    last_for_api = _file_url_to_base64_data_url(last_frame_image) if last_frame_image else ""
    payload = {
        "prompt": prompt,
        "model": model,
        "aspect_ratio": aspect_ratio,
        "duration": duration,
        "first_frame_image": first_for_api,
        "last_frame_image": last_for_api or None,
        "project_id": project_id or "creez",
        "chat_id": chat_id or "",
    }
    api_result = _call_async_video_api(base_url, payload, user_id=user_id)
    if api_result.get("_error"):
        return {
            "success": False,
            "task_id": task_id,
            "shot_id": shot_id,
            "message": f"storyboard 已保存，但调用生视频接口失败: {api_result['_error']}",
        }

    return {
        "success": True,
        "task_id": api_result.get("task_id", task_id),
        "shot_id": shot_id,
        "message": f"已提交视频生成任务 task_id={task_id}，storyboard 已写入 isloading 占位并保存",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="为指定镜头发起视频生成任务并写回 isloading 占位。所有生视频参数需由调用方传入。"
    )
    parser.add_argument("storyboard", help="storyboard JSON 文件路径")
    parser.add_argument("--shot_id", type=int, required=True, help="镜头 shot_id")
    parser.add_argument("--prompt", required=True, help="视频 prompt")
    parser.add_argument("--model", required=True, help="视频模型")
    parser.add_argument("--aspect_ratio", required=True, help="宽高比，如 16:9")
    parser.add_argument("--duration", type=int, required=True, help="视频时长（秒）")
    parser.add_argument("--first_frame_image", required=True, help="首帧图 URL（支持 file://）")
    parser.add_argument("--last_frame_image", default="", help="尾帧图 URL（可选，支持 file://）")
    parser.add_argument("--user_id", default="", help="系统级参数")
    parser.add_argument("--project_id", default="", help="系统级参数")
    parser.add_argument("--chat_id", default="", help="系统级参数")
    parser.add_argument("--backend_base_url", default="", help="后端 base URL，也可用环境变量 BACKEND_BASE_URL")
    args = parser.parse_args()

    result = run(
        args.storyboard,
        shot_id=args.shot_id,
        prompt=args.prompt,
        model=args.model,
        aspect_ratio=args.aspect_ratio,
        duration=args.duration,
        first_frame_image=args.first_frame_image,
        last_frame_image=args.last_frame_image,
        user_id=args.user_id,
        project_id=args.project_id,
        chat_id=args.chat_id,
        backend_base_url=args.backend_base_url or os.environ.get("BACKEND_BASE_URL", ""),
    )
    print(json.dumps(result, ensure_ascii=False))
