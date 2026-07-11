// المسار: backend/src/services/workflow.service.ts

import { Types } from 'mongoose';
import { WorkflowModel, IWorkflow } from '../models/Workflow.model';
import { WorkflowRunModel, IWorkflowRun, RunStatus, IStep } from '../models/WorkflowRun.model';
import { Orchestrator } from '../core/StateMachine.orchestrator';
import { addOrchestrationJob } from '../queues/run.queue';
import logger from '../utils/logger';

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

// ============================================
// CONSTANTS
// ============================================

const MAX_WORKFLOWS_LIMIT = 100;
const MAX_RUNS_LIMIT = 100;
const MAX_STATS_RUNS_LIMIT = 1000;
const PENDING_APPROVALS_LIMIT = 50;

// ============================================
// SERVICE
// ============================================

export class WorkflowService {
  /**
   * Create a new workflow template
   */
  static async createWorkflow(data: Partial<IWorkflow>): Promise<IWorkflow> {
    const correlationId = `create-workflow-${Date.now()}`;

    try {
      const workflow = new WorkflowModel(data);
      await workflow.save();

      logger.info(`✅ Workflow created: ${workflow._id} (${workflow.name})`, {
        correlationId,
        workflowId: workflow._id,
        workflowName: workflow.name,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error creating workflow';
      logger.error(`❌ Failed to create workflow: ${message}`, {
        correlationId,
        err: error,
        data,
      });
      throw error;
    }
  }

  /**
   * Get all workflows with optional filters
   */
  static async getWorkflows(filters: WorkflowFilters = {}): Promise<IWorkflow[]> {
    const correlationId = `get-workflows-${Date.now()}`;

    try {
      const query: Record<string, unknown> = {};

      if (filters.isActive !== undefined) {
        query.isActive = filters.isActive;
      }

      if (filters.tags && filters.tags.length > 0) {
        query.tags = { $in: filters.tags };
      }

      if (filters.createdBy) {
        query.createdBy = filters.createdBy;
      }

      const workflows = await WorkflowModel.find(query)
        .sort({ createdAt: -1 })
        .limit(MAX_WORKFLOWS_LIMIT);

      logger.info(`✅ Retrieved ${workflows.length} workflows`, {
        correlationId,
        count: workflows.length,
        filters,
      });

      return workflows;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching workflows';
      logger.error(`❌ Failed to fetch workflows: ${message}`, {
        correlationId,
        err: error,
        filters,
      });
      throw error;
    }
  }

  /**
   * Get a single workflow by ID
   */
  static async getWorkflowById(id: string): Promise<IWorkflow | null> {
    const correlationId = `get-workflow-${id}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid workflow ID');
      }

      const workflow = await WorkflowModel.findById(id);

      if (!workflow) {
        logger.warn(`Workflow not found: ${id}`, {
          correlationId,
          workflowId: id,
        });
        return null;
      }

      logger.info(`✅ Workflow retrieved: ${id}`, {
        correlationId,
        workflowId: id,
        workflowName: workflow.name,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching workflow';
      logger.error(`❌ Failed to fetch workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Update an existing workflow
   */
  static async updateWorkflow(id: string, data: Partial<IWorkflow>): Promise<IWorkflow | null> {
    const correlationId = `update-workflow-${id}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid workflow ID');
      }

      const workflow = await WorkflowModel.findById(id);

      if (!workflow) {
        logger.warn(`Workflow not found for update: ${id}`, {
          correlationId,
          workflowId: id,
        });
        return null;
      }

      const pendingRuns = await WorkflowRunModel.countDocuments({
        workflowId: id,
        status: { $in: [RunStatus.IDLE, RunStatus.RUNNING, RunStatus.WAITING_APPROVAL] },
      });

      if (pendingRuns > 0) {
        const error = new Error(
          `Cannot update workflow with ${pendingRuns} pending runs. Create a new version instead.`
        );
        logger.warn(`Workflow update blocked: pending runs exist`, {
          correlationId,
          workflowId: id,
          pendingRuns,
        });
        throw error;
      }

      Object.assign(workflow, data);
      await workflow.save();

      logger.info(`✅ Workflow updated: ${id}`, {
        correlationId,
        workflowId: id,
        workflowName: workflow.name,
        version: workflow.version,
      });

      return workflow;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error updating workflow';
      logger.error(`❌ Failed to update workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
        data,
      });
      throw error;
    }
  }

  /**
   * Delete a workflow (soft delete by deactivating)
   */
  static async deleteWorkflow(id: string): Promise<boolean> {
    const correlationId = `delete-workflow-${id}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid workflow ID');
      }

      const workflow = await WorkflowModel.findById(id);

      if (!workflow) {
        logger.warn(`Workflow not found for deletion: ${id}`, {
          correlationId,
          workflowId: id,
        });
        return false;
      }

      const runCount = await WorkflowRunModel.countDocuments({ workflowId: id });

      if (runCount > 0) {
        workflow.isActive = false;
        await workflow.save();

        logger.info(`⚠️ Workflow ${id} deactivated (has ${runCount} historical runs)`, {
          correlationId,
          workflowId: id,
          runCount,
        });
        return true;
      }

      await workflow.deleteOne();

      logger.info(`🗑️ Workflow ${id} permanently deleted`, {
        correlationId,
        workflowId: id,
      });

      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error deleting workflow';
      logger.error(`❌ Failed to delete workflow ${id}: ${message}`, {
        correlationId,
        workflowId: id,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Execute a workflow with given context
   * This creates a new run and starts the orchestration
   */
  static async executeWorkflow(
    workflowId: string,
    context: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<IWorkflowRun> {
    const correlationId = `execute-workflow-${workflowId}-${Date.now()}`;

    try {
      const workflow = await WorkflowModel.findOne({ _id: workflowId, isActive: true });

      if (!workflow) {
        const error = new Error(`Active workflow not found: ${workflowId}`);
        logger.warn(`Workflow execution failed: workflow not found or inactive`, {
          correlationId,
          workflowId,
        });
        throw error;
      }

      const runIdempotencyKey = idempotencyKey || `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const existingRun = await WorkflowRunModel.findOne({ idempotencyKey: runIdempotencyKey });

      if (existingRun) {
        logger.info(`🔄 Idempotent request: returning existing run ${existingRun._id}`, {
          correlationId,
          workflowId,
          runId: existingRun._id,
          idempotencyKey: runIdempotencyKey,
        });
        return existingRun;
      }

      const initialSteps: IStep[] = workflow.steps.map((templateStep) => {
        const resolvedInput = this.resolveTemplate(templateStep.inputTemplate, context);

        return {
          stepId: templateStep.stepId,
          toolName: templateStep.toolName,
          input: resolvedInput as Record<string, unknown>,
          status: 'pending' as const,
          requiresApproval: templateStep.requiresApproval,
          retryCount: 0,
          startedAt: new Date(),
        };
      });

      const run = new WorkflowRunModel({
        workflowId: workflow._id.toString(),
        idempotencyKey: runIdempotencyKey,
        status: RunStatus.IDLE,
        context,
        steps: initialSteps,
        currentStepIndex: 0,
        totalCost: 0,
        latencyMs: 0,
      });

      await run.save();

      logger.info(`🚀 Workflow run created: ${run._id} for workflow ${workflowId}`, {
        correlationId,
        workflowId,
        runId: run._id,
        idempotencyKey: runIdempotencyKey,
        stepCount: initialSteps.length,
      });

      await addOrchestrationJob(run._id.toString());

      return run;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error executing workflow';
      logger.error(`❌ Failed to execute workflow ${workflowId}: ${message}`, {
        correlationId,
        workflowId,
        err: error,
        idempotencyKey: idempotencyKey || 'none',
      });
      throw error;
    }
  }

  /**
   * Get all runs with optional filters
   */
  static async getRuns(filters: RunFilters = {}): Promise<{ runs: IWorkflowRun[]; total: number }> {
    const correlationId = `get-runs-${Date.now()}`;

    try {
      const query: Record<string, unknown> = {};

      if (filters.workflowId) {
        query.workflowId = filters.workflowId;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const limit = Math.min(filters.limit || 50, MAX_RUNS_LIMIT);
      const skip = filters.offset || 0;

      const [runs, total] = await Promise.all([
        WorkflowRunModel.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        WorkflowRunModel.countDocuments(query),
      ]);

      logger.info(`✅ Retrieved ${runs.length} runs (total: ${total})`, {
        correlationId,
        count: runs.length,
        total,
        limit,
        skip,
        filters,
      });

      return { runs, total };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching runs';
      logger.error(`❌ Failed to fetch runs: ${message}`, {
        correlationId,
        err: error,
        filters,
      });
      throw error;
    }
  }

  /**
   * Get a single run by ID
   */
  static async getRunById(id: string): Promise<IWorkflowRun | null> {
    const correlationId = `get-run-${id}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(id)) {
        throw new Error('Invalid run ID');
      }

      const run = await WorkflowRunModel.findById(id);

      if (!run) {
        logger.warn(`Run not found: ${id}`, {
          correlationId,
          runId: id,
        });
        return null;
      }

      logger.info(`✅ Run retrieved: ${id}`, {
        correlationId,
        runId: id,
        status: run.status,
      });

      return run;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching run';
      logger.error(`❌ Failed to fetch run ${id}: ${message}`, {
        correlationId,
        runId: id,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Get pending approvals
   */
  static async getPendingApprovals(): Promise<IWorkflowRun[]> {
    const correlationId = `get-pending-approvals-${Date.now()}`;

    try {
      const approvals = await WorkflowRunModel.find({ status: RunStatus.WAITING_APPROVAL })
        .sort({ createdAt: 1 })
        .limit(PENDING_APPROVALS_LIMIT);

      logger.info(`✅ Retrieved ${approvals.length} pending approvals`, {
        correlationId,
        count: approvals.length,
      });

      return approvals;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching pending approvals';
      logger.error(`❌ Failed to fetch pending approvals: ${message}`, {
        correlationId,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Handle approval decision from human
   */
  static async handleApproval(runId: string, approved: boolean, userId: string): Promise<IWorkflowRun> {
    const correlationId = `handle-approval-${runId}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(runId)) {
        throw new Error('Invalid run ID');
      }

      const run = await WorkflowRunModel.findById(runId);

      if (!run) {
        const error = new Error(`Run not found: ${runId}`);
        logger.warn(`Approval failed: run not found`, {
          correlationId,
          runId,
        });
        throw error;
      }

      if (run.status !== RunStatus.WAITING_APPROVAL) {
        const error = new Error(`Run ${runId} is not waiting for approval (status: ${run.status})`);
        logger.warn(`Approval failed: run not waiting for approval`, {
          correlationId,
          runId,
          currentStatus: run.status,
        });
        throw error;
      }

      await Orchestrator.handleApproval(runId, approved, userId);

      const updatedRun = await WorkflowRunModel.findById(runId);

      if (!updatedRun) {
        throw new Error(`Failed to fetch updated run ${runId}`);
      }

      logger.info(`✅ Approval handled for run ${runId}`, {
        correlationId,
        runId,
        approved,
        userId,
        newStatus: updatedRun.status,
      });

      return updatedRun;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error handling approval';
      logger.error(`❌ Failed to handle approval for run ${runId}: ${message}`, {
        correlationId,
        runId,
        err: error,
        approved,
        userId,
      });
      throw error;
    }
  }

  /**
   * Get aggregated statistics for a workflow
   */
  static async getWorkflowStats(workflowId: string): Promise<WorkflowStatsResponse> {
    const correlationId = `get-stats-${workflowId}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(workflowId)) {
        throw new Error('Invalid workflow ID');
      }

      const [total, completed, failed, rejected, runs] = await Promise.all([
        WorkflowRunModel.countDocuments({ workflowId }),
        WorkflowRunModel.countDocuments({ workflowId, status: RunStatus.COMPLETED }),
        WorkflowRunModel.countDocuments({ workflowId, status: RunStatus.FAILED }),
        WorkflowRunModel.countDocuments({ workflowId, status: RunStatus.REJECTED }),
        WorkflowRunModel.find({ workflowId, status: RunStatus.COMPLETED })
          .select('latencyMs totalCost')
          .limit(MAX_STATS_RUNS_LIMIT),
      ]);

      const avgLatency = runs.length > 0
        ? runs.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / runs.length
        : 0;

      const avgCost = runs.length > 0
        ? runs.reduce((sum, r) => sum + (r.totalCost || 0), 0) / runs.length
        : 0;

      const completedCount = completed || 0;
      const totalCompleted = completedCount + (failed || 0) + (rejected || 0);
      const successRate = totalCompleted > 0 ? (completedCount / totalCompleted) * 100 : 0;

      const stats: WorkflowStatsResponse = {
        totalRuns: total || 0,
        completedRuns: completedCount,
        failedRuns: failed || 0,
        rejectedRuns: rejected || 0,
        averageLatency: avgLatency,
        totalCost: avgCost * (total || 0),
        successRate,
      };

      logger.info(`✅ Workflow stats retrieved for ${workflowId}`, {
        correlationId,
        workflowId,
        totalRuns: stats.totalRuns,
        successRate: stats.successRate,
      });

      return stats;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error fetching stats';
      logger.error(`❌ Failed to get stats for workflow ${workflowId}: ${message}`, {
        correlationId,
        workflowId,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Cancel a running workflow
   */
  static async cancelRun(runId: string): Promise<void> {
    const correlationId = `cancel-run-${runId}-${Date.now()}`;

    try {
      if (!Types.ObjectId.isValid(runId)) {
        throw new Error('Invalid run ID');
      }

      const run = await WorkflowRunModel.findById(runId);

      if (!run) {
        const error = new Error(`Run not found: ${runId}`);
        logger.warn(`Cancel failed: run not found`, {
          correlationId,
          runId,
        });
        throw error;
      }

      if (run.status === RunStatus.COMPLETED || run.status === RunStatus.FAILED || run.status === RunStatus.REJECTED) {
        const error = new Error(`Run ${runId} is already finished (status: ${run.status})`);
        logger.warn(`Cancel failed: run already finished`, {
          correlationId,
          runId,
          status: run.status,
        });
        throw error;
      }

      run.status = RunStatus.FAILED;
      run.errorMessage = 'Cancelled by user';
      await run.save();

      logger.info(`🛑 Run ${runId} cancelled by user`, {
        correlationId,
        runId,
        userId: 'system',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error cancelling run';
      logger.error(`❌ Failed to cancel run ${runId}: ${message}`, {
        correlationId,
        runId,
        err: error,
      });
      throw error;
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Resolve template variables in input
   * Supports {{context.key}} and {{context.nested.key}} syntax
   */
  private static resolveTemplate(template: unknown, context: Record<string, unknown>): unknown {
    if (typeof template === 'string') {
      return template.replace(/\{\{context\.([^}]+)\}\}/g, (match, path) => {
        const value = this.getValueByPath(context, path.trim());
        return value !== undefined ? String(value) : match;
      });
    }

    if (Array.isArray(template)) {
      return template.map((item) => this.resolveTemplate(item, context));
    }

    if (typeof template === 'object' && template !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.resolveTemplate(value, context);
      }
      return result;
    }

    return template;
  }

  /**
   * Get value from nested object by dot notation path
   */
  private static getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}