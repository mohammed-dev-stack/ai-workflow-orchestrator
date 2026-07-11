// المسار: backend/src/services/ai.service.ts

import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger';
import { aiConfig } from '../config';
import { getAIMode, isMockMode, generateMockContent } from '../utils/aiMode';

// ============================================
// TYPES
// ============================================

export interface AIDecision {
  tool: string;
  arguments: Record<string, unknown>;
  is_critical_action: boolean;
  context_update: Record<string, unknown>;
  reasoning: string;
  content?: string;
  mode: 'mock' | 'real';
}

export interface AIEmailResponse {
  content: string;
  mode: 'mock' | 'real';
  model?: string;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

// ============================================
// AI SERVICE
// ============================================

export class AIService {
  private static anthropic: Anthropic | null = null;

  /**
   * Get or initialize Anthropic client
   */
  private static getClient(): Anthropic {
    if (!this.anthropic) {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) {
        throw new Error('ANTHROPIC_API_KEY is not defined in environment variables');
      }
      this.anthropic = new Anthropic({ apiKey: key });
    }
    return this.anthropic;
  }

  /**
   * Generate a decision for the next workflow step
   */
  static async generateDecision(
    context: Record<string, unknown>,
    toolName: string,
    inputTemplate?: Record<string, unknown>
  ): Promise<AIDecision> {
    const mode = getAIMode();
    const correlationId = `ai-decision-${Date.now()}`;

    logger.info('🤖 AI Service: Generating decision', {
      correlationId,
      mode,
      toolName,
      contextKeys: Object.keys(context),
    });

    try {
      if (isMockMode()) {
        return this.generateMockDecision(context, toolName, inputTemplate, correlationId);
      }

      return await this.generateRealDecision(context, toolName, inputTemplate, correlationId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown AI service error';
      logger.error(`❌ AI decision generation failed: ${message}`, {
        correlationId,
        mode,
        err: error,
      });
      // Fallback to mock decision
      return this.generateMockDecision(context, toolName, inputTemplate, correlationId);
    }
  }

  /**
   * Generate an email using AI
   */
  static async generateEmail(context: Record<string, unknown>, subject?: string): Promise<AIEmailResponse> {
    const mode = getAIMode();
    const correlationId = `ai-email-${Date.now()}`;

    logger.info('📧 AI Service: Generating email', {
      correlationId,
      mode,
      subject,
      contextKeys: Object.keys(context),
    });

    try {
      if (isMockMode()) {
        return this.generateMockEmail(context, correlationId);
      }

      return await this.generateRealEmail(context, subject, correlationId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown email generation error';
      logger.error(`❌ AI email generation failed: ${message}`, {
        correlationId,
        mode,
        err: error,
      });
      // Fallback to mock email
      return this.generateMockEmail(context, correlationId);
    }
  }

  /**
   * Get AI service status
   */
  static getStatus(): {
    mode: 'mock' | 'real';
    apiKeyConfigured: boolean;
    model: string;
  } {
    return {
      mode: getAIMode(),
      apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
      model: aiConfig.model || DEFAULT_MODEL,
    };
  }

  // ============================================
  // PRIVATE METHODS - Mock
  // ============================================

  private static generateMockDecision(
    context: Record<string, unknown>,
    toolName: string,
    inputTemplate?: Record<string, unknown>,
    correlationId?: string
  ): AIDecision {
    const content = generateMockContent(context, toolName);

    return {
      tool: toolName,
      arguments: {
        ...inputTemplate,
        to: context.user_email || context.customer_email || 'user@example.com',
        subject: 'مرحباً بك!',
        body: content,
      },
      is_critical_action: toolName === 'send_email' || toolName === 'create_calendar_event',
      context_update: {
        last_action: toolName,
        last_content: content,
        mock: true,
      },
      reasoning: `🧪 Mock mode: Generated content for ${toolName} without using Claude API.`,
      content,
      mode: 'mock',
    };
  }

  private static generateMockEmail(
    context: Record<string, unknown>,
    correlationId?: string
  ): AIEmailResponse {
    const userName = context.user_name || context.customer_name || 'User';
    const email = context.user_email || context.customer_email || 'user@example.com';

    const content = `🧪 [MOCK] مرحباً ${userName}،\n\nشكراً لانضمامك إلينا. نحن سعداء بتواجدك معنا.\n\nهذا إيميل وهمي تم توليده في وضع المحاكاة.\n\nالبريد الإلكتروني: ${email}\n\nفريق الدعم`;

    return {
      content,
      mode: 'mock',
    };
  }

  // ============================================
  // PRIVATE METHODS - Real API
  // ============================================

  private static async generateRealDecision(
    context: Record<string, unknown>,
    toolName: string,
    inputTemplate?: Record<string, unknown>,
    correlationId?: string
  ): Promise<AIDecision> {
    const client = this.getClient();

    const systemPrompt = `
      You are an AI workflow orchestrator.
      You need to generate content for the tool: ${toolName}.
      Context: ${JSON.stringify(context, null, 2)}
      Input Template: ${JSON.stringify(inputTemplate, null, 2)}

      Generate appropriate content based on the context.
      Return valid JSON with the following structure:
      {
        "tool": "${toolName}",
        "arguments": { ... },
        "is_critical_action": true/false,
        "context_update": { ... },
        "reasoning": "..."
      }
    `;

    const response = await client.messages.create({
      model: aiConfig.model || DEFAULT_MODEL,
      max_tokens: aiConfig.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: aiConfig.temperature || DEFAULT_TEMPERATURE,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: 'Generate the next action based on the context.',
        },
      ],
    });

    const contentBlock = response.content[0];
    if (!contentBlock || contentBlock.type !== 'text') {
      throw new Error('Claude returned non-text response');
    }

    const jsonMatch = contentBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain valid JSON');
    }

    const decision = JSON.parse(jsonMatch[0]) as Partial<AIDecision>;

    return {
      tool: decision.tool || toolName,
      arguments: decision.arguments || inputTemplate || {},
      is_critical_action: decision.is_critical_action || toolName === 'send_email',
      context_update: decision.context_update || {},
      reasoning: decision.reasoning || 'Decision generated by Claude AI.',
      content: contentBlock.text,
      mode: 'real',
    };
  }

  private static async generateRealEmail(
    context: Record<string, unknown>,
    subject?: string,
    correlationId?: string
  ): Promise<AIEmailResponse> {
    const client = this.getClient();
    const userName = context.user_name || context.customer_name || 'User';
    const email = context.user_email || context.customer_email || 'user@example.com';

    const response = await client.messages.create({
      model: aiConfig.model || DEFAULT_MODEL,
      max_tokens: aiConfig.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: aiConfig.temperature || DEFAULT_TEMPERATURE,
      system: 'You are a professional email writer. Generate welcome emails for new users.',
      messages: [
        {
          role: 'user',
          content: `Generate a welcome email for ${userName} (${email}). Subject: ${subject || 'Welcome!'}`,
        },
      ],
    });

    const contentBlock = response.content[0];
    if (!contentBlock || contentBlock.type !== 'text') {
      throw new Error('Claude returned non-text response');
    }

    return {
      content: contentBlock.text,
      mode: 'real',
      model: aiConfig.model || DEFAULT_MODEL,
    };
  }
}