import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { apiClient } from '../api/client';
import type {
  Workflow,
  WorkflowRun,
  WorkflowStats,
  PendingApproval,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  ExecuteWorkflowInput,
  ApiResponse,
  PaginatedResponse,
} from '../types';

// ============================================
// TYPES
// ============================================

interface WorkflowState {
  // State
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

  // Actions
  fetchWorkflows: (filters?: { isActive?: boolean; tags?: string[] }) => Promise<void>;
  fetchWorkflowById: (id: string) => Promise<Workflow | null>;
  createWorkflow: (data: CreateWorkflowInput) => Promise<Workflow>;
  updateWorkflow: (id: string, data: UpdateWorkflowInput) => Promise<Workflow>;
  deleteWorkflow: (id: string) => Promise<void>;
  executeWorkflow: (workflowId: string, context: Record<string, unknown>, idempotencyKey?: string) => Promise<WorkflowRun>;

  fetchRuns: (filters?: { workflowId?: string; status?: string; limit?: number; offset?: number }) => Promise<void>;
  fetchRunById: (id: string) => Promise<WorkflowRun | null>;
  cancelRun: (id: string) => Promise<void>;

  fetchPendingApprovals: () => Promise<void>;
  handleApproval: (runId: string, approved: boolean) => Promise<void>;

  fetchWorkflowStats: (workflowId: string) => Promise<WorkflowStats | null>;

  setSelectedWorkflow: (workflow: Workflow | null) => void;
  setSelectedRun: (run: WorkflowRun | null) => void;
  clearError: () => void;
  resetState: () => void;

  startPolling: () => void;
  stopPolling: () => void;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState: Omit<
  WorkflowState,
  | 'fetchWorkflows'
  | 'fetchWorkflowById'
  | 'createWorkflow'
  | 'updateWorkflow'
  | 'deleteWorkflow'
  | 'executeWorkflow'
  | 'fetchRuns'
  | 'fetchRunById'
  | 'cancelRun'
  | 'fetchPendingApprovals'
  | 'handleApproval'
  | 'fetchWorkflowStats'
  | 'setSelectedWorkflow'
  | 'setSelectedRun'
  | 'clearError'
  | 'resetState'
  | 'startPolling'
  | 'stopPolling'
> = {
  workflows: [],
  runs: [],
  pendingApprovals: [],
  pendingApprovalsCount: 0,
  selectedWorkflow: null,
  selectedRun: null,
  stats: null,
  isLoading: false,
  error: null,
  isPolling: false,
};

// ============================================
// STORE
// ============================================

export const useWorkflowStore = create<WorkflowState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ============================================
        // WORKFLOW ACTIONS
        // ============================================

        fetchWorkflows: async (filters = {}): Promise<void> => {
          set({ isLoading: true, error: null });
          try {
            const params = new URLSearchParams();
            if (filters.isActive !== undefined) params.append('isActive', String(filters.isActive));
            if (filters.tags && filters.tags.length > 0) params.append('tags', filters.tags.join(','));

            const response = await apiClient.get<ApiResponse<Workflow[]>>(`/workflows?${params.toString()}`);
            const workflows = response.data.data || [];
            set({ workflows, isLoading: false });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch workflows';
            set({ error: message, isLoading: false });
          }
        },

        fetchWorkflowById: async (id: string): Promise<Workflow | null> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.get<ApiResponse<Workflow>>(`/workflows/${id}`);
            const workflow = response.data.data || null;
            set({ selectedWorkflow: workflow, isLoading: false });
            return workflow;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `Failed to fetch workflow ${id}`;
            set({ error: message, isLoading: false });
            return null;
          }
        },

        createWorkflow: async (data: CreateWorkflowInput): Promise<Workflow> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.post<ApiResponse<Workflow>>('/workflows', data);
            const workflow = response.data.data;
            set((state) => ({
              workflows: [workflow, ...state.workflows],
              isLoading: false,
            }));
            return workflow;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to create workflow';
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        updateWorkflow: async (id: string, data: UpdateWorkflowInput): Promise<Workflow> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.put<ApiResponse<Workflow>>(`/workflows/${id}`, data);
            const updatedWorkflow = response.data.data;
            set((state) => ({
              workflows: state.workflows.map((w) => (w._id === id ? updatedWorkflow : w)),
              selectedWorkflow: state.selectedWorkflow?._id === id ? updatedWorkflow : state.selectedWorkflow,
              isLoading: false,
            }));
            return updatedWorkflow;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `Failed to update workflow ${id}`;
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        deleteWorkflow: async (id: string): Promise<void> => {
          set({ isLoading: true, error: null });
          try {
            await apiClient.delete(`/workflows/${id}`);
            set((state) => ({
              workflows: state.workflows.filter((w) => w._id !== id),
              selectedWorkflow: state.selectedWorkflow?._id === id ? null : state.selectedWorkflow,
              isLoading: false,
            }));
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `Failed to delete workflow ${id}`;
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        executeWorkflow: async (
          workflowId: string,
          context: Record<string, unknown>,
          idempotencyKey?: string
        ): Promise<WorkflowRun> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.post<ApiResponse<WorkflowRun>>(
              `/workflows/${workflowId}/execute`,
              { context, idempotencyKey }
            );
            const run = response.data.data;
            set((state) => ({
              runs: [run, ...state.runs],
              isLoading: false,
            }));
            return run;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to execute workflow';
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        // ============================================
        // RUN ACTIONS
        // ============================================

        fetchRuns: async (filters = {}): Promise<void> => {
          set({ isLoading: true, error: null });
          try {
            const params = new URLSearchParams();
            if (filters.workflowId) params.append('workflowId', filters.workflowId);
            if (filters.status) params.append('status', filters.status);
            if (filters.limit) params.append('limit', String(filters.limit));
            if (filters.offset) params.append('offset', String(filters.offset));

            const response = await apiClient.get<PaginatedResponse<WorkflowRun>>(`/runs?${params.toString()}`);
            const runs = response.data.data || [];
            set({ runs, isLoading: false });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch runs';
            set({ error: message, isLoading: false });
          }
        },

        fetchRunById: async (id: string): Promise<WorkflowRun | null> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.get<ApiResponse<WorkflowRun>>(`/runs/${id}`);
            const run = response.data.data || null;
            set({ selectedRun: run, isLoading: false });
            return run;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `Failed to fetch run ${id}`;
            set({ error: message, isLoading: false });
            return null;
          }
        },

        cancelRun: async (id: string): Promise<void> => {
          set({ isLoading: true, error: null });
          try {
            await apiClient.post(`/runs/${id}/cancel`);
            set((state) => ({
              runs: state.runs.map((r) =>
                r._id === id ? { ...r, status: 'failed', errorMessage: 'Cancelled by user' } : r
              ),
              selectedRun: state.selectedRun?._id === id
                ? { ...state.selectedRun, status: 'failed', errorMessage: 'Cancelled by user' }
                : state.selectedRun,
              isLoading: false,
            }));
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `Failed to cancel run ${id}`;
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        // ============================================
        // APPROVAL ACTIONS
        // ============================================

        fetchPendingApprovals: async (): Promise<void> => {
          try {
            const response = await apiClient.get<ApiResponse<PendingApproval[]>>('/approvals/pending');
            const pendingApprovals = response.data.data || [];
            set({
              pendingApprovals,
              pendingApprovalsCount: pendingApprovals.length,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch pending approvals';
            console.error(message);
          }
        },

        handleApproval: async (runId: string, approved: boolean): Promise<void> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.post<ApiResponse<WorkflowRun>>(`/runs/${runId}/approve`, { approved });
            const updatedRun = response.data.data;
            set((state) => ({
              runs: state.runs.map((r) => (r._id === runId ? updatedRun : r)),
              pendingApprovals: state.pendingApprovals.filter((p) => p._id !== runId),
              pendingApprovalsCount: Math.max(0, state.pendingApprovalsCount - 1),
              selectedRun: state.selectedRun?._id === runId ? updatedRun : state.selectedRun,
              isLoading: false,
            }));
            await get().fetchPendingApprovals();
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to process approval';
            set({ error: message, isLoading: false });
            throw error;
          }
        },

        // ============================================
        // STATS ACTIONS
        // ============================================

        fetchWorkflowStats: async (workflowId: string): Promise<WorkflowStats | null> => {
          set({ isLoading: true, error: null });
          try {
            const response = await apiClient.get<ApiResponse<WorkflowStats>>(`/workflows/${workflowId}/stats`);
            const stats = response.data.data || null;
            set({ stats, isLoading: false });
            return stats;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch workflow stats';
            set({ error: message, isLoading: false });
            return null;
          }
        },

        // ============================================
        // UI ACTIONS
        // ============================================

        setSelectedWorkflow: (workflow: Workflow | null): void => {
          set({ selectedWorkflow: workflow });
        },

        setSelectedRun: (run: WorkflowRun | null): void => {
          set({ selectedRun: run });
        },

        clearError: (): void => {
          set({ error: null });
        },

        resetState: (): void => {
          set(initialState);
        },

        // ============================================
        // POLLING CONTROL
        // ============================================

        startPolling: (): void => {
          const state = get();
          if (state.isPolling) return;

          set({ isPolling: true });

          const intervalId = setInterval(() => {
            get().fetchPendingApprovals();
          }, 15000);

          (window as unknown as { __pollingInterval: NodeJS.Timeout }).__pollingInterval = intervalId;
        },

        stopPolling: (): void => {
          set({ isPolling: false });
          const intervalId = (window as unknown as { __pollingInterval?: NodeJS.Timeout }).__pollingInterval;
          if (intervalId) {
            clearInterval(intervalId);
            delete (window as unknown as { __pollingInterval?: NodeJS.Timeout }).__pollingInterval;
          }
        },
      }),
      {
        name: 'workflow-store',
        partialize: (state) => ({
          workflows: state.workflows,
          pendingApprovalsCount: state.pendingApprovalsCount,
        }),
      }
    ),
    { name: 'WorkflowStore' }
  )
);

// ============================================
// SELECTOR HOOKS
// ============================================

export const useWorkflowsSelector = (): Workflow[] => useWorkflowStore((state) => state.workflows);
export const useRunsSelector = (): WorkflowRun[] => useWorkflowStore((state) => state.runs);
export const usePendingApprovalsSelector = (): PendingApproval[] => useWorkflowStore((state) => state.pendingApprovals);
export const usePendingApprovalsCountSelector = (): number => useWorkflowStore((state) => state.pendingApprovalsCount);
export const useIsLoadingSelector = (): boolean => useWorkflowStore((state) => state.isLoading);
export const useErrorSelector = (): string | null => useWorkflowStore((state) => state.error);
export const useSelectedWorkflowSelector = (): Workflow | null => useWorkflowStore((state) => state.selectedWorkflow);
export const useSelectedRunSelector = (): WorkflowRun | null => useWorkflowStore((state) => state.selectedRun);

// ============================================
// DEFAULT EXPORT
// ============================================

export default useWorkflowStore;