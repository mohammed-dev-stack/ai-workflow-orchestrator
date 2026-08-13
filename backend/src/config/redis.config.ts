// ============================================================
// backend/src/config/redis.config.ts
// ============================================================
// إعدادات Redis (اتصال، صحة، إدارة الدورة)
// باستخدام envConfig من env.schema.js (SSoT).
// ============================================================

import Redis from 'ioredis';
import { envConfig } from './env.schema.js';
import { logger } from '../observability/logger.js';

export interface HealthCheckResult {
  status: 'connected' | 'disconnected' | 'error';
  latency?: number;
  error?: string;
}

let redisClient: Redis | null = null;

export async function initializeRedis(): Promise<Redis> {
  if (redisClient && redisClient.status === 'ready') {
    return redisClient;
  }

  const redisUrl = envConfig.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL غير معرّف في متغيرات البيئة');
  }

  redisClient = new Redis(redisUrl, {
    connectTimeout: 10000,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    logger.error(`Redis error: ${err.message}`);
  });

  redisClient.on('ready', () => {
    logger.info('✅ Redis connected');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  await redisClient.connect();
  await redisClient.ping();
  return redisClient;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error('Redis not initialized — call initializeRedis() first');
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  await redisClient.quit();
  redisClient = null;
}

export async function redisHealthCheck(): Promise<HealthCheckResult> {
  if (!redisClient || redisClient.status !== 'ready') {
    return { status: 'disconnected' };
  }
  try {
    const start = Date.now();
    await redisClient.ping();
    return { status: 'connected', latency: Date.now() - start };
  } catch (error: any) {
    return { status: 'error', error: error.message };
  }
}