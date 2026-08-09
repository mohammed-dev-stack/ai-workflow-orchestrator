// المسار: backend/src/api/controllers/AISettings.ts

import { Request, Response } from 'express';
import { getAIMode, setAIMode, getModeLabel, getModeDescription } from '../../utils/aiMode';
import logger from '../../utils/logger';

// ============================================
// TYPES
// ============================================

interface AIModeResponse {
  mode: 'mock' | 'real';
  label: string;
  description: string;
  isMock: boolean;
  isReal: boolean;
}

interface AIStatusResponse {
  mode: 'mock' | 'real';
  label: string;
  description: string;
  apiKeyConfigured: boolean;
  model: string;
}

// ============================================
// CONTROLLER
// ============================================

export class AISettingsController {
  /**
   * GET /api/settings/ai-mode
   * Get current AI mode
   */
  static async getAIMode(req: Request, res: Response): Promise<Response> {
    const correlationId = req.headers['x-request-id'] as string || `req-${Date.now()}`;

    try {
      const mode = getAIMode();

      const response: AIModeResponse = {
        mode,
        label: getModeLabel(),
        description: getModeDescription(),
        isMock: mode === 'mock',
        isReal: mode === 'real',
      };

      logger.info('AI mode retrieved successfully', {
        correlationId,
        mode,
      });

      return res.status(200).json({
        success: true,
        data: response,
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

      const response: AIModeResponse = {
        mode: newMode,
        label: getModeLabel(),
        description: getModeDescription(),
        isMock: newMode === 'mock',
        isReal: newMode === 'real',
      };

      const successMessage = newMode === 'mock'
        ? '🧪 Switched to mock mode (free - no cost)'
        : '🚀 Switched to real mode (paid - uses Claude API)';

      logger.info(`AI mode changed to: ${mode}`, {
        correlationId,
        mode,
        userId: (req as any).userId || 'system',
      });

      return res.status(200).json({
        success: true,
        data: {
          ...response,
          message: successMessage,
        },
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

      const response: AIStatusResponse = {
        mode,
        label: getModeLabel(),
        description: getModeDescription(),
        apiKeyConfigured: !!apiKey && apiKey.length > 0,
        model,
      };

      logger.info('AI status retrieved successfully', {
        correlationId,
        mode,
        apiKeyConfigured: response.apiKeyConfigured,
        model,
      });

      return res.status(200).json({
        success: true,
        data: response,
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

// ============================================
// DEFAULT EXPORT (Legacy compatibility)
// ============================================

export default AISettingsController;