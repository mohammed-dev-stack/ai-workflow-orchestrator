// المسار: src/features/workflows/hooks/usePendingApprovalActions.ts

import { useCallback } from 'react';
import { useHandleApproval } from '../../../hooks/useWorkflows';

interface UsePendingApprovalActionsProps {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export const usePendingApprovalActions = ({ onSuccess, onError }: UsePendingApprovalActionsProps = {}) => {
  const mutation = useHandleApproval({
    onSuccess: () => {
      if (onSuccess) onSuccess();
    },
    onError: (error: unknown) => {
      if (onError) onError(error);
    },
  });

  const approve = useCallback(
    (runId: string) => {
      mutation.mutate({ runId, approved: true });
    },
    [mutation]
  );

  const reject = useCallback(
    (runId: string) => {
      mutation.mutate({ runId, approved: false });
    },
    [mutation]
  );

  const isPending = mutation.isPending;

  return { approve, reject, isPending };
};