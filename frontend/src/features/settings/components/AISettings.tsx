// المسار: src/features/settings/components/AISettings.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleXmark,
  faKey,
  faRobot,
  faTriangleExclamation,
  faFlask,
  faRocket,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { apiClient } from '../../../api/client';
import { StatusBadge } from './StatusBadge';
import { ModeCard } from './ModeCard';

// ============================================
// TYPES
// ============================================

interface AIModeData {
  mode: 'mock' | 'real';
  label: string;
  isMock: boolean;
  isReal: boolean;
  message?: string;
}

interface AIStatusData {
  mode: 'mock' | 'real';
  label: string;
  apiKeyConfigured: boolean;
  model: string;
  instructions: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

export const AISettings: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<AIModeData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AIStatusData | null>(null);

  const fetchCurrentMode = useCallback(async (): Promise<void> => {
    try {
      const response = await apiClient.get<{ data: AIModeData }>('/settings/ai-mode');
      setCurrentMode(response.data.data);
      setError(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
      setError(message);
    }
  }, []);

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await apiClient.get<{ data: AIStatusData }>('/settings/ai-status');
      setStatus(response.data.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'حدث خطأ غير متوقع';
      console.error('Failed to fetch status:', message);
    }
  }, []);

  const toggleMode = useCallback(
    async (mode: 'mock' | 'real'): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.post<{ data: AIModeData }>('/settings/ai-mode', { mode });
        setCurrentMode(response.data.data);
        await fetchStatus();

        const successMessage =
          response.data.data.message || `تم التبديل إلى وضع ${mode.toUpperCase()}`;

        // TODO: يتطلب نظام toast مركزي
        alert(successMessage);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to change AI mode';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [fetchStatus]
  );

  useEffect(() => {
    fetchCurrentMode();
    fetchStatus();
  }, [fetchCurrentMode, fetchStatus]);

  if (!currentMode) {
    return (
      <div className="flex items-center justify-center p-8">
        <FontAwesomeIcon icon={faSpinner} className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">AI Mode Control</h3>
          <p className="text-sm text-gray-500 mt-1">
            التحكم في وضع عمل الـ AI (محاكاة مجانية أو API حقيقي)
          </p>
        </div>
        <StatusBadge isActive={currentMode.isMock || currentMode.isReal} label={currentMode.label} />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center">
          <FontAwesomeIcon icon={faTriangleExclamation} className="h-4 w-4 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ModeCard
          mode="mock"
          icon={<FontAwesomeIcon icon={faFlask} className="h-6 w-6" />}
          title="Mock Mode"
          description="محاكاة مجانية • بدون تكلفة • لا يستخدم Claude API"
          features={['مناسب للتجربة', 'مجاني', 'سريع']}
          isActive={currentMode.isMock}
          isLoading={loading}
          onClick={() => toggleMode('mock')}
        />

        <ModeCard
          mode="real"
          icon={<FontAwesomeIcon icon={faRocket} className="h-6 w-6" />}
          title="Real Mode"
          description="API حقيقي • بتكلفة • يستخدم Claude API"
          features={['دقة عالية', 'إنتاجي', 'متكامل']}
          isActive={currentMode.isReal}
          isLoading={loading}
          onClick={() => toggleMode('real')}
        />
      </div>

      {status && (
        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center justify-between md:justify-start md:space-x-4">
              <span className="text-gray-500 flex items-center">
                <FontAwesomeIcon icon={faKey} className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                API Key:
              </span>
              <span
                className={`font-mono ${
                  status.apiKeyConfigured ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {status.apiKeyConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>
            <div className="flex items-center justify-between md:justify-start md:space-x-4">
              <span className="text-gray-500 flex items-center">
                <FontAwesomeIcon icon={faRobot} className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                Model:
              </span>
              <span className="font-mono text-gray-700">{status.model}</span>
            </div>
            <div className="col-span-1 md:col-span-2 mt-1">
              <span className="text-gray-500">Instructions:</span>
              <p className="text-xs text-gray-600 mt-0.5">{status.instructions}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AISettings;