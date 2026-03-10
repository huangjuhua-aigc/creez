---
name: vc_lead_capture
description: When User Ask for product own's contact info, or the user have show deep insterests to creez(e.g. after substantive conversation, deep questions, or explicit meeting request)
some signals that implies depp instersts and serious
  - User had ~10 rounds of substantive conversation about Creez with RoundCloser
  - User asked deep questions that RoundCloser's knowledge base doesn't cover
  - User explicitly asks for founder contact or requests a meeting
reply_instruction: "告知用户已收到联系方式，创始人/产品负责人会尽快与其联系。语气专业、简洁。"

metadata: {"clawdbot":{"emoji":"📇"}}
---

# vc_lead_capture (Built-in Tool)

This is a built-in tool executed by the Creez system. It sends the user's contact information to the backend so the product owner can follow up (e.g. for VC / RoundCloser leads).

## When to call

Call this tool when you think the user is serious. 

1. some conditions imply the user is serious
   - User has had roughly 10 or more rounds of substantive conversation about Creez with RoundCloser, OR
   - User asked deep questions that the knowledge base doesn't cover, OR
   - User explicitly asked for founder contact or requested a meeting / demo.

2. **Contact already collected:** You have already obtained from the user at least: **name** and a way to reach them (**email** and/or **WeChat**). If you have not yet collected this, do **not** call the tool; instead, ask the user for their contact (name, email, company, WeChat, availability) in a natural way, then call the tool in a later turn once they provide it.

## How to call

Call tool:

```text
vc_lead_capture({
  "name": "<user's name>",
  "email": "<email if provided>",
  "company": "<company if provided>",
  "wechat": "<WeChat ID if provided>",
  "message": "<optional short note or availability>"
})
```

Arguments:

- `name` (required): Full name or how the user wants to be called.
- `email` (optional): Email address.
- `company` (optional): Company or fund name.
- `wechat` (optional): WeChat ID.
- `message` (optional): Short note, availability, or reason for contact.

At least one of `email` or `wechat` is strongly recommended so the product owner can reach the user.

## Behavior

- If contact info is **incomplete** (e.g. missing name or both email and wechat): The tool returns an error instructing you to ask the user for the missing fields. Do not retry until the user has provided them.
- If contact info is **complete**: The tool sends the payload to the backend (stored in DB + Feishu notification to product owner) and returns success. Use the reply_instruction to shape your response.

## Scope and safety

- Only call for RoundCloser / VC lead context. Do not call for casual or non-lead conversations.
- Do not fabricate contact fields; use only what the user has explicitly provided.
