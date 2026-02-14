# Prompt Construction Guidelines

Guidelines for constructing high-quality prompts for image and video generation.

## Core Principles

1. **Specificity**: Be detailed and precise
2. **Consistency**: Maintain visual consistency across shots
3. **Context**: Include scene environment and style
4. **References**: Leverage asset references effectively
5. **Technical specs**: Include shot type and movement

## Prompt Structure Template

```
{镜头技术规格} {场景描述}。
{参考图引用}。
{环境描述}。
{画面风格}。
```

### 1. 镜头技术规格

Format: `{type}{movement}镜头`

**Examples:**
- 远景静止镜头
- 中景缓慢推镜
- 特写跟随镜头
- 全景横移镜头

**Shot Types (镜头类型):**
- 远景 (Wide Shot): Shows entire scene/environment
- 全景 (Long Shot): Full body in environment
- 中景 (Medium Shot): Waist up
- 近景 (Close-up): Head and shoulders
- 特写 (Close-up): Face
- 大特写 (Extreme Close-up): Eyes, details

**Camera Movements (运镜):**
- 静止: Static, no movement
- 推镜: Push in / Dolly in
- 拉镜: Pull out / Dolly out
- 缓慢推镜: Slow push
- 横移: Pan / Track
- 升降: Crane / Tilt
- 跟随: Follow / Tracking shot
- 环绕: Orbit / Circle

### 2. 场景描述

Main content description from the shot's `description` field.

**Tips:**
- Be specific about actions and emotions
- Include time of day, weather, atmosphere
- Mention key objects and their states
- Describe character positions and interactions

**Example:**
```
黎明时分的海岸线上，络腮胡男子被海浪卷抛在潮湿沙滩上，
一动不动躺着，面部表情模糊，身上沾满沙子和海水。
```

### 3. 参考图引用

Reference assets from `active_assets` using structured format.

**Format:**
```
参考图{N}中的{asset.name}({asset.desc中的关键特征})
```

**Examples:**
- `参考图1中的海岸(汹涌的黑色波浪冲击沙滩、冷色调天空)`
- `参考图2中的络腮胡男子(30-40多岁白人男性，凌乱棕色短发，浓密络腮胡)`
- `参考图3中的沙堡(结构简单，部分坍塌，表面湿润)`

**Multi-asset pattern:**
```
场景环境参考图1的{environment_asset.name}：{key_features}。
角色参考图2的{character_asset.name}：{key_features}。
道具参考图3的{prop_asset.name}：{key_features}。
```

### 4. 环境描述

Overall scene atmosphere and environment, often derived from primary location assets.

**Elements to include:**
- Lighting conditions
- Weather/atmosphere
- Color palette
- Mood/feeling

**Example:**
```
场景环境：汹涌的黑色波浪冲击沙滩，潮湿的深灰褐色沙滩，
天空呈现冷色调的蓝色和灰色，整体光线昏暗，营造神秘而压抑的氛围。
```

### 5. 画面风格

Technical and artistic style specifications.

**Standard format:**
```
画面采用干净、高分辨率写实质感，冷色调（青/蓝/灰），
低饱和度，写实自然光，柔和阴影，4K，ARRI Alexa质感，
中性色温，大景深，真实的材质纹理
```

**Style components:**
- **Resolution**: 干净、高分辨率、4K
- **Quality**: 写实质感、电影质感、ARRI Alexa质感
- **Color tone**: 冷色调/暖色调、低饱和度/高饱和度
- **Lighting**: 写实自然光、柔和阴影、实用灯光
- **Temperature**: 中性色温、冷色温、暖色温
- **Composition**: 大景深、中心对称构图、精确透视线条
- **Realism**: 真实的纹理、现代风格、无科幻元素

## Asset Reference Strategy

### Single Asset
Use when the shot focuses on one main element:
```
中景静止镜头，参考图1中的络腮胡男子坐在桌前...
```

### Multiple Assets (Environment + Character)
```
{镜头规格}，{场景描述}。
场景环境参考图1的{location}：{features}。
角色参考图2的{character}：{features}。
```

### Multiple Assets (Environment + Multiple Characters/Props)
```
{镜头规格}，{场景描述}。
场景环境参考图1的{location}：{features}。
参考图2中的{character1}({features})，
参考图3中的{character2}({features})，
参考图4中的{prop}({features})。
```

## Prompt Assembly Function

```python
def construct_prompt(shot: dict, assets: list, scene_style: str = "") -> str:
    """
    Construct a complete prompt from shot data and assets.
    
    Args:
        shot: Shot object from scene_board
        assets: List of asset objects (from active_assets)
        scene_style: Overall scene style description
    
    Returns:
        Complete prompt string
    """
    parts = []
    
    # 1. Technical specs
    if shot['type'] and shot['movement']:
        parts.append(f"{shot['type']}{shot['movement']}镜头")
    elif shot['type']:
        parts.append(f"{shot['type']}镜头")
    
    # 2. Scene description
    if shot['description']:
        parts.append(shot['description'])
    
    # 3. Asset references
    if assets:
        # Separate environment and other assets
        env_assets = [a for a in assets if '环境' in a['name'] or '场景' in a['name'] 
                      or '海岸' in a['name'] or '城堡' in a['name']]
        other_assets = [a for a in assets if a not in env_assets]
        
        # Reference environment first
        if env_assets:
            for idx, asset in enumerate(env_assets, 1):
                parts.append(f"参考图{idx}中的{asset['name']}：{extract_key_features(asset['desc'])}")
        
        # Then reference characters and props
        start_idx = len(env_assets) + 1
        for idx, asset in enumerate(other_assets, start_idx):
            parts.append(f"参考图{idx}中的{asset['name']}({extract_key_features(asset['desc'])})")
    
    # 4. Style specifications
    style_spec = get_standard_style(scene_style)
    parts.append(style_spec)
    
    return "。".join(parts) + "。"


def extract_key_features(desc: str, max_length: int = 100) -> str:
    """Extract key features from asset description."""
    # Remove redundant phrases
    desc = desc.replace('空白纯色背景', '')
    desc = desc.replace('定妆照', '')
    desc = desc.replace('产品摄影', '')
    
    # Truncate if too long
    if len(desc) > max_length:
        desc = desc[:max_length] + "..."
    
    return desc.strip()


def get_standard_style(scene_style: str = "") -> str:
    """Get standard style specifications."""
    base_style = (
        "画面采用干净、高分辨率写实质感，冷色调（青/蓝/灰），"
        "低饱和度，写实自然光，柔和阴影，4K，ARRI Alexa质感，"
        "中性色温，真实的材质纹理"
    )
    
    if scene_style:
        return f"{scene_style}。{base_style}"
    
    return base_style
```

## Quality Checklist

Before generating, verify:

- [ ] Shot type and movement specified
- [ ] Scene description is clear and detailed
- [ ] All active_assets are referenced
- [ ] Reference numbering is sequential (图1, 图2, ...)
- [ ] Key features extracted from asset descriptions
- [ ] Environment/atmosphere included
- [ ] Style specifications consistent with scene
- [ ] Prompt length reasonable (< 500 characters ideally)
- [ ] No contradictory instructions
- [ ] Proper Chinese grammar and punctuation

## Common Patterns

### Action Shot
```
中景跟随镜头，{character}快速奔跑穿过{location}，背景模糊。
参考图1中的{location}，参考图2中的{character}。
画面采用动态模糊效果，强调速度感，{standard_style}。
```

### Dialogue Shot
```
近景静止镜头，{character1}与{character2}对话，表情{emotion}。
场景环境参考图1的{location}。角色参考图2的{character1}和图3的{character2}。
{standard_style}，浅景深，焦点在前景角色。
```

### Establishing Shot
```
远景静止镜头，{location}全景，{time_of_day}，{atmosphere}。
参考图1中的{location}：{detailed_features}。
{standard_style}，大景深，展现环境全貌。
```

## Negative Prompts (What to Avoid)

Don't include in prompts:
- ❌ "空白纯色背景" (unless intentional)
- ❌ "定妆照" 
- ❌ "产品摄影"
- ❌ CGI effects (unless intentional)
- ❌ Science fiction elements (unless intentional)
- ❌ Overly generic descriptions
- ❌ Contradictory style instructions

## Model-Specific Notes

### doubao-seedream-4-0
- Excellent at reference image consistency
- Good at detailed scene composition
- Supports up to 4-6 reference images effectively
- Best for photorealistic shots

### gemini-3-pro
- Good general quality
- May need more detailed prompts
- Better at artistic/stylized looks
- Can handle complex compositions

## Examples from Real Storyboard

### Example 1: Environment Establishing Shot
```
远景静止镜头，黎明时分的海岸全景，海浪轰鸣着拍打沙滩，
整体色调为冷蓝色，低饱和度，呈现出清晨的清冷感。
参考图1中的黎明海岸线场景，包括汹涌的黑色波浪冲击潮湿的深灰褐色沙滩、
前景被潮水吞噬的沙堡，以及冷色调的蓝色和灰色天空，光线昏暗以营造神秘而压抑的氛围。
```

### Example 2: Character Focus Shot
```
中景镜头，缓慢推镜，黎明时分的海岸线上，
参考图2中的络腮胡男子（30-40多岁白人男性，面容疲惫，凌乱棕色短发，
浓密杂乱络腮胡，湿透深色服装）被海浪卷抛在潮湿沙滩上，一动不动躺着。
场景环境参考图1的海岸风格：汹涌的黑色波浪冲击沙滩，冷色调天空，昏暗光线。
画面采用干净、高分辨率写实质感，冷色调，低饱和度，写实自然光，
柔和阴影，4K ARRI Alexa质感，中性色温，大景深。
```

### Example 3: Multi-Character Shot
```
中远景静止镜头，黎明时分的海岸线场景，
金发小男孩（5-7岁，参考图2）蹲在地上专注注视着正在被潮水吞噬的沙堡（参考图4），
金发小女孩（5-7岁，参考图3）正缓慢走近男孩，两人动作天真。
场景环境参考图1：冷色调蓝灰色天空、昏暗光线、神秘压抑氛围。
画面采用干净写实质感，低饱和度冷色调、自然柔和阴影及4K ARRI Alexa质感。
```
