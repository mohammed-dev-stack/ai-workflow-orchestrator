// المسار: backend/src/workers/run.worker.ts

import { Worker, Job } from 'bullmq';
import { Orchestrator } from '../core/StateMachine.orchestrator';
import logger from '../utils/logger';
import { QUEUE_NAMES, QueueJobData, runQueue } from '../queues/run.queue';

// ============================================
// TYPES
// ============================================

interface WorkerHealthStatus {
  isRunning: boolean;
  activeJobs: number;
  waitingJobs: number;
  delayedJobs: number;
  failedJobs: number;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_DURATION = 1000;
const WORKER_LOCK_DURATION = 30000;
const STALLED_INTERVAL = 30000;
const MAX_STALLED_COUNT = 3;

// ============================================
// WORKER CLASS
// ============================================

export class RunWorker {
  private static instance: Worker<QueueJobData> | null = null;
  private static isShuttingDown = false;

  /**
   * Start the BullMQ worker
   * Singleton pattern to prevent multiple worker instances
   */
  static async start(): Promise<Worker<QueueJobData>> {
    if (this.instance) {
      logger.warn('⚠️ Worker already running, returning existing instance');
      return this.instance;
    }

    if (this.isShuttingDown) {
      logger.warn('⚠️ Worker is shutting down, cannot start new instance');
      throw new Error('Worker is shutting down');
    }

    const redisConnection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times: number): number => {
        const delay = Math.min(times * 50, 2000);
        logger.debug(`Redis connection retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
    };

    this.instance = new Worker<QueueJobData>(
      QUEUE_NAMES.ORCHESTRATION,
      async (job): Promise<void> => {
        if (this.isShuttingDown) {
          logger.warn(`⚠️ Shutting down, skipping job ${job.id}`);
          throw new Error('Worker is shutting down');
        }

        const correlationId = `worker-${job.id}-${Date.now()}`;

        try {
          logger.info(`🔄 Processing job ${job.id} (${job.name})`, {
            correlationId,
            jobId: job.id,
            name: job.name,
            data: job.data,
            attempts: job.attemptsMade + 1,
          });

          await Orchestrator.process(job.data.runId);

          logger.info(`✅ Job ${job.id} completed successfully`, {
            correlationId,
            jobId: job.id,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown worker error';
          logger.error(`❌ Job ${job.id} failed: ${message}`, {
            correlationId,
            jobId: job.id,
            err: error,
          });
          throw error;
        }
      },
      {
        connection: redisConnection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || String(DEFAULT_CONCURRENCY), 10),
        limiter: {
          max: parseInt(process.env.WORKER_RATE_LIMIT_MAX || String(DEFAULT_RATE_LIMIT_MAX), 10),
          duration: parseInt(process.env.WORKER_RATE_LIMIT_DURATION || String(DEFAULT_RATE_LIMIT_DURATION), 10),
        },
        lockDuration: WORKER_LOCK_DURATION,
        stalledInterval: STALLED_INTERVAL,
        maxStalledCount: MAX_STALLED_COUNT,
        autorun: true,
        removeOnComplete: {
          age: 24 * 60 * 60, // 1 day in seconds
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 60 * 60, // 7 days in seconds
          count: 5000,
        },
      }
    );

    // ============================================
    // WORKER EVENT HANDLERS
    // ============================================

    this.instance.on('ready', (): void => {
      logger.info('🔧 BullMQ Worker is ready and waiting for jobs');
    });

    this.instance.on('active', (job: Job<QueueJobData>): void => {
      logger.debug(`⚡ Worker activated job ${job.id} (${job.name})`, {
        jobId: job.id,
        name: job.name,
      });
    });

    this.instance.on('completed', (job: Job<QueueJobData>, result: unknown): void => {
      logger.info(`🎉 Job ${job.id} completed with result`, {
        jobId: job.id,
        name: job.name,
        result,
      });
    });

    this.instance.on('failed', (job: Job<QueueJobData> | undefined, error: Error): void => {
      if (job) {
        logger.error(`💥 Job ${job.id} (${job.name}) permanently failed: ${error.message}`, {
          jobId: job.id,
          name: job.name,
          attempts: job.attemptsMade,
          stack: error.stack,
        });
      } else {
        logger.error(`💥 A job failed without reference: ${error.message}`, {
          stack: error.stack,
        });
      }
    });

    this.instance.on('error', (error: Error): void => {
      logger.error(`🔧 Worker encountered an error: ${error.message}`, {
        stack: error.stack,
      });
    });

    this.instance.on('stalled', (jobId: string): void => {
      logger.warn(`⚠️ Job ${jobId} stalled, will be retried`, {
        jobId,
      });
    });

    this.instance.on('closing', (): void => {
      logger.info('🔧 Worker is closing...');
    });

    this.instance.on('closed', (): void => {
      logger.info('🔧 Worker closed successfully');
      this.instance = null;
    });

    // Register shutdown handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    logger.info('✅ BullMQ Worker started successfully', {
      concurrency: DEFAULT_CONCURRENCY,
      rateLimit: `${DEFAULT_RATE_LIMIT_MAX}/${DEFAULT_RATE_LIMIT_DURATION}ms`,
    });

    return this.instance;
  }

  /**
   * Gracefully shutdown the worker
   */
  static async shutdown(signal: string = 'SIGTERM'): Promise<void> {
    if (this.isShuttingDown || !this.instance) {
      return;
    }

    logger.info(`🛑 Received ${signal}, starting graceful worker shutdown...`);
    this.isShuttingDown = true;

    try {
      // Pause the worker to stop accepting new jobs
      await this.instance.pause();
      logger.info('⏸️ Worker paused, no new jobs will be processed');

      // Wait for current jobs to finish (max 30 seconds)
      const timeout = 30000;
      const startTime = Date.now();

      // Check if there are active jobs
      const activeJobs = await runQueue.getActive();

      if (activeJobs.length > 0) {
        logger.info(`⏳ Waiting for ${activeJobs.length} active jobs to complete...`, {
          activeJobs: activeJobs.length,
        });

        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(async () => {
            const currentActive = await runQueue.getActive();
            if (currentActive.length === 0 || Date.now() - startTime > timeout) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 1000);
        });
      }

      // Close the worker
      await this.instance.close();
      logger.info('✅ Worker closed gracefully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown shutdown error';
      logger.error(`❌ Error during worker shutdown: ${message}`, {
        err: error,
      });

      // Force close if error occurs
      if (this.instance) {
        await this.instance.close();
      }
    } finally {
      this.instance = null;
      this.isShuttingDown = false;
    }
  }

  /**
   * Get worker health status
   */
  static async healthCheck(): Promise<WorkerHealthStatus> {
    if (!this.instance) {
      return {
        isRunning: false,
        activeJobs: 0,
        waitingJobs: 0,
        delayedJobs: 0,
        failedJobs: 0,
      };
    }

    try {
      // Get job counts from the queue
      const counts = await runQueue.getJobCounts();

      // Get active jobs from the queue
      const activeJobs = await runQueue.getActive();

      return {
        isRunning: true,
        activeJobs: activeJobs.length,
        waitingJobs: counts.waiting || 0,
        delayedJobs: counts.delayed || 0,
        failedJobs: counts.failed || 0,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown health check error';
      logger.error(`Health check error: ${message}`, {
        err: error,
      });

      return {
        isRunning: true,
        activeJobs: 0,
        waitingJobs: 0,
        delayedJobs: 0,
        failedJobs: 0,
      };
    }
  }

  /**
   * Get worker instance (for debugging)
   */
  static getInstance(): Worker<QueueJobData> | null {
    return this.instance;
  }

  /**
   * Check if worker is running
   */
  static isRunning(): boolean {
    return this.instance !== null && !this.isShuttingDown;
  }
}

// ============================================
// SELF-INITIALIZATION (for standalone mode)
// ============================================

if (require.main === module) {
  (async (): Promise<void> => {
    try {
      await RunWorker.start();
      logger.info('🚀 Worker running as standalone process');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown start error';
      logger.error(`❌ Failed to start worker: ${message}`, {
        err: error,
      });
      process.exit(1);
    }
  })();
}

// ============================================
// EXPORTS
// ============================================

export const getWorker = (): Worker<QueueJobData> | null => RunWorker.getInstance();
export const startWorker = RunWorker.start.bind(RunWorker);
export const shutdownWorker = RunWorker.shutdown.bind(RunWorker);
export const isWorkerRunning = RunWorker.isRunning.bind(RunWorker);