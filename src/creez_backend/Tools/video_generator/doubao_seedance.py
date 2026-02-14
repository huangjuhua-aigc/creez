import json
import time
from typing import Optional

import httpx
import asyncio
from log_util import get_logger

from config import VOLC_API_KEY

logger = get_logger(__name__)


class DoubaoSeedanceVideoGenerator:
    def __init__(self):
        self.API_KEY = VOLC_API_KEY
        self.seedance_url = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
        self.MODEL_NAME = "doubao-seedance-1-5-pro-251215"
        if not self.API_KEY:
            raise ValueError("VOLC_API_KEY is required")

    async def generate_video(
        self,
        image: str,
        prompt: str,
        model_name: str = "doubao-seedance-pro",
        image_tail: Optional[str] = None,
        **kwargs,
    ) -> dict:
        duration = kwargs.get("duration", "5")
        aspect_ratio = kwargs.get("aspect_ratio", "adaptive")
        generate_audio = kwargs.get("generate_audio", False)

        payload = {
            "model": self.MODEL_NAME,
            "generateAudio": generate_audio,
            "content": [
                {
                    "type": "text",
                    "text": f"{prompt} --resolution 720p --duration {duration} --ratio {aspect_ratio} --watermark false --camerafixed false",
                },
                {"type": "image_url", "image_url": {"url": image}},
            ],
        }
        if image_tail:
            payload["content"].append({
                "type": "image_url",
                "image_url": {"url": image_tail},
                "role": "last_frame",
            })

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.API_KEY}",
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(self.seedance_url, headers=headers, json=payload)
            resp.raise_for_status()
            result = resp.json()

        task_id = result.get("id")
        if not task_id:
            raise Exception("No task ID in response")

        start_time = time.time()
        while time.time() - start_time < 3600:
            query_url = f"{self.seedance_url}/{task_id}"
            async with httpx.AsyncClient(timeout=30) as client:
                q = await client.get(query_url, headers=headers)
                q.raise_for_status()
                r = q.json()

            status = r.get("status")
            if status == "succeeded":
                video_url = (r.get("content") or {}).get("video_url")
                usage = r.get("usage") or {}
                formatted = []
                if video_url:
                    formatted.append({"type": "url", "data": video_url, "mime": "video/mp4"})
                return {
                    "videos": formatted,
                    "usage": {
                        "inputToken": usage.get("prompt_tokens"),
                        "outputToken": usage.get("completion_tokens"),
                        "totalToken": usage.get("total_tokens"),
                    },
                }
            if status == "failed":
                raise Exception(r.get("error_message", "Video generation failed"))
            await asyncio.sleep(20)

        raise Exception("Video generation timeout")
