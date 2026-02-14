from typing import Optional

from log_util import get_logger

from Tools.image_generator.doubao_4_0_image_generator import Doubao_4_0_ImageGenerator

logger = get_logger(__name__)


class ImageGenerator:
    def __init__(self):
        self.doubao_4_0 = Doubao_4_0_ImageGenerator()
        self.MODEL_MAP = {
            "doubao-seedream-4-0": lambda prompt, aspect_ratio, reference_image_list=None, **kw: self.doubao_4_0.generate_image(
                prompt=prompt,
                model_name="doubao-seedream-4-0-250828",
                aspect_ratio=aspect_ratio,
                reference_image_list=reference_image_list,
            ),
            "doubao-seedream-4-5": lambda prompt, aspect_ratio, reference_image_list=None, **kw: self.doubao_4_0.generate_image(
                prompt=prompt,
                model_name="doubao-seedream-4-5-251128",
                aspect_ratio=aspect_ratio,
                reference_image_list=reference_image_list,
            ),
        }

    async def generate_image(
        self,
        prompt: str,
        model_name: str,
        aspect_ratio: str,
        reference_image_list: Optional[list] = None,
        **kwargs,
    ):
        if isinstance(reference_image_list, str):
            reference_image_list = [reference_image_list]
        if model_name not in self.MODEL_MAP:
            raise ValueError(f"Unsupported model: {model_name}")
        return await self.MODEL_MAP[model_name](
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            reference_image_list=reference_image_list,
            **kwargs,
        )
