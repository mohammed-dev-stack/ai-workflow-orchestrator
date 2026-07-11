// المسار: src/features/dashboard/components/StatusBadge.tsx

import React from 'react';
import { STATUS_CONFIG } from '../constants/statusConfig';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = React.memo(({ status }) => {
  const config = STATUS_CONFIG[status] || { label: status, className: 'badge-gray' };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
});

StatusBadge.displayName = 'StatusBadge';