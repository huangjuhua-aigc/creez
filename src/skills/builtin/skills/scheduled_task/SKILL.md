---
name: scheduled_task
description: One skill for listing, creating, and deleting recurring scheduled tasks in this chat (default bot only). Choose action by user intent.
reply_instruction: "根据操作结果用简短一句话回复：列出时说明有哪些任务（时间/内容）；创建成功时说明已设置及下次运行时间；删除成功时说明已取消。"
read_when:
  - User asks to list/show/cancel/delete scheduled tasks or reminders
  - User asks to create/set a recurring task (e.g. daily summary, reminder)
  - User says "取消 8 点那个" or "删掉定时任务" or "我有哪些定时任务"
metadata: {"clawdbot":{"emoji":"⏰"}}
---

# scheduled_task (Built-in Tool)

Single skill for **listing**, **creating**, and **deleting** scheduled tasks in the current chat. Decide `action` from user intent and pass the right parameters.

## When to call

- **list**: User asks what scheduled tasks exist, or to show/列出/查看定时任务/提醒.
- **create**: User asks to add a recurring task (e.g. 每天 8 点总结, every day at 9am remind me).
- **delete**: User asks to cancel/remove/delete a task (e.g. 取消 8 点那个, delete the 8am one). Call **list** first to get task ids, then **delete** with the chosen `task_id`.

## How to call

**List (no extra args):**
```text
scheduled_task({ "action": "list" })
```

**Create (cron + task_prompt):**
```text
scheduled_task({
  "action": "create",
  "cron_expression": "0 8 * * *",
  "task_prompt": "Summarize today's priorities and reply in this chat."
})
```

**Delete (task_id from list):**
```text
scheduled_task({ "action": "delete", "task_id": "<id from list>" })
```

## Parameters

- `action` (required): `"list"` | `"create"` | `"delete"`.
- `task_id` (required when action is `delete`): Id from a previous list result.
- `cron_expression` (required when action is `create`): Standard 5-field cron, e.g. `0 8 * * *` (8:00 daily), `0 */2 * * *` (every 2 hours).
- `task_prompt` (required when action is `create`): Instruction sent to the agent at each run.

## Scope

- Only available for the default assistant bot. Tasks are scoped to the current chat.
