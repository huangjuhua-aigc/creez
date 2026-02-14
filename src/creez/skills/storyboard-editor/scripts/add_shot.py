"""
Add a new shot to the storyboard at a specified position.
"""

from typing import Optional
from skill_utils import (
    load_storyboard, 
    save_storyboard, 
    create_shot_template,
    get_next_shot_id,
    update_scene_indices
)


def add_shot(
    storyboard_path: str,
    position: Optional[int] = None,
    shot_type: str = "",
    movement: str = "",
    description: str = "",
    duration: float = 0,
    active_assets: list = None,
) -> dict:
    """
    Add a new shot to the storyboard.
    
    Args:
        storyboard_path: Path to storyboard JSON file
        position: Insert position (0-based). If None, append to end
        shot_type: Shot type (远景/中景/近景/特写)
        movement: Camera movement (静止/推镜/拉镜/横移等)
        description: Shot description
        duration: Shot duration in seconds
        active_assets: List of asset file_ids to use
    
    Returns:
        dict with 'success', 'shot_id', 'scene_index', 'message'
    """
    # Load storyboard
    storyboard = load_storyboard(storyboard_path)
    scene_board = storyboard['scene_board']
    
    # Get next shot_id
    shot_id = get_next_shot_id(scene_board)
    
    # Determine insert position
    if position is None:
        position = len(scene_board)
    elif position < 0:
        position = 0
    elif position > len(scene_board):
        position = len(scene_board)
    
    # Create new shot
    new_shot = create_shot_template(shot_id, position)
    new_shot['type'] = shot_type
    new_shot['movement'] = movement
    new_shot['description'] = description
    new_shot['duration'] = duration
    new_shot['active_assets'] = active_assets or []
    
    # Insert shot
    scene_board.insert(position, new_shot)
    
    # Update all scene_index values
    update_scene_indices(scene_board)
    
    save_storyboard(storyboard, storyboard_path)
    
    return {
        'success': True,
        'shot_id': shot_id,
        'scene_index': position,
        'message': f'Added shot #{shot_id} at position {position}'
    }


if __name__ == "__main__":
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description='Add a new shot to storyboard')
    parser.add_argument('storyboard', help='Path to storyboard JSON file')
    parser.add_argument('-p', '--position', type=int, help='Insert position (0-based)')
    parser.add_argument('-t', '--type', default='', help='Shot type')
    parser.add_argument('-m', '--movement', default='', help='Camera movement')
    parser.add_argument('-d', '--description', default='', help='Shot description')
    parser.add_argument('--duration', type=float, default=0, help='Duration in seconds')
    parser.add_argument('-o', '--output', help='Output file path')
    
    args = parser.parse_args()
    
    result = add_shot(
        args.storyboard,
        position=args.position,
        shot_type=args.type,
        movement=args.movement,
        description=args.description,
        duration=args.duration,
        output_path=args.output
    )
    
    print(f"✅ {result['message']}")
    print(f"   Shot ID: {result['shot_id']}")
    print(f"   Scene Index: {result['scene_index']}")
