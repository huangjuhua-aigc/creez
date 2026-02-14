"""图片生成、生成 prompt 接口"""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any

from log_util import get_logger
from middleware.auth import require_user_id
from prompt_generator import generate_scene_image_parameters
from task_runner import fire_and_forget_generate_image
from utils import poll_tasks_with_timeout_check

logger = get_logger(__name__)

router = APIRouter(prefix="/creez/images", tags=["creez-image"])


class GeneratePromptRequest(BaseModel):
    project_id: Optional[str] = "creez"
    chat_id: Optional[str] = ""
    type: Optional[str] = ""
    movement: Optional[str] = ""
    description: Optional[str] = ""
    active_assets: Optional[List[Any]] = []
    user_query: Optional[str] = ""


class GeneratePromptResponse(BaseModel):
    prompt: str
    model: str
    aspect_ratio: str


@router.post("/generate_prompt", response_model=GeneratePromptResponse)
async def generate_prompt(
    body: GeneratePromptRequest,
    user_id: str = Depends(require_user_id),
):
    """AI 生成分镜图片 prompt"""
    try:
        params = await generate_scene_image_parameters(
            project_id=body.project_id or "creez",
            user_id=user_id,
            chat_id=body.chat_id or "",
            scene_type=body.type or "",
            movement=body.movement or "",
            description=body.description or "",
            active_assets=body.active_assets or [],
            user_query=body.user_query or "",
        )
        if not params.get("prompt"):
            raise HTTPException(status_code=500, detail="生成图片提示词失败")
        return JSONResponse(content=params, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"generate_prompt error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = "doubao-seedream-4-0"
    aspect_ratio: Optional[str] = "16:9"
    reference_image_list: Optional[List[Any]] = []
    project_id: Optional[str] = "creez"
    chat_id: Optional[str] = ""


@router.post("/async_generations")
async def create_image_task(
    body: CreateImageRequest,
    user_id: str = Depends(require_user_id),
):
    """创建异步图片生成任务"""
    try:
        task_id = str(uuid4())
        fire_and_forget_generate_image(
            task_id=task_id,
            prompt=body.prompt,
            model=body.model or "doubao-seedream-4-0",
            aspect_ratio=body.aspect_ratio or "16:9",
            reference_image_list=body.reference_image_list or [],
            user_id=user_id,
            project_id=body.project_id or "creez",
            chat_id=body.chat_id or "",
        )
        return JSONResponse(content={"task_id": task_id}, status_code=200)
    except Exception as e:
        logger.error(f"create_image_task error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class PollImagesRequest(BaseModel):
    task_ids: List[str]


@router.post("/pollimages")
async def poll_images(body: PollImagesRequest):
    """轮询图片任务状态"""
    try:
        task_ids = body.task_ids or []
        if not task_ids:
            return JSONResponse(content={"data": {}}, status_code=200)
        result = poll_tasks_with_timeout_check(
            task_ids=task_ids,
            table_name="image_tasks",
            url_field_name="image_urls",
            timeout_minutes=10,
        )
        return JSONResponse(content={"data": result}, status_code=200)
    except Exception as e:
        logger.error(f"poll_images error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
