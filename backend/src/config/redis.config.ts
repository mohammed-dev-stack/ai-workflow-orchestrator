/**
 * config/redis.config.ts
 */
import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import logger from '../utils/logger';
import type { HealthCheckResult } from './types';
 
let redisClient: Redis | null = null;
 
function buildRedisOptions(source = env): RedisOptions {
  return {
    host: source.REDIS_HOST,
    port: source.REDIS_PORT,
    password: source.REDIS_PASSWORD,
    tls: source.REDIS_TLS ? {} : undefined,
    connectTimeout: source.REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: source.REDIS_MAX_RETRIES_PER_REQUEST,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
    lazyConnect: true,
  };
}
 
export async function initializeRedis(): Promise<Redis> {
  if (redisClient && redisClient.status === 'ready') return redisClient;
 
  redisClient = new Redis(buildRedisOptions());
 
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
    throw new Error(
      'Redis not initialized — call initializeRedis() during app bootstrap first'
    );
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