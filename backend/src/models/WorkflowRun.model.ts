// المسار: backend/src/models/WorkflowRun.model.ts

import mongoose, { Schema, Document, model } from 'mongoose';
// ============================================
// ENUMS
// ============================================

export enum RunStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  WAITING_APPROVAL = 'waiting_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// ============================================
// TYPES
// ============================================

export interface IStep {
  stepId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'pending' | 'executed' | 'failed';
  requiresApproval: boolean;
  approvedBy?: string;
  retryCount: number;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface IWorkflowRun extends Document {
  workflowId: string;
  idempotencyKey: string;
  status: RunStatus;
  context: Record<string, unknown>;
  steps: IStep[];
  currentStepIndex: number;
  errorMessage?: string;
  totalCost: number;
  latencyMs: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// CONSTANTS
// ============================================

const IDEMPOTENCY_KEY_PREFIX = 'run';
const MAX_PENDING_APPROVALS_LIMIT = 50;

// ============================================
// SUB-SCHEMA: Step
// ============================================

const StepSchema = new Schema<IStep>(
  {
    stepId: {
      type: String,
      required: [true, 'Step ID is required'],
      trim: true,
    },
    toolName: {
      type: String,
      required: [true, 'Tool name is required'],
      trim: true,
    },
    input: {
      type: Schema.Types.Mixed,
      required: [true, 'Input is required'],
      default: {},
    },
    output: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'executed', 'failed'],
        message: 'Invalid step status. Must be pending, executed, or failed',
      },
      default: 'pending',
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: String,
      default: null,
      trim: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      min: [0, 'Retry count cannot be negative'],
      max: [10, 'Retry count cannot exceed 10'],
    },
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
  }
);

// ============================================
// MAIN SCHEMA: WorkflowRun
// ============================================

const WorkflowRunSchema = new Schema<IWorkflowRun>(
  {
    workflowId: {
      type: String,
      required: [true, 'Workflow ID is required'],
      index: true,
      trim: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required'],
      unique: true,
      index: true,
      trim: true,
      validate: {
        validator: (value: string): boolean => value.length >= 10,
        message: 'Idempotency key must be at least 10 characters',
      },
    },
    status: {
      type: String,
      enum: {
        values: Object.values(RunStatus),
        message: 'Invalid run status',
      },
      default: RunStatus.IDLE,
      index: true,
    },
    context: {
      type: Schema.Types.Mixed,
      default: {},
    },
    steps: {
      type: [StepSchema],
      default: [],
    },
    currentStepIndex: {
      type: Number,
      default: 0,
      min: [0, 'Current step index cannot be negative'],
    },
    errorMessage: {
      type: String,
      default: null,
      trim: true,
    },
    totalCost: {
      type: Number,
      default: 0,
      min: [0, 'Total cost cannot be negative'],
    },
    latencyMs: {
      type: Number,
      default: 0,
      min: [0, 'Latency cannot be negative'],
    },
  },
  {
    timestamps: true,
    collection: 'workflowruns',
  }
);

// ============================================
// INDEXES
// ============================================

WorkflowRunSchema.index({ status: 1, createdAt: -1 });
WorkflowRunSchema.index({ workflowId: 1, status: 1 });
WorkflowRunSchema.index({ idempotencyKey: 1 }, { unique: true });
WorkflowRunSchema.index({ createdAt: 1 });

// ============================================
// PRE-SAVE HOOKS
// ============================================

WorkflowRunSchema.pre<IWorkflowRun>('save', function (next): void {
  try {
    // Ensure currentStepIndex doesn't exceed steps length
    if (this.currentStepIndex > this.steps.length) {
      this.currentStepIndex = this.steps.length;
    }

    // Generate idempotency key if not provided
    if (!this.idempotencyKey) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      this.idempotencyKey = `${IDEMPOTENCY_KEY_PREFIX}_${timestamp}_${random}`;
    }

    // Validate that current step index doesn't point to a non-existent step
    if (this.currentStepIndex > 0 && this.steps.length === 0) {
      this.currentStepIndex = 0;
    }

    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error in pre-save hook';
    next(new Error(`WorkflowRun validation failed: ${message}`));
  }
});

// ============================================
// VIRTUALS
// ============================================

/**
 * Get the current step of the workflow run
 */
WorkflowRunSchema.virtual('currentStep').get(function (this: IWorkflowRun): IStep | null {
  // استخدام التجميع للتحقق من وجود العنصر
  const step = this.steps[this.currentStepIndex];
  
  // إذا كان step هو undefined، سيتم إرجاع null، وهو ما يتوافق مع النوع المعرف (IStep | null)
  return step ?? null;
});

/**
 * Get the number of completed steps
 */
WorkflowRunSchema.virtual('completedStepsCount').get(function (this: IWorkflowRun): number {
  return this.steps.filter((step) => step.status === 'executed').length;
});

/**
 * Get the number of failed steps
 */
WorkflowRunSchema.virtual('failedStepsCount').get(function (this: IWorkflowRun): number {
  return this.steps.filter((step) => step.status === 'failed').length;
});

// ============================================
// STATIC METHODS
// ============================================

/**
 * Find pending approvals with limit
 */
WorkflowRunSchema.statics.findPendingApprovals = function (): mongoose.Query<IWorkflowRun[], IWorkflowRun> {
  return this.find({ status: RunStatus.WAITING_APPROVAL })
    .sort({ createdAt: 1 })
    .limit(MAX_PENDING_APPROVALS_LIMIT);
};

/**
 * Find runs by status with pagination
 */
WorkflowRunSchema.statics.findByStatus = function (
  status: RunStatus,
  limit: number = 20,
  offset: number = 0
): mongoose.Query<IWorkflowRun[], IWorkflowRun> {
  return this.find({ status })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(Math.min(limit, 100));
};

/**
 * Check if a run exists with the given idempotency key
 */
WorkflowRunSchema.statics.existsByIdempotencyKey = function (
  idempotencyKey: string
): mongoose.Query<boolean, IWorkflowRun> {
  return this.exists({ idempotencyKey });
};

// ============================================
// TOJSON TRANSFORM
// ============================================

WorkflowRunSchema.set('toJSON', {
  virtuals: true,
  // تغيير النوع من void إلى any
  transform: (_, ret): any => {
    const { __v, ...rest } = ret;
    return rest; // الآن سيقبل TypeScript إرجاع الكائن
  },
});

// ============================================
// MODEL CREATION
// ============================================

export const WorkflowRunModel = model<IWorkflowRun>('WorkflowRun', WorkflowRunSchema);

// ============================================
// TYPE EXPORTS
// ============================================

export type WorkflowRunDocument = IWorkflowRun;
export type Step = IStep;