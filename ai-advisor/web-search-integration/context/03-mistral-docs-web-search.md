# What Mistral documentation says about web search (search-result summary, current as of 2026-07-14)

Sources:
- https://docs.mistral.ai/studio-api/agents/agent-tools/websearch
- https://docs.mistral.ai/studio-api/agents/agents-api
- https://docs.mistral.ai/api/endpoint/beta/conversations
- https://mistral.ai/pricing/api/

## Tool availability

Mistral provides two built-in web-search tools:
- `web_search` — simple web search
- `web_search_premium` — web search + verified news articles

They work ONLY with:
- **Conversations API** (`POST /v1/conversations`)
- **Agents API** (`/v1/agents` + `/v1/conversations`)

They do **NOT** work with `/v1/chat/completions`. Per the docs:

> `web_search` and `web_search_premium` aren't supported in the Chat Completions API because Chat Completions responses don't include the search result references that these tools return.

## Conversations API request shape (without an agent)

```bash
curl -X POST "https://api.mistral.ai/v1/conversations" \
  -H "Authorization: Bearer ${MISTRAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral-small-latest",
    "inputs": [{"role": "user", "content": "What is the current weather in Paris?"}],
    "tools": [{"type": "web_search"}],
    "stream": false
  }'
```

Key fields: `model`, `inputs` (array of messages or string), `tools` (built-in tool types), `stream`.

## Conversations API response shape

```json
{
  "object": "conversation.response",
  "conversation_id": "conv_...",
  "outputs": [
    { "type": "tool.execution", "name": "web_search", ... },
    {
      "type": "message.output",
      "role": "assistant",
      "content": [
        { "type": "text", "text": "The last winner of the European Football Cup was Spain..." },
        { "type": "tool_reference", "tool": "web_search", "title": "UEFA Euro Winners List", "url": "https://www.marca.com/...", "source": "brave" },
        ...
      ]
    }
  ],
  "usage": {
    "prompt_tokens": 188,
    "completion_tokens": 55,
    "total_tokens": 7355,
    "connector_tokens": 7112,
    "connectors": { "web_search": 1 }
  }
}
```

## Pricing (current Mistral API pricing)

| Tool | Price |
|---|---|
| Web search | $30 per 1,000 calls = **$0.03 per search** |
| Premium news | $50 per 1,000 calls = $0.05 per search |

Agent/Conversation billing = model token cost + tool call cost.

Example model costs per million tokens:
- Mistral Small 4: $0.15 input / $0.60 output
- Mistral Large 3: $0.50 input / $1.50 output
- Mistral Medium 3.5: $1.50 input / $7.50 output
