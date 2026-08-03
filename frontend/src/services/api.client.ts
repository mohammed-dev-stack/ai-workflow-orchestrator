// ============================================================
// frontend/src/services/api.client.ts
// ============================================================
// عميل HTTP موحد مع دعم المصادقة وإعادة المحاولة.
// ✅ تم إصلاح مشكلة params عبر إضافتها إلى RequestOptions وتمريرها إلى axios.
// ✅ تم تحسين معالجة إلغاء الطلبات (cancel) باستخدام signal و isCancel.
// ✅ تم إصلاح مشكلة الأنواع (types) بالاعتماد على الاستدلال التلقائي.
// ============================================================

import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

// ============================================================
// 1. أنواع البيانات العامة
// ============================================================

export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * خيارات الطلب – تدعم الآن params بشكل صريح.
 */
export interface RequestOptions {
  retry?: boolean;
  retryAttempts?: number;
  signal?: AbortSignal;
  params?: Record<string, any>; // ✅ تم إضافة هذه الخاصية
  headers?: Record<string, any>;
  onUploadProgress?: (progressEvent: any) => void;
  timeout?: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  correlationId?: string;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
}

// ============================================================
// 2. الثوابت والدوال المساعدة
// ============================================================

const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const generateCorrelationId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// ============================================================
// 3. العميل الرئيسي (Lazy Singleton)
// ============================================================

class ApiClient {
  private instance: any;
  private config: ApiClientConfig;
  private isRefreshing = false;
  private failedQueue: Array<{
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    config: any & { _retry?: boolean; _retryCount?: number };
  }> = [];

  constructor(config: ApiClientConfig = {}) {
    const baseURL = config.baseURL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
    this.config = { ...config, baseURL };

    this.instance = axios.create({
      baseURL,
      timeout: config.timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.subscribeToAuthChanges();
    this.setupRequestInterceptors();
    this.setupResponseInterceptors();
    this.updateAuthHeader();
  }

  private subscribeToAuthChanges(): void {
    useAuthStore.subscribe(() => {
      this.updateAuthHeader();
    });
  }

  private updateAuthHeader(): void {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      this.instance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.instance.defaults.headers.common['Authorization'];
    }
  }

  private setupRequestInterceptors(): void {
    this.instance.interceptors.request.use(
      (config: any) => {
        config.headers['x-correlation-id'] = generateCorrelationId();

        const { accessToken } = useAuthStore.getState();
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        } else {
          delete config.headers.Authorization;
        }

        const { user } = useAuthStore.getState();
        if (user?.tenantId) {
          config.headers['x-tenant-id'] = user.tenantId;
        }

        if (import.meta.env.DEV) {
          console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`, {
            hasToken: !!accessToken,
            params: config.params,
          });
        }

        return config;
      },
      (error: any) => Promise.reject(error)
    );
  }

  private setupResponseInterceptors(): void {
    this.instance.interceptors.response.use(
      (response: any) => response,
      async (error: any) => {
        const originalConfig = error.config as any & {
          _retry?: boolean;
          _retryCount?: number;
        };

        if (axios.isCancel(error) || !originalConfig) {
          return Promise.reject(error);
        }

        if (error.response?.status === 401 && !originalConfig._retry) {
          originalConfig._retry = true;

          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject, config: originalConfig });
            });
          }

          this.isRefreshing = true;

          try {
            const newToken = await this.refreshAccessToken();
            if (newToken) {
              useAuthStore.setState({ accessToken: newToken });
              this.updateAuthHeader();

              this.failedQueue.forEach(({ config, resolve }) => {
                if (config.headers) {
                  config.headers.Authorization = `Bearer ${newToken}`;
                }
                resolve(this.instance(config));
              });
              this.failedQueue = [];

              if (originalConfig.headers) {
                originalConfig.headers.Authorization = `Bearer ${newToken}`;
              }
              return this.instance(originalConfig);
            } else {
              this.failedQueue.forEach(({ reject }) =>
                reject(new Error('انتهت صلاحية الجلسة'))
              );
              this.failedQueue = [];
              await useAuthStore.getState().logout();
              return Promise.reject(new Error('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً'));
            }
          } catch (refreshError) {
            this.failedQueue.forEach(({ reject }) => reject(refreshError));
            this.failedQueue = [];
            await useAuthStore.getState().logout();
            return Promise.reject(refreshError);
          } finally {
            this.isRefreshing = false;
          }
        }

        const statusCode = error.response?.status;
        const isRetryable = statusCode && RETRYABLE_STATUS_CODES.includes(statusCode);
        const maxRetries = (originalConfig as any).retryAttempts ?? this.config.retryAttempts ?? 2;
        const currentRetry = originalConfig._retryCount || 0;

        if (isRetryable && currentRetry < maxRetries) {
          originalConfig._retryCount = currentRetry + 1;
          const delay = (this.config.retryDelay ?? 1000) * Math.pow(2, currentRetry);
          const waitTime = Math.floor(delay + delay * 0.1 * Math.random());
          console.warn(
            `[API] إعادة محاولة ${originalConfig.url} (${currentRetry + 1}/${maxRetries}) بعد ${waitTime}ms`
          );
          await sleep(waitTime);
          return this.instance(originalConfig);
        }

        const apiError = this.normalizeError(error);
        console.error(
          `[API] ❌ ${originalConfig.method?.toUpperCase()} ${originalConfig.url} - فشل:`,
          apiError
        );
        return Promise.reject(apiError);
      }
    );
  }

  private async refreshAccessToken(): Promise<string | null> {
    try {
      const { refreshToken } = useAuthStore.getState();
      if (!refreshToken) return null;

      const response = await axios.post<ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number }>>(
        `${this.config.baseURL}/api/auth/refresh`,
        { refreshToken },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      if (response.data.success && response.data.data) {
        const { accessToken, refreshToken: newRefreshToken, expiresIn } = response.data.data;
        useAuthStore.setState({
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn,
          isAuthenticated: true,
        });
        return accessToken;
      }
      return null;
    } catch (error) {
      console.error('[API] فشل تجديد التوكن:', error);
      return null;
    }
  }

  private normalizeError(error: any): Error {
    const statusCode = error.response?.status;
    const data = error.response?.data as any;
    let message = 'حدث خطأ غير متوقع';

    if (data?.message) message = data.message;
    else if (data?.error) message = data.error;
    else if (error.message) message = error.message;

    if (statusCode) {
      message = `[${statusCode}] ${message}`;
    }

    const normalizedError = new Error(message);
    (normalizedError as any).statusCode = statusCode;
    (normalizedError as any).originalError = error;
    (normalizedError as any).data = data;
    return normalizedError;
  }

  // ============================================================
  // 8. دوال HTTP العامة
  // ============================================================

  get<T = any>(url: string, config?: RequestOptions): Promise<any> {
    return this.instance.get(url, config);
  }

  post<T = any>(url: string, data?: any, config?: RequestOptions): Promise<any> {
    return this.instance.post(url, data, config);
  }

  put<T = any>(url: string, data?: any, config?: RequestOptions): Promise<any> {
    return this.instance.put(url, data, config);
  }

  patch<T = any>(url: string, data?: any, config?: RequestOptions): Promise<any> {
    return this.instance.patch(url, data, config);
  }

  delete<T = any>(url: string, config?: RequestOptions): Promise<any> {
    return this.instance.delete(url, config);
  }

  getAbortController(): AbortController {
    return new AbortController();
  }

  getInstance(): any {
    return this.instance;
  }
}

// ============================================================
// 9. Lazy Singleton
// ============================================================

let _apiClient: ApiClient | null = null;

function getApiClient(): ApiClient {
  if (!_apiClient) {
    _apiClient = new ApiClient();
  }
  return _apiClient;
}

export function ensureApiClientInitialized(): void {
  getApiClient();
}

export const apiClient = new Proxy({} as ApiClient, {
  get: (target, prop) => {
    const client = getApiClient();
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

export default apiClient;