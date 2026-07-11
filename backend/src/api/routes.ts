// المسار: backend/src/api/routes.ts

import { Router, Request, Response, NextFunction } from 'express';
import { WorkflowController } from './controllers/workflow.controller';
import { SettingsController } from './controllers/settings.controller';
import { RunStatus } from '../models/WorkflowRun.model';

// ============================================
// TYPES
// ============================================

interface AuthenticatedRequest extends Request {
  userId: string;
}

interface RunFilters {
  workflowId?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

// ============================================
// ROUTER INSTANCE
// ============================================

const router = Router();

// ============================================
// MIDDLEWARE: Async handler to avoid try-catch repetition
// ============================================

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const userId = req.headers['user-id'] as string || 'system';
  (req as AuthenticatedRequest).userId = userId;
  next();
};

// Apply authentication middleware to all routes
router.use(authMiddleware);

// ============================================
// WORKFLOW TEMPLATE ROUTES
// ============================================

/**
 * GET /api/workflows
 * Get all workflows with optional filters
 */
router.get(
  '/workflows',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const filters: {
      isActive?: boolean;
      tags?: string[];
      createdBy?: string;
    } = {};

    if (req.query.isActive !== undefined) {
      filters.isActive = req.query.isActive === 'true';
    }

    if (req.query.tags) {
      filters.tags = (req.query.tags as string).split(',');
    }

    if (req.query.createdBy) {
      filters.createdBy = req.query.createdBy as string;
    }

    const workflows = await WorkflowController.getWorkflows(filters);

    res.status(200).json({
      success: true,
      data: workflows,
      meta: {
        count: workflows.length,
      },
    });
  })
);

/**
 * GET /api/workflows/:id
 * Get a single workflow by ID
 */
router.get(
  '/workflows/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    const workflow = await WorkflowController.getWorkflowById(id);

    if (!workflow) {
      res.status(404).json({
        success: false,
        message: `Workflow with ID ${id} not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: workflow,
    });
  })
);

/**
 * POST /api/workflows
 * Create a new workflow template
 */
router.post(
  '/workflows',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const workflowData = { ...req.body, createdBy: userId };

    const workflow = await WorkflowController.createWorkflow(workflowData);

    res.status(201).json({
      success: true,
      data: workflow,
      message: 'Workflow created successfully',
    });
  })
);

/**
 * PUT /api/workflows/:id
 * Update an existing workflow
 */
router.put(
  '/workflows/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    const workflow = await WorkflowController.updateWorkflow(id, req.body);

    if (!workflow) {
      res.status(404).json({
        success: false,
        message: `Workflow with ID ${id} not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: workflow,
      message: 'Workflow updated successfully',
    });
  })
);

/**
 * DELETE /api/workflows/:id
 * Delete (or deactivate) a workflow
 */
router.delete(
  '/workflows/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    const result = await WorkflowController.deleteWorkflow(id);

    if (!result) {
      res.status(404).json({
        success: false,
        message: `Workflow with ID ${id} not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Workflow deleted successfully',
    });
  })
);

/**
 * POST /api/workflows/:id/execute
 * Execute a workflow (create a new run)
 */
router.post(
  '/workflows/:id/execute',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { context, idempotencyKey } = req.body;

    if (!context || typeof context !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Context must be a valid JSON object',
      });
      return;
    }

    const run = await WorkflowController.executeWorkflow(id, context || {}, idempotencyKey);

    res.status(201).json({
      success: true,
      data: run,
      message: 'Workflow execution started',
    });
  })
);

/**
 * GET /api/workflows/:id/stats
 * Get statistics for a workflow
 */
router.get(
  '/workflows/:id/stats',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    const stats = await WorkflowController.getWorkflowStats(id);

    res.status(200).json({
      success: true,
      data: stats,
    });
  })
);

// ============================================
// WORKFLOW RUN ROUTES
// ============================================

/**
 * GET /api/runs
 * Get all runs with optional filters
 */
router.get(
  '/runs',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const filters: RunFilters = {};

    if (req.query.workflowId) {
      filters.workflowId = req.query.workflowId as string;
    }

    if (req.query.status) {
      const statusValue = req.query.status as string;
      if (Object.values(RunStatus).includes(statusValue as RunStatus)) {
        filters.status = statusValue as RunStatus;
      }
    }

    if (req.query.limit) {
      filters.limit = parseInt(req.query.limit as string, 10);
    }

    if (req.query.offset) {
      filters.offset = parseInt(req.query.offset as string, 10);
    }

    const result = await WorkflowController.getRuns(filters);

    res.status(200).json({
      success: true,
      data: result.runs,
      meta: {
        total: result.total,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
      },
    });
  })
);

/**
 * GET /api/runs/:id
 * Get a single run by ID
 */
router.get(
  '/runs/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    const run = await WorkflowController.getRunById(id);

    if (!run) {
      res.status(404).json({
        success: false,
        message: `Run with ID ${id} not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: run,
    });
  })
);

/**
 * POST /api/runs/:id/cancel
 * Cancel a running workflow
 */
router.post(
  '/runs/:id/cancel',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    await WorkflowController.cancelRun(id);

    res.status(200).json({
      success: true,
      message: 'Run cancelled successfully',
    });
  })
);

// ============================================
// APPROVAL ROUTES
// ============================================

/**
 * GET /api/approvals/pending
 * Get all runs pending human approval
 */
router.get(
  '/approvals/pending',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const pending = await WorkflowController.getPendingApprovals();

    res.status(200).json({
      success: true,
      data: pending,
      meta: {
        count: pending.length,
      },
    });
  })
);

/**
 * POST /api/runs/:id/approve
 * Handle approval decision for a run
 */
router.post(
  '/runs/:id/approve',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { approved } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (typeof approved !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Approved must be a boolean value',
      });
      return;
    }

    const run = await WorkflowController.handleApproval(id, approved, userId);

    res.status(200).json({
      success: true,
      data: run,
      message: approved ? 'Approval granted, workflow continuing' : 'Approval rejected, workflow stopped',
    });
  })
);

// ============================================
// HEALTH CHECK ROUTE
// ============================================

/**
 * GET /api/health
 * Basic health check endpoint
 */
router.get(
  '/health',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  })
);

// ============================================
// AI SETTINGS ROUTES
// ============================================

/**
 * GET /api/settings/ai-mode
 * Get current AI mode (mock/real)
 */
router.get(
  '/settings/ai-mode',
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    return await SettingsController.getAIMode(req, res);
  })
);

/**
 * POST /api/settings/ai-mode
 * Change AI mode (mock/real)
 */
router.post(
  '/settings/ai-mode',
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    return await SettingsController.setAIMode(req, res);
  })
);

/**
 * GET /api/settings/ai-status
 * Get detailed AI status with additional information
 */
router.get(
  '/settings/ai-status',
  asyncHandler(async (req: Request, res: Response): Promise<Response> => {
    return await SettingsController.getAIStatus(req, res);
  })
);

// ============================================
// FALLBACK ROUTE (404)
// ============================================

router.all('*', (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ============================================
// EXPORT
// ============================================

export default router;