// ============================================================
// backend/src/ai/client.ts
// ============================================================
// عميل الذكاء الاصطناعي الموحد (Anthropic Claude)
// يدعم قاطع الدائرة، إعادة المحاولة، التحقق من المخرجات، والتتبع.
// تم إصلاح استدعاء withSpan بإزالة الوسيط النوعي العام غير الضروري.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';

// ============================================================
// أدوات التتبع (lazy loading مع fallback)
// ============================================================

let tracerModule: any = null;
let tracerLoaded = false;

async function loadTracerModule(): Promise<any> {
  if (!tracerLoaded) {
    try {
      const mod = await import('../observability/tracer.js');
      tracerModule = mod.default || mod;
    } catch {
      tracerModule = null;
    }
    tracerLoaded = true;
  }
  return tracerModule;
}

async function getSetSpanAttributes(): Promise<(attributes: Record<string, any>) => void> {
  const mod = await loadTracerModule();
  if (mod && typeof mod.setSpanAttributes === 'function') {
    return mod.setSpanAttributes;
  }
  return (attributes: Record<string, any>) => {
    logger.debug('🔵 setSpanAttributes (fallback):', { attributes });
  };
}

async function getWithSpan(): Promise<(
  name: string,
  fn: (span: any) => Promise<any>,
  attributes?: Record<string, any>
) => Promise<any>> {
  const mod = await loadTracerModule();
  if (mod && typeof mod.withSpan === 'function') {
    return mod.withSpan;
  }
  return async <T>(
    name: string,
    fn: (span: any) => Promise<T>,
    attributes?: Record<string, any>
  ): Promise<T> => {
    logger.debug('🔵 withSpan (fallback): بدء العملية', { name, attributes });
    try {
      const result = await fn({ setAttribute: () => {} });
      logger.debug('🔵 withSpan (fallback): انتهاء العملية', { name });
      return result;
    } catch (error) {
      logger.error('🔴 withSpan (fallback): خطأ', { name, error });
      throw error;
    }
  };
}

import { withCircuitBreakerAndRetry } from '../utils/circuitBreaker.js';
import { recordAIMetric, recordExternalCallMetric } from '../observability/metrics.js';

import {
  EmbeddingResponseSchema,
  ChatResponseSchema,
  ChunkingResponseSchema,
} from './validators/index.js';

import {
  AIServiceError,
  ValidationError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware.js';

// ============================================================
// أنواع البيانات
// ============================================================

export interface AICallOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  responseSchema?: z.ZodSchema;
  operationName?: string;
  tenantId?: string;
}

export interface AICallResult<T = any> {
  data: T;
  raw: string;
  tokensUsed?: number;
  durationMs: number;
  model: string;
  usedFallback: boolean;
}

export type AIOperationType = 'chat' | 'embedding' | 'chunking';

function requireConfigValue<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) {
    throw new Error(`ConfigRequiredError: الإعداد "${name}" غير موجود في البيئة.`);
  }
  return value;
}

// ============================================================
// عميل AI (Singleton)
// ============================================================

class AIClientSingleton {
  private static instance: AIClient | null = null;

  static getInstance(): AIClient {
    if (!this.instance) {
      this.instance = this.createClient();
    }
    return this.instance;
  }

  private static createClient(): AIClient {
    const apiKey = requireConfigValue(config.anthropic?.apiKey, 'ANTHROPIC_API_KEY');
    const timeout = config.circuitBreaker?.timeout || 30000;
    const anthropic = new Anthropic({ apiKey, timeout });
    return new AIClient(anthropic);
  }

  static resetInstance(): void {
    this.instance = null;
  }
}

export class AIClient {
  private anthropic: Anthropic;

  constructor(anthropic: Anthropic) {
    this.anthropic = anthropic;
  }

  private sanitizeInput(text: string): string {
    if (!text) return '';
    let sanitized = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/[<>{}[\]|\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const maxLength = config.anthropic?.maxPromptLength || 100000;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
      logger.warn('تم اقتطاع النص بسبب تجاوز الحد الأقصى للطول', {
        originalLength: text.length,
        truncatedLength: sanitized.length,
        maxLength,
      });
    }
    return sanitized;
  }

  private validateResponse<T>(
    raw: string,
    schema: z.ZodSchema<T>
  ): { data: T; isValid: boolean; error?: string } {
    try {
      const parsed = JSON.parse(raw);
      const result = schema.safeParse(parsed);
      if (result.success) {
        return { data: result.data, isValid: true };
      }
      return {
        data: {} as T,
        isValid: false,
        error: `فشل التحقق من المخرجات: ${result.error.message}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل تحليل JSON';
      return {
        data: {} as T,
        isValid: false,
        error: errorMessage,
      };
    }
  }

  private logAICall(
    operationType: AIOperationType,
    model: string,
    success: boolean,
    durationMs: number,
    tokensUsed?: number,
    error?: string,
    tenantId?: string,
    idempotencyKey?: string
  ): void {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    if (success) {
      logger.info('استدعاء AI ناجح', {
        correlationId,
        operationType,
        model,
        durationMs,
        tokensUsed,
        tenantId,
        idempotencyKey,
      });
    } else {
      logger.error('استدعاء AI فاشل', {
        correlationId,
        operationType,
        model,
        durationMs,
        error,
        tenantId,
        idempotencyKey,
      });
    }
    try {
      recordExternalCallMetric('anthropic', success, durationMs, tenantId);
      recordAIMetric(model, success ? 'response' : 'error', tokensUsed, durationMs, tenantId);
    } catch (metricError) {
      logger.warn('فشل تسجيل المقاييس', { error: metricError });
    }
  }

  async call<T = any>(
    options: AICallOptions
  ): Promise<AICallResult<T>> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const startTime = Date.now();

    const {
      prompt,
      model = config.anthropic?.model || 'claude-3-sonnet-20240229',
      maxTokens = config.anthropic?.maxTokens || 1024,
      temperature = config.anthropic?.temperature || 0.7,
      idempotencyKey,
      timeoutMs = config.circuitBreaker?.timeout || 30000,
      maxRetries = (config.retry?.maxAttempts || 3) - 1,
      responseSchema,
      operationName = 'ai.call',
      tenantId,
    } = options;

    const sanitizedPrompt = this.sanitizeInput(prompt);

    if (!sanitizedPrompt || sanitizedPrompt.length < 3) {
      logger.warn('مطالبة قصيرة جداً', {
        correlationId,
        promptLength: sanitizedPrompt.length,
        idempotencyKey,
      });
      throw new ValidationError('المطالبة قصيرة جداً (يجب أن تكون 3 أحرف على الأقل)');
    }

    logger.debug('بدء استدعاء AI', {
      correlationId,
      model,
      operationName,
      promptLength: sanitizedPrompt.length,
      idempotencyKey,
      tenantId,
    });

    const setSpanAttributes = await getSetSpanAttributes();
    const withSpan = await getWithSpan();

    try {
      setSpanAttributes({
        'ai.model': model,
        'ai.operation': operationName,
        'ai.prompt_length': sanitizedPrompt.length,
        'ai.max_tokens': maxTokens,
        'ai.temperature': temperature,
      });
    } catch (spanError) {
      logger.warn('فشل إضافة سمات التتبع', { error: spanError });
    }

    try {
      // ✅ إزالة الوسيط النوعي العام <AICallResult<T>> من استدعاء withSpan
      const result = await withSpan(
        `ai.${operationName}`,
        async (span) => {
          span.setAttribute('ai.model', model);
          span.setAttribute('ai.operation', operationName);
          span.setAttribute('ai.prompt_length', sanitizedPrompt.length);
          span.setAttribute('ai.idempotency_key', idempotencyKey || 'none');

          const cbResult = await withCircuitBreakerAndRetry<{
            text: string;
            usage: Anthropic.Messages.Usage;
          }>(
            async () => {
              const response = await this.anthropic.messages.create({
                model,
                max_tokens: maxTokens,
                temperature,
                messages: [{ role: 'user', content: sanitizedPrompt }],
              });
              const content = response.content[0];
              if (!content || content.type !== 'text') {
                throw new Error('استجابة غير متوقعة من Claude: نوع المحتوى ليس نصاً أو فارغاً');
              }
              return { text: content.text, usage: response.usage };
            },
            {
              serviceName: `anthropic-${operationName}`,
              idempotencyKey: idempotencyKey || `ai-${correlationId}`,
              timeoutMs,
              errorThreshold: config.circuitBreaker?.errorThreshold || 5,
              halfOpenWaitMs: 60000,
              maxRetries,
              backoffBaseMs: config.retry?.backoffBase || 1000,
              maxBackoffMs: 30000,
            }
          );

          if (!cbResult.data) throw new Error('لم يتم الحصول على بيانات من خدمة الذكاء الاصطناعي');

          const durationMs = Date.now() - startTime;
          const tokensUsed = cbResult.data.usage?.output_tokens || 0;

          let validatedData: T;
          let usedFallback = false;

          if (responseSchema) {
            const validation = this.validateResponse(cbResult.data.text, responseSchema);
            if (!validation.isValid) {
              logger.warn('فشل التحقق من مخرجات AI، استخدام الاحتياطي', {
                correlationId,
                operationName,
                model,
                error: validation.error,
                idempotencyKey,
              });
              usedFallback = true;
              validatedData = cbResult.data.text as unknown as T;
            } else {
              validatedData = validation.data as T;
            }
          } else {
            validatedData = cbResult.data.text as unknown as T;
          }

          this.logAICall(
            operationName as AIOperationType,
            model,
            true,
            durationMs,
            tokensUsed,
            undefined,
            tenantId,
            idempotencyKey
          );

          span.setAttribute('ai.success', true);
          span.setAttribute('ai.duration_ms', durationMs);
          span.setAttribute('ai.tokens_used', tokensUsed);
          span.setAttribute('ai.used_fallback', usedFallback);

          const finalResult: AICallResult<T> = {
            data: validatedData,
            raw: cbResult.data.text,
            tokensUsed,
            durationMs,
            model,
            usedFallback,
          };
          return finalResult;
        },
        {
          'ai.model': model,
          'ai.operation': operationName,
        }
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'فشل غير معروف';

      this.logAICall(
        operationName as AIOperationType,
        model,
        false,
        durationMs,
        undefined,
        errorMessage,
        tenantId,
        idempotencyKey
      );

      try {
        setSpanAttributes({
          'ai.success': false,
          'ai.error': errorMessage,
          'ai.duration_ms': durationMs,
        });
      } catch (spanError) {
        logger.warn('فشل إضافة سمات التتبع للفشل', { error: spanError });
      }

      logger.error('فشل استدعاء AI', {
        correlationId,
        operationName,
        model,
        error: errorMessage,
        durationMs,
        idempotencyKey,
        tenantId,
      });

      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError(
        `فشل استدعاء الذكاء الاصطناعي: ${errorMessage}`,
        { operationName, model, durationMs }
      );
    }
  }

  async chat(
    prompt: string,
    options: Partial<AICallOptions> = {}
  ): Promise<AICallResult<z.infer<typeof ChatResponseSchema>>> {
    return this.call<z.infer<typeof ChatResponseSchema>>({
      ...options,
      prompt,
      operationName: options.operationName || 'chat',
      responseSchema: ChatResponseSchema,
    });
  }

  async embedding(
    prompt: string,
    options: Partial<AICallOptions> = {}
  ): Promise<AICallResult<z.infer<typeof EmbeddingResponseSchema>>> {
    return this.call<z.infer<typeof EmbeddingResponseSchema>>({
      ...options,
      prompt,
      operationName: options.operationName || 'embedding',
      responseSchema: EmbeddingResponseSchema,
      temperature: 0.1,
    });
  }

  async chunking(
    prompt: string,
    options: Partial<AICallOptions> = {}
  ): Promise<AICallResult<z.infer<typeof ChunkingResponseSchema>>> {
    return this.call<z.infer<typeof ChunkingResponseSchema>>({
      ...options,
      prompt,
      operationName: options.operationName || 'chunking',
      responseSchema: ChunkingResponseSchema,
    });
  }
}

export const aiClient = AIClientSingleton.getInstance();
export { AIClientSingleton };
export default aiClient;

