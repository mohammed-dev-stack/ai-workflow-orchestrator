import React, { useState, useCallback, lazy, Suspense, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartSimple,
  faInbox,
  faWrench,
  faGear,
  faRobot,
  faCircle,
} from '@fortawesome/free-solid-svg-icons';
import { useWorkflowStore } from './store/useWorkflowStore';
import './index.css';

// ============================================
// TYPES
// ============================================

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

// ============================================
// LAZY LOADED COMPONENTS (المسارات الصحيحة بعد التقسيم)
// ============================================

const Dashboard = lazy(() => import('./features/dashboard/components/Dashboard'));
const Inbox = lazy(() => import('./features/workflows/components/Inbox'));
const WorkflowBuilder = lazy(() => import('./features/workflows/components/WorkflowBuilder'));
const AISettings = lazy(() => import('./features/settings/components/AISettings'));

// ============================================
// LOADING FALLBACK
// ============================================

const LoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <div className="relative w-16 h-16 mx-auto mb-4">
        <div className="absolute inset-0 border-4 border-blue-200 rounded-full" />
        <div className="absolute inset-0 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <FontAwesomeIcon icon={faRobot} className="h-6 w-6 text-blue-600" />
        </div>
      </div>
      <p className="text-gray-600 text-sm font-medium">Loading...</p>
    </div>
  </div>
);

// ============================================
// NAVIGATION COMPONENT
// ============================================

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange }) => {
  const pendingCount = useWorkflowStore((state) => state.pendingApprovalsCount);

  const tabs: Tab[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <FontAwesomeIcon icon={faChartSimple} className="h-4 w-4" /> },
    {
      id: 'inbox',
      label: 'Approval Inbox',
      icon: <FontAwesomeIcon icon={faInbox} className="h-4 w-4" />,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { id: 'builder', label: 'Workflow Builder', icon: <FontAwesomeIcon icon={faWrench} className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <FontAwesomeIcon icon={faGear} className="h-4 w-4" /> },
  ];

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center space-x-2">
              <div className="relative">
                <FontAwesomeIcon icon={faRobot} className="h-6 w-6 text-blue-600" />
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              </div>
              <span className="text-xl font-bold text-gray-900 hidden sm:block">
                AI Orchestrator
              </span>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  relative px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150
                  flex items-center space-x-2
                  ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }
                `}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Status Indicator */}
          <div className="flex items-center space-x-3">
            <div className="hidden md:flex items-center space-x-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                <FontAwesomeIcon icon={faCircle} className="w-1.5 h-1.5 mr-1.5 text-green-500 animate-pulse" />
                Live
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden flex justify-around py-2 border-t border-gray-200 bg-gray-50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex flex-col items-center px-3 py-1 text-xs font-medium
              ${activeTab === tab.id ? 'text-blue-600' : 'text-gray-500'}
            `}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge && (
              <span className="mt-0.5 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

// ============================================
// MAIN APP COMPONENT
// ============================================

function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  const fetchPendingApprovals = useWorkflowStore((state) => state.fetchPendingApprovals);
  const { startPolling, stopPolling } = useWorkflowStore();

  // Fetch pending approvals and start polling on mount
  useEffect(() => {
    fetchPendingApprovals();
    startPolling();

    return () => {
      stopPolling();
    };
  }, [fetchPendingApprovals, startPolling, stopPolling]);

  // ✅ المستمع الصحيح لأحداث تغيير التبويب (على document)
  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { tab } = customEvent.detail;
      if (typeof tab === 'string') {
        setActiveTab(tab);
      }
    };

    document.addEventListener('tabChange', handleTabChange);
    return () => {
      document.removeEventListener('tabChange', handleTabChange);
    };
  }, []);

  const handleTabChange = useCallback((tab: string): void => {
    setActiveTab(tab);
  }, []);

  const renderActiveTab = (): React.ReactNode => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'inbox':
        return <Inbox />;
      case 'builder':
        return <WorkflowBuilder />;
      case 'settings':
        return <AISettings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Suspense fallback={<LoadingFallback />}>
          {renderActiveTab()}
        </Suspense>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            AI Workflow Orchestrator v1.0 — Enterprise Multi-Agent System with Human-in-the-Loop
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;