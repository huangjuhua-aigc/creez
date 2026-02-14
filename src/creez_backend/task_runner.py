"""后台任务执行：图片/视频生成，结果写入 Supabase"""
import asyncio
import threading
from uuid import uuid4

from exceptions.self_defined import OutOfQuotaException
from log_util import get_logger
import token_usage_utils
from supabase_client import supabase_client

logger = get_logger(__name__)


def _extract_reference_urls(reference_image_list) -> list:
    """从 reference_image_list 提取 URL 列表，支持 {url} 和 {type:base64, data:...}"""
    if not reference_image_list:
        return []
    urls = []
    for item in reference_image_list:
        if isinstance(item, str):
            urls.append(item)
        elif isinstance(item, dict):
            if item.get("url"):
                urls.append(item["url"])
            elif item.get("type") == "base64" and item.get("data"):
                urls.append(item["data"])  # data URL 也支持
    return urls


def fire_and_forget_generate_image(task_id: str = None, **kwargs):
    from Tools.image_generator.image_generator import ImageGenerator
    from image_generation_helper import generate_and_save_image

    if not task_id:
        task_id = str(uuid4())

    def run():
        try:
            ids = token_usage_utils.prepare_ids_for_model_usage(**kwargs)
            ref_list = kwargs.get("reference_image_list") or []
            ref_urls = _extract_reference_urls(ref_list)

            supabase_client.insert("image_tasks", {"task_id": task_id, "status": "isloading"})
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                generator = ImageGenerator()
                urls = loop.run_until_complete(
                    generate_and_save_image(
                        image_generator=generator,
                        prompt=kwargs.get("prompt", ""),
                        model=kwargs.get("model", "doubao-seedream-4-0"),
                        aspect_ratio=kwargs.get("aspect_ratio", "16:9"),
                        reference_images=ref_urls if ref_urls else None,
                        source="creez",
                        **ids,
                    )
                )
                supabase_client.update(
                    "image_tasks", {"task_id": task_id}, {"status": "completed", "image_urls": urls}
                )
            except OutOfQuotaException as e:
                logger.error(f"Out of quota: {e}")
                supabase_client.update("image_tasks", {"task_id": task_id}, {"status": "failed", "message": str(e)})
            except Exception as e:
                logger.error(f"Image generation failed: {e}")
                supabase_client.update("image_tasks", {"task_id": task_id}, {"status": "failed", "image_urls": []})
            finally:
                loop.close()
        except Exception as e:
            logger.error(f"Task runner error: {e}")
            try:
                supabase_client.update("image_tasks", {"task_id": task_id}, {"status": "failed", "message": str(e)})
            except Exception:
                pass

    t = threading.Thread(target=run, daemon=False)
    t.start()
    return task_id


def fire_and_forget_generate_video(task_id: str = None, **kwargs):
    from Tools.video_generator.video_generator import VideoGenerator
    from video_generation_helper import generate_and_save_video

    if not task_id:
        task_id = str(uuid4())

    def run():
        try:
            ids = token_usage_utils.prepare_ids_for_model_usage(**kwargs)
            first_frame = kwargs.get("first_frame_image") or kwargs.get("first_frame") or ""
            last_frame = kwargs.get("last_frame_image") or kwargs.get("last_frame")

            supabase_client.insert("video_tasks", {"task_id": task_id, "status": "isloading"})
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                generator = VideoGenerator()
                urls = loop.run_until_complete(
                    generate_and_save_video(
                        video_generator=generator,
                        prompt=kwargs.get("prompt", ""),
                        model=kwargs.get("model", "doubao-seedance-pro"),
                        image=first_frame if first_frame else None,
                        image_tail=last_frame,
                        source="creez",
                        duration=kwargs.get("duration", 5),
                        aspect_ratio=kwargs.get("aspect_ratio", "16:9"),
                        generate_audio=kwargs.get("generate_audio", False),
                        **ids,
                    )
                )
                supabase_client.update(
                    "video_tasks", {"task_id": task_id}, {"status": "completed", "video_urls": urls}
                )
            except OutOfQuotaException as e:
                logger.error(f"Out of quota: {e}")
                supabase_client.update("video_tasks", {"task_id": task_id}, {"status": "failed", "message": str(e)})
            except Exception as e:
                logger.error(f"Video generation failed: {e}")
                supabase_client.update("video_tasks", {"task_id": task_id}, {"status": "failed", "video_urls": []})
            finally:
                loop.close()
        except Exception as e:
            logger.error(f"Task runner error: {e}")
            try:
                supabase_client.update("video_tasks", {"task_id": task_id}, {"status": "failed", "message": str(e)})
            except Exception:
                pass

    t = threading.Thread(target=run, daemon=False)
    t.start()
    return task_id
