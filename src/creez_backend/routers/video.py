"""视频生成接口"""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any

from log_util import get_logger
from middleware.auth import require_user_id
from task_runner import fire_and_forget_generate_video, _extract_reference_urls
from utils import poll_tasks_with_timeout_check

logger = get_logger(__name__)

router = APIRouter(prefix="/creez/videos", tags=["creez-video"])


class CreateVideoRequest(BaseModel):
    prompt: str
    frames: Optional[List[Any]] = None  # [{ type: "base64", data: "data:..." } | { url: "..." }]
    model: Optional[str] = "doubao-seedance-pro"
    duration: Optional[int] = 5
    aspect_ratio: Optional[str] = "16:9"
    generate_audio: Optional[bool] = False
    project_id: Optional[str] = "creez"
    chat_id: Optional[str] = ""


@router.post("/async_generations")
async def create_video_task(
    body: CreateVideoRequest,
    user_id: str = Depends(require_user_id),
):
    """创建异步视频生成任务。frames 格式同 image 的 reference_image_list：{ type: "base64", data } 或 { url }。frames[0]=首帧，frames[1]=尾帧。"""
    try:
        task_id = str(uuid4())
        raw_frames = body.frames or []
        extracted = _extract_reference_urls(raw_frames)
        first_frame_image = extracted[0] if len(extracted) > 0 else None
        last_frame_image = extracted[1] if len(extracted) > 1 else None
        fire_and_forget_generate_video(
            task_id=task_id,
            prompt=body.prompt,
            first_frame_image=first_frame_image,
            last_frame_image=last_frame_image,
            model=body.model or "doubao-seedance-pro",
            duration=body.duration or 5,
            aspect_ratio=body.aspect_ratio or "16:9",
            generate_audio=body.generate_audio or False,
            user_id=user_id,
            project_id=body.project_id or "creez",
            chat_id=body.chat_id or "",
        )
        return JSONResponse(content={"task_id": task_id}, status_code=200)
    except Exception as e:
        logger.error(f"create_video_task error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PollVideosRequest(BaseModel):
    task_ids: List[str]


@router.post("/pollvideos")
async def poll_videos(body: PollVideosRequest):
    """轮询视频任务状态"""
    try:
        task_ids = body.task_ids or []
        if not task_ids:
            return JSONResponse(content={"data": {}}, status_code=200)
        result = poll_tasks_with_timeout_check(
            task_ids=task_ids,
            table_name="video_tasks",
            url_field_name="video_urls",
            timeout_minutes=30,
        )
        return JSONResponse(content={"data": result}, status_code=200)
    except Exception as e:
        logger.error(f"poll_videos error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
