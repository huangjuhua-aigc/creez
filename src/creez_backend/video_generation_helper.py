import base64
from typing import List, Optional
from uuid import uuid4

from exceptions.self_defined import OutOfQuotaException
from log_util import get_logger
from Storage.volc_tos import volc_tos_client
from Tools.utils_price_calculator import video_price_calculator
import token_usage_utils

from config import VOLC_TOS_BUCKET

logger = get_logger(__name__)


async def generate_and_save_video(
    video_generator,
    prompt: str,
    model: str,
    image: Optional[str] = None,
    image_tail: Optional[str] = None,
    source: str = "creez",
    **kwargs,
) -> List[str]:
    user_id = kwargs.get("user_id")
    if user_id and not await token_usage_utils.check_user_points(user_id):
        raise OutOfQuotaException("积分已用完，请明日再试或充值后再试")

    gen_result = await video_generator.generate_video(
        image=image or "",
        prompt=prompt,
        model_name=model,
        image_tail=image_tail,
        **kwargs,
    )
    videos_items = (gen_result or {}).get("videos", []) or []
    usage_stats = (gen_result or {}).get("usage", {}) or {}

    uploaded_urls = []
    for item in videos_items:
        if not isinstance(item, dict):
            continue
        vid_type = item.get("type")
        data = item.get("data")
        if not data:
            continue
        mime = item.get("mime", "video/mp4")
        ext = ".webm" if "webm" in mime else ".mp4" if "mp4" in mime else ".mov" if "mov" in mime else ".mp4"
        object_name = f"{uuid4()}{ext}"
        if vid_type == "base64":
            try:
                vid_bytes = base64.b64decode(data)
                url = volc_tos_client.upload_object(VOLC_TOS_BUCKET, object_name, vid_bytes)
                uploaded_urls.append(url)
            except Exception as e:
                logger.error(f"Upload base64 video failed: {e}")
                continue
        elif vid_type == "url":
            try:
                url = volc_tos_client.upload_url_content(VOLC_TOS_BUCKET, object_name, data)
                uploaded_urls.append(url)
            except Exception as e:
                logger.error(f"Upload url video failed: {e}")
                continue

    if not uploaded_urls:
        raise Exception("No videos were generated or uploaded")

    price = video_price_calculator(model=model, usage=usage_stats or {}, **kwargs)
    await token_usage_utils.save_model_usage_async(
        type="video",
        source=source,
        model=model,
        request={"prompt": prompt},
        response=uploaded_urls,
        video_count=len(uploaded_urls),
        points=price,
        **kwargs,
    )
    return uploaded_urls
