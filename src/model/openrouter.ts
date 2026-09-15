import type {
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  TokenUsage,
  ToolCall
} from "./types.js";

type OpenRouterChoice = { finish_reason?: string | null; message?: Record<string, unknown> };
type OpenRouterPayload = {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: TokenUsage;
  error?: { message?: string };
};

function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== "object") return false;
  const call = value as Record<string, unknown>;
  if (typeof call.id !== "string" || call.type !== "function") return false;
  if (!call.function || typeof call.function !== "object") return false;
  const fn = call.function as Record<string, unknown>;
  return typeof fn.name === "string" && typeof fn.arguments === "string";
}

function assistantMessage(value: unknown): Extract<ChatMessage, { role: "assistant" }> {
  if (!value || typeof value !== "object") throw new Error("OpenRouter returned no assistant message.");
  const raw = value as Record<string, unknown>;
  const content = raw.content;
  if (content !== null && typeof content !== "string") {
    throw new Error("OpenRouter returned an unsupported assistant content type.");
  }
  const toolCalls = raw.tool_calls;
  if (toolCalls !== undefined && (!Array.isArray(toolCalls) || !toolCalls.every(isToolCall))) {
    throw new Error("OpenRouter returned malformed tool calls.");
  }
  return {
    ...raw,
    role: "assistant",
    content,
    ...(toolCalls === undefined ? {} : { tool_calls: toolCalls })
  } as Extract<ChatMessage, { role: "assistant" }>;
}

export class OpenRouterClient implements ModelClient {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions",
    private readonly applicationTitle = "Interface.ai Computer Use Harness"
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/whoissegun/interface-ai-computer-use",
        "X-Title": this.applicationTitle
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        ...(request.tools.length > 0
          ? { tools: request.tools, tool_choice: "auto", parallel_tool_calls: false }
          : {}),
        reasoning: { effort: request.reasoningEffort },
        max_tokens: request.maxTokens,
        session_id: request.sessionId,
        stream: false
      }),
      signal: AbortSignal.timeout(180_000)
    });

    const body = await response.text();
    let payload: OpenRouterPayload;
    try {
      payload = JSON.parse(body) as OpenRouterPayload;
    } catch {
      throw new Error(`OpenRouter returned non-JSON HTTP ${response.status}: ${body.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${payload.error?.message ?? body.slice(0, 500)}`
      );
    }
    const choice = payload.choices?.[0];
    if (!choice) throw new Error("OpenRouter returned no completion choices.");
    return {
      id: payload.id ?? "unknown",
      model: payload.model ?? request.model,
      message: assistantMessage(choice.message),
      finishReason: choice.finish_reason ?? null,
      ...(payload.usage ? { usage: payload.usage } : {})
    };
  }
}
