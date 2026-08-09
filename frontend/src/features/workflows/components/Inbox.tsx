// المسار: src/features/workflows/components/Inbox.tsx

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClock,
  faCircleCheck,
  faCircleXmark,
  faTriangleExclamation,
  faRotate,
  faInbox,
  faXmark,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { usePendingApprovals, useRun } from '../../../hooks/useWorkflows';
import { useWorkflowStore } from '../../../store/useWorkflowStore';
import type { WorkflowRun, PendingApproval } from '../../../types';
import { StatusBadge } from './StatusBadge';
import { usePendingApprovalActions } from '../hooks/usePendingApprovalActions';

// ============================================
// SUB-COMPONENTS
// ============================================

interface StepTimelineProps {
  run: WorkflowRun | PendingApproval;
}

const StepTimeline: React.FC<StepTimelineProps> = React.memo(({ run }) => {
  const steps = run.steps || [];
  const currentIndex = run.currentStepIndex || 0;

  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
      <div className="space-y-4">
        {steps.map((step, index) => {
          const isCompleted = step.status === 'executed';
          const isCurrent = index === currentIndex && step.status === 'pending';
          const isFailed = step.status === 'failed';
          const isWaitingApproval = step.requiresApproval && step.status === 'pending';

          let icon: React.ReactNode = '○';
          let iconColor = 'text-gray-400';
          let bgColor = 'bg-gray-100';

          if (isCompleted) {
            icon = <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5 text-green-500" />;
            bgColor = 'bg-green-50';
          } else if (isCurrent) {
            icon = <FontAwesomeIcon icon={faCircleCheck} className="h-3.5 w-3.5 text-blue-500 animate-pulse" />;
            bgColor = 'bg-blue-50';
          } else if (isFailed) {
            icon = <FontAwesomeIcon icon={faCircleXmark} className="h-3.5 w-3.5 text-red-500" />;
            bgColor = 'bg-red-50';
          } else if (isWaitingApproval) {
            icon = <FontAwesomeIcon icon={faClock} className="h-3.5 w-3.5 text-yellow-500 animate-pulse" />;
            bgColor = 'bg-yellow-50';
          }

          return (
            <div key={step.stepId} className={`relative pl-10 ${bgColor} rounded-lg p-3 transition-colors duration-150`}>
              <div className="absolute left-0 top-3 w-8 flex items-center justify-center">{icon}</div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-gray-900">{step.toolName || 'Unknown Step'}</span>
                  <span className="text-xs text-gray-500">
                    {step.startedAt ? new Date(step.startedAt).toLocaleTimeString() : '—'}
                  </span>
                </div>
                {step.input && Object.keys(step.input).length > 0 && (
                  <details className="mt-1">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors duration-150">
                      Input Details
                    </summary>
                    <pre className="mt-1 text-xs bg-gray-800 text-gray-200 p-2 rounded overflow-x-auto">
                      {JSON.stringify(step.input, null, 2)}
                    </pre>
                  </details>
                )}
                {step.output && (
                  <details className="mt-1">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors duration-150">
                      Output Details
                    </summary>
                    <pre className="mt-1 text-xs bg-gray-800 text-gray-200 p-2 rounded overflow-x-auto">
                      {JSON.stringify(step.output, null, 2)}
                    </pre>
                  </details>
                )}
                {step.requiresApproval && step.status === 'pending' && (
                  <div className="mt-1 flex items-center space-x-2">
                    <FontAwesomeIcon icon={faClock} className="h-3 w-3 text-yellow-600" aria-hidden="true" />
                    <span className="text-xs font-medium text-yellow-600">Requires Approval</span>
                    {step.approvedBy && (
                      <span className="text-xs text-green-600">Approved by {step.approvedBy}</span>
                    )}
                  </div>
                )}
                {step.retryCount > 0 && (
                  <span className="text-xs text-orange-600 mt-1 block">Retry attempt {step.retryCount}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

StepTimeline.displayName = 'StepTimeline';

interface ApprovalActionsProps {
  runId: string;
  onApprove: (runId: string) => void;
  onReject: (runId: string) => void;
  isProcessing: boolean;
}

const ApprovalActions: React.FC<ApprovalActionsProps> = React.memo(({ runId, onApprove, onReject, isProcessing }) => {
  return (
    <div className="flex items-center space-x-3">
      <button
        onClick={() => onApprove(runId)}
        disabled={isProcessing}
        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1.5"
        aria-label="Approve this workflow action"
      >
        <FontAwesomeIcon icon={faCircleCheck} className="h-4 w-4" />
        <span>Approve</span>
      </button>
      <button
        onClick={() => onReject(runId)}
        disabled={isProcessing}
        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1.5"
        aria-label="Reject this workflow action"
      >
        <FontAwesomeIcon icon={faCircleXmark} className="h-4 w-4" />
        <span>Reject</span>
      </button>
    </div>
  );
});

ApprovalActions.displayName = 'ApprovalActions';

interface RunDetailPanelProps {
  run: WorkflowRun | PendingApproval | null;
  isLoading: boolean;
  onClose: () => void;
  onApprove: (runId: string) => void;
  onReject: (runId: string) => void;
  isProcessing: boolean;
}

const RunDetailPanel: React.FC<RunDetailPanelProps> = React.memo(({
  run,
  isLoading,
  onClose,
  onApprove,
  onReject,
  isProcessing,
}) => {
  if (!run && !isLoading) {
    return (
      <div className="card h-full flex items-center justify-center border border-gray-200 rounded-lg p-6">
        <div className="text-center text-gray-500">
          <FontAwesomeIcon icon={faInbox} className="h-10 w-10 mb-3 text-gray-300" aria-hidden="true" />
          <p>Select a run from the list to view details</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card h-full border border-gray-200 rounded-lg p-6">
        <div className="space-y-4">
          <div className="h-8 bg-gray-200 rounded animate-pulse" />
          <div className="h-32 bg-gray-200 rounded animate-pulse" />
          <div className="h-24 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!run) return null;

  const isPendingApproval = run.status === 'waiting_approval';

  return (
    <div className="card h-full overflow-y-auto max-h-[calc(100vh-300px)] border border-gray-200 rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-semibold text-gray-900">Run Details</h2>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-xs text-gray-500 font-mono mt-1">ID: {run._id}</p>
          <p className="text-xs text-gray-500 mt-0.5">Workflow: {run.workflowId}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors duration-150 p-2 rounded-md hover:bg-gray-100"
          aria-label="Close details panel"
        >
          <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
        </button>
      </div>

      {run.context && Object.keys(run.context).length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Context</h4>
          <div className="bg-gray-50 rounded-lg p-3 overflow-x-auto border border-gray-100">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap">
              {JSON.stringify(run.context, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Execution Steps</h4>
        <StepTimeline run={run} />
      </div>

      {isPendingApproval && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-yellow-700 flex items-center">
                <FontAwesomeIcon icon={faClock} className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Human Decision Required
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Review the context and step details before approving.
              </p>
            </div>
            <ApprovalActions
              runId={run._id}
              onApprove={onApprove}
              onReject={onReject}
              isProcessing={isProcessing}
            />
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>
          <span className="font-medium">Created:</span> {new Date(run.createdAt).toLocaleString()}
        </div>
        <div>
          <span className="font-medium">Total Cost:</span> ${run.totalCost?.toFixed(4) || '0.0000'}
        </div>
        <div>
          <span className="font-medium">Latency:</span>{' '}
          {run.latencyMs > 0 ? `${(run.latencyMs / 1000).toFixed(1)}s` : '—'}
        </div>
        <div>
          <span className="font-medium">Steps:</span> {run.steps?.length || 0}
        </div>
        {run.errorMessage && (
          <div className="col-span-2 text-red-600 bg-red-50 p-2 rounded mt-1 border border-red-100 flex items-start">
            <FontAwesomeIcon icon={faTriangleExclamation} className="h-3.5 w-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
            <span className="font-medium">Error:</span>
            <span className="ml-1">{run.errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
});

RunDetailPanel.displayName = 'RunDetailPanel';

interface RunListItemProps {
  run: PendingApproval;
  isSelected: boolean;
  onSelect: (run: PendingApproval) => void;
}

const RunListItem: React.FC<RunListItemProps> = React.memo(({ run, isSelected, onSelect }) => {
  const currentStep = run.steps?.[run.currentStepIndex];
  const hasPendingApproval = run.status === 'waiting_approval';

  return (
    <div
      onClick={() => onSelect(run)}
      className={`
        p-4 border rounded-lg cursor-pointer transition-colors duration-150
        ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}
      `}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className="font-mono text-sm text-gray-900 truncate">{run._id.slice(0, 12)}...</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-1 flex items-center space-x-2 text-xs text-gray-500">
            <span>Workflow: {run.workflowId.slice(0, 10)}...</span>
            <span>•</span>
            <span>Steps: {run.steps?.length || 0}</span>
          </div>
          {hasPendingApproval && currentStep && (
            <div className="mt-1 text-xs text-yellow-700 bg-yellow-50 inline-block px-2 py-0.5 rounded border border-yellow-200 flex items-center">
              <FontAwesomeIcon icon={faClock} className="h-3 w-3 mr-1" aria-hidden="true" />
              Waiting: {currentStep.toolName}
            </div>
          )}
          {run.errorMessage && (
            <div className="mt-1 text-xs text-red-600 truncate flex items-center">
              <FontAwesomeIcon icon={faCircleXmark} className="h-3 w-3 mr-1" aria-hidden="true" />
              {run.errorMessage}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-400 flex-shrink-0 ml-2">
          {new Date(run.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
});

RunListItem.displayName = 'RunListItem';

const EmptyState: React.FC = React.memo(() => (
  <div className="text-center py-12">
    <FontAwesomeIcon icon={faInbox} className="h-12 w-12 text-gray-300 mb-3" aria-hidden="true" />
    <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Approvals</h3>
    <p className="text-sm text-gray-500">All workflows are running smoothly. Approvals will appear here when needed.</p>
  </div>
));

EmptyState.displayName = 'EmptyState';

// ============================================
// MAIN INBOX COMPONENT
// ============================================

export const Inbox: React.FC = React.memo(() => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [processingRunId, setProcessingRunId] = useState<string | null>(null);

  const { setSelectedRun, pendingApprovalsCount } = useWorkflowStore();

  const { data: pendingApprovals, isLoading: pendingLoading, refetch: refetchPending } = usePendingApprovals();

  const { data: selectedRun, isLoading: runLoading } = useRun(selectedRunId || '', {
    enabled: !!selectedRunId,
  });

  const runs = useMemo(() => {
    if (!pendingApprovals) return [];
    if (selectedRun && !pendingApprovals.some((r) => r._id === selectedRun._id)) {
      return [...pendingApprovals, selectedRun as PendingApproval];
    }
    return pendingApprovals;
  }, [pendingApprovals, selectedRun]);

  const handleApprovalSuccess = useCallback(() => {
    setProcessingRunId(null);
    refetchPending();
    if (selectedRunId) {
      const stillPending = pendingApprovals?.some((r) => r._id === selectedRunId);
      if (!stillPending) {
        setSelectedRunId(null);
        setSelectedRun(null);
      }
    }
  }, [refetchPending, selectedRunId, pendingApprovals, setSelectedRun]);

  const handleApprovalError = useCallback((error: unknown) => {
    setProcessingRunId(null);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    // TODO: يتطلب نظام toast مركزي
    alert(message);
  }, []);

  const { approve: handleApprove, reject: handleReject, isPending: isApprovalPending } = usePendingApprovalActions({
    onSuccess: handleApprovalSuccess,
    onError: handleApprovalError,
  });

  const handleSelectRun = useCallback(
    (run: PendingApproval) => {
      setSelectedRunId(run._id);
      setSelectedRun(run);
    },
    [setSelectedRun]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedRunId(null);
    setSelectedRun(null);
  }, [setSelectedRun]);

  useEffect(() => {
    if (!selectedRunId && pendingApprovals && pendingApprovals.length > 0) {
      setSelectedRunId(pendingApprovals[0]._id);
      setSelectedRun(pendingApprovals[0]);
    }
  }, [pendingApprovals, selectedRunId, setSelectedRun]);

  const isProcessing = processingRunId !== null || isApprovalPending;
  const isSelectedRunProcessing = selectedRunId === processingRunId;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and approve AI-suggested actions before they are executed.
            {pendingApprovalsCount > 0 && (
              <span className="ml-2 font-medium text-yellow-700">({pendingApprovalsCount} pending)</span>
            )}
          </p>
        </div>
        <button
          onClick={() => refetchPending()}
          className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={pendingLoading}
        >
          <FontAwesomeIcon icon={faRotate} className="h-3.5 w-3.5" />
          <span>{pendingLoading ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="card h-full max-h-[calc(100vh-250px)] overflow-y-auto border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">Pending Requests</h3>
              <span className="badge badge-yellow">{pendingApprovals?.length || 0}</span>
            </div>

            {pendingLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 bg-gray-200 rounded animate-pulse" />
                ))}
              </div>
            ) : runs.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <RunListItem
                    key={run._id}
                    run={run}
                    isSelected={selectedRunId === run._id}
                    onSelect={handleSelectRun}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <RunDetailPanel
            run={selectedRun || null}
            isLoading={runLoading && !!selectedRunId}
            onClose={handleCloseDetail}
            onApprove={(runId) => {
              setProcessingRunId(runId);
              handleApprove(runId);
            }}
            onReject={(runId) => {
              setProcessingRunId(runId);
              handleReject(runId);
            }}
            isProcessing={isSelectedRunProcessing}
          />
        </div>
      </div>
    </div>
  );
});

Inbox.displayName = 'Inbox';

export default Inbox;