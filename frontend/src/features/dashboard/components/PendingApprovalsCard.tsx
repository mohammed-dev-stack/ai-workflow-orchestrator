// المسار: src/features/dashboard/components/PendingApprovalsCard.tsx

import React, { useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClock, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { usePendingApprovals } from '../../../hooks/useWorkflows';
import { useWorkflowStore } from '../../../store/useWorkflowStore';

export const PendingApprovalsCard: React.FC = React.memo(() => {
  const { data: pendingApprovals, isLoading } = usePendingApprovals();
  const { setSelectedRun } = useWorkflowStore();
  const navigateToInbox = useCallback((): void => {
    const event = new CustomEvent('tabChange', { detail: { tab: 'inbox' } });
    document.dispatchEvent(event);
  }, []);

  if (isLoading) {
    return (
      <div className="card">
        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const pending = pendingApprovals || [];
  if (pending.length === 0) {
    return (
      <div className="card border-green-200 bg-green-50">
        <div className="flex items-center space-x-3">
          <FontAwesomeIcon icon={faCircleCheck} className="h-6 w-6 text-green-600" aria-hidden="true" />
          <div>
            <p className="font-medium text-green-800">No Pending Approvals</p>
            <p className="text-sm text-green-600">All workflows are running smoothly.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-yellow-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <FontAwesomeIcon icon={faClock} className="h-5 w-5 text-yellow-600" aria-hidden="true" />
          <h3 className="font-semibold text-gray-900">Pending Approvals</h3>
          <span className="badge badge-yellow">{pending.length}</span>
        </div>
        <button onClick={navigateToInbox} className="btn-outline text-sm">
          View All →
        </button>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {pending.slice(0, 5).map((approval) => (
          <div
            key={approval._id}
            className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg border border-yellow-200 hover:bg-yellow-100 transition-colors duration-150 cursor-pointer"
            onClick={() => {
              setSelectedRun(approval);
              navigateToInbox();
            }}
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{approval.workflowId.slice(0, 12)}...</p>
              <p className="text-xs text-gray-600 truncate">
                {approval.steps[approval.currentStepIndex]?.toolName || 'Unknown tool'}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-500">{new Date(approval.createdAt).toLocaleTimeString()}</span>
              <FontAwesomeIcon icon={faClock} className="h-4 w-4 text-yellow-600 animate-pulse" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

PendingApprovalsCard.displayName = 'PendingApprovalsCard';