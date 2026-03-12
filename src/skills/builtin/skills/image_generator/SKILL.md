---
name: image_generator
description: Generate images from a text prompt via Creez backend. Returns image URLs and saves to workplace/GeneratedImage.
reply_instruction: "When image_generator returns generated images, you MUST include them in your reply using Markdown image syntax so the user can see the pictures. Copy each line in the form ![Generated image N](file://path) into your reply exactly as given; do not replace with plain links or omit the images."
read_when:
  - User asks to generate/create/draw an image from a description
  - User asks for image generation or 生成图片/画一张图
metadata: {}
---

# image_generator (Built-in Tool)

Generate images from a text prompt. Images are saved under the user's workplace in `GeneratedImage/`. Include the returned Markdown image blocks in your reply so the user sees the images.

## When to call

- User asks to generate an image from a description (e.g. "生成一张橘猫晒太阳的图", "draw a sunset over mountains").
- User explicitly requests image generation.

## Parameters

- **prompt** (required): Text description of the image.
- **ratio** (optional): e.g. "16:9", "1:1". Default "16:9".
- **numImages** (optional): 1–10. Default 1.
- **enableWebSearch** (optional): Enhance prompt with web search. Default false.

## Reply

Always include the generated image(s) in your reply using the exact Markdown image syntax returned by the tool (e.g. `![Generated image 1](file:///path)`), so the images are displayed to the user.
