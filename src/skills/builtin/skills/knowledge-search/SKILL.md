---
name: knowledge_search
description: Search bot-scoped company knowledge for factual answers before responding.
reply_instruction: "请渐进式披露信息，不要一次性把内容说完，可以引导用户继续提问。但是回复的内容不要跟前文有重复。"
read_when:
  - Answering factual business questions that may require verified company data
  - User asks about traction metrics, roadmap, fundraising details, customers, or commitments
metadata: {"clawdbot":{"emoji":"🧠"}}
---

# knowledge_search (Built-in Tool)

This is a built-in tool executed by the Creez system (not by shell/curl).

## When to call

- Before giving concrete factual claims about company data.
- When a response depends on bot-specific knowledge base context.

## How to call

Call tool:

```text
knowledge_search({
  "query": "<factual question>",
  "topK": 5
})
```

Arguments:
- `query` (required): natural-language search question.
- `topK` (optional): number of snippets, range `1-20`, default `5`.

## Reply instruction (EN)

The `reply_instruction` in frontmatter is shown with the tool result so the model shapes its reply accordingly: disclose information progressively; do not dump everything at once; guide the user to ask follow-up questions; do not repeat content from earlier in the conversation.

## Scope and safety

- Bot scope (`botId`) is injected by the system from current runtime contact context.
- Do not ask for or fabricate another bot id.
- If tool returns error protocol or empty result, ask user for missing facts instead of guessing.
