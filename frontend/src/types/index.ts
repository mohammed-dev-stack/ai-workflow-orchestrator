// ============================================
//  CORE TYPES (Shared between Frontend & Backend)
// ============================================

/**
 * Run status enum - matches backend exactly
 */
export type RunStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

/**
 * Tool names supported by the system
 */
export type ToolName =
  | 'send_email'
  | 'create_calendar_event'
  | 'create_jira_ticket'
  | 'custom_webhook'
  | 'complete';

/**
 * Step status within a run
 */
export type StepStatus = 'pending' | 'executed' | 'failed';

// ============================================
//  WORKFLOW TEMPLATE TYPES
// ============================================

/**
 * Retry policy configuration for a step
 */
export interface RetryPolicy {
  maxRetries: number;
  backoffDelay: number; // milliseconds
}

/**
 * A single step definition in a workflow template
 */
export interface WorkflowStep {
  stepId: string;
  toolName: ToolName | string;
  description?: string;
  inputTemplate: Record<string, unknown>;
  requiresApproval: boolean;
  order: number;
  isOptional: boolean;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
}

/**
 * Workflow template - the blueprint for workflow executions
 */
export interface Workflow {
  _id: string;
  name: string;
  description?: string;
  version: number;
  steps: WorkflowStep[];
  isActive: boolean;
  createdBy: string;
  tags: string[];
  estimatedCostPerRun: number;
  successRate: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a new workflow
 */
export interface CreateWorkflowInput {
  name: string;
  description?: string;
  steps: Omit<WorkflowStep, 'order'>[];
  tags?: string[];
  isActive?: boolean;
}

/**
 * Input for updating an existing workflow
 */
export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
  tags?: string[];
  isActive?: boolean;
}

// ============================================
//  WORKFLOW RUN TYPES
// ============================================

/**
 * A single step execution within a run
 */
export interface Step {
  stepId: string;
  toolName: ToolName | string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: StepStatus;
  requiresApproval: boolean;
  approvedBy?: string;
  retryCount: number;
  startedAt?: string | Date;
  finishedAt?: string | Date;
}

/**
 * Workflow run instance - represents a single execution
 */
export interface WorkflowRun {
  _id: string;
  workflowId: string;
  idempotencyKey: string;
  status: RunStatus;
  context: Record<string, unknown>;
  steps: Step[];
  currentStepIndex: number;
  errorMessage?: string;
  totalCost: number;
  latencyMs: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pending approval item - extends WorkflowRun with approval context
 */
export interface PendingApproval extends WorkflowRun {
  currentStep: Step;
  reasoning: string;
}

/**
 * Input for executing a workflow
 */
export interface ExecuteWorkflowInput {
  workflowId: string;
  context: Record<string, unknown>;
  idempotencyKey?: string;
}

// ============================================
//  WORKFLOW STATISTICS TYPES
// ============================================

/**
 * Aggregated statistics for a workflow
 */
export interface WorkflowStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  rejectedRuns: number;
  averageLatency: number;
  totalCost: number;
  successRate: number;
}

// ============================================
//  API RESPONSE TYPES
// ============================================

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  details?: unknown;
  stack?: string; // Only in development
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  total: number;
  limit: number;
  offset: number;
}

/**
 * API error structure
 */
export interface ApiError {
  message: string;
  status: number;
  code: string;
  details?: unknown;
}

// ============================================
//  FRONTEND STATE TYPES
// ============================================

/**
 * UI state for the workflow store
 */
export interface WorkflowStoreState {
  workflows: Workflow[];
  runs: WorkflowRun[];
  pendingApprovals: PendingApproval[];
  pendingApprovalsCount: number;
  selectedWorkflow: Workflow | null;
  selectedRun: WorkflowRun | null;
  stats: WorkflowStats | null;
  isLoading: boolean;
  error: string | null;
  isPolling: boolean;
}

/**
 * Filter options for fetching workflows
 */
export interface WorkflowFilters {
  isActive?: boolean;
  tags?: string[];
}

/**
 * Filter options for fetching runs
 */
export interface RunFilters {
  workflowId?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
}

// ============================================
//  FORM TYPES (for Workflow Builder)
// ============================================

/**
 * Form data for creating/editing a workflow
 */
export interface WorkflowFormData {
  _id?: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  tags: string[];
  isActive: boolean;
}

/**
 * Validation error for forms
 */
export interface FormError {
  field: string;
  message: string;
}

// ============================================
//  WEBHOOK / NOTIFICATION TYPES
// ============================================

/**
 * Webhook payload for approval notifications
 */
export interface ApprovalWebhookPayload {
  runId: string;
  workflowId: string;
  stepIndex: number;
  toolName: string;
  context: Record<string, unknown>;
  approvalUrl: string;
  timestamp: string;
}

/**
 * Slack notification payload
 */
export interface SlackNotification {
  text: string;
  mrkdwn?: boolean;
  attachments?: Array<{
    color?: string;
    title?: string;
    text?: string;
    fields?: Array<{
      title: string;
      value: string;
      short?: boolean;
    }>;
  }>;
}

// ============================================
//  HEALTH CHECK TYPES
// ============================================

/**
 * Health check response
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  mongodb: {
    status: string;
    latency?: number;
    error?: string;
  };
  redis: {
    status: string;
    latency?: number;
    error?: string;
  };
  queue: {
    status: string;
    queueSize?: number;
    workerCount?: number;
    error?: string;
  };
  worker: {
    isRunning: boolean;
    activeJobs: number;
    waitingJobs: number;
    delayedJobs: number;
    failedJobs: number;
  };
}

// ============================================
//  ENVIRONMENT TYPES
// ============================================

/**
 * Frontend environment variables
 */
export interface FrontendEnv {
  VITE_API_BASE_URL: string;
  VITE_API_TIMEOUT: string;
  VITE_APP_NAME: string;
  VITE_APP_VERSION: string;
  VITE_ENABLE_DEVTOOLS: string;
}

// ============================================
//  UTILITY TYPES
// ============================================

/**
 * Type for API endpoints with path parameters
 */
export type ApiEndpoint<T extends string> = T;

/**
 * Extract the response data type from an ApiResponse
 */
export type ExtractData<T> = T extends ApiResponse<infer U> ? U : never;

/**
 * Make all properties optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Non-nullable version of a type (overrides built-in)
 * Note: This is intentionally named differently to avoid conflict with built-in NonNullable
 */
export type NonNullableType<T> = Exclude<T, null | undefined>;

// ============================================
//  TYPE GUARDS
// ============================================

/**
 * Type guard for checking if a value is a Workflow
 */
export function isWorkflow(value: unknown): value is Workflow {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    'steps' in value
  );
}

/**
 * Type guard for checking if a value is a WorkflowRun
 */
export function isWorkflowRun(value: unknown): value is WorkflowRun {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    'context' in value
  );
}

/**
 * Type guard for checking if a value is a PendingApproval
 */
export function isPendingApproval(value: unknown): value is PendingApproval {
  return (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    (value as { status: string }).status === 'waiting_approval'
  );
}

// ============================================
//  CONSTANTS
// ============================================

/**
 * Human-readable labels for run statuses
 */
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_approval: 'Waiting for Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
};

/**
 * Color mapping for run statuses
 */
export const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  idle: 'gray',
  running: 'blue',
  waiting_approval: 'yellow',
  approved: 'green',
  rejected: 'red',
  completed: 'green',
  failed: 'red',
};

/**
 * Icon mapping for tool names
 */
export const TOOL_ICONS: Record<ToolName, string> = {
  send_email: '📧',
  create_calendar_event: '📅',
  create_jira_ticket: '🎫',
  custom_webhook: '🔗',
  complete: '✅',
};

/**
 * Human-readable labels for tool names
 */
export const TOOL_LABELS: Record<ToolName, string> = {
  send_email: 'Send Email',
  create_calendar_event: 'Create Calendar Event',
  create_jira_ticket: 'Create Jira Ticket',
  custom_webhook: 'Custom Webhook',
  complete: 'Complete Workflow',
};

// ============================================
//  DEFAULT EXPORT
// ============================================

export default {
  // Types
  RunStatus,
  StepStatus,
  ToolName,
  // Interfaces
  Workflow,
  WorkflowStep,
  WorkflowRun,
  Step,
  PendingApproval,
  WorkflowStats,
  WorkflowStoreState,
  WorkflowFormData,
  ApiResponse,
  PaginatedResponse,
  ApiError,
  HealthStatus,
  // Constants
  RUN_STATUS_LABELS,
  RUN_STATUS_COLORS,
  TOOL_ICONS,
  TOOL_LABELS,
  // Type Guards
  isWorkflow,
  isWorkflowRun,
  isPendingApproval,
};