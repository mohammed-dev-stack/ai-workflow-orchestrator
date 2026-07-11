// المسار: backend/src/api/controllers/workflow.controller.ts

import { Request, Response } from 'express';
import { WorkflowService } from '../../services/workflow.service';
import { IWorkflow } from '../../models/Workflow.model';
import { RunStatus, IWorkflowRun } from '../../models/WorkflowRun.model';
import logger from '../../utils/logger';
import { RunWorker } from '../../workers/run.worker';
import { dbHealthCheck, redisHealthCheck } from '../../config';

// ============================================
// TYPES
// ============================================

interface WorkflowFilters {
  isActive?: boolean;
  tags?: string[];
  createdBy?: string;
}

interface RunFilters {
  workflowId?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

interface WorkflowStatsResponse {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  rejectedRuns: number;
  averageLatency: number;
  totalCost: number;
  successRate: number;
}

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  uptime: number;
  mongodb: {
    status: string;
    latency?: number;
    error?: string;
  };
  redis: {
    status: string;
    latency?: number;
    error?: string;
  };
  queue: {
    status: string;
    queueSize?: number;
    workerCount?: number;
    error?: string;
  };
  worker: {
    isRunning: boolean;
    activeJobs: number;
    waitingJobs: number;
    delayedJobs: number;
    failedJobs: number;
  };
}

// ============================================
// CONTROLLER
// ============================================

/**
 * Controller layer for workflow operations
 * Handles HTTP request/response formatting and delegates to service layer
 */
export class WorkflowController {
  // ============================================
  //  WORKFLOW TEMPLATE METHODS
  // ============================================

  static async getWorkflows(filters: WorkflowFilters): Promise<IWorkflow[]> {
    const correlationId = `get-workflows-${Date.now()}`;

    try {
      const workflows = await WorkflowService.getWorkflows(filters);

      logger.info('Workflows retrieved successfully', {
        correlationId,
        count: workflows.length,
        filters,
      });

      return workflows;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting workflows';
      logger.error(`Failed to get workflows: ${message}`, {
        correlationId,
        err: error,
        filters,
      });
      throw error;
    }
  }

  static async getWorkflowById(id: string): Promise<IWorkflow | null> {
    const correlationId = `get-workflow-${id}-${Date.now()}`;

    try {
      const workflow = await WorkflowService.getWorkflowById(id);

      if (!workflow) {
        logger.warn(`Workflow not found: ${id}`, {
          correlationId,
          workflowId: id,
        });
        return null;
      }

      logger.info('Workflow retrieved successfully', {
        correlationId,
        workflowId: id,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting workflow';
      logger.error(`Failed to get workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
      });
      throw error;
    }
  }

  static async createWorkflow(data: Partial<IWorkflow>): Promise<IWorkflow> {
    const correlationId = `create-workflow-${Date.now()}`;

    try {
      // Validate required fields
      if (!data.name || data.name.trim().length === 0) {
        const error = new Error('Workflow name is required and cannot be empty');
        logger.warn('Workflow creation failed: name required', {
          correlationId,
          data,
        });
        throw error;
      }

      if (!data.steps || data.steps.length === 0) {
        const error = new Error('Workflow must have at least one step');
        logger.warn('Workflow creation failed: steps required', {
          correlationId,
          data,
        });
        throw error;
      }

      const workflow = await WorkflowService.createWorkflow(data);

      logger.info('Workflow created successfully', {
        correlationId,
        workflowId: workflow._id,
        workflowName: workflow.name,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error creating workflow';
      logger.error(`Failed to create workflow: ${message}`, {
        correlationId,
        err: error,
        data,
      });
      throw error;
    }
  }

  static async updateWorkflow(id: string, data: Partial<IWorkflow>): Promise<IWorkflow | null> {
    const correlationId = `update-workflow-${id}-${Date.now()}`;

    try {
      const workflow = await WorkflowService.updateWorkflow(id, data);

      if (!workflow) {
        logger.warn(`Workflow not found for update: ${id}`, {
          correlationId,
          workflowId: id,
        });
        return null;
      }

      logger.info('Workflow updated successfully', {
        correlationId,
        workflowId: id,
        workflowName: workflow.name,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error updating workflow';
      logger.error(`Failed to update workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
        data,
      });
      throw error;
    }
  }

  static async deleteWorkflow(id: string): Promise<boolean> {
    const correlationId = `delete-workflow-${id}-${Date.now()}`;

    try {
      const result = await WorkflowService.deleteWorkflow(id);

      logger.info('Workflow deleted successfully', {
        correlationId,
        workflowId: id,
        result,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error deleting workflow';
      logger.error(`Failed to delete workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
      });
      throw error;
    }
  }

  static async executeWorkflow(
    workflowId: string,
    context: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<IWorkflowRun> {
    const correlationId = `execute-workflow-${workflowId}-${Date.now()}`;

    try {
      if (!workflowId || workflowId.trim().length === 0) {
        const error = new Error('Workflow ID is required');
        logger.warn('Workflow execution failed: workflowId required', {
          correlationId,
        });
        throw error;
      }

      const run = await WorkflowService.executeWorkflow(workflowId, context, idempotencyKey);

      logger.info('Workflow executed successfully', {
        correlationId,
        workflowId,
        runId: run._id,
        idempotencyKey: idempotencyKey || 'none',
      });

      return run;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error executing workflow';
      logger.error(`Failed to execute workflow ${workflowId}: ${message}`, {
        correlationId,
        workflowId,
        err: error,
        idempotencyKey: idempotencyKey || 'none',
      });
      throw error;
    }
  }

  static async getWorkflowStats(workflowId: string): Promise<WorkflowStatsResponse> {
    const correlationId = `get-stats-${workflowId}-${Date.now()}`;

    try {
      if (!workflowId || workflowId.trim().length === 0) {
        const error = new Error('Workflow ID is required');
        logger.warn('Workflow stats failed: workflowId required', {
          correlationId,
        });
        throw error;
      }

      const stats = await WorkflowService.getWorkflowStats(workflowId);

      logger.info('Workflow stats retrieved successfully', {
        correlationId,
        workflowId,
        totalRuns: stats.totalRuns,
      });

      return stats;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting stats';
      logger.error(`Failed to get stats for workflow ${workflowId}: ${message}`, {
        correlationId,
        workflowId,
        err: error,
      });
      throw error;
    }
  }

  // ============================================
  //  WORKFLOW RUN METHODS
  // ============================================

  static async getRuns(filters: RunFilters): Promise<{ runs: IWorkflowRun[]; total: number }> {
    const correlationId = `get-runs-${Date.now()}`;

    try {
      const result = await WorkflowService.getRuns(filters);

      logger.info('Runs retrieved successfully', {
        correlationId,
        total: result.total,
        limit: filters.limit || 50,
        offset: filters.offset || 0,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting runs';
      logger.error(`Failed to get runs: ${message}`, {
        correlationId,
        err: error,
        filters,
      });
      throw error;
    }
  }

  static async getRunById(id: string): Promise<IWorkflowRun | null> {
    const correlationId = `get-run-${id}-${Date.now()}`;

    try {
      const run = await WorkflowService.getRunById(id);

      if (!run) {
        logger.warn(`Run not found: ${id}`, {
          correlationId,
          runId: id,
        });
        return null;
      }

      logger.info('Run retrieved successfully', {
        correlationId,
        runId: id,
        status: run.status,
      });

      return run;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting run';
      logger.error(`Failed to get run ${id}: ${message}`, {
        correlationId,
        runId: id,
        err: error,
      });
      throw error;
    }
  }

  static async cancelRun(id: string): Promise<void> {
    const correlationId = `cancel-run-${id}-${Date.now()}`;

    try {
      await WorkflowService.cancelRun(id);

      logger.info('Run cancelled successfully', {
        correlationId,
        runId: id,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error cancelling run';
      logger.error(`Failed to cancel run ${id}: ${message}`, {
        correlationId,
        runId: id,
        err: error,
      });
      throw error;
    }
  }

  // ============================================
  //  APPROVAL METHODS
  // ============================================

  static async getPendingApprovals(): Promise<IWorkflowRun[]> {
    const correlationId = `get-pending-approvals-${Date.now()}`;

    try {
      const approvals = await WorkflowService.getPendingApprovals();

      logger.info('Pending approvals retrieved successfully', {
        correlationId,
        count: approvals.length,
      });

      return approvals;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error getting approvals';
      logger.error(`Failed to get pending approvals: ${message}`, {
        correlationId,
        err: error,
      });
      throw error;
    }
  }

  static async handleApproval(runId: string, approved: boolean, userId: string): Promise<IWorkflowRun> {
    const correlationId = `handle-approval-${runId}-${Date.now()}`;

    try {
      if (!runId || runId.trim().length === 0) {
        const error = new Error('Run ID is required');
        logger.warn('Approval failed: runId required', {
          correlationId,
        });
        throw error;
      }

      if (typeof approved !== 'boolean') {
        const error = new Error('Approved must be a boolean');
        logger.warn('Approval failed: approved must be boolean', {
          correlationId,
          runId,
          approved,
        });
        throw error;
      }

      const run = await WorkflowService.handleApproval(runId, approved, userId);

      logger.info('Approval handled successfully', {
        correlationId,
        runId,
        approved,
        userId,
        newStatus: run.status,
      });

      return run;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error handling approval';
      logger.error(`Failed to handle approval for run ${runId}: ${message}`, {
        correlationId,
        runId,
        err: error,
        approved,
        userId,
      });
      throw error;
    }
  }

  // ============================================
  //  HEALTH CHECK
  // ============================================

  static async healthCheck(): Promise<HealthCheckResponse> {
    const correlationId = `health-check-${Date.now()}`;

    try {
      const [mongoHealth, redisHealth, workerHealth] = await Promise.all([
        dbHealthCheck(),
        redisHealthCheck(),
        RunWorker.healthCheck(),
      ]);

      logger.info('Health check completed successfully', {
        correlationId,
        mongodb: mongoHealth.status,
        redis: redisHealth.status,
        worker: workerHealth.isRunning,
      });

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: {
          status: mongoHealth.status,
          latency: mongoHealth.latency,
          error: mongoHealth.error,
        },
        redis: {
          status: redisHealth.status,
          latency: redisHealth.latency,
          error: redisHealth.error,
        },
        queue: {
          status: 'healthy',
          queueSize: 0,
          workerCount: 1,
          error: undefined,
        },
        worker: {
          isRunning: workerHealth.isRunning,
          activeJobs: workerHealth.activeJobs || 0,
          waitingJobs: workerHealth.waitingJobs || 0,
          delayedJobs: workerHealth.delayedJobs || 0,
          failedJobs: workerHealth.failedJobs || 0,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown health check error';
      logger.error(`Health check failed: ${message}`, {
        correlationId,
        err: error,
      });

      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: { status: 'error', error: message },
        redis: { status: 'error', error: message },
        queue: { status: 'error', error: message },
        worker: {
          isRunning: false,
          activeJobs: 0,
          waitingJobs: 0,
          delayedJobs: 0,
          failedJobs: 0,
        },
      };
    }
  }
}