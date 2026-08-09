// المسار: src/features/settings/components/ModeCard.tsx

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons';

interface ModeCardProps {
  mode: 'mock' | 'real';
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  isActive: boolean;
  isLoading: boolean;
  onClick: () => void;
}

export const ModeCard: React.FC<ModeCardProps> = ({
  mode,
  icon,
  title,
  description,
  features,
  isActive,
  isLoading,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      disabled={isLoading || isActive}
      className={`
        group relative p-4 border-2 rounded-lg text-left transition-colors duration-150
        ${isActive ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'}
        disabled:opacity-50 disabled:cursor-not-allowed
      `}
      aria-label={`Switch to ${title}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {isActive && (
          <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Active</span>
        )}
      </div>
      <h4 className="font-medium text-gray-900 mt-2">{title}</h4>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {features.map((feature, index) => (
          <span
            key={index}
            className={`text-xs px-2 py-0.5 rounded-full ${
              isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {feature}
          </span>
        ))}
      </div>
      {isLoading && !isActive && (
        <div className="absolute inset-0 bg-white/50 rounded-lg flex items-center justify-center">
          <FontAwesomeIcon icon={faSpinner} className="h-6 w-6 text-blue-500 animate-spin" />
        </div>
      )}
    </button>
  );
};

ModeCard.displayName = 'ModeCard';