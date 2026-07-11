/**
 * config/database.config.ts
 */
import mongoose, { ConnectOptions } from 'mongoose';
import { env } from './env';
import logger from '../utils/logger';
import { redactUriCredentials } from '../utils/redact';
import type { HealthCheckResult } from './types';
 
function buildMongoOptions(source = env): ConnectOptions {
  return Object.freeze({
    autoIndex: source.NODE_ENV !== 'production',
    maxPoolSize: source.MONGO_MAX_POOL_SIZE,
    minPoolSize: source.MONGO_MIN_POOL_SIZE,
    socketTimeoutMS: source.MONGO_SOCKET_TIMEOUT_MS,
    serverSelectionTimeoutMS: source.MONGO_SERVER_SELECTION_TIMEOUT_MS,
  });
}
 
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
 
export async function connectDB(
  connection: mongoose.Mongoose = mongoose
): Promise<void> {
  if (connection.connection.readyState === 1) return;
 
  const safeUri = redactUriCredentials(env.MONGO_URI);
  const options = buildMongoOptions();
 
  connection.set('strictQuery', true);
 
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await connection.connect(env.MONGO_URI, options);
      logger.info(`✅ MongoDB connected (${safeUri})`);
      return;
    } catch (error: any) {
      logger.error(
        `MongoDB connection attempt ${attempt}/${env.MONGO_CONNECT_RETRIES} failed: ${error.message}`
      );
 
      if (attempt >= env.MONGO_CONNECT_RETRIES) {
        throw new Error(
          `MongoDB connection failed after ${attempt} attempts: ${error.message}`
        );
      }
 
      await delay(env.MONGO_CONNECT_RETRY_DELAY_MS);
    }
  }
}
 
export async function disconnectDB(
  connection: mongoose.Mongoose = mongoose
): Promise<void> {
  if (connection.connection.readyState === 0) return;
  await connection.disconnect();
  logger.info('MongoDB disconnected');
}
 
export function isDBConnected(
  connection: mongoose.Mongoose = mongoose
): boolean {
  return connection.connection.readyState === 1;
}
 
export async function dbHealthCheck(
  connection: mongoose.Mongoose = mongoose
): Promise<HealthCheckResult> {
  if (connection.connection.readyState !== 1) {
    return { status: 'disconnected' };
  }
 
  try {
    const start = Date.now();
    const db = connection.connection.db;
    if (!db) return { status: 'disconnected' };
    await db.admin().ping();
    return { status: 'connected', latency: Date.now() - start };
  } catch (error: any) {
    return { status: 'error', error: error.message };
  }
}
 