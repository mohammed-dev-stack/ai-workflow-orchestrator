// المسار: backend/src/app.ts

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import routes from './api/routes';
import { errorHandler } from './utils/errorHandler';
import logger, { createRequestLogger } from './utils/logger';
import { connectDB, initializeRedis, getRedisClient } from './config';
import { RunWorker } from './workers/run.worker';
import { getAIMode, getModeLabel } from './utils/aiMode';
import { env } from './config/env';
// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================

dotenv.config();

const isProduction = process.env.// ============================================
NODE_ENV === 'production';

// EXPRESS APPLICATION INITIALIZATION
// ============================================

const app: Application = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

// ============================================
// SECURITY MIDDLEWARES
// ============================================

// Helmet - Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: true,
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  })
);

// CORS - Cross-Origin Resource Sharing
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin) || !isProduction) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'user-id', 'X-Request-ID', 'X-Correlation-ID'],
  exposedHeaders: ['X-Request-ID', 'X-Correlation-ID'],
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Compression - Response compression
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req: Request, res: Response): boolean => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);

// ============================================
// BODY PARSING MIDDLEWARES
// ============================================

app.use(
  express.json({
    limit: '10mb',
    verify: (req: Request, res: Response, buf: Buffer): void => {
      try {
        JSON.parse(buf.toString());
      } catch {
        res.status(400).json({
          success: false,
          message: 'Invalid JSON payload',
        });
      }
    },
  })
);

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// REQUEST LOGGING & TRACING
// ============================================

app.use((req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] as string || req.headers['x-request-id'] as string;
  const requestId = correlationId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);

  // Store in request object for use in other middleware
  (req as Request & { requestId: string }).requestId = requestId;

  // Create request-scoped logger
  const reqLogger = createRequestLogger(req);

  // Log request
  reqLogger.info(`➡️ ${req.method} ${req.path}`, {
    query: req.query,
    body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
  });

  // Log response
  res.on('finish', (): void => {
    const duration = Date.now() - startTime;
    const statusIcon = res.statusCode >= 500 ? '🔴' : res.statusCode >= 400 ? '🟡' : '🟢';
    reqLogger.info(`${statusIcon} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
});

// ============================================
// API ROUTES
// ============================================

app.use('/api', routes);

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================

app.get('/health', async (req: Request, res: Response): Promise<void> => {
  const requestId = (req as Request & { requestId: string }).requestId;

  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    let redisStatus = 'disconnected';
    try {
      const client = getRedisClient();
      redisStatus = client ? 'connected' : 'disconnected';
    } catch {
      redisStatus = 'disconnected';
    }

    const aiMode = getAIMode();

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        mongodb: {
          status: dbStatus,
        },
        redis: {
          status: redisStatus,
        },
        ai: {
          mode: aiMode,
          label: getModeLabel(),
          configured: !!process.env.ANTHROPIC_API_KEY,
        },
      },
      memory: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
      requestId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown health check error';
    logger.error(`Health check failed: ${message}`, {
      requestId,
      err: error,
    });
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Health check failed',
      requestId,
    });
  }
});

// ============================================
// NOT FOUND & ERROR HANDLING
// ============================================

app.use((req: Request, res: Response): void => {
  const requestId = (req as Request & { requestId: string }).requestId;
  logger.warn(`❓ 404: ${req.method} ${req.path}`, { requestId });
  res.status(404).json({
    success: false,
    message: `Endpoint ${req.method} ${req.path} not found`,
    requestId,
  });
});

app.use(errorHandler);

// ============================================
// SERVER INITIALIZATION
// ============================================

let server: ReturnType<typeof createServer>;

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (): Promise<void> => {
    logger.info('🔒 HTTP server closed');

    // Close MongoDB connection
    try {
      await mongoose.connection.close();
      logger.info('🗄️ MongoDB connection closed');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown MongoDB close error';
      logger.error(`❌ Error closing MongoDB: ${message}`, { err: error });
    }

    // Close Redis connection
    try {
      const redis = getRedisClient();
      if (redis) {
        await redis.quit();
        logger.info('🔴 Redis connection closed');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Redis close error';
      logger.error(`❌ Error closing Redis: ${message}`, { err: error });
    }

    // Close BullMQ Worker
    try {
      await RunWorker.shutdown();
      logger.info('⚙️ BullMQ Worker closed');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Worker close error';
      logger.error(`❌ Error closing Worker: ${message}`, { err: error });
    }

    logger.info('✅ Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout((): void => {
    logger.error('⏰ Force shutdown after timeout');
    process.exit(1);
  }, 30000);
};

const startServer = async (): Promise<void> => {
  try {
    // Display startup banner
    logger.info('🚀 ' + '='.repeat(60));
    logger.info('  🤖 AI Workflow Orchestrator Server');
    logger.info(`  📦 Version: ${process.env.npm_package_version || '1.0.0'}`);
    logger.info(`  🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`  🤖 AI Mode: ${getModeLabel()}`);
    logger.info(`  🔑 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Missing (Mock only)'}`);
    logger.info('🚀 ' + '='.repeat(60));

    // Connect to MongoDB
    logger.info('🗄️ Connecting to MongoDB...');
    await connectDB();
    logger.info('✅ MongoDB connected successfully');

    // Connect to Redis
    logger.info('🔴 Connecting to Redis...');
    await initializeRedis();
    logger.info('✅ Redis connected successfully');

    // Start BullMQ Worker
    logger.info('⚙️ Starting BullMQ Worker...');
    await RunWorker.start();
    logger.info('✅ BullMQ Worker started');

    // Start Express server
    server = createServer(app);
    server.listen(PORT, (): void => {
      logger.info(`🌐 Server running on http://localhost:${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📡 API endpoint: http://localhost:${PORT}/api`);
    });

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Global error handlers
    process.on('uncaughtException', (error: Error): void => {
      logger.error(`💥 Uncaught Exception: ${error.message}`, {
        stack: error.stack,
      });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason: unknown): void => {
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.error(`💥 Unhandled Rejection: ${message}`, {
        reason,
      });
      shutdown('unhandledRejection');
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown start error';
    logger.error(`❌ Failed to start server: ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
};

// ============================================
// START SERVER
// ============================================

startServer();

// ============================================
// EXPORTS
// ============================================

export default app;