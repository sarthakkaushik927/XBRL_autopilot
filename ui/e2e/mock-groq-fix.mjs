// A scripted stand-in for Groq's chat completions (OpenAI-compatible) for Ind AS Fix with AI: the backend is started
// with GROQ_API_BASE=http://127.0.0.1:<port> (langchain_groq), so no request leaves the machine. The backend asks for
// structured output by function calling; the mock answers with one `FixAnswer` tool call built by `answer(prompt)`.
// Every request body is kept, so the test can check what was sent.
import { createServer } from 'node:http'

export function startMockGroqFix(port, answer) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return send(404, { error: { message: 'not found' } })
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        return send(400, { error: { message: 'bad json' } })
      }
      requests.push(parsed)
      const prompt = (parsed.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join('\n')
      const tool = parsed.tools?.[0]?.function?.name ?? 'FixAnswer'
      send(200, {
        id: `chatcmpl-mock-${requests.length}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: parsed.model,
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool, arguments: JSON.stringify(answer(prompt)) } }] },
          },
        ],
        usage: { prompt_tokens: 1200, completion_tokens: 120, total_tokens: 1320 },
      })
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ requests, close: () => server.close() })))
}

/** The id of the line with this exact line item in a Fix with AI prompt ("<id> | <line item> | <headings> | …"). */
export function lineId(prompt, label) {
  const line = prompt.split('\n').find((l) => l.split(' | ')[1] === label)
  return line ? line.split(' | ')[0] : null
}

/** The first problem id in a Fix with AI prompt ("- Problem <id>: …"). */
export function firstProblemId(prompt) {
  return /^- Problem (.+?): /m.exec(prompt)?.[1] ?? null
}
