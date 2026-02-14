"""用户 ID 校验"""
from fastapi import Header, HTTPException
from typing import Annotated

from config import USER_ID_HEADER
from log_util import get_logger

logger = get_logger(__name__)


async def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    """依赖：校验 X-User-Id header，缺失则 401"""
    user_id = x_user_id
    if not user_id or not str(user_id).strip():
        raise HTTPException(status_code=401, detail="X-User-Id header is required")
    return str(user_id).strip()
