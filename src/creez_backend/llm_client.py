from openai import AsyncOpenAI

from config import DOUBAO_API_KEY, DOUBAO_BASE_URL

async_doubao_client = AsyncOpenAI(
    api_key=DOUBAO_API_KEY,
    base_url=DOUBAO_BASE_URL,
)
