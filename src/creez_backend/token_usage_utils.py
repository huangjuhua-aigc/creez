import asyncio
import json
from datetime import datetime

from log_util import get_logger
from supabase_client import supabase_client

logger = get_logger(__name__)

FREEUSERS = {
    "7c13eda6-9552-4d0a-b322-98d17705a8a7",
    "e30a1323-657e-44de-b3bc-2d5dc35e9375",
    "d0ecc6d7-7fde-4144-9545-dec15e2d0997",
}


def _prepare_model_usage_data(**kwargs):
    fields = [
        "user_id", "chat_id", "project_id", "type", "source", "model", "request",
        "response", "completion_tokens", "prompt_tokens", "total_tokens",
        "images_count", "video_count", "points",
    ]
    data = {}
    for f in fields:
        v = kwargs.get(f)
        if v is not None:
            if f in ("request", "response") and not isinstance(v, str):
                v = json.dumps(v, ensure_ascii=False)
            data[f] = v
    return data


def prepare_ids_for_model_usage(**kwargs):
    fields = ["user_id", "chat_id", "project_id"]
    data = {}
    for f in fields:
        v = kwargs.get(f)
        if v is not None:
            data[f] = v
    return data


async def save_model_usage_async(**kwargs):
    data = _prepare_model_usage_data(**kwargs)
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, supabase_client.insert, "token_usage", data)
        logger.info(f"Saved model usage: {list(data.keys())}")

        usage_type = data.get("type")
        user_id = data.get("user_id")
        points = data.get("points", 0)

        if user_id and points and points > 0 and usage_type in ["image", "video", "audio"]:
            success = await deduct_user_balance(user_id, points)
            if not success:
                logger.warning(f"Failed to deduct {points} points from user {user_id}")
    except Exception as e:
        logger.error(f"Failed to save model usage: {e}, data={list(data.keys())}")


async def save_image_usage_async(model_name: str, prompt: str, aspect_ratio: str, urls, **kwargs):
    from Tools.utils_price_calculator import image_price_calculator

    price = image_price_calculator(model=model_name, **kwargs)
    await save_model_usage_async(
        model=model_name,
        type="image",
        source=kwargs.get("source", "creez"),
        request={"prompt": prompt, "aspect_ratio": aspect_ratio},
        response=urls,
        images_count=len(urls),
        points=price,
        **kwargs,
    )


async def save_video_usage_async(model_name: str, prompt: str, urls, **kwargs):
    from Tools.utils_price_calculator import video_price_calculator

    price = video_price_calculator(model=model_name, **kwargs)
    await save_model_usage_async(
        model=model_name,
        type="video",
        source=kwargs.get("source", "creez"),
        request={"prompt": prompt},
        response=urls,
        video_count=len(urls),
        points=price,
        **kwargs,
    )


async def check_user_points(user_id: str) -> bool:
    if user_id in FREEUSERS:
        return True
    try:
        ub_rows = supabase_client.select(
            table="user_balance",
            filters={"user_id": user_id},
            columns=["balance", "granted_credits"],
        )
        if not ub_rows:
            logger.error(f"User {user_id} has no balance record")
            return False
        balance = int(ub_rows[0].get("balance", 0) or 0)
        granted_credits = int(ub_rows[0].get("granted_credits", 0) or 0)
        return (balance + granted_credits) >= 0
    except Exception as e:
        logger.error(f"Failed to check user points: {e}")
        return False


async def deduct_user_balance(user_id: str, points: int) -> bool:
    try:
        ub_rows = supabase_client.select(
            table="user_balance",
            filters={"user_id": user_id},
            columns=["id", "balance", "granted_credits"],
        )
        if not ub_rows:
            raise Exception(f"User {user_id} balance record not found")

        current_balance = int(ub_rows[0].get("balance", 0) or 0)
        current_granted_credits = int(ub_rows[0].get("granted_credits", 0) or 0)

        new_granted_credits = max(0, current_granted_credits - points)
        granted_credits_used = current_granted_credits - new_granted_credits
        remaining_points = points - granted_credits_used
        new_balance = current_balance - remaining_points

        supabase_client.update(
            table="user_balance",
            filters={"user_id": user_id},
            data={
                "balance": new_balance,
                "granted_credits": new_granted_credits,
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
        )
        return True
    except Exception as e:
        logger.error(f"Failed to deduct user balance: {e}")
        return False
