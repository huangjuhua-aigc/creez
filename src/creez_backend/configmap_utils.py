"""与 mcp_host_backend 一致：从 K8s configmap 读取配置，本地开发时回退默认值"""
import os

CONFIGMAP_PATH = "/root/config/"
SECRET_PATH = "/root/certs/"


def get_configmap_value(key: str, defaultvalue=None):
    config = CONFIGMAP_PATH + key
    if not os.path.exists(config):
        return defaultvalue
    with open(config) as f:
        return (f.read() or "").strip()


def get_cert_value(key: str, defaultvalue=None):
    config = SECRET_PATH + key
    if not os.path.exists(config):
        return defaultvalue
    with open(config) as f:
        return (f.read() or "").strip()
