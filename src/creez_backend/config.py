import os
from pathlib import Path

from dotenv import load_dotenv

from configmap_utils import get_configmap_value

# 从本文件所在目录（Creez_backend）加载 .env，避免 debug/不同 cwd 下找不到
_env_dir = Path(__file__).resolve().parent
# 与 mcp_host_backend 一致：先读 ConfigRole（K8s configmap 或默认 localhost），再加载对应 env
config_role = get_configmap_value("ConfigRole", "localhost")
if config_role == "Int":
    load_dotenv(_env_dir / ".int.env", override=True)
elif config_role == "Prod":
    load_dotenv(_env_dir / ".prod.env", override=True)
else:
    load_dotenv(_env_dir / ".env", override=True)

# Supabase
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Volc TOS
VOLC_STORAGE_AK = os.getenv("VOLC_STORAGE_AK", "")
VOLC_STORAGE_SK = os.getenv("VOLC_STORAGE_SK", "")
VOLC_TOS_BUCKET = os.getenv("VOLC_TOS_BUCKET", "lighton-generated-content")
VOLC_TOS_ENDPOINT = os.getenv("VOLC_TOS_ENDPOINT", "tos-cn-shanghai.volces.com")
VOLC_TOS_REGION = os.getenv("VOLC_TOS_REGION", "cn-shanghai")

# Doubao / Volc (image, video, LLM - same platform)
VOLC_API_KEY = os.getenv("VOLC_API_KEY", "") or os.getenv("DOUBAO_API_KEY", "")
DOUBAO_API_KEY = os.getenv("DOUBAO_API_KEY", "") or os.getenv("VOLC_API_KEY", "")
DOUBAO_BASE_URL = os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

# Auth: header name for user_id (client must send)
USER_ID_HEADER = "X-User-Id"
