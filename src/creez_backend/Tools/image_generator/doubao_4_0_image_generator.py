import json
from typing import Optional

import httpx
from log_util import get_logger

from config import VOLC_API_KEY

logger = get_logger(__name__)


class Doubao_4_0_ImageGenerator:
    def __init__(self):
        self.API_KEY = VOLC_API_KEY
        self.API_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
        if not self.API_KEY:
            logger.error("VOLC_API_KEY not found")
            raise ValueError("VOLC_API_KEY is required")

    def get_width_height(self, aspect_ratio: str) -> tuple:
        ratio_2_width_height = {
            "1:1": (2048, 2048),
            "3:4": (1728, 2304),
            "4:3": (2304, 1728),
            "16:9": (2560, 1440),
            "9:16": (1440, 2560),
            "2:3": (1664, 2496),
            "3:2": (2496, 1664),
            "21:9": (3024, 1296),
        }
        return ratio_2_width_height.get(aspect_ratio, (2048, 2048))

    async def generate_image(
        self,
        prompt: str,
        model_name: str,
        aspect_ratio: str,
        reference_image_list: Optional[list] = None,
    ) -> dict:
        width, height = self.get_width_height(aspect_ratio)
        size = f"{width}x{height}"
        payload = {
            "model": model_name,
            "prompt": prompt,
            "sequential_image_generation": "auto",
            "response_format": "url",
            "size": size,
            "watermark": False,
        }
        if reference_image_list:
            payload["image"] = reference_image_list

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.API_KEY}",
        }

        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                self.API_URL, headers=headers, json=payload
            )
            response.raise_for_status()
            raw = response.json()

        result = {
            "images": [],
            "usage": {
                "inputToken": None,
                "outputToken": None,
                "totalToken": None,
            },
        }
        data_items = (raw or {}).get("data")
        if isinstance(data_items, dict) and data_items.get("url"):
            result["images"].append({"type": "url", "data": data_items["url"]})
        elif isinstance(data_items, list):
            for item in data_items:
                url = (item or {}).get("url")
                if url:
                    result["images"].append({"type": "url", "data": url})
        usage = (raw or {}).get("usage") or {}
        result["usage"]["inputToken"] = usage.get("input_tokens") or usage.get("inputTokens")
        result["usage"]["outputToken"] = usage.get("output_tokens") or usage.get("outputTokens")
        result["usage"]["totalToken"] = usage.get("total_tokens") or usage.get("totalTokens")
        return result
