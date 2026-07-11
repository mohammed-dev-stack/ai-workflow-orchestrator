// المسار: src/features/settings/components/StatusBadge.tsx

import React from 'react';

interface StatusBadgeProps {
  isActive: boolean;
  label: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ isActive, label }) => {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
        isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
          isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
        }`}
      />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
};

StatusBadge.displayName = 'StatusBadge';