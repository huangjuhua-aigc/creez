"""
Validate storyboard JSON structure and data integrity.
"""

from typing import Dict, List, Tuple, Any
from skill_utils import load_storyboard


class ValidationError:
    def __init__(self, level: str, message: str, location: str = ""):
        self.level = level  # "error", "warning", "info"
        self.message = message
        self.location = location
    
    def __str__(self):
        prefix = {"error": "❌", "warning": "⚠️", "info": "ℹ️"}[self.level]
        loc = f" [{self.location}]" if self.location else ""
        return f"{prefix} {self.message}{loc}"


def validate_storyboard(storyboard: Dict[str, Any]) -> Tuple[bool, List[ValidationError]]:
    """
    Validate storyboard structure and return (is_valid, errors_list).
    """
    errors = []
    
    # Check root structure
    if 'scene_board' not in storyboard:
        errors.append(ValidationError("error", "Missing 'scene_board' field", "root"))
        return False, errors
    
    if 'art_materials' not in storyboard:
        errors.append(ValidationError("error", "Missing 'art_materials' field", "root"))
        return False, errors
    
    scene_board = storyboard['scene_board']
    art_materials = storyboard['art_materials']
    
    # Validate scene_board
    errors.extend(validate_scene_board(scene_board, art_materials))
    
    # Validate art_materials
    errors.extend(validate_art_materials(art_materials))
    
    # Check for errors vs warnings
    has_errors = any(e.level == "error" for e in errors)
    
    return not has_errors, errors


def validate_scene_board(scene_board: List[Dict], art_materials: Dict) -> List[ValidationError]:
    """Validate scene_board array."""
    errors = []
    
    if not isinstance(scene_board, list):
        errors.append(ValidationError("error", "scene_board must be an array", "scene_board"))
        return errors
    
    shot_ids = []
    scene_indices = []
    
    for idx, shot in enumerate(scene_board):
        location = f"scene_board[{idx}]"
        
        # Check required fields
        required_fields = ['shot_id', 'scene_index', 'picture']
        for field in required_fields:
            if field not in shot:
                errors.append(ValidationError("error", f"Missing required field '{field}'", location))
        
        # Validate shot_id
        shot_id = shot.get('shot_id')
        if shot_id is not None:
            if not isinstance(shot_id, int):
                errors.append(ValidationError("error", "shot_id must be an integer", location))
            elif shot_id in shot_ids:
                errors.append(ValidationError("error", f"Duplicate shot_id: {shot_id}", location))
            else:
                shot_ids.append(shot_id)
        
        # Validate scene_index
        scene_index = shot.get('scene_index')
        if scene_index is not None:
            if not isinstance(scene_index, int):
                errors.append(ValidationError("error", "scene_index must be an integer", location))
            else:
                scene_indices.append(scene_index)
        
        # Validate duration
        duration = shot.get('duration')
        if duration is not None and not isinstance(duration, (int, float)):
            errors.append(ValidationError("warning", "duration should be a number", location))
        
        # Validate active_assets
        active_assets = shot.get('active_assets', [])
        if not isinstance(active_assets, list):
            errors.append(ValidationError("error", "active_assets must be an array", location))
        else:
            # Check if referenced assets exist (id or legacy file_id)
            asset_ids = set()
            for a in art_materials.get('asset', []):
                if a.get('id'):
                    asset_ids.add(a['id'])
                if a.get('file_id'):
                    asset_ids.add(a['file_id'])
            for aid in active_assets:
                if aid not in asset_ids:
                    errors.append(ValidationError("warning",
                        f"Referenced asset '{aid}' not found in art_materials", location))

        # Validate picture structure (frames is 2D array; first_frame is legacy)
        picture = shot.get('picture', {})
        if not isinstance(picture, dict):
            errors.append(ValidationError("error", "picture must be an object", location))
        else:
            if 'frames' not in picture:
                errors.append(ValidationError("warning", "picture missing 'frames'", location))
        
        # Validate videos/video field
        if 'videos' not in shot and 'video' not in shot:
            errors.append(ValidationError("warning", "Shot missing 'videos' or 'video' field", location))
    
    # Check scene_index sequence
    if scene_indices:
        scene_indices.sort()
        expected = list(range(len(scene_board)))
        if scene_indices != expected:
            errors.append(ValidationError("error", 
                f"scene_index not sequential. Expected {expected}, got {scene_indices}", "scene_board"))
    
    return errors


def validate_art_materials(art_materials: Dict) -> List[ValidationError]:
    """Validate art_materials object."""
    errors = []
    
    if not isinstance(art_materials, dict):
        errors.append(ValidationError("error", "art_materials must be an object", "art_materials"))
        return errors
    
    if 'asset' not in art_materials:
        errors.append(ValidationError("error", "art_materials missing 'asset' array", "art_materials"))
        return errors
    
    assets = art_materials['asset']
    if not isinstance(assets, list):
        errors.append(ValidationError("error", "'asset' must be an array", "art_materials.asset"))
        return errors
    
    seen_ids = []

    for idx, asset in enumerate(assets):
        location = f"art_materials.asset[{idx}]"

        # id or legacy file_id required for uniqueness
        asset_id = asset.get('id') or asset.get('file_id')
        if not asset_id:
            errors.append(ValidationError("error", "Asset must have 'id' or 'file_id'", location))
        else:
            if asset_id in seen_ids:
                errors.append(ValidationError("error", f"Duplicate asset id: {asset_id}", location))
            else:
                seen_ids.append(asset_id)

        # Check required fields (name, desc, visual_state)
        for field in ['name', 'desc', 'visual_state']:
            if field not in asset:
                errors.append(ValidationError("error", f"Missing required field '{field}'", location))

        # image_urls (array) or legacy image_url
        if 'image_urls' not in asset and 'image_url' not in asset:
            errors.append(ValidationError("warning", "Missing 'image_urls' or 'image_url' field", location))
        elif asset.get('image_urls') is not None and not isinstance(asset.get('image_urls'), list):
            errors.append(ValidationError("warning", "'image_urls' must be an array", location))
    
    return errors


def print_validation_results(is_valid: bool, errors: List[ValidationError]) -> None:
    """Print validation results in a formatted way."""
    if is_valid and not errors:
        print("✅ Validation passed! No issues found.")
        return
    
    # Count by level
    error_count = sum(1 for e in errors if e.level == "error")
    warning_count = sum(1 for e in errors if e.level == "warning")
    info_count = sum(1 for e in errors if e.level == "info")
    
    print(f"\n🔍 Validation Results:")
    print(f"  Errors: {error_count}")
    print(f"  Warnings: {warning_count}")
    print(f"  Info: {info_count}")
    print()
    
    # Print all issues
    for error in errors:
        print(f"  {error}")
    
    print()
    if is_valid:
        print("✅ Validation passed with warnings/info")
    else:
        print("❌ Validation failed - please fix errors")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python validate_storyboard.py <storyboard.json>")
        sys.exit(1)
    
    filepath = sys.argv[1]
    storyboard = load_storyboard(filepath)
    is_valid, errors = validate_storyboard(storyboard)
    print_validation_results(is_valid, errors)
    
    sys.exit(0 if is_valid else 1)
