// المسار: src/features/dashboard/components/RecentRunsTable.tsx

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInbox } from '@fortawesome/free-solid-svg-icons';
import type { WorkflowRun } from '../../../types';
import { StatusBadge } from './StatusBadge';

interface RecentRunsTableProps {
  runs: WorkflowRun[];
  loading: boolean;
  onRowClick: (runId: string) => void;
}

export const RecentRunsTable: React.FC<RecentRunsTableProps> = React.memo(({
  runs,
  loading,
  onRowClick,
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-4xl mb-2 flex justify-center" aria-hidden="true">
          <FontAwesomeIcon icon={faInbox} />
        </div>
        <p>No runs yet. Execute a workflow to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Run ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Steps</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {runs.map((run) => (
            <tr
              key={run._id}
              onClick={() => onRowClick(run._id)}
              className="hover:bg-gray-50 cursor-pointer transition-colors duration-150"
            >
              <td className="px-4 py-3 text-sm font-mono text-gray-900">{run._id.slice(0, 8)}...</td>
              <td className="px-4 py-3 text-sm">
                <StatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{run.steps.length} steps</td>
              <td className="px-4 py-3 text-sm text-gray-600">${run.totalCost.toFixed(4)}</td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {run.latencyMs > 0 ? `${(run.latencyMs / 1000).toFixed(1)}s` : '—'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {new Date(run.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

RecentRunsTable.displayName = 'RecentRunsTable';