// المسار: backend/src/queues/run.queue.ts

import { Queue, Job } from 'bullmq';
import logger from '../utils/logger';

export const QUEUE_NAMES = {
  ORCHESTRATION: 'orchestration-queue',
  CONTINUE_RUN: 'continue-run',
  RETRY_STEP: 'retry-step',
  CHECK_APPROVAL: 'check-approval',
} as const;

export type QueueJobData = {
  runId: string;
};

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_BACKOFF_DELAY_MS = 2000;
const MAX_RETRY_ATTEMPTS = 5;

const getRedisConnection = () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times: number): number => {
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 3,
});

export const runQueue = new Queue<QueueJobData>(QUEUE_NAMES.ORCHESTRATION, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: DEFAULT_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: DEFAULT_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
      count: 5000,
    },
  },
});

// Queue event handlers
runQueue.on('error', (err: Error): void => {
  logger.error(`❌ Queue error: ${err.message}`, { stack: err.stack });
});

export const addOrchestrationJob = async (
  runId: string,
  delayMs?: number
): Promise<Job<QueueJobData>> => {
  return runQueue.add(
    QUEUE_NAMES.ORCHESTRATION,
    { runId },
    {
      jobId: `orchestrate_${runId}`,
      delay: delayMs || 0,
      attempts: DEFAULT_RETRY_ATTEMPTS,
    }
  );
};

export const addContinuationJob = async (
  runId: string,
  delayMs: number = 100
): Promise<Job<QueueJobData>> => {
  return runQueue.add(
    QUEUE_NAMES.CONTINUE_RUN,
    { runId },
    {
      jobId: `continue_${runId}_${Date.now()}`,
      delay: delayMs,
      attempts: DEFAULT_RETRY_ATTEMPTS,
    }
  );
};

export const addRetryJob = async (
  runId: string,
  delayMs: number = 5000
): Promise<Job<QueueJobData>> => {
  return runQueue.add(
    QUEUE_NAMES.RETRY_STEP,
    { runId },
    {
      jobId: `retry_${runId}_${Date.now()}`,
      delay: delayMs,
      attempts: MAX_RETRY_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: DEFAULT_BACKOFF_DELAY_MS,
      },
    }
  );
};

export const addApprovalCheckJob = async (
  runId: string,
  delayMs: number = 2000
): Promise<Job<QueueJobData>> => {
  return runQueue.add(
    QUEUE_NAMES.CHECK_APPROVAL,
    { runId },
    {
      jobId: `approval_${runId}_${Date.now()}`,
      delay: delayMs,
      attempts: 10,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
    }
  );
};

export interface QueueHealthStatus {
  status: 'healthy' | 'unhealthy';
  queueSize?: number;
  workerCount?: number;
  error?: string;
}

export const queueHealthCheck = async (): Promise<QueueHealthStatus> => {
  try {
    const counts = await runQueue.getJobCounts();
    const workers = await runQueue.getWorkers();

    const totalQueueSize = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);

    return {
      status: 'healthy',
      queueSize: totalQueueSize,
      workerCount: workers.length || 0,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown queue health check error';
    logger.error(`❌ Queue health check failed: ${message}`, { err: error });
    return {
      status: 'unhealthy',
      error: message,
    };
  }
};

export default runQueue;