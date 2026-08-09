// المسار: src/features/workflows/constants/statusConfig.ts

export const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'badge-gray' },
  running: { label: 'Running', className: 'badge-blue animate-pulse' },
  waiting_approval: { label: 'Waiting Approval', className: 'badge-yellow' },
  approved: { label: 'Approved', className: 'badge-green' },
  rejected: { label: 'Rejected', className: 'badge-red' },
  completed: { label: 'Completed', className: 'badge-green' },
  failed: { label: 'Failed', className: 'badge-red' },
};