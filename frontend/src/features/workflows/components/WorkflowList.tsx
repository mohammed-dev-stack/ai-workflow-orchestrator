// المسار: src/features/workflows/components/WorkflowList.tsx

import React, { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMagnifyingGlass,
  faPlay,
  faTrash,
  faTag,
} from '@fortawesome/free-solid-svg-icons';
import type { Workflow } from '../../../types';

interface WorkflowListProps {
  workflows: Workflow[];
  selectedId: string | null;
  onSelect: (workflow: Workflow) => void;
  onDelete: (id: string) => void;
  onExecute: (workflow: Workflow) => void;
  isLoading: boolean;
}

export const WorkflowList: React.FC<WorkflowListProps> = React.memo(({
  workflows,
  selectedId,
  onSelect,
  onDelete,
  onExecute,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredWorkflows = useMemo(() => {
    if (!searchTerm.trim()) return workflows;
    const term = searchTerm.toLowerCase().trim();
    return workflows.filter((w) =>
      w.name.toLowerCase().includes(term) ||
      w.tags?.some((tag) => tag.toLowerCase().includes(term)) ||
      w.description?.toLowerCase().includes(term)
    );
  }, [workflows, searchTerm]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-5xl mb-4 flex justify-center" aria-hidden="true">
          <FontAwesomeIcon icon={faTag} />
        </div>
        <p className="font-medium text-gray-700">No workflows created yet</p>
        <p className="text-sm mt-1">Click "New Workflow" to get started</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <div className="relative">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search workflows..."
            className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-shadow"
          />
        </div>
      </div>

      <div className="space-y-2 max-h-[calc(100vh-450px)] overflow-y-auto pr-1">
        {filteredWorkflows.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-4">
            No workflows matching "{searchTerm}"
          </p>
        ) : (
          filteredWorkflows.map((workflow) => (
            <div
              key={workflow._id}
              className={`
                p-3 border rounded-lg transition-all duration-150
                ${selectedId === workflow._id 
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                  : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }
              `}
            >
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => onSelect(workflow)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-gray-900 truncate">{workflow.name}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      workflow.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {workflow.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-gray-500 mt-0.5">
                    <span>v{workflow.version}</span>
                    <span>•</span>
                    <span>{workflow.steps?.length || 0} steps</span>
                    {workflow.tags && workflow.tags.length > 0 && (
                      <>
                        <span>•</span>
                        <span className="flex space-x-1">
                          {workflow.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                              {tag}
                            </span>
                          ))}
                          {workflow.tags.length > 3 && (
                            <span className="text-gray-400">+{workflow.tags.length - 3}</span>
                          )}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-1 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExecute(workflow);
                    }}
                    disabled={!workflow.isActive}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 flex items-center space-x-1 ${
                      workflow.isActive
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                    title={workflow.isActive ? 'Execute workflow' : 'Workflow is inactive'}
                    aria-label={`Execute ${workflow.name}`}
                  >
                    <FontAwesomeIcon icon={faPlay} className="h-3 w-3" />
                    <span>Execute</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete workflow "${workflow.name}"? This action cannot be undone.`)) {
                        onDelete(workflow._id);
                      }
                    }}
                    className="text-gray-400 hover:text-red-600 transition-colors duration-150 p-1.5 hover:bg-red-50 rounded-md"
                    title="Delete workflow"
                    aria-label={`Delete ${workflow.name}`}
                  >
                    <FontAwesomeIcon icon={faTrash} className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

WorkflowList.displayName = 'WorkflowList';