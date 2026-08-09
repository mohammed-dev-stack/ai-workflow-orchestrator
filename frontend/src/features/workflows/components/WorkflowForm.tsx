// المسار: src/features/workflows/components/WorkflowForm.tsx

import React, { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus,
  faSpinner,
  faFloppyDisk,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { Workflow, WorkflowStep } from '../../../types';
import { StepEditor } from './StepEditor';
import { DEFAULT_STEP } from '../constants/workflowDefaults';

interface WorkflowFormProps {
  workflow: Partial<Workflow>;
  onChange: (workflow: Partial<Workflow>) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isEditing: boolean;
}

export const WorkflowForm: React.FC<WorkflowFormProps> = React.memo(({
  workflow,
  onChange,
  onSave,
  onCancel,
  isSaving,
  isEditing,
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!workflow.name || workflow.name.trim().length < 3) {
      newErrors.name = 'Workflow name must be at least 3 characters';
    }

    if (!workflow.steps || workflow.steps.length === 0) {
      newErrors.steps = 'Workflow must have at least one step';
    }

    workflow.steps?.forEach((step, index) => {
      if (!step.toolName) {
        newErrors[`step-${index}`] = `Step ${index + 1} must have a tool selected`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [workflow]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    if (workflow.name) allTouched.name = true;
    if (workflow.steps) {
      workflow.steps.forEach((_, i) => {
        allTouched[`step-${i}`] = true;
      });
    }
    setTouched(allTouched);

    if (validate()) {
      onSave();
    }
  }, [validate, onSave, workflow]);

  const handleChange = useCallback((field: keyof Workflow, value: unknown) => {
    onChange({ ...workflow, [field]: value });
    setErrors((prev) => ({ ...prev, [field]: '' }));
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, [workflow, onChange]);

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const stepCount = workflow.steps?.length || 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Workflow Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={workflow.name || ''}
          onChange={(e) => handleChange('name', e.target.value)}
          onBlur={() => handleBlur('name')}
          placeholder="e.g., Customer Onboarding Workflow"
          className={`w-full px-4 py-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm ${
            errors.name && touched.name ? 'border-red-500 focus:ring-red-500' : 'border-gray-300'
          }`}
        />
        {errors.name && touched.name && (
          <p className="text-sm text-red-600 mt-1.5 flex items-center">
            <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3 mr-1" />
            {errors.name}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
        <textarea
          value={workflow.description || ''}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Describe what this workflow does..."
          rows={3}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm resize-none"
        />
        <p className="text-xs text-gray-500 mt-1.5">
          Provide a clear description of what this workflow accomplishes.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Tags <span className="text-gray-400 text-xs font-normal">(comma separated)</span>
        </label>
        <input
          type="text"
          value={workflow.tags?.join(', ') || ''}
          onChange={(e) => {
            const tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
            handleChange('tags', tags);
          }}
          placeholder="e.g., sales, automation, customer-service"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
        />
        <p className="text-xs text-gray-500 mt-1.5">
          Add tags to help organize and find your workflows
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">
            Steps <span className="text-red-500">*</span>
            <span className="ml-2 text-xs text-gray-400 font-normal">
              ({stepCount} {stepCount === 1 ? 'step' : 'steps'})
            </span>
          </label>
          {errors.steps && touched.steps && (
            <p className="text-sm text-red-600 flex items-center">
              <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3 mr-1" />
              {errors.steps}
            </p>
          )}
        </div>

        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
          {workflow.steps?.map((step, index) => (
            <StepEditor
              key={step.stepId || index}
              step={step}
              index={index}
              onUpdate={(idx, updates) => {
                const newSteps = [...(workflow.steps || [])];
                newSteps[idx] = { ...newSteps[idx], ...updates };
                handleChange('steps', newSteps);
              }}
              onRemove={(idx) => {
                const newSteps = (workflow.steps || []).filter((_, i) => i !== idx);
                handleChange('steps', newSteps);
              }}
              onMoveUp={(idx) => {
                if (idx > 0) {
                  const newSteps = [...(workflow.steps || [])];
                  [newSteps[idx - 1], newSteps[idx]] = [newSteps[idx], newSteps[idx - 1]];
                  handleChange('steps', newSteps);
                }
              }}
              onMoveDown={(idx) => {
                const steps = workflow.steps || [];
                if (idx < steps.length - 1) {
                  const newSteps = [...steps];
                  [newSteps[idx], newSteps[idx + 1]] = [newSteps[idx + 1], newSteps[idx]];
                  handleChange('steps', newSteps);
                }
              }}
              isFirst={index === 0}
              isLast={index === (workflow.steps?.length || 0) - 1}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            const newStep: WorkflowStep = {
              ...DEFAULT_STEP,
              order: workflow.steps?.length || 0,
              stepId: `step_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            };
            handleChange('steps', [...(workflow.steps || []), newStep]);
            setTimeout(() => {
              const stepElements = document.querySelectorAll('.step-editor');
              const lastStep = stepElements[stepElements.length - 1];
              if (lastStep) {
                lastStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
          }}
          className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors duration-150 text-sm font-medium mt-3"
        >
          <span className="flex items-center justify-center space-x-2">
            <FontAwesomeIcon icon={faPlus} className="h-4 w-4" />
            <span>Add Step</span>
          </span>
        </button>
      </div>

      <div className="flex items-center space-x-3 bg-gray-50 p-3 rounded-md border border-gray-100">
        <input
          type="checkbox"
          id="is-active"
          checked={workflow.isActive !== false}
          onChange={(e) => handleChange('isActive', e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
        />
        <label htmlFor="is-active" className="text-sm text-gray-700 cursor-pointer">
          <span className="font-medium">Active</span>
          <span className="text-gray-500 ml-1">(workflow can be executed)</span>
        </label>
      </div>

      <div className="flex items-center space-x-3 pt-4 border-t border-gray-200">
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          {isSaving ? (
            <>
              <FontAwesomeIcon icon={faSpinner} className="h-4 w-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={isEditing ? faFloppyDisk : faPlus} className="h-4 w-4" />
              <span>{isEditing ? 'Update Workflow' : 'Create Workflow'}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50 px-6 py-2.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-center"
        >
          Cancel
        </button>
      </div>
    </form>
  );
});

WorkflowForm.displayName = 'WorkflowForm';