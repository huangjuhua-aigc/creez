import requests

from config import (
    VOLC_STORAGE_AK,
    VOLC_STORAGE_SK,
    VOLC_TOS_BUCKET,
    VOLC_TOS_ENDPOINT,
    VOLC_TOS_REGION,
)
import tos


class VolcTosClient:
    def __init__(self, ak: str, sk: str, endpoint: str, region: str):
        self.endpoint = endpoint
        self.region = region
        self.client = tos.TosClientV2(ak, sk, endpoint, region)

    def upload_object(self, bucket_name: str, object_name: str, object_content) -> str:
        result = self.client.put_object(bucket_name, object_name, content=object_content)
        if result.status_code != 200:
            raise Exception(f"Upload failed: {result.status_code}")
        return f"https://{bucket_name}.{self.endpoint}/{object_name}"

    def upload_url_content(self, bucket_name: str, object_name: str, url: str) -> str:
        response = requests.get(url)
        if not response.ok:
            raise Exception(f"Failed to fetch url: {url}")
        result = self.client.put_object(bucket_name, object_name, content=response.content)
        if result.status_code != 200:
            raise Exception(f"Upload failed: {result.status_code}")
        return f"https://{bucket_name}.{self.endpoint}/{object_name}"


volc_tos_client = VolcTosClient(
    VOLC_STORAGE_AK,
    VOLC_STORAGE_SK,
    VOLC_TOS_ENDPOINT,
    VOLC_TOS_REGION,
)
