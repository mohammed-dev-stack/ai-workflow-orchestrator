/**
 * config/ai.config.ts
 */
import { env, Env } from './env';
import { redact } from '../utils/redact';
 
export interface AIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly mode: 'mock' | 'real';
  readonly mockDelay: number;
}
 
export function buildAIConfig(source: Env = env): Readonly<AIConfig> {
  return Object.freeze({
    apiKey: source.ANTHROPIC_API_KEY ?? '',
    model: source.AI_MODEL,
    maxTokens: source.AI_MAX_TOKENS,
    temperature: source.AI_TEMPERATURE,
    mode: source.AI_MODE,
    mockDelay: source.AI_MOCK_DELAY,
  });
}
 
export const aiConfig: Readonly<AIConfig> = buildAIConfig();
 
/** إسقاط آمن للطباعة. لا تطبع aiConfig مباشرة أبدًا في أي لوغ. */
export function getSafeAIConfig(): Record<string, unknown> {
  return redact({ ...aiConfig });
}
 
export default aiConfig;