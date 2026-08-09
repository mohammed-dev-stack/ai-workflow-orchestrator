// المسار: src/features/workflows/components/StepEditor.tsx

import React, { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronDown,
  faChevronRight,
  faArrowUp,
  faArrowDown,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { WorkflowStep } from '../../../types';

interface StepEditorProps {
  step: WorkflowStep;
  index: number;
  onUpdate: (index: number, step: Partial<WorkflowStep>) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

export const StepEditor: React.FC<StepEditorProps> = React.memo(({
  step,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleChange = (field: keyof WorkflowStep, value: unknown) => {
    onUpdate(index, { [field]: value });
  };

  const toggleExpanded = () => setIsExpanded(!isExpanded);

  const handleTemplateChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    setJsonError(null);

    if (rawValue.trim() === '' || rawValue.trim() === '{}') {
      handleChange('inputTemplate', {});
      return;
    }

    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === 'object' && parsed !== null) {
        handleChange('inputTemplate', parsed);
      } else {
        setJsonError('Input must be a JSON object');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid JSON format';
      setJsonError(message);
    }
  };

  const getJsonValue = useMemo(() => {
    try {
      const value = step.inputTemplate;
      if (value && typeof value === 'object' && Object.keys(value).length === 0) {
        return '{}';
      }
      return JSON.stringify(value, null, 2);
    } catch {
      return '{}';
    }
  }, [step.inputTemplate]);

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm transition-colors duration-150 step-editor">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 rounded-t-lg transition-colors duration-150"
        onClick={toggleExpanded}
      >
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">#{index + 1}</span>
          <span className="font-medium text-gray-900">{step.toolName || 'Untitled Step'}</span>
          {step.requiresApproval && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              Requires Approval
            </span>
          )}
          {step.isOptional && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              Optional
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <FontAwesomeIcon
            icon={isExpanded ? faChevronDown : faChevronRight}
            className="h-3 w-3 text-gray-400 transition-transform duration-150"
          />
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 border-t border-gray-200 space-y-4 bg-gray-50/30">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Tool Name <span className="text-red-500">*</span>
            </label>
            <select
              value={step.toolName}
              onChange={(e) => handleChange('toolName', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm bg-white"
            >
              <option value="">Select a tool...</option>
              <option value="send_email">Send Email</option>
              <option value="create_calendar_event">Create Calendar Event</option>
              <option value="create_jira_ticket">Create Jira Ticket</option>
              <option value="custom_webhook">Custom Webhook</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <input
              type="text"
              value={step.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="What does this step do?"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Input Template <span className="text-blue-500 text-xs font-normal">(JSON)</span>
            </label>
            <textarea
              value={getJsonValue}
              onChange={handleTemplateChange}
              placeholder='{"key": "{{context.value}}"}'
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm font-mono h-28 resize-y ${
                jsonError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300'
              }`}
            />
            {jsonError && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center">
                <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3 mr-1" />
                {jsonError}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              Use {'{{context.key}}'} to reference context values
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 bg-white p-3 rounded-md border border-gray-100">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`requires-approval-${index}`}
                checked={step.requiresApproval}
                onChange={(e) => handleChange('requiresApproval', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
              />
              <label htmlFor={`requires-approval-${index}`} className="text-sm text-gray-700 cursor-pointer">
                Requires Human Approval
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`is-optional-${index}`}
                checked={step.isOptional}
                onChange={(e) => handleChange('isOptional', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
              />
              <label htmlFor={`is-optional-${index}`} className="text-sm text-gray-700 cursor-pointer">
                Optional Step
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Max Retries</label>
              <input
                type="number"
                min="0"
                max="10"
                value={step.retryPolicy?.maxRetries || 3}
                onChange={(e) => handleChange('retryPolicy', {
                  ...step.retryPolicy,
                  maxRetries: parseInt(e.target.value) || 0,
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Backoff Delay (ms)</label>
              <input
                type="number"
                min="1000"
                max="60000"
                step="1000"
                value={step.retryPolicy?.backoffDelay || 5000}
                onChange={(e) => handleChange('retryPolicy', {
                  ...step.retryPolicy,
                  backoffDelay: parseInt(e.target.value) || 5000,
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Timeout (ms)</label>
            <input
              type="number"
              min="5000"
              max="120000"
              step="5000"
              value={step.timeoutMs || 30000}
              onChange={(e) => handleChange('timeoutMs', parseInt(e.target.value) || 30000)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => onMoveUp(index)}
                disabled={isFirst}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move Up"
              >
                <FontAwesomeIcon icon={faArrowUp} className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(index)}
                disabled={isLast}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move Down"
              >
                <FontAwesomeIcon icon={faArrowDown} className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="flex items-center space-x-1 text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors duration-150 text-sm font-medium"
            >
              <FontAwesomeIcon icon={faTrash} className="h-4 w-4" />
              <span>Remove Step</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

StepEditor.displayName = 'StepEditor';