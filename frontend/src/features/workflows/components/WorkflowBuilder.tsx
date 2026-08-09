// المسار: src/features/workflows/components/WorkflowBuilder.tsx

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faTriangleExclamation,
  faCircleCheck,
  faCircleXmark,
  faInfoCircle,
} from '@fortawesome/free-solid-svg-icons';
import { useWorkflows, useCreateWorkflow, useUpdateWorkflow, useDeleteWorkflow, useExecuteWorkflow } from '../../../hooks/useWorkflows';
import { useWorkflowStore } from '../../../store/useWorkflowStore';
import type { Workflow, CreateWorkflowInput, UpdateWorkflowInput } from '../../../types';
import { WorkflowList } from './WorkflowList';
import { WorkflowForm } from './WorkflowForm';
import { ExecuteWorkflowModal } from './ExecuteWorkflowModal';
import { DEFAULT_WORKFLOW_FORM } from '../constants/workflowDefaults';

export const WorkflowBuilder: React.FC = React.memo(() => {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<Workflow>>(DEFAULT_WORKFLOW_FORM);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [selectedWorkflowForExecute, setSelectedWorkflowForExecute] = useState<Workflow | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const { setSelectedWorkflow } = useWorkflowStore();

  const { data: workflows, isLoading: workflowsLoading, refetch: refetchWorkflows } = useWorkflows();
  const selectedWorkflow = workflows?.find((w) => w._id === selectedWorkflowId);

  const createMutation = useCreateWorkflow({
    onSuccess: () => {
      refetchWorkflows();
      resetForm();
      setIsCreating(false);
      showNotification('success', 'Workflow created successfully!');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to create workflow';
      showNotification('error', `Failed to create workflow: ${message}`);
    },
  });

  const updateMutation = useUpdateWorkflow({
    onSuccess: () => {
      refetchWorkflows();
      resetForm();
      setIsCreating(false);
      showNotification('success', 'Workflow updated successfully!');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update workflow';
      showNotification('error', `Failed to update workflow: ${message}`);
    },
  });

  const deleteMutation = useDeleteWorkflow({
    onSuccess: () => {
      refetchWorkflows();
      if (selectedWorkflowId) {
        resetForm();
      }
      showNotification('success', 'Workflow deleted successfully!');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete workflow';
      showNotification('error', `Failed to delete workflow: ${message}`);
    },
  });

  const executeMutation = useExecuteWorkflow({
    onSuccess: () => {
      setExecuteModalOpen(false);
      setSelectedWorkflowForExecute(null);
      setIsExecuting(false);
      showNotification('success', 'Workflow executed successfully!');
      refetchWorkflows();
    },
    onError: (error: unknown) => {
      setIsExecuting(false);
      const message = error instanceof Error ? error.message : 'Failed to execute workflow';
      showNotification('error', `Failed to execute workflow: ${message}`);
    },
  });

  const resetForm = useCallback(() => {
    setFormData(DEFAULT_WORKFLOW_FORM);
    setSelectedWorkflowId(null);
    setSelectedWorkflow(null);
  }, [setSelectedWorkflow]);

  const loadWorkflowForEdit = useCallback((workflow: Workflow) => {
    setFormData({
      _id: workflow._id,
      name: workflow.name,
      description: workflow.description || '',
      steps: workflow.steps || [],
      tags: workflow.tags || [],
      isActive: workflow.isActive !== false,
    });
    setSelectedWorkflowId(workflow._id);
    setSelectedWorkflow(workflow);
    setIsCreating(true);
  }, [setSelectedWorkflow]);

  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const handleSave = useCallback(() => {
    if (selectedWorkflowId) {
      const updateData: UpdateWorkflowInput = {
        name: formData.name!,
        description: formData.description,
        steps: formData.steps!,
        tags: formData.tags,
        isActive: formData.isActive,
      };
      updateMutation.mutate({ id: selectedWorkflowId, data: updateData });
    } else {
      const createData: CreateWorkflowInput = {
        name: formData.name!,
        description: formData.description,
        steps: formData.steps!.map((step, index) => ({
          ...step,
          order: index,
        })),
        tags: formData.tags,
        isActive: formData.isActive,
      };
      createMutation.mutate(createData);
    }
  }, [selectedWorkflowId, formData, createMutation, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleCancel = useCallback(() => {
    resetForm();
    setIsCreating(false);
  }, [resetForm]);

  const handleNewWorkflow = useCallback(() => {
    resetForm();
    setIsCreating(true);
  }, [resetForm]);

  const handleExecuteClick = useCallback((workflow: Workflow) => {
    setSelectedWorkflowForExecute(workflow);
    setExecuteModalOpen(true);
  }, []);

  const handleExecuteWorkflow = useCallback((workflowId: string, context: Record<string, unknown>) => {
    setIsExecuting(true);
    executeMutation.mutate({ workflowId, context });
  }, [executeMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const selectedFromList = useMemo(() => {
    return workflows?.find((w) => w._id === selectedWorkflowId) || null;
  }, [workflows, selectedWorkflowId]);

  useEffect(() => {
    return () => setNotification(null);
  }, []);

  const getNotificationIcon = () => {
    switch (notification?.type) {
      case 'success': return faCircleCheck;
      case 'error': return faCircleXmark;
      default: return faInfoCircle;
    }
  };

  const getNotificationColors = () => {
    switch (notification?.type) {
      case 'success': return 'bg-green-50 border-green-200 text-green-800';
      case 'error': return 'bg-red-50 border-red-200 text-red-800';
      default: return 'bg-blue-50 border-blue-200 text-blue-800';
    }
  };

  return (
    <div className="animate-fade-in relative">
      <ExecuteWorkflowModal
        workflow={selectedWorkflowForExecute}
        isOpen={executeModalOpen}
        onClose={() => {
          setExecuteModalOpen(false);
          setSelectedWorkflowForExecute(null);
        }}
        onExecute={handleExecuteWorkflow}
        isExecuting={isExecuting}
      />

      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-md max-w-md transition-all transform translate-x-0 ${getNotificationColors()}`}>
          <div className="flex items-start space-x-3">
            <FontAwesomeIcon icon={getNotificationIcon()} className="h-5 w-5 mt-0.5" />
            <p className="text-sm">{notification.message}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Builder</h1>
          <p className="text-sm text-gray-500 mt-1">Design and manage your AI agent workflows</p>
        </div>
        {!isCreating && (
          <button
            onClick={handleNewWorkflow}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-md font-medium transition-colors duration-150 flex items-center space-x-2 shadow-sm"
          >
            <FontAwesomeIcon icon={faPlus} className="h-4 w-4" />
            <span>New Workflow</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {!isCreating && (
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700">My Workflows</h3>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {workflows?.length || 0} total
                </span>
              </div>
              <WorkflowList
                workflows={workflows || []}
                selectedId={selectedWorkflowId}
                onSelect={loadWorkflowForEdit}
                onDelete={handleDelete}
                onExecute={handleExecuteClick}
                isLoading={workflowsLoading}
              />
            </div>
          </div>
        )}

        <div className={isCreating ? 'lg:col-span-3' : 'lg:col-span-2'}>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-gray-700 text-lg">
                {isCreating ? (
                  <span className="flex items-center space-x-2">
                    <span>{selectedWorkflowId ? '✏️' : '📝'}</span>
                    <span>{selectedWorkflowId ? 'Edit Workflow' : 'Create New Workflow'}</span>
                  </span>
                ) : (
                  'Select a workflow to edit'
                )}
              </h3>
              {isCreating && selectedWorkflowId && selectedFromList && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Version {selectedFromList.version || 1}
                </span>
              )}
            </div>

            {isCreating ? (
              <WorkflowForm
                workflow={formData}
                onChange={setFormData}
                onSave={handleSave}
                onCancel={handleCancel}
                isSaving={isSaving}
                isEditing={!!selectedWorkflowId}
              />
            ) : (
              <div className="text-center py-16 text-gray-500">
                <div className="text-7xl mb-6 flex justify-center" aria-hidden="true">
                  <FontAwesomeIcon icon={faPlus} className="h-16 w-16 text-gray-300" />
                </div>
                <h3 className="text-xl font-medium text-gray-700 mb-2">No workflow selected</h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  Select an existing workflow from the list to edit it, or click
                  <span className="text-blue-600 font-medium mx-1">"New Workflow"</span>
                  to create a new one.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

WorkflowBuilder.displayName = 'WorkflowBuilder';

export default WorkflowBuilder;