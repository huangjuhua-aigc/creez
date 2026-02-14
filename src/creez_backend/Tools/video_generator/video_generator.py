from typing import Optional

from log_util import get_logger

from Tools.video_generator.doubao_seedance import DoubaoSeedanceVideoGenerator

logger = get_logger(__name__)


class VideoGenerator:
    def __init__(self):
        self.doubao = DoubaoSeedanceVideoGenerator()
        self.MODEL_MAP = {
            "doubao-seedance-pro": self.doubao.generate_video,
            "doubao-seedance-lite": self.doubao.generate_video,
        }

    async def generate_video(
        self,
        image: str,
        prompt: str,
        model_name: str = "doubao-seedance-pro",
        image_tail: Optional[str] = None,
        **kwargs,
    ):
        if model_name not in self.MODEL_MAP:
            raise ValueError(f"Unsupported model: {model_name}")
        return await self.MODEL_MAP[model_name](
            image=image,
            prompt=prompt,
            model_name=model_name,
            image_tail=image_tail,
            **kwargs,
        )
