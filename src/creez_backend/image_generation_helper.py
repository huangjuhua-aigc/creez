import base64
from typing import List, Optional
from uuid import uuid4

from exceptions.self_defined import OutOfQuotaException
from log_util import get_logger
from Storage.volc_tos import volc_tos_client
from Tools.utils_price_calculator import image_price_calculator
import token_usage_utils

from config import VOLC_TOS_BUCKET

logger = get_logger(__name__)


async def generate_and_save_image(
    image_generator,
    prompt: str,
    model: str,
    aspect_ratio: str = "9:16",
    reference_images: Optional[List] = None,
    source: str = "creez",
    **kwargs,
) -> List[str]:
    user_id = kwargs.get("user_id")
    if user_id and not await token_usage_utils.check_user_points(user_id):
        raise OutOfQuotaException("积分已用完，请明日再试或充值后再试")

    gen_result = await image_generator.generate_image(
        prompt=prompt,
        model_name=model,
        aspect_ratio=aspect_ratio,
        reference_image_list=reference_images,
    )
    images_items = (gen_result or {}).get("images", []) or []
    usage_stats = (gen_result or {}).get("usage", {}) or {}

    uploaded_urls = []
    for item in images_items:
        if not isinstance(item, dict):
            continue
        img_type = item.get("type")
        data = item.get("data")
        if not data:
            continue
        object_name = f"{uuid4()}.png"
        if img_type == "base64":
            mime = item.get("mime") or item.get("mine") or "image/png"
            ext = ".jpg" if "jpeg" in mime or "jpg" in mime else ".png" if "png" in mime else ".webp" if "webp" in mime else ".bin"
            object_name = f"{uuid4()}{ext}"
            try:
                img_bytes = base64.b64decode(data)
                url = volc_tos_client.upload_object(VOLC_TOS_BUCKET, object_name, img_bytes)
                uploaded_urls.append(url)
            except Exception as e:
                logger.error(f"Upload base64 image failed: {e}")
                continue
        elif img_type == "url":
            try:
                url = volc_tos_client.upload_url_content(VOLC_TOS_BUCKET, object_name, data)
                uploaded_urls.append(url)
            except Exception as e:
                logger.error(f"Upload url image failed: {e}")
                continue

    if not uploaded_urls:
        raise Exception("No images were generated or uploaded")

    price_args = {k: v for k, v in kwargs.items() if k != "reference_image_list"}
    price = image_price_calculator(model=model, reference_image_list=reference_images, **price_args)
    await token_usage_utils.save_model_usage_async(
        type="image",
        source=source,
        model=model,
        request={"prompt": prompt, "aspect_ratio": aspect_ratio},
        response=uploaded_urls,
        images_count=len(uploaded_urls),
        points=price,
        **kwargs,
    )
    return uploaded_urls
