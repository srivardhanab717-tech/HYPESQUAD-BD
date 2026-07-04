import { config } from '../../config/env';
import { AppError } from '../../lib/errors';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const TIMEOUT_MS = 30000;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  system?: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}

export interface ClaudeResponse {
  content: string;
}

/**
 * Thin Claude API wrapper.
 * Calls the Anthropic Messages API and returns the parsed text response.
 * Throws on failure/timeout.
 */
export async function callClaude(request: ClaudeRequest): Promise<string> {
  const apiKey = config.ai.claudeApiKey;
  if (!apiKey) {
    throw new AppError('AI service not configured', 503, 'AI_NOT_CONFIGURED');
  }

  const model = process.env.CLAUDE_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 1024,
        system: request.system,
        messages: request.messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Claude API error:', response.status, errorBody);
      throw new AppError('AI service unavailable', 503, 'AI_SERVICE_ERROR');
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    const textContent = data.content?.find((c) => c.type === 'text');
    if (!textContent) {
      throw new AppError('AI service returned empty response', 503, 'AI_EMPTY_RESPONSE');
    }

    return textContent.text;
  } catch (error) {
    if (error instanceof AppError) throw error;

    if ((error as Error).name === 'AbortError') {
      throw new AppError('AI service timeout', 503, 'AI_TIMEOUT');
    }

    console.error('Claude API call failed:', error);
    throw new AppError('AI service unavailable', 503, 'AI_SERVICE_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Call Claude and parse the response as JSON.
 * Attempts to extract JSON from the response text (handles markdown code fences).
 */
export async function callClaudeForJson<T>(request: ClaudeRequest): Promise<T> {
  const rawText = await callClaude(request);

  // Try to extract JSON from the response (may be wrapped in code fences)
  let jsonStr = rawText.trim();

  // Remove markdown code fences if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    console.error('Failed to parse Claude JSON response:', rawText);
    throw new AppError('AI service returned invalid response format', 503, 'AI_PARSE_ERROR');
  }
}
