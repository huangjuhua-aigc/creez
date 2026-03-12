---
name: channel_send
description: Send a message to an external channel (e.g. Feishu, WeCom) by user instruction.
reply_instruction: "After channel_send succeeds, confirm to the user that the message was sent to the requested channel (e.g. 已通过飞书发送 / 已通过企微发送). If it fails, explain the error and suggest checking channel config in Advanced Settings."
read_when:
  - User asks to send a message to Feishu / 飞书 (e.g. 通过飞书发送xxx, 发送xxx给飞书)
  - User asks to send a message to WeCom / 企业微信 / 企微 (e.g. 通过企微发送xxx, 发送xxx给企业微信)
  - User asks to send something via a specific channel
metadata: {}
---

# channel_send (Built-in Tool)

Send a message to an external channel based on user instruction. The recipient is read from the channel configuration (Advanced Settings → Channel), no need to specify it.

## When to call

- User says to send a message to Feishu: e.g. "通过飞书发送：明天开会", "发送xxx给飞书", "用飞书发一条消息".
- User says to send a message to WeCom: e.g. "通过企微发送：明天开会", "发送xxx给企业微信", "用企微发一条消息".
- User explicitly requests sending to a named channel.

## Parameters

- **channel** (required): Use `"feishu"` for Feishu / 飞书, `"wecom"` for WeCom / 企业微信 / 企微.
- **content** (required): The exact message text to send.

## Reply

Confirm to the user that the message was sent (e.g. 已通过飞书发送 / 已通过企微发送). On failure, report the error and suggest checking Advanced Settings → Channel config.
