// المسار: src/features/workflows/constants/workflowDefaults.ts

import type { WorkflowStep } from '../../../types';

export const DEFAULT_STEP: WorkflowStep = {
  stepId: `step_${Date.now()}_${Math.random().toString(36).substring(7)}`,
  toolName: '',
  description: '',
  inputTemplate: {},
  requiresApproval: false,
  order: 0,
  isOptional: false,
  retryPolicy: { maxRetries: 3, backoffDelay: 5000 },
  timeoutMs: 30000,
};

export const DEFAULT_WORKFLOW_FORM = {
  name: '',
  description: '',
  steps: [] as WorkflowStep[],
  tags: [],
  isActive: true,
};