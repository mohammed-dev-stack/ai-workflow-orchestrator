// المسار: backend/src/core/StateMachine.orchestrator.ts

import Anthropic from '@anthropic-ai/sdk';
import { WorkflowRunModel, RunStatus, IWorkflowRun, IStep } from '../models/WorkflowRun.model';
import { runQueue } from '../queues/run.queue';
import logger from '../utils/logger';
import { aiConfig } from '../config';
import { getAIMode, isMockMode } from '../utils/aiMode';

// ============================================
// TYPES
// ============================================

interface ToolExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface ClaudeDecision {
  tool: string;
  arguments: Record<string, unknown>;
  is_critical_action: boolean;
  context_update: Record<string, unknown>;
  reasoning: string;
}

// ============================================
// CONSTANTS
// ============================================

const MAX_RETRIES = 3;
const MAX_LOOP_ITERATIONS = 50;
const RETRY_BACKOFF_BASE_MS = 5000;
const CONTINUATION_DELAY_MS = 100;

// ============================================
// ORCHESTRATOR CLASS
// ============================================

export class Orchestrator {
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
   * Main entry point for processing a workflow run
   * This method is idempotent and can be called multiple times safely
   */
  static async process(runId: string): Promise<void> {
    const correlationId = `orchestrator-${runId}-${Date.now()}`;

    try {
      logger.info(`🔄 Orchestrator processing run: ${runId}`, {
        correlationId,
        runId,
      });

      // Fetch the run with optimistic locking to prevent race conditions
      const run = await WorkflowRunModel.findById(runId);
      if (!run) {
        logger.warn(`Run not found: ${runId}`, { correlationId, runId });
        return;
      }

      // Idempotency check: Skip if already completed, failed, or rejected
      if (
        run.status === RunStatus.COMPLETED ||
        run.status === RunStatus.FAILED ||
        run.status === RunStatus.REJECTED
      ) {
        logger.info(`⏭️ Skipping run ${runId} - Status: ${run.status}`, {
          correlationId,
          runId,
          status: run.status,
        });
        return;
      }

      // If waiting for approval, don't process further - wait for webhook
      if (run.status === RunStatus.WAITING_APPROVAL) {
        logger.info(`⏳ Run ${runId} is waiting for human approval`, {
          correlationId,
          runId,
        });
        await this.notifyApproval(run, correlationId);
        return;
      }

      // Update status to RUNNING if not already
      if (run.status !== RunStatus.RUNNING) {
        run.status = RunStatus.RUNNING;
        await run.save();
      }

      // Main processing loop
      let loopGuard = 0;

      while (loopGuard < MAX_LOOP_ITERATIONS) {
        loopGuard += 1;

        // Check if we've completed all steps
        if (run.currentStepIndex >= run.steps.length) {
          run.status = RunStatus.COMPLETED;
          run.latencyMs = Date.now() - run.createdAt.getTime();
          await run.save();
          logger.info(`✅ Run ${runId} completed successfully`, {
            correlationId,
            runId,
            latencyMs: run.latencyMs,
          });
          return;
        }

        // Get current step
        const currentStep = run.steps[run.currentStepIndex];

        if (!currentStep) {
          run.currentStepIndex += 1;
          await run.save();
          continue;
        }

        // If current step needs approval and is pending, transition to WAITING_APPROVAL
        if (currentStep.status === 'pending' && currentStep.requiresApproval === true) {
          run.status = RunStatus.WAITING_APPROVAL;
          await run.save();
          await this.notifyApproval(run, correlationId);
          logger.info(`🔔 Run ${runId} waiting for approval at step ${run.currentStepIndex}`, {
            correlationId,
            runId,
            stepIndex: run.currentStepIndex,
            toolName: currentStep.toolName,
          });
          return;
        }

        // If current step is already executed, move to next index
        if (currentStep.status === 'executed') {
          run.currentStepIndex += 1;
          await run.save();
          continue;
        }

        // If current step failed, handle retry
        if (currentStep.status === 'failed') {
          const shouldRetry = await this.handleRetry(run, currentStep, correlationId);
          if (shouldRetry) {
            return;
          }
          continue;
        }

        // Decision point: Ask Claude what to do next
        // This only happens for 'pending' steps without requiring approval
        if (currentStep.status === 'pending' && !currentStep.requiresApproval) {
          const shouldContinue = await this.processPendingStep(run, currentStep, correlationId);
          if (!shouldContinue) {
            return;
          }
          continue;
        }

        // Safety valve
        if (loopGuard >= MAX_LOOP_ITERATIONS) {
          run.status = RunStatus.FAILED;
          run.errorMessage = 'Infinite loop detected, exceeded max iterations';
          await run.save();
          logger.error(`❌ Run ${runId} failed: ${run.errorMessage}`, {
            correlationId,
            runId,
            loopGuard,
          });
          return;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error in orchestrator';
      logger.error(`❌ Orchestrator critical error for run ${runId}: ${message}`, {
        correlationId,
        runId,
        err: error,
      });
      // Attempt to mark the run as failed
      try {
        const run = await WorkflowRunModel.findById(runId);
        if (run) {
          run.status = RunStatus.FAILED;
          run.errorMessage = `Orchestrator error: ${message}`;
          await run.save();
        }
      } catch (saveError: unknown) {
        const saveMessage = saveError instanceof Error ? saveError.message : 'Unknown save error';
        logger.error(`❌ Failed to update run status after orchestrator error: ${saveMessage}`, {
          correlationId,
          runId,
          err: saveError,
        });
      }
    }
  }

  /**
   * Handle human approval decision
   * Called via API endpoint when a user approves or rejects a pending step
   */
  static async handleApproval(runId: string, approved: boolean, userId: string): Promise<void> {
    const correlationId = `approval-${runId}-${Date.now()}`;

    try {
      logger.info(`👤 Approval decision for run ${runId}: ${approved ? 'APPROVED' : 'REJECTED'} by ${userId}`, {
        correlationId,
        runId,
        approved,
        userId,
      });

      const run = await WorkflowRunModel.findById(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      if (run.status !== RunStatus.WAITING_APPROVAL) {
        throw new Error(`Run ${runId} is not waiting for approval (status: ${run.status})`);
      }

      const currentStep = run.steps[run.currentStepIndex];
      if (!currentStep || !currentStep.requiresApproval) {
        throw new Error(`No pending approval step found at index ${run.currentStepIndex}`);
      }

      if (approved) {
        await this.executeApprovedStep(run, currentStep, userId, correlationId);
      } else {
        await this.rejectStep(run, currentStep, userId, correlationId);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown approval error';
      logger.error(`❌ Approval error for run ${runId}: ${message}`, {
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

  private static async handleRetry(
    run: IWorkflowRun,
    step: IStep,
    correlationId: string
  ): Promise<boolean> {
    if (step.retryCount < MAX_RETRIES) {
      step.retryCount += 1;
      const delay = Math.min(RETRY_BACKOFF_BASE_MS * Math.pow(2, step.retryCount), 30000);
      logger.info(`🔄 Retrying step ${step.stepId} (attempt ${step.retryCount}) in ${delay}ms`, {
        correlationId,
        runId: run._id.toString(),
        stepId: step.stepId,
        retryCount: step.retryCount,
        delay,
      });
      await run.save();
      await runQueue.add('retry-step', { runId: run._id.toString() }, { delay });
      return true;
    }

    // Max retries exceeded
    run.status = RunStatus.FAILED;
    run.errorMessage = `Step ${step.stepId} failed after ${step.retryCount} retries`;
    await run.save();
    logger.error(`❌ Run ${run._id} failed: ${run.errorMessage}`, {
      correlationId,
      runId: run._id.toString(),
      stepId: step.stepId,
      retryCount: step.retryCount,
    });
    return false;
  }

  private static async processPendingStep(
    run: IWorkflowRun,
    step: IStep,
    correlationId: string
  ): Promise<boolean> {
    try {
      const decision = await this.callClaude(run.context, run.steps, correlationId);

      const newStep: IStep = {
        stepId: `step_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        toolName: decision.tool,
        input: decision.arguments,
        requiresApproval: decision.is_critical_action,
        status: 'pending',
        retryCount: 0,
        startedAt: new Date(),
      };

      run.steps.push(newStep);
      run.context = { ...run.context, ...decision.context_update };
      await run.save();

      // If the new step requires approval, we'll handle it in the next loop iteration
      if (decision.is_critical_action) {
        // Schedule a continuation to check for approval
        await runQueue.add('continue-run', { runId: run._id.toString() }, { delay: CONTINUATION_DELAY_MS });
        return false;
      }

      // Otherwise, execute the tool directly
      const result = await this.executeTool(newStep.toolName, newStep.input, correlationId);

      // Update step with execution result
      const stepToUpdate = run.steps[run.steps.length - 1];
      if (stepToUpdate) {
        stepToUpdate.status = 'executed';
        stepToUpdate.output = result.data || { success: true };
        stepToUpdate.finishedAt = new Date();
      }

      // Increment current step index
      run.currentStepIndex += 1;
      await run.save();

      // Add to queue for next iteration
      await runQueue.add('continue-run', { runId: run._id.toString() }, { delay: CONTINUATION_DELAY_MS });
      return false;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error in pending step';
      logger.error(`❌ Error during decision/execution for run ${run._id}: ${message}`, {
        correlationId,
        runId: run._id.toString(),
        err: error,
      });
      step.status = 'failed';
      step.output = { error: message };
      await run.save();
      return true; // Continue loop to handle retry logic
    }
  }

  private static async executeApprovedStep(
    run: IWorkflowRun,
    step: IStep,
    userId: string,
    correlationId: string
  ): Promise<void> {
    try {
      const result = await this.executeTool(step.toolName, step.input, correlationId);

      step.status = 'executed';
      step.approvedBy = userId;
      step.output = result.data || { success: true };
      step.finishedAt = new Date();

      run.currentStepIndex += 1;
      run.status = RunStatus.RUNNING;
      run.context = {
        ...run.context,
        last_approved_action: step.toolName,
        last_approved_result: result.data,
      };

      await run.save();

      // Schedule continuation
      await runQueue.add('continue-run', { runId: run._id.toString() }, { delay: CONTINUATION_DELAY_MS });

      logger.info(`✅ Run ${run._id} approved and continuing`, {
        correlationId,
        runId: run._id.toString(),
        userId,
        toolName: step.toolName,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown tool execution error';
      logger.error(`❌ Failed to execute approved tool for run ${run._id}: ${message}`, {
        correlationId,
        runId: run._id.toString(),
        userId,
        toolName: step.toolName,
        err: error,
      });
      step.status = 'failed';
      step.output = { error: message };
      run.status = RunStatus.FAILED;
      run.errorMessage = `Tool execution failed after approval: ${message}`;
      await run.save();
      throw error;
    }
  }

  private static async rejectStep(
    run: IWorkflowRun,
    step: IStep,
    userId: string,
    correlationId: string
  ): Promise<void> {
    step.status = 'failed';
    step.approvedBy = userId;
    step.output = { rejected: true, reason: 'User rejected the action' };
    run.status = RunStatus.REJECTED;
    run.errorMessage = 'Workflow rejected by user';
    await run.save();

    logger.info(`❌ Run ${run._id} rejected by user ${userId}`, {
      correlationId,
      runId: run._id.toString(),
      userId,
      toolName: step.toolName,
    });
  }

  /**
   * Call Claude API to decide the next tool to execute
   * Falls back to mock mode if configured
   */
  private static async callClaude(
    context: Record<string, unknown>,
    steps: IStep[],
    correlationId: string
  ): Promise<ClaudeDecision> {
    const mode = getAIMode();

    // If in mock mode, return a mock decision
    if (isMockMode()) {
      logger.info('🧪 Using mock Claude decision', {
        correlationId,
        mode: 'mock',
      });
      return this.getMockDecision(context);
    }

    // In production, we would call the actual Claude API here
    // For now, return a mock decision with a warning
    logger.warn('⚠️ Real Claude API not implemented in this version, falling back to mock', {
      correlationId,
      mode,
    });

    return this.getMockDecision(context);
  }

  /**
   * Get a mock decision for testing without Claude API
   */
  private static getMockDecision(context: Record<string, unknown>): ClaudeDecision {
    // Determine if the action should be critical based on context
    const isCritical = context.user_email !== undefined || context.customer_email !== undefined;

    return {
      tool: 'send_email',
      arguments: {
        to: context.user_email || context.customer_email || 'test@example.com',
        subject: 'مرحباً بك!',
        body: `أهلاً ${context.user_name || context.customer_name || 'User'}،\n\nشكراً لانضمامك إلينا. نحن سعداء بتواجدك معنا.\n\nفريق الدعم`,
      },
      is_critical_action: isCritical,
      context_update: {
        last_action: 'send_email',
        mock_decision: true,
      },
      reasoning: 'Mock decision: Send welcome email to the new user.',
    };
  }

  /**
   * Execute a specific tool with the given input
   * This is the integration layer with external services
   */
  private static async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    correlationId: string
  ): Promise<ToolExecutionResult> {
    logger.info(`🔧 Executing tool: ${toolName}`, {
      correlationId,
      toolName,
      input,
    });

    // Simulate tool execution - in production, integrate with actual APIs
    // For MVP, we'll return mock responses
    await this.simulateAsyncOperation(200, 800);

    const mockResponses: Record<string, ToolExecutionResult> = {
      send_email: {
        success: true,
        data: {
          messageId: `msg_${Date.now()}`,
          to: input.to as string || 'unknown',
          subject: input.subject as string || 'No subject',
          sentAt: new Date().toISOString(),
        },
      },
      create_calendar_event: {
        success: true,
        data: {
          eventId: `evt_${Date.now()}`,
          title: input.title as string || 'Untitled Event',
          startTime: input.startTime as string || new Date().toISOString(),
          endTime: input.endTime as string || new Date().toISOString(),
          htmlLink: `https://calendar.google.com/event/${Date.now()}`,
        },
      },
      create_jira_ticket: {
        success: true,
        data: {
          ticketKey: `PROJ-${Math.floor(Math.random() * 10000)}`,
          summary: input.summary as string || 'No summary',
          priority: input.priority as string || 'Medium',
          url: `https://your-domain.atlassian.net/browse/PROJ-${Math.floor(Math.random() * 10000)}`,
        },
      },
    };

    return mockResponses[toolName] || {
      success: true,
      data: { message: `Mock execution of ${toolName} completed successfully.` },
    };
  }

  /**
   * Simulate async operation for development
   */
  private static async simulateAsyncOperation(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Send notification to human approvers (Slack/Email)
   */
  private static async notifyApproval(run: IWorkflowRun, correlationId: string): Promise<void> {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    const currentStep = run.steps[run.currentStepIndex];

    if (!slackWebhookUrl) {
      logger.warn('⚠️ SLACK_WEBHOOK_URL not configured, skipping notification', {
        correlationId,
        runId: run._id.toString(),
      });
      return;
    }

    try {
      const payload = {
        text: `🔔 *Human Approval Required*\n\n` +
          `*Workflow:* ${run.workflowId}\n` +
          `*Step:* ${currentStep?.toolName || 'Unknown'}\n` +
          `*Context:* ${JSON.stringify(run.context, null, 2)}\n` +
          `*Reasoning:* ${(currentStep?.input as Record<string, unknown>)?.reasoning || 'No reasoning provided'}\n\n` +
          `Approve: http://localhost:5173/inbox\n` +
          `Run ID: ${run._id}`,
        mrkdwn: true,
      };

      await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      logger.info(`✅ Approval notification sent for run ${run._id}`, {
        correlationId,
        runId: run._id.toString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown notification error';
      logger.error(`❌ Failed to send approval notification: ${message}`, {
        correlationId,
        runId: run._id.toString(),
        err: error,
      });
      // Don't throw - workflow should still proceed
    }
  }
}