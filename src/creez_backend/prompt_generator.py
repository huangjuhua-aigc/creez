"""生成分镜图片/视频参数的 LLM 调用（Creez 专用，不依赖 Supabase file_content）"""
import json
import os

from fastapi import HTTPException
from log_util import get_logger

from llm_client import async_doubao_client

logger = get_logger(__name__)

_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "prompt", "generate_scene_image_parameters.txt")
_PROMPT_TEMPLATE = ""
try:
    with open(_PROMPT_PATH, "r", encoding="utf-8") as f:
        _PROMPT_TEMPLATE = f.read()
except Exception as e:
    logger.warning(f"Failed to load prompt template: {e}")


async def generate_scene_image_parameters(
    *,
    project_id: str = "creez",
    user_id: str = "",
    chat_id: str = "",
    scene_type: str = "",
    movement: str = "",
    description: str = "",
    active_assets: list = None,
    user_query: str = "",
) -> dict:
    """生成分镜图片参数：返回 {prompt, aspect_ratio, model}"""
    active_assets = active_assets or []
    assets_info = []
    for idx, asset in enumerate(active_assets, 1):
        if isinstance(asset, dict):
            assets_info.append({
                "序号": idx,
                "名称": asset.get("name", asset.get("名称", "")),
                "描述": asset.get("description", asset.get("描述", "")),
            })
        elif isinstance(asset, str):
            assets_info.append({"序号": idx, "名称": asset, "描述": ""})

    user_content_parts = [
        f"场景类型：{scene_type}",
        f"镜头运动：{movement}",
        f"场景描述：{description}",
    ]
    if assets_info:
        lines = ["参考素材列表："]
        for a in assets_info:
            lines.append(f"素材{a['序号']}：{a['名称']}")
            if a.get("描述"):
                lines.append(f"  描述：{a['描述']}")
        user_content_parts.append("\n".join(lines))
    if (user_query or "").strip():
        user_content_parts.append(f"\n用户额外要求：{user_query.strip()}")

    user_content_parts.append("\n默认图片模型：doubao-seedream-4-0")
    user_content_parts.append("默认宽高比：16:9")
    user_content = "\n".join(user_content_parts)

    messages = [
        {"role": "system", "content": _PROMPT_TEMPLATE or "生成图片参数。"},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await async_doubao_client.chat.completions.create(
            model="doubao-seed-1-6-250615",
            messages=messages,
            max_tokens=32000,
            response_format={"type": "json_object"},
            extra_body={"thinking": {"type": "disabled"}},
        )
        content = response.choices[0].message.content
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        raise HTTPException(status_code=500, detail=f"生成提示词失败: {e}")

    json_str = content.strip().strip("```json").strip("```").strip()
    try:
        params = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse LLM response: {e}")
        raise HTTPException(status_code=500, detail="解析提示词失败")

    return {
        "prompt": params.get("prompt", ""),
        "model": params.get("model", "doubao-seedream-4-0"),
        "aspect_ratio": params.get("aspect_ratio", "16:9"),
    }
