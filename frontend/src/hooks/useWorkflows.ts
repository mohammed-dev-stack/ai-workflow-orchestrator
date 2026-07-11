import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
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
// QUERY KEYS
// ============================================

export const workflowKeys = {
  all: ['workflows'] as const,
  lists: () => [...workflowKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...workflowKeys.lists(), filters] as const,
  details: () => [...workflowKeys.all, 'detail'] as const,
  detail: (id: string) => [...workflowKeys.details(), id] as const,
  runs: () => [...workflowKeys.all, 'runs'] as const,
  runList: (filters: Record<string, unknown>) => [...workflowKeys.runs(), filters] as const,
  runDetail: (id: string) => [...workflowKeys.runs(), 'detail', id] as const,
  approvals: () => [...workflowKeys.all, 'approvals'] as const,
  pendingApprovals: () => [...workflowKeys.approvals(), 'pending'] as const,
  stats: (workflowId: string) => [...workflowKeys.detail(workflowId), 'stats'] as const,
};

// ============================================
// WORKFLOW HOOKS
// ============================================

export const useWorkflows = (filters?: { isActive?: boolean; tags?: string[] }) => {
  return useQuery({
    queryKey: workflowKeys.list(filters || {}),
    queryFn: async (): Promise<Workflow[]> => {
      const params = new URLSearchParams();
      if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
      if (filters?.tags && filters.tags.length > 0) params.append('tags', filters.tags.join(','));

      const response = await apiClient.get<ApiResponse<Workflow[]>>(`/workflows?${params.toString()}`);
      return response.data.data || [];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

export const useWorkflow = (id: string, options?: Partial<UseQueryOptions<Workflow | null>>) => {
  return useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: async (): Promise<Workflow | null> => {
      const response = await apiClient.get<ApiResponse<Workflow>>(`/workflows/${id}`);
      return response.data.data || null;
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
    retry: 1,
    enabled: !!id,
    ...options,
  });
};

export const useCreateWorkflow = (options?: Partial<UseMutationOptions<Workflow, Error, CreateWorkflowInput>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateWorkflowInput): Promise<Workflow> => {
      const response = await apiClient.post<ApiResponse<Workflow>>('/workflows', data);
      return response.data.data;
    },
    onSuccess: (): void => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
    ...options,
  });
};

export const useUpdateWorkflow = (options?: Partial<UseMutationOptions<Workflow, Error, { id: string; data: UpdateWorkflowInput }>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateWorkflowInput }): Promise<Workflow> => {
      const response = await apiClient.put<ApiResponse<Workflow>>(`/workflows/${id}`, data);
      return response.data.data;
    },
    onSuccess: (data: Workflow, variables: { id: string; data: UpdateWorkflowInput }): void => {
      queryClient.setQueryData(workflowKeys.detail(variables.id), data);
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
    ...options,
  });
};

export const useDeleteWorkflow = (options?: Partial<UseMutationOptions<void, Error, string>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/workflows/${id}`);
    },
    onSuccess: (_: void, id: string): void => {
      queryClient.removeQueries({ queryKey: workflowKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
    ...options,
  });
};

export const useExecuteWorkflow = (options?: Partial<UseMutationOptions<WorkflowRun, Error, ExecuteWorkflowInput>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ workflowId, context, idempotencyKey }: ExecuteWorkflowInput): Promise<WorkflowRun> => {
      const response = await apiClient.post<ApiResponse<WorkflowRun>>(
        `/workflows/${workflowId}/execute`,
        { context, idempotencyKey }
      );
      return response.data.data;
    },
    onSuccess: (): void => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.pendingApprovals() });
    },
    ...options,
  });
};

// ============================================
// RUN HOOKS
// ============================================

interface RunsResponse {
  runs: WorkflowRun[];
  total: number;
}

export const useRuns = (filters?: { workflowId?: string; status?: string; limit?: number; offset?: number }) => {
  return useQuery({
    queryKey: workflowKeys.runList(filters || {}),
    queryFn: async (): Promise<RunsResponse> => {
      const params = new URLSearchParams();
      if (filters?.workflowId) params.append('workflowId', filters.workflowId);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.limit) params.append('limit', String(filters.limit));
      if (filters?.offset) params.append('offset', String(filters.offset));

      const response = await apiClient.get<PaginatedResponse<WorkflowRun>>(`/runs?${params.toString()}`);
      return {
        runs: response.data.data || [],
        total: response.data.total || 0,
      };
    },
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    retry: 1,
    refetchInterval: 1000 * 45,
    refetchOnWindowFocus: true,
  });
};

export const useRun = (id: string, options?: Partial<UseQueryOptions<WorkflowRun | null>>) => {
  return useQuery({
    queryKey: workflowKeys.runDetail(id),
    queryFn: async (): Promise<WorkflowRun | null> => {
      const response = await apiClient.get<ApiResponse<WorkflowRun>>(`/runs/${id}`);
      return response.data.data || null;
    },
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    retry: 1,
    enabled: !!id,
    refetchInterval: 1000 * 30,
    ...options,
  });
};

export const useCancelRun = (options?: Partial<UseMutationOptions<void, Error, string>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.post(`/runs/${id}/cancel`);
    },
    onSuccess: (_: void, id: string): void => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.runDetail(id) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs() });
    },
    ...options,
  });
};

// ============================================
// APPROVAL HOOKS
// ============================================

export const usePendingApprovals = (options?: Partial<UseQueryOptions<PendingApproval[]>>) => {
  return useQuery({
    queryKey: workflowKeys.pendingApprovals(),
    queryFn: async (): Promise<PendingApproval[]> => {
      const response = await apiClient.get<ApiResponse<PendingApproval[]>>('/approvals/pending');
      return response.data.data || [];
    },
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    retry: 1,
    refetchInterval: 1000 * 45,
    refetchOnWindowFocus: true,
    ...options,
  });
};

interface HandleApprovalVariables {
  runId: string;
  approved: boolean;
}

export const useHandleApproval = (options?: Partial<UseMutationOptions<WorkflowRun, Error, HandleApprovalVariables>>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ runId, approved }: HandleApprovalVariables): Promise<WorkflowRun> => {
      const response = await apiClient.post<ApiResponse<WorkflowRun>>(
        `/runs/${runId}/approve`,
        { approved }
      );
      return response.data.data;
    },
    onSuccess: (data: WorkflowRun, variables: HandleApprovalVariables): void => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.pendingApprovals() });
      queryClient.invalidateQueries({ queryKey: workflowKeys.runDetail(variables.runId) });
      queryClient.invalidateQueries({ queryKey: workflowKeys.runs() });
    },
    ...options,
  });
};

// ============================================
// STATS HOOKS
// ============================================

export const useWorkflowStats = (workflowId: string, options?: Partial<UseQueryOptions<WorkflowStats | null>>) => {
  return useQuery({
    queryKey: workflowKeys.stats(workflowId),
    queryFn: async (): Promise<WorkflowStats | null> => {
      const response = await apiClient.get<ApiResponse<WorkflowStats>>(`/workflows/${workflowId}/stats`);
      return response.data.data || null;
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    enabled: !!workflowId,
    ...options,
  });
};

// ============================================
// COMBINED HOOKS
// ============================================

interface WorkflowDashboardReturn {
  workflow: Workflow | null | undefined;
  runs: WorkflowRun[];
  stats: WorkflowStats | null | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useWorkflowDashboard = (workflowId: string): WorkflowDashboardReturn => {
  const workflowQuery = useWorkflow(workflowId);
  const runsQuery = useRuns({ workflowId, limit: 20 });
  const statsQuery = useWorkflowStats(workflowId);

  return {
    workflow: workflowQuery.data,
    runs: runsQuery.data?.runs || [],
    stats: statsQuery.data,
    isLoading: workflowQuery.isLoading || runsQuery.isLoading || statsQuery.isLoading,
    isError: workflowQuery.isError || runsQuery.isError || statsQuery.isError,
    error: workflowQuery.error || runsQuery.error || statsQuery.error,
    refetch: (): void => {
      workflowQuery.refetch();
      runsQuery.refetch();
      statsQuery.refetch();
    },
  };
};

// ============================================
// HELPER HOOKS
// ============================================

export const useHasPendingApprovals = (workflowId?: string): boolean => {
  const { data: pendingApprovals } = usePendingApprovals();

  if (!workflowId) return false;
  return pendingApprovals?.some((approval) => approval.workflowId === workflowId) || false;
};

export const useLatestRun = (workflowId: string): WorkflowRun | null => {
  const { data } = useRuns({ workflowId, limit: 1 });
  return data?.runs?.[0] || null;
};

// ============================================
// EXPORT DEFAULT
// ============================================

export default {
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useExecuteWorkflow,
  useRuns,
  useRun,
  useCancelRun,
  usePendingApprovals,
  useHandleApproval,
  useWorkflowStats,
  useWorkflowDashboard,
  useHasPendingApprovals,
  useLatestRun,
  workflowKeys,
};