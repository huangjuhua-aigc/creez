#!/usr/bin/env python3
"""
小红书笔记发布脚本 - 增强版
支持直接发布（本地签名）和通过 API 服务发布两种方式

使用方法:
    # 直接发布（使用本地签名）
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png

    # 通过 API 服务发布
    python publish_xhs.py --title "标题" --desc "描述" --images cover.png card_1.png --api-mode

环境变量:
    在技能根目录或脚本上级目录创建 .env 文件，配置：
    XHS_COOKIE=your_cookie_string_here
    XHS_API_URL=http://localhost:5005  # 可选，--api-mode 时使用

依赖安装:
    pip install xhs python-dotenv requests
"""

import argparse
import os
import sys
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any

try:
    from dotenv import load_dotenv
    import requests
except ImportError as e:
    print(f"缺少依赖: {e}")
    print("请运行: pip install python-dotenv requests")
    sys.exit(1)


def load_cookie() -> str:
    """从 .env 加载 Cookie。优先使用 Creez 统一配置：~/.creez/.env（与设置里保存位置一致）"""
    home = Path.home()
    creez_env = home / '.creez' / '.env'
    env_paths = [
        creez_env,
        Path.cwd() / '.env',
        Path(__file__).parent.parent / '.env',
        Path(__file__).parent.parent.parent / '.env',
    ]
    for env_path in env_paths:
        if env_path.exists():
            load_dotenv(env_path)
            break
    cookie = os.getenv('XHS_COOKIE')
    if not cookie:
        print("❌ 错误: 未找到 XHS_COOKIE 环境变量")
        print("请创建 .env 文件，添加：XHS_COOKIE=your_cookie_string_here")
        print("Cookie 获取：浏览器登录小红书 → F12 → Network → 请求头 Cookie")
        sys.exit(1)
    return cookie


def parse_cookie(cookie_string: str) -> Dict[str, str]:
    cookies = {}
    for item in cookie_string.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


def validate_cookie(cookie_string: str) -> bool:
    cookies = parse_cookie(cookie_string)
    required_fields = ['a1', 'web_session']
    missing = [f for f in required_fields if f not in cookies]
    if missing:
        print(f"⚠️ Cookie 可能不完整，缺少: {', '.join(missing)}")
        return False
    return True


def get_api_url() -> str:
    return os.getenv('XHS_API_URL', 'http://localhost:5005')


def validate_images(image_paths: List[str]) -> List[str]:
    valid_images = []
    for path in image_paths:
        if os.path.exists(path):
            valid_images.append(os.path.abspath(path))
        else:
            print(f"⚠️ 警告: 图片不存在 - {path}")
    if not valid_images:
        print("❌ 错误: 没有有效的图片文件")
        sys.exit(1)
    return valid_images


class LocalPublisher:
    """本地发布模式：直接使用 xhs 库"""
    def __init__(self, cookie: str):
        self.cookie = cookie
        self.client = None

    def init_client(self):
        try:
            from xhs import XhsClient
            from xhs.help import sign as local_sign
        except ImportError:
            print("❌ 错误: 缺少 xhs 库，请运行: pip install xhs")
            sys.exit(1)
        cookies = parse_cookie(self.cookie)
        a1 = cookies.get('a1', '')
        def sign_func(uri, data=None, a1_param="", web_session="", **kwargs):
            return local_sign(uri, data, a1=a1 or a1_param)
        self.client = XhsClient(cookie=self.cookie, sign=sign_func)

    def get_user_info(self) -> Optional[Dict[str, Any]]:
        try:
            info = self.client.get_self_info()
            print(f"👤 当前用户: {info.get('nickname', '未知')}")
            return info
        except Exception as e:
            print(f"⚠️ 无法获取用户信息: {e}")
            return None

    def publish(self, title: str, desc: str, images: List[str],
                is_private: bool = False, post_time: str = None) -> Dict[str, Any]:
        print(f"\n🚀 准备发布笔记（本地模式）...")
        print(f"  📌 标题: {title}")
        print(f"  📝 描述: {desc[:50]}..." if len(desc) > 50 else f"  📝 描述: {desc}")
        print(f"  🖼️ 图片数量: {len(images)}")
        try:
            result = self.client.create_image_note(
                title=title, desc=desc, files=images,
                is_private=is_private, post_time=post_time
            )
            print("\n✨ 笔记发布成功！")
            if isinstance(result, dict):
                note_id = result.get('note_id') or result.get('id')
                if note_id:
                    print(f"  📎 笔记ID: {note_id}")
                    print(f"  🔗 链接: https://www.xiaohongshu.com/explore/{note_id}")
            return result
        except Exception as e:
            print(f"\n❌ 发布失败: {str(e)}")
            if 'sign' in str(e).lower():
                print("💡 建议：检查 Cookie 含 a1/web_session，或使用 --api-mode")
            raise


class ApiPublisher:
    """API 发布模式：通过 xhs-api 服务发布"""
    def __init__(self, cookie: str, api_url: str = None):
        self.cookie = cookie
        self.api_url = api_url or get_api_url()
        self.session_id = 'xiaohongshu_session'

    def init_client(self):
        print(f"📡 连接 API 服务: {self.api_url}")
        try:
            resp = requests.get(f"{self.api_url}/health", timeout=5)
            if resp.status_code != 200:
                raise Exception("API 服务不可用")
        except requests.exceptions.RequestException as e:
            print(f"❌ 无法连接 API: {e}")
            sys.exit(1)
        try:
            resp = requests.post(f"{self.api_url}/init",
                json={"session_id": self.session_id, "cookie": self.cookie}, timeout=30)
            result = resp.json()
            if resp.status_code == 200 and result.get('status') == 'success':
                print("✅ API 初始化成功")
            else:
                raise Exception(result.get('error', '初始化失败'))
        except Exception as e:
            print(f"❌ API 初始化失败: {e}")
            sys.exit(1)

    def get_user_info(self) -> Optional[Dict[str, Any]]:
        return None

    def publish(self, title: str, desc: str, images: List[str],
                is_private: bool = False, post_time: str = None) -> Dict[str, Any]:
        print(f"\n🚀 准备发布笔记（API 模式）...")
        payload = {"session_id": self.session_id, "title": title, "desc": desc,
                  "files": images, "is_private": is_private}
        if post_time:
            payload["post_time"] = post_time
        resp = requests.post(f"{self.api_url}/publish/image", json=payload, timeout=120)
        result = resp.json()
        if resp.status_code == 200 and result.get('status') == 'success':
            print("\n✨ 笔记发布成功！")
            return result.get('result', {})
        raise Exception(result.get('error', '发布失败'))


def main():
    parser = argparse.ArgumentParser(description='将图片发布为小红书笔记')
    parser.add_argument('--title', '-t', required=True, help='笔记标题（不超过20字）')
    parser.add_argument('--desc', '-d', default='', help='笔记描述/正文内容')
    parser.add_argument('--images', '-i', nargs='+', required=True, help='图片文件路径')
    parser.add_argument('--private', action='store_true', help='设为私密笔记')
    parser.add_argument('--post-time', default=None, help='定时发布 2024-01-01 12:00:00')
    parser.add_argument('--api-mode', action='store_true', help='使用 API 服务发布')
    parser.add_argument('--api-url', default=None, help='API 地址')
    parser.add_argument('--dry-run', action='store_true', help='仅验证不发布')
    args = parser.parse_args()
    if len(args.title) > 20:
        args.title = args.title[:20]
    cookie = load_cookie()
    validate_cookie(cookie)
    valid_images = validate_images(args.images)
    if args.dry_run:
        print("🔍 验证通过，未发布")
        return
    publisher = ApiPublisher(cookie, args.api_url) if args.api_mode else LocalPublisher(cookie)
    publisher.init_client()
    try:
        publisher.publish(args.title, args.desc, valid_images, args.private, args.post_time)
    except Exception:
        sys.exit(1)


if __name__ == '__main__':
    main()
