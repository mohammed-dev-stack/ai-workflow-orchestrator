// ============================================
// FILE: src/lib/api/client.ts
// ============================================

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosRequestConfig,
} from 'axios';
import type { ApiResponse, ApiError, ApiRequestConfig } from '../../types/global';

// ============================================
// CONSTANTS
// ============================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const API_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 30000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// ============================================
// TYPES
// ============================================

interface QueuedRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  config: InternalAxiosRequestConfig;
}

interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
  _idempotencyKey?: string;
}

// ============================================
// API CLIENT CLASS
// ============================================

class ApiClient {
  private static instance: ApiClient | null = null;
  private readonly client: AxiosInstance;
  private isRefreshing = false;
  private failedQueue: QueuedRequest[] = [];
  private readonly abortControllers: Map<string, AbortController> = new Map();

  // ============================================
  // CONSTRUCTOR (Private for Singleton)
  // ============================================

  private constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  // ============================================
  // SINGLETON INSTANCE
  // ============================================

  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  public static resetInstance(): void {
    ApiClient.instance = null;
  }

  // ============================================
  // PUBLIC METHODS
  // ============================================

  public getClient(): AxiosInstance {
    return this.client;
  }

  public setAuthToken(token: string | null): void {
    if (token) {
      localStorage.setItem('authToken', token);
    } else {
      localStorage.removeItem('authToken');
    }
  }

  public getAuthToken(): string | null {
    return localStorage.getItem('authToken');
  }

  public getUserId(): string {
    return localStorage.getItem('userId') || 'anonymous';
  }

  public setUserId(userId: string): void {
    localStorage.setItem('userId', userId);
  }

  public clearAuth(): void {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
  }

  public cancelAllPendingRequests(): void {
    for (const [key, controller] of this.abortControllers) {
      controller.abort();
      this.abortControllers.delete(key);
    }
  }

  public cancelRequest(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  public async getHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      const response = await this.client.get<{ status: string; timestamp: string }>('/health');
      return response.data;
    } catch (error) {
      throw this.transformError(error as AxiosError);
    }
  }

  // ============================================
  // INTERCEPTORS SETUP
  // ============================================

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      this.handleRequestFulfilled.bind(this),
      this.handleRequestRejected.bind(this)
    );

    this.client.interceptors.response.use(
      this.handleResponseFulfilled.bind(this),
      this.handleResponseRejected.bind(this)
    );
  }

  // ============================================
  // REQUEST INTERCEPTORS
  // ============================================

  private handleRequestFulfilled(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    const extendedConfig = config as ExtendedAxiosRequestConfig;

    // Generate request ID for tracing
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    extendedConfig.headers['X-Request-ID'] = requestId;

    // Add user ID
    extendedConfig.headers['user-id'] = this.getUserId();

    // Add auth token if available
    const token = this.getAuthToken();
    if (token) {
      extendedConfig.headers.Authorization = `Bearer ${token}`;
    }

    // Add idempotency key for state-changing requests
    if (['post', 'put', 'patch', 'delete'].includes(extendedConfig.method?.toLowerCase() ?? '')) {
      const idempotencyKey = extendedConfig._idempotencyKey || crypto.randomUUID?.() || Date.now().toString();
      extendedConfig.headers['Idempotency-Key'] = idempotencyKey;
      extendedConfig._idempotencyKey = idempotencyKey;
    }

    // Create abort controller for request cancellation
    const controller = new AbortController();
    extendedConfig.signal = controller.signal;
    this.abortControllers.set(requestId, controller);

    // Log request in development
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(`🚀 [${requestId}] ${extendedConfig.method?.toUpperCase() ?? 'UNKNOWN'} ${extendedConfig.url}`, {
        data: extendedConfig.data,
        params: extendedConfig.params,
        headers: extendedConfig.headers,
      });
    }

    return extendedConfig;
  }

  private handleRequestRejected(error: AxiosError): Promise<never> {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('❌ Request interceptor error:', error.message);
    }
    return Promise.reject(this.transformError(error));
  }

  // ============================================
  // RESPONSE INTERCEPTORS
  // ============================================

  private handleResponseFulfilled(response: AxiosResponse): AxiosResponse {
    const config = response.config as ExtendedAxiosRequestConfig;
    const requestId = config.headers?.['X-Request-ID'] || 'unknown';

    // Remove abort controller
    if (typeof requestId === 'string') {
      this.abortControllers.delete(requestId);
    }

    // Log response in development
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(`✅ [${requestId}] ${response.status} ${config.url}`, {
        data: response.data,
      });
    }

    return response;
  }

  private async handleResponseRejected(error: AxiosError): Promise<unknown> {
    const config = error.config as ExtendedAxiosRequestConfig | undefined;

    // Remove abort controller
    const requestId = config?.headers?.['X-Request-ID'];
    if (typeof requestId === 'string') {
      this.abortControllers.delete(requestId);
    }

    // Check if request was cancelled
    if (axios.isCancel(error)) {
      return Promise.reject({
        message: 'Request was cancelled',
        status: 0,
        code: 'REQUEST_CANCELLED',
      } as ApiError);
    }

    // Log error
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('❌ Response error:', {
        status: error.response?.status,
        message: error.message,
        url: config?.url,
        method: config?.method,
      });
    }

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && config && !config._retry) {
      return this.handleUnauthorizedError(error, config);
    }

    // Handle 429 Rate Limiting
    if (error.response?.status === 429) {
      return this.handleRateLimitError(error, config);
    }

    // Handle 5xx Server Errors with retry
    if (error.response?.status && error.response.status >= 500 && error.response.status < 600) {
      return this.handleServerError(error, config);
    }

    // Transform and reject other errors
    return Promise.reject(this.transformError(error));
  }

  // ============================================
  // ERROR HANDLING STRATEGIES
  // ============================================

  private async handleUnauthorizedError(
    error: AxiosError,
    config: ExtendedAxiosRequestConfig
  ): Promise<unknown> {
    config._retry = true;

    // If already refreshing, queue the request
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.failedQueue.push({ resolve, reject, config });
      })
        .then(() => {
          const token = this.getAuthToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
          return this.client(config);
        })
        .catch((err) => Promise.reject(this.transformError(err as AxiosError)));
    }

    this.isRefreshing = true;

    try {
      const newToken = await this.refreshToken();
      this.setAuthToken(newToken);

      // Update token in config
      config.headers.Authorization = `Bearer ${newToken}`;

      // Retry queued requests
      const queuedRequests = [...this.failedQueue];
      this.failedQueue = [];
      for (const queued of queuedRequests) {
        try {
          const token = this.getAuthToken();
          if (token) {
            queued.config.headers.Authorization = `Bearer ${token}`;
          }
          const result = await this.client(queued.config);
          queued.resolve(result);
        } catch (err) {
          queued.reject(err);
        }
      }

      // Retry original request
      return this.client(config);
    } catch (refreshError) {
      // Refresh failed - clear auth and redirect
      this.clearAuth();
      this.failedQueue = [];

      // Dispatch auth:logout event for UI to react
      window.dispatchEvent(new CustomEvent('auth:logout'));

      // Redirect to login if not already there
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }

      return Promise.reject(this.transformError(refreshError as AxiosError));
    } finally {
      this.isRefreshing = false;
    }
  }

  private async handleRateLimitError(
    error: AxiosError,
    config?: ExtendedAxiosRequestConfig
  ): Promise<unknown> {
    if (!config) {
      return Promise.reject(this.transformError(error));
    }

    const retryAfter = Number(error.response?.headers?.['retry-after']) || 5;
    const delayMs = retryAfter * 1000;

    // eslint-disable-next-line no-console
    console.warn(`⏳ Rate limited. Retrying after ${retryAfter}s`);

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    return this.client(config);
  }

  private async handleServerError(
    error: AxiosError,
    config?: ExtendedAxiosRequestConfig
  ): Promise<unknown> {
    if (!config) {
      return Promise.reject(this.transformError(error));
    }

    const retryCount = (config._retryCount ?? 0) + 1;
    config._retryCount = retryCount;

    if (retryCount > MAX_RETRY_ATTEMPTS) {
      // eslint-disable-next-line no-console
      console.error(`❌ Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded for ${config.url}`);
      return Promise.reject(this.transformError(error));
    }

    const delayMs = RETRY_DELAY_MS * Math.pow(2, retryCount - 1);
    // eslint-disable-next-line no-console
    console.warn(`🔄 Retry ${retryCount}/${MAX_RETRY_ATTEMPTS} for ${config.url} after ${delayMs}ms`);

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    return this.client(config);
  }

  // ============================================
  // TOKEN REFRESH
  // ============================================

  private async refreshToken(): Promise<string> {
    // In production, this would call /auth/refresh endpoint
    // For now, we'll simulate a refresh
    try {
      const response = await this.client.post<{ token: string }>('/auth/refresh', null, {
        headers: {
          'X-Refresh-Token': localStorage.getItem('refreshToken') || '',
        },
      });

      const newToken = response.data.token;
      if (!newToken) {
        throw new Error('No token received from refresh endpoint');
      }

      return newToken;
    } catch (error) {
      // If refresh fails, clear auth and throw
      this.clearAuth();
      throw this.transformError(error as AxiosError);
    }
  }

  // ============================================
  // ERROR TRANSFORMATION
  // ============================================

  private transformError(error: AxiosError<unknown>): ApiError {
    // Network error (no response)
    if (!error.response) {
      return {
        message: 'Network error. Please check your connection.',
        status: 0,
        code: 'NETWORK_ERROR',
      };
    }

    // Server responded with error
    const responseData = error.response.data as Record<string, unknown> | null;

    return {
      message: this.extractErrorMessage(responseData) || error.message || 'An unexpected error occurred',
      status: error.response.status,
      code: this.extractErrorCode(responseData) || `HTTP_${error.response.status}`,
      details: responseData?.details ?? null,
    };
  }

  private extractErrorMessage(data: Record<string, unknown> | null): string | null {
    if (!data) return null;

    if (typeof data.message === 'string') return data.message;
    if (typeof data.error === 'string') return data.error;
    if (typeof data.detail === 'string') return data.detail;

    return null;
  }

  private extractErrorCode(data: Record<string, unknown> | null): string | null {
    if (!data) return null;

    if (typeof data.code === 'string') return data.code;
    if (typeof data.errorCode === 'string') return data.errorCode;

    return null;
  }

  // ============================================
  // DESTROY METHOD (for testing)
  // ============================================

  public destroy(): void {
    this.cancelAllPendingRequests();
    this.abortControllers.clear();
    this.failedQueue = [];
    this.isRefreshing = false;
  }
}

// ============================================
// EXPORT SINGLETON INSTANCE
// ============================================

const apiClientInstance = ApiClient.getInstance();
export const apiClient = apiClientInstance.getClient();

// ============================================
// TYPE-SAFE CONVENIENCE METHODS
// ============================================

export const get = async <TData = unknown, TResponse = ApiResponse<TData>>(
  url: string,
  config?: AxiosRequestConfig
): Promise<TResponse> => {
  const response = await apiClient.get<TResponse>(url, config);
  return response.data;
};

export const post = async <TData = unknown, TResponse = ApiResponse<TData>>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<TResponse> => {
  const response = await apiClient.post<TResponse>(url, data, config);
  return response.data;
};

export const put = async <TData = unknown, TResponse = ApiResponse<TData>>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<TResponse> => {
  const response = await apiClient.put<TResponse>(url, data, config);
  return response.data;
};

export const patch = async <TData = unknown, TResponse = ApiResponse<TData>>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<TResponse> => {
  const response = await apiClient.patch<TResponse>(url, data, config);
  return response.data;
};

export const del = async <TData = unknown, TResponse = ApiResponse<TData>>(
  url: string,
  config?: AxiosRequestConfig
): Promise<TResponse> => {
  const response = await apiClient.delete<TResponse>(url, config);
  return response.data;
};

// ============================================
// EXPORT TYPES
// ============================================

export type { ApiError, ApiResponse, ApiRequestConfig };

// ============================================
// DEFAULT EXPORT
// ============================================

export default ApiClient;