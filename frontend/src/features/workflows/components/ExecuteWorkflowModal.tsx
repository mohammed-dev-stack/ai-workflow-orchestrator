// المسار: src/features/workflows/components/ExecuteWorkflowModal.tsx

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark,
  faPlay,
  faSpinner,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { Workflow } from '../../../types';

interface ExecuteWorkflowModalProps {
  workflow: Workflow | null;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (workflowId: string, context: Record<string, unknown>) => void;
  isExecuting: boolean;
}

export const ExecuteWorkflowModal: React.FC<ExecuteWorkflowModalProps> = React.memo(({
  workflow,
  isOpen,
  onClose,
  onExecute,
  isExecuting,
}) => {
  const [context, setContext] = useState<string>(
    '{\n  "user_email": "user@example.com",\n  "user_name": "User Name",\n  "details": "Details here"\n}'
  );
  const [contextError, setContextError] = useState<string | null>(null);

  if (!isOpen || !workflow) return null;

  const handleExecute = (): void => {
    try {
      const parsedContext = JSON.parse(context) as unknown;
      if (typeof parsedContext === 'object' && parsedContext !== null) {
        setContextError(null);
        onExecute(workflow._id, parsedContext as Record<string, unknown>);
      } else {
        setContextError('Context must be a JSON object');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid JSON format';
      setContextError(message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-900">Execute Workflow</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors duration-150 p-1 rounded-md hover:bg-gray-100"
            aria-label="Close modal"
          >
            <FontAwesomeIcon icon={faXmark} className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600">
              <span className="font-medium">Workflow:</span> {workflow.name}
            </p>
            <p className="text-sm text-gray-500">
              <span className="font-medium">Description:</span> {workflow.description || 'No description'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Context (JSON)</label>
            <textarea
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                setContextError(null);
              }}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm font-mono h-48 resize-y ${
                contextError ? 'border-red-500 focus:ring-red-500' : 'border-gray-300'
              }`}
              aria-label="Context JSON input"
            />
            {contextError && (
              <p className="text-xs text-red-600 mt-1.5 flex items-center">
                <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3 mr-1" />
                {contextError}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              Provide the context data for the workflow execution. Use {'{{context.key}}'} in your workflow steps.
            </p>
          </div>

          <div className="flex items-center space-x-3 pt-4 border-t border-gray-200">
            <button
              onClick={handleExecute}
              disabled={isExecuting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              aria-label="Execute workflow"
            >
              {isExecuting ? (
                <>
                  <FontAwesomeIcon icon={faSpinner} className="h-4 w-4 animate-spin" />
                  <span>Executing...</span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faPlay} className="h-4 w-4" />
                  <span>Execute</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              disabled={isExecuting}
              className="flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ExecuteWorkflowModal.displayName = 'ExecuteWorkflowModal';