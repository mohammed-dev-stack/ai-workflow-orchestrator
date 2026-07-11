// المسار: backend/src/utils/aiMode.ts

import aiConfig from '../config/ai.config';
import logger from './logger';

// ============================================
// TYPES
// ============================================

export type AIMode = 'mock' | 'real';

// ============================================
// STATE
// ============================================

let currentMode: AIMode = aiConfig.mode;

// ============================================
// GETTERS & SETTERS
// ============================================

export const getAIMode = (): AIMode => currentMode;

export const setAIMode = (mode: AIMode): void => {
  currentMode = mode;
  logger.info(`🔄 AI Mode changed to: ${mode.toUpperCase()}`);
};

export const isMockMode = (): boolean => currentMode === 'mock';
export const isRealMode = (): boolean => currentMode === 'real';

// ============================================
// LABELS & DESCRIPTIONS
// ============================================

export const getModeLabel = (): string => {
  return currentMode === 'mock'
    ? '🧪 Mock (Free - No Cost)'
    : '🚀 Real (Paid - Uses Claude API)';
};

export const getModeDescription = (): string => {
  return currentMode === 'mock'
    ? 'Mock mode • No cost • Does not use Claude API • Suitable for testing and development'
    : 'Real mode • Costs apply • Uses Claude API • Suitable for production and actual operations';
};

export const getModeArabicLabel = (): string => {
  return currentMode === 'mock'
    ? '🧪 محاكاة (مجاني - بدون تكلفة)'
    : '🚀 حقيقي (مدفوع - يستخدم Claude API)';
};

export const getModeArabicDescription = (): string => {
  return currentMode === 'mock'
    ? 'محاكاة مجانية • بدون تكلفة • لا يستخدم Claude API • مناسب للتجربة والاختبار'
    : 'API حقيقي • بتكلفة • يستخدم Claude API • مناسب للإنتاج والتشغيل الفعلي';
};

// ============================================
// MOCK CONTENT GENERATOR
// ============================================

interface MockContentContext {
  user_email?: string;
  user_name?: string;
  customer_email?: string;
  customer_name?: string;
  meeting_start?: string;
  details?: string;
  [key: string]: unknown;
}

/**
 * Generate mock content for different tools
 * Used when AI mode is set to 'mock'
 */
export const generateMockContent = (
  context: MockContentContext,
  toolName: string
): string => {
  const userEmail = context.user_email || context.customer_email || 'user@example.com';
  const userName = context.user_name || context.customer_name || 'User';
  const customerName = context.customer_name || 'العميل';
  const meetingStart = context.meeting_start || '2026-07-10T10:00:00Z';
  const details = context.details || 'تفاصيل الطلب';

  const mockResponses: Record<string, string> = {
    send_email: `
      To: ${userEmail}
      Subject: Welcome!
      Content: Hello ${userName},

      Thank you for joining us. We are happy to have you with us.

      Support Team
    `,
    create_calendar_event: `
      Appointment booked:
      Title: Meeting with ${customerName}
      Time: ${meetingStart}
      Attendees: ${userEmail}
    `,
    create_jira_ticket: `
      Ticket created:
      Summary: Request from ${userName}
      Priority: Medium
      Details: ${details}
    `,
  };

  return mockResponses[toolName] || '✅ Mock response generated successfully.';
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get AI mode configuration summary
 */
export const getAIModeSummary = (): {
  mode: AIMode;
  label: string;
  description: string;
  isMock: boolean;
  isReal: boolean;
} => {
  return {
    mode: currentMode,
    label: getModeLabel(),
    description: getModeDescription(),
    isMock: isMockMode(),
    isReal: isRealMode(),
  };
};

/**
 * Get AI mode status for health checks
 */
export const getAIModeStatus = (): {
  mode: AIMode;
  apiKeyConfigured: boolean;
  model: string;
} => {
  return {
    mode: currentMode,
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    model: aiConfig.model,
  };
};

/**
 * Validate if the current mode can actually use the API
 * Returns true if:
 * - Mode is 'mock' (always works)
 * - Mode is 'real' and API key is configured
 */
export const isAIAvailable = (): boolean => {
  if (isMockMode()) {
    return true;
  }

  // Real mode requires API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return !!apiKey && apiKey.length > 0;
};

/**
 * Get a warning message if AI is not available
 */
export const getAIAvailabilityWarning = (): string | null => {
  if (isMockMode()) {
    return null;
  }

  if (!isAIAvailable()) {
    return '⚠️ Real mode selected but ANTHROPIC_API_KEY is missing or invalid. Falling back to mock mode.';
  }

  return null;
};