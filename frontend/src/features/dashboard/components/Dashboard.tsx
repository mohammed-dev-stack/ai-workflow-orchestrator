// المسار: src/features/dashboard/components/Dashboard.tsx

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlay,
  faRotate,
  faInbox,
  faPlus,
  faClock,
  faCircleCheck,
  faCircleXmark,
  faTriangleExclamation,
  faChartSimple,
  faCoins,
  faSpinner,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { useWorkflows, useRuns, usePendingApprovals, useWorkflowDashboard, useExecuteWorkflow } from '../../../hooks/useWorkflows';
import { useWorkflowStore } from '../../../store/useWorkflowStore';
import type { WorkflowRun, Workflow } from '../../../types';
import { StatCard } from './StatCard';
import { StatusBadge } from './StatusBadge';
import { RecentRunsTable } from './RecentRunsTable';
import { ExecuteWorkflowModal } from '../../workflows/components/ExecuteWorkflowModal';
import { PendingApprovalsCard } from './PendingApprovalsCard';

// ============================================
// MAIN DASHBOARD COMPONENT
// ============================================

export const Dashboard: React.FC = React.memo(() => {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [executeModalOpen, setExecuteModalOpen] = useState<boolean>(false);
  const [selectedWorkflowForExecute, setSelectedWorkflowForExecute] = useState<Workflow | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  const { setSelectedRun, startPolling, stopPolling } = useWorkflowStore();

  const { data: workflows, isLoading: workflowsLoading, refetch: refetchWorkflows } = useWorkflows({ isActive: true });
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useRuns({ limit: 20 });
  const { data: pendingApprovals, refetch: refetchPending } = usePendingApprovals();

  const executeMutation = useExecuteWorkflow({
    onSuccess: (): void => {
      setExecuteModalOpen(false);
      setSelectedWorkflowForExecute(null);
      setIsExecuting(false);
      setTimeout(() => {
        refetchWorkflows();
        refetchRuns();
        refetchPending();
      }, 500);
    },
    onError: (error: unknown): void => {
      setIsExecuting(false);
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      // TODO: يتطلب نظام toast مركزي
      alert(`Failed to execute workflow: ${message}`);
    },
  });

  const stats = useMemo(() => {
    const runs = runsData?.runs || [];
    const pending = pendingApprovals || [];
    const completed = runs.filter((r) => r.status === 'completed');
    const failed = runs.filter((r) => r.status === 'failed');
    const waiting = runs.filter((r) => r.status === 'waiting_approval');

    const totalCost = runs.reduce((sum, r) => sum + (r.totalCost || 0), 0);
    const avgLatency =
      completed.length > 0 ? completed.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / completed.length : 0;

    return {
      totalRuns: runs.length,
      completedRuns: completed.length,
      failedRuns: failed.length,
      waitingApproval: waiting.length + pending.length,
      totalCost,
      avgLatency,
      successRate: runs.length > 0 ? (completed.length / runs.length) * 100 : 0,
    };
  }, [runsData, pendingApprovals]);

  const handleRowClick = useCallback(
    (runId: string): void => {
      const run = runsData?.runs.find((r) => r._id === runId);
      if (run) {
        setSelectedRun(run);
        const event = new CustomEvent('tabChange', { detail: { tab: 'inbox', runId } });
        document.dispatchEvent(event);
      }
    },
    [runsData, setSelectedRun]
  );

  const handleWorkflowSelect = useCallback((workflowId: string): void => {
    setSelectedWorkflowId(workflowId);
  }, []);

  const handleRefresh = useCallback((): void => {
    setRefreshKey((prev) => prev + 1);
    refetchWorkflows();
    refetchRuns();
    refetchPending();
  }, [refetchWorkflows, refetchRuns, refetchPending]);

  const handleExecuteClick = useCallback((workflow: Workflow): void => {
    setSelectedWorkflowForExecute(workflow);
    setExecuteModalOpen(true);
  }, []);

  const handleExecuteWorkflow = useCallback(
    (workflowId: string, context: Record<string, unknown>): void => {
      setIsExecuting(true);
      executeMutation.mutate({ workflowId, context });
    },
    [executeMutation]
  );

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const renderWorkflowList = (): React.ReactNode => {
    if (workflowsLoading) {
      return (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      );
    }

    if (!workflows || workflows.length === 0) {
      return <p className="text-sm text-gray-500 text-center py-4">No workflows created yet.</p>;
    }

    return (
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {workflows.slice(0, 10).map((w) => (
          <div
            key={w._id}
            className="flex items-center justify-between py-2 px-2 hover:bg-gray-50 rounded transition-colors duration-150"
          >
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleWorkflowSelect(w._id)}>
              <span className="text-sm text-gray-700">{w.name}</span>
              <span className={`ml-2 badge ${w.isActive ? 'badge-green' : 'badge-gray'}`}>
                {w.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleExecuteClick(w);
              }}
              disabled={!w.isActive}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors duration-150 flex items-center space-x-1 ${
                w.isActive ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title={w.isActive ? 'Execute workflow' : 'Workflow is inactive'}
              aria-label={`Execute ${w.name}`}
            >
              <FontAwesomeIcon icon={faPlay} className="h-3 w-3" />
              <span>Execute</span>
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time overview of your AI workflow orchestration</p>
        </div>
        <button
          onClick={handleRefresh}
          className="btn-outline text-sm flex items-center space-x-2 transition-colors duration-150"
        >
          <FontAwesomeIcon icon={faRotate} className="h-4 w-4" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Runs"
          value={stats.totalRuns}
          icon={<FontAwesomeIcon icon={faChartSimple} className="h-6 w-6" />}
          color="blue"
          loading={runsLoading}
        />
        <StatCard
          title="Success Rate"
          value={`${stats.successRate.toFixed(1)}%`}
          icon={<FontAwesomeIcon icon={faCircleCheck} className="h-6 w-6" />}
          color="green"
          loading={runsLoading}
          subtitle={`${stats.completedRuns} completed / ${stats.failedRuns} failed`}
        />
        <StatCard
          title="Pending Approvals"
          value={stats.waitingApproval}
          icon={<FontAwesomeIcon icon={faClock} className="h-6 w-6" />}
          color="yellow"
          loading={runsLoading || !pendingApprovals}
        />
        <StatCard
          title="Total Cost"
          value={`$${stats.totalCost.toFixed(4)}`}
          icon={<FontAwesomeIcon icon={faCoins} className="h-6 w-6" />}
          color="purple"
          loading={runsLoading}
          subtitle={`Avg latency: ${(stats.avgLatency / 1000).toFixed(1)}s`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Recent Runs</h2>
                <p className="text-sm text-gray-500">Latest workflow executions</p>
              </div>
              {workflows && workflows.length > 0 && (
                <select
                  className="input-field w-48 text-sm"
                  value={selectedWorkflowId}
                  onChange={(e) => handleWorkflowSelect(e.target.value)}
                  aria-label="Filter workflows"
                >
                  <option value="">All Workflows</option>
                  {workflows.map((w) => (
                    <option key={w._id} value={w._id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <RecentRunsTable runs={runsData?.runs || []} loading={runsLoading} onRowClick={handleRowClick} />
          </div>
        </div>

        <div className="space-y-4">
          <PendingApprovalsCard />

          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const event = new CustomEvent('tabChange', { detail: { tab: 'builder' } });
                  document.dispatchEvent(event);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 flex items-center justify-center space-x-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <FontAwesomeIcon icon={faPlus} className="h-4 w-4" />
                <span>Create New Workflow</span>
              </button>
              <button
                onClick={() => {
                  const event = new CustomEvent('tabChange', { detail: { tab: 'inbox' } });
                  document.dispatchEvent(event);
                }}
                className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 flex items-center justify-center space-x-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <FontAwesomeIcon icon={faInbox} className="h-4 w-4" />
                <span>Go to Inbox</span>
                {stats.waitingApproval > 0 && <span className="badge badge-red">{stats.waitingApproval}</span>}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Workflows</h3>
            {renderWorkflowList()}
          </div>
        </div>
      </div>
    </div>
  );
});

Dashboard.displayName = 'Dashboard';

export default Dashboard;