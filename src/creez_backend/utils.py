import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from log_util import get_logger
from supabase_client import supabase_client

logger = get_logger(__name__)


def poll_tasks_with_timeout_check(
    task_ids: List[str],
    table_name: str,
    url_field_name: str,
    timeout_minutes: int = 60,
) -> Dict[str, Any]:
    """通用任务轮询，检查超时并返回结果"""
    if not task_ids:
        return {}

    result = (
        supabase_client.client.table(table_name)
        .select("*")
        .in_("task_id", task_ids)
        .execute()
    )
    data = result.data

    current_time = datetime.now(timezone.utc)
    overtime_task_ids = []
    result_data = {}

    for item in data:
        task_id = item.get("task_id", "")
        status = item.get("status", "")
        urls = item.get(url_field_name, [""])
        message = item.get("message", "")
        created_at_str = item.get("created_at", "")

        if created_at_str:
            try:
                created_at = datetime.fromisoformat(
                    created_at_str.replace("+00", "+00:00")
                )
                time_diff = current_time - created_at
                if (
                    time_diff > timedelta(minutes=timeout_minutes)
                    and status in ["processing", "isloading"]
                ):
                    overtime_task_ids.append(task_id)
                    status = "overtime"
                    message = "内容生成超时"
            except Exception as e:
                logger.error(f"Error parsing created_at for task {task_id}: {e}")

        result_data[task_id] = {
            "task_id": task_id,
            "status": status,
            url_field_name: urls,
            "message": message,
        }

    if overtime_task_ids:
        try:
            supabase_client.batch_update_in(
                table=table_name,
                field="task_id",
                values=overtime_task_ids,
                data={"status": "overtime", "message": "内容生成超时"},
            )
            logger.info(
                f"Batch updated {len(overtime_task_ids)} overtime {table_name} tasks"
            )
        except Exception as e:
            logger.error(f"Error batch updating overtime {table_name} tasks: {e}")

    return result_data


def get_file_content(project_id: str) -> tuple:
    """从 Supabase 读取 file_content（Creez 场景下 project_id 可能无数据，返回空）"""
    if not project_id:
        return {}, {}

    try:
        file_content_result = supabase_client.select(
            table="file_content",
            filters={"project_id": project_id, "is_deleted__neq": True},
            columns=["file_id", "content", "content_type", "file_name"],
        )
        if file_content_result:
            project_config = {}
            other_files = {}
            for item in file_content_result:
                file_obj = {
                    "content": item.get("content", ""),
                    "content_type": item.get("content_type", ""),
                    "file_name": item.get("file_name", ""),
                }
                file_id = item.get("file_id")
                if item.get("content_type") == "project_config":
                    project_config[file_id] = file_obj
                else:
                    other_files[file_id] = file_obj
            return project_config, other_files
        return {}, {}
    except Exception as e:
        logger.error(f"Failed to load file_content for project {project_id}: {e}")
        return {}, {}


def parse_project_config(project_config: dict) -> dict:
    """解析 project_config 的 content 为 dict"""
    if not project_config:
        return {}
    try:
        for file_id, file_obj in project_config.items():
            content_str = file_obj.get("content", "")
            if content_str:
                return json.loads(content_str) if isinstance(content_str, str) else content_str
        return {}
    except Exception as e:
        logger.error(f"Failed to parse project config: {e}")
        return {}
