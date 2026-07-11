// المسار: backend/src/api/controllers/settings.controller.ts

import { Request, Response } from 'express';
import { getAIMode, setAIMode, getModeLabel, getModeDescription, isMockMode } from '../../utils/aiMode';
import logger from '../../utils/logger';

// ============================================
// TYPES
// ============================================

interface AIModeResponseData {
  mode: 'mock' | 'real';
  label: string;
  description: string;
  isMock: boolean;
  isReal: boolean;
}

interface AIModeSetResponseData extends AIModeResponseData {
  message: string;
}

interface AIStatusResponseData {
  mode: 'mock' | 'real';
  label: string;
  description: string;
  isMock: boolean;
  isReal: boolean;
  apiKeyConfigured: boolean;
  apiKeyLength: number;
  model: string;
  instructions: string;
}

// ============================================
// CONTROLLER
// ============================================

export class SettingsController {
  /**
   * GET /api/settings/ai-mode
   * Get current AI mode
   */
  static async getAIMode(req: Request, res: Response): Promise<Response> {
    const correlationId = req.headers['x-request-id'] as string || `req-${Date.now()}`;

    try {
      const mode = getAIMode();

      const responseData: AIModeResponseData = {
        mode,
        label: getModeLabel(),
        description: getModeDescription(),
        isMock: isMockMode(),
        isReal: !isMockMode(),
      };

      logger.info('AI mode retrieved successfully', {
        correlationId,
        mode,
        isMock: isMockMode(),
      });

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error retrieving AI mode';
      logger.error(`Failed to get AI mode: ${message}`, {
        correlationId,
        err: error,
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve AI mode settings',
      });
    }
  }

  /**
   * POST /api/settings/ai-mode
   * Change AI mode (mock/real)
   */
  static async setAIMode(req: Request, res: Response): Promise<Response> {
    const correlationId = req.headers['x-request-id'] as string || `req-${Date.now()}`;

    try {
      const { mode } = req.body;

      // Validate input
      if (!mode || (mode !== 'mock' && mode !== 'real')) {
        logger.warn('Invalid AI mode requested', {
          correlationId,
          mode,
        });

        return res.status(400).json({
          success: false,
          message: 'Invalid mode. Must be "mock" or "real"',
        });
      }

      setAIMode(mode);
      const newMode = getAIMode();

      const responseData: AIModeSetResponseData = {
        mode: newMode,
        label: getModeLabel(),
        description: getModeDescription(),
        isMock: isMockMode(),
        isReal: !isMockMode(),
        message: mode === 'mock'
          ? '🧪 Switched to mock mode (free - no cost)'
          : '🚀 Switched to real mode (paid - uses Claude API)',
      };

      logger.info(`AI mode changed to: ${mode}`, {
        correlationId,
        mode,
        userId: (req as any).userId || 'system',
      });

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error changing AI mode';
      logger.error(`Failed to set AI mode: ${message}`, {
        correlationId,
        err: error,
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to update AI mode settings',
      });
    }
  }

  /**
   * GET /api/settings/ai-status
   * Get AI status with additional details
   */
  static async getAIStatus(req: Request, res: Response): Promise<Response> {
    const correlationId = req.headers['x-request-id'] as string || `req-${Date.now()}`;

    try {
      const mode = getAIMode();
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const model = process.env.AI_MODEL || 'claude-3-5-sonnet-20241022';

      const responseData: AIStatusResponseData = {
        mode,
        label: getModeLabel(),
        description: getModeDescription(),
        isMock: isMockMode(),
        isReal: !isMockMode(),
        apiKeyConfigured: !!apiKey && apiKey.length > 0,
        apiKeyLength: apiKey ? apiKey.length : 0,
        model,
        instructions: isMockMode()
          ? '🧪 Mock mode: All emails and content are generated locally without using the API.'
          : '🚀 Real mode: Claude API is used to generate content (requires valid API key).',
      };

      logger.info('AI status retrieved successfully', {
        correlationId,
        mode,
        apiKeyConfigured: responseData.apiKeyConfigured,
        model,
      });

      return res.status(200).json({
        success: true,
        data: responseData,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error retrieving AI status';
      logger.error(`Failed to get AI status: ${message}`, {
        correlationId,
        err: error,
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve AI status',
      });
    }
  }
}