from typing import Any, Dict, List, Optional

from supabase import Client, create_client

from config import SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
from log_util import get_logger

logger = get_logger(__name__)

# 未配置时直接报错，便于发现原因（检查 .env 中 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY）
def _require_supabase_config():
    url = (SUPABASE_URL or "").strip()
    key = (SUPABASE_ANON_KEY or "").strip()
    role_key = (SUPABASE_SERVICE_ROLE_KEY or "").strip()
    if not url or not key:
        raise RuntimeError(
            "Supabase 未配置，无法连接。请在 Creez_backend 目录下创建 .env 文件并设置：\n"
            "  NEXT_PUBLIC_SUPABASE_URL=你的 Supabase 项目 URL\n"
            "  NEXT_PUBLIC_SUPABASE_ANON_KEY=你的 anon key\n"
            "  SUPABASE_SERVICE_ROLE_KEY=你的 service_role key（可选，用于服务端鉴权）\n"
            "若暂无 Supabase 项目，请先在 https://supabase.com 创建项目后复制上述值。"
        )
    return url, key, role_key or key


class SupabaseClient:
    def __init__(self, url: str, key: str, role_key: str):
        self.client: Client = create_client(url, key)
        self.auth_client: Client = create_client(url, role_key or key)

    def insert(
        self, table: str, data: Dict[str, Any] | List[Dict[str, Any]]
    ) -> Any:
        response = self.client.table(table).insert(data).execute()
        return response.data

    def select(
        self,
        table: str,
        filters: Optional[Dict[str, Any]] = None,
        columns: Optional[List[str]] = None,
        order_by: Optional[str] = None,
        order_desc: bool = False,
    ) -> Any:
        if columns:
            query = self.client.table(table).select(",".join(columns))
        else:
            query = self.client.table(table).select("*")
        if filters:
            for k, v in filters.items():
                if "__" in k:
                    field, op = k.split("__", 1)
                    if hasattr(query, op):
                        query = getattr(query, op)(field, v)
                    else:
                        raise ValueError(f"Unsupported filter operation: {op}")
                else:
                    query = query.eq(k, v)
        if order_by:
            query = query.order(order_by, desc=order_desc)
        response = query.execute()
        return response.data

    def update(
        self, table: str, filters: Dict[str, Any], data: Dict[str, Any]
    ) -> Any:
        query = self.client.table(table).update(data)
        for k, v in filters.items():
            query = query.eq(k, v)
        response = query.execute()
        return response.data

    def batch_update_in(
        self,
        table: str,
        field: str,
        values: List[Any],
        data: Dict[str, Any],
        extra_filters: Optional[Dict[str, Any]] = None,
    ) -> Any:
        query = self.client.table(table).update(data)
        if extra_filters:
            for k, v in extra_filters.items():
                query = query.eq(k, v)
        query = query.in_(field, values)
        response = query.execute()
        return response.data


_url, _key, _role_key = _require_supabase_config()
supabase_client = SupabaseClient(_url, _key, _role_key)
