"""
Utility functions for storyboard editing operations.
"""

import json
import uuid
from typing import Dict, List, Any, Optional


def load_storyboard(filepath: str) -> Dict[str, Any]:
    """Load storyboard JSON file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_storyboard(storyboard: Dict[str, Any], filepath: str) -> None:
    """Save storyboard to JSON file with proper formatting."""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(storyboard, f, ensure_ascii=False, indent=4)


def update_scene_indices(scene_board: List[Dict]) -> None:
    """Update scene_index for all shots sequentially."""
    for idx, shot in enumerate(scene_board):
        shot['scene_index'] = idx


def get_next_shot_id(scene_board: List[Dict]) -> int:
    """Get the next available shot_id."""
    if not scene_board:
        return 1
    return max(shot.get('shot_id', 0) for shot in scene_board) + 1


def generate_file_id() -> str:
    """Generate a new UUID (legacy). Prefer generate_asset_id() for new assets."""
    return str(uuid.uuid4())


def generate_asset_id() -> str:
    """Generate a unique asset id, e.g. asset_<timestamp>_<short_uuid>."""
    t = int(__import__("time").time() * 1000)
    short = uuid.uuid4().hex[:8]
    return f"asset_{t}_{short}"


def find_shot_by_id(scene_board: List[Dict], shot_id: int) -> Optional[Dict]:
    """Find a shot by its shot_id."""
    for shot in scene_board:
        if shot.get('shot_id') == shot_id:
            return shot
    return None


def find_shot_by_index(scene_board: List[Dict], scene_index: int) -> Optional[Dict]:
    """Find a shot by its scene_index."""
    for shot in scene_board:
        if shot.get('scene_index') == scene_index:
            return shot
    return None


def find_asset_by_id(art_materials: Dict, asset_id: str) -> Optional[Dict]:
    """Find an asset by its id (or legacy file_id)."""
    for asset in art_materials.get('asset', []):
        if asset.get('id') == asset_id or asset.get('file_id') == asset_id:
            return asset
    return None


def get_assets_by_ids(art_materials: Dict, asset_ids: List[str]) -> List[Dict]:
    """Get multiple assets by their ids (or legacy file_ids)."""
    assets = []
    for aid in asset_ids:
        asset = find_asset_by_id(art_materials, aid)
        if asset:
            assets.append(asset)
    return assets


def create_shot_template(shot_id: int, scene_index: int) -> Dict[str, Any]:
    """Create an empty shot template. picture.frames is a 2D array (no first_frame)."""
    return {
        "shot_id": shot_id,
        "type": "",
        "movement": "",
        "description": "",
        "visual": "",
        "action": "",
        "dialogue": "",
        "sound": "",
        "active_assets": [],
        "picture": {
            "frames": []
        },
        "videos": [],
        "scene_index": scene_index
    }


def create_asset_template(name: str, desc: str, visual_state: str, asset_type: str = "") -> Dict[str, Any]:
    """Create an empty asset template. Uses id and image_urls (file://)."""
    return {
        "id": generate_asset_id(),
        "name": name,
        "desc": desc,
        "image_urls": [],
        "visual_state": visual_state,
        "asset_type": asset_type or ""
    }


def remove_asset_references(scene_board: List[Dict], asset_id: str) -> int:
    """Remove all references to an asset from all shots. Returns count of removals."""
    count = 0
    for shot in scene_board:
        active_assets = shot.get('active_assets', [])
        if asset_id in active_assets:
            active_assets.remove(asset_id)
            count += 1

        # Remove from picture.frames reference_image_list (by url; ref list items may only have "url")
        picture = shot.get('picture', {})
        for group in picture.get('frames', []):
            if not isinstance(group, list):
                continue
            for candidate in group:
                if isinstance(candidate, dict):
                    params = candidate.get('parameters', {})
                    ref_images = params.get('reference_image_list', [])
                    # Filter out refs that point to this asset (by url or legacy file_id)
                    ref_images[:] = [
                        img for img in ref_images
                        if img.get('file_id') != asset_id and img.get('id') != asset_id
                        # url might be file:// path; we don't have asset->url map here, so keep by id/file_id
                    ]
    return count


def get_storyboard_stats(storyboard: Dict[str, Any]) -> Dict[str, int]:
    """Get statistics about the storyboard."""
    scene_board = storyboard.get('scene_board', [])
    art_materials = storyboard.get('art_materials', {})

    def _has_pictures(picture: Dict) -> bool:
        frames = picture.get('frames', [])
        if picture.get('first_frame'):  # legacy
            return True
        for group in frames:
            if isinstance(group, list) and group:
                return True
        return False

    shots_with_pictures = sum(
        1 for shot in scene_board
        if _has_pictures(shot.get('picture', {}))
    )
    
    shots_with_videos = sum(
        1 for shot in scene_board 
        if shot.get('videos', []) or shot.get('video', [])
    )
    
    return {
        'total_shots': len(scene_board),
        'total_assets': len(art_materials.get('asset', [])),
        'shots_with_pictures': shots_with_pictures,
        'shots_with_videos': shots_with_videos
    }
