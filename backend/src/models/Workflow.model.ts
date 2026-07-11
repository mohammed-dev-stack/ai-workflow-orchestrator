// المسار: backend/src/models/Workflow.model.ts

import mongoose, { Schema, Document, model } from 'mongoose';

// ============================================
// TYPES
// ============================================

/**
 * Interface for a workflow definition
 * This is the template that users create in the Workflow Builder
 */
export interface IWorkflow extends Document {
  name: string;
  description?: string;
  version: number;
  steps: IWorkflowStep[];
  isActive: boolean;
  createdBy: string;
  tags: string[];
  estimatedCostPerRun: number;
  successRate: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for a step definition within a workflow template
 */
export interface IWorkflowStep {
  stepId: string;
  toolName: string;
  description?: string;
  inputTemplate: Record<string, unknown>;
  requiresApproval: boolean;
  order: number;
  isOptional: boolean;
  retryPolicy: {
    maxRetries: number;
    backoffDelay: number;
  };
  timeoutMs: number;
}

// ============================================
// CONSTANTS
// ============================================

const STEP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_COST_PER_RUN = 0.01;

// ============================================
// SUB-SCHEMA: Workflow Step
// ============================================

const WorkflowStepSchema = new Schema<IWorkflowStep>(
  {
    stepId: {
      type: String,
      required: [true, 'Step ID is required'],
      unique: true,
      validate: {
        validator: (value: string): boolean => STEP_ID_PATTERN.test(value),
        message: 'Step ID must contain only alphanumeric characters, hyphens, and underscores',
      },
    },
    toolName: {
      type: String,
      required: [true, 'Tool name is required'],
      enum: {
        values: ['send_email', 'create_calendar_event', 'create_jira_ticket', 'custom_webhook'],
        message: 'Invalid tool name. Must be one of: send_email, create_calendar_event, create_jira_ticket, custom_webhook',
      },
    },
    description: {
      type: String,
      default: '',
      maxlength: 500,
    },
    inputTemplate: {
      type: Schema.Types.Mixed,
      required: [true, 'Input template is required'],
      default: {},
      validate: {
        validator: (value: unknown): boolean => {
          return value !== null && typeof value === 'object';
        },
        message: 'Input template must be a valid JSON object',
      },
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      required: [true, 'Step order is required'],
      min: [0, 'Order must be a non-negative integer'],
    },
    isOptional: {
      type: Boolean,
      default: false,
    },
    retryPolicy: {
      maxRetries: {
        type: Number,
        default: DEFAULT_RETRY_MAX,
        min: [0, 'Max retries cannot be negative'],
        max: [10, 'Max retries cannot exceed 10'],
      },
      backoffDelay: {
        type: Number,
        default: DEFAULT_RETRY_DELAY_MS,
        min: [1000, 'Backoff delay must be at least 1000ms'],
        max: [60000, 'Backoff delay cannot exceed 60000ms'],
      },
    },
    timeoutMs: {
      type: Number,
      default: DEFAULT_TIMEOUT_MS,
      min: [5000, 'Timeout must be at least 5000ms'],
      max: [120000, 'Timeout cannot exceed 120000ms'],
    },
  },
  {
    _id: false,
  }
);

// ============================================
// MAIN SCHEMA: Workflow
// ============================================

const WorkflowSchema = new Schema<IWorkflow>(
  {
    name: {
      type: String,
      required: [true, 'Workflow name is required'],
      trim: true,
      minlength: [3, 'Workflow name must be at least 3 characters'],
      maxlength: [100, 'Workflow name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    version: {
      type: Number,
      default: 1,
      min: [1, 'Version must be at least 1'],
    },
    steps: {
      type: [WorkflowStepSchema],
      validate: {
        validator: function (steps: IWorkflowStep[]): boolean {
          if (!steps || steps.length === 0) return false;

          // Ensure steps are ordered correctly
          const orders = steps.map((s) => s.order);
          const sortedOrders = [...orders].sort((a, b) => a - b);
          return orders.every((v, i) => v === sortedOrders[i]);
        },
        message: 'Steps must be in sequential order (0, 1, 2, ...)',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: String,
      required: [true, 'Creator is required'],
      default: 'system',
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
      validate: {
        validator: function (tags: string[]): boolean {
          return tags.every((tag) => tag.length <= 50);
        },
        message: 'Tags cannot exceed 50 characters',
      },
    },
    estimatedCostPerRun: {
      type: Number,
      default: DEFAULT_COST_PER_RUN,
      min: [0, 'Estimated cost cannot be negative'],
    },
    successRate: {
      type: Number,
      default: 0,
      min: [0, 'Success rate cannot be negative'],
      max: [100, 'Success rate cannot exceed 100'],
    },
  },
  {
    timestamps: true,
    collection: 'workflows',
  }
);

// ============================================
// INDEXES
// ============================================

WorkflowSchema.index({ isActive: 1, name: 1 });
WorkflowSchema.index({ tags: 1 });
WorkflowSchema.index({ createdBy: 1, createdAt: -1 });
WorkflowSchema.index({ name: 'text', description: 'text', tags: 'text' });

// ============================================
// PRE-SAVE HOOKS
// ============================================

WorkflowSchema.pre<IWorkflow>('save', function (next): void {
  try {
    // Ensure version increments on updates
    if (!this.isNew && this.isModified('steps')) {
      this.version += 1;
    }

    // Validate no duplicate stepIds
    const stepIds = this.steps.map((s) => s.stepId);
    const uniqueIds = new Set(stepIds);
    if (stepIds.length !== uniqueIds.size) {
      next(new Error('Duplicate stepId detected'));
      return;
    }

    // Ensure order starts at 0 and is continuous
    const orders = this.steps.map((s) => s.order).sort((a, b) => a - b);
    if (orders.length > 0 && orders[0] !== 0) {
      next(new Error('Step order must start at 0'));
      return;
    }

    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i) {
        next(new Error(`Step order missing value: ${i}`));
        return;
      }
    }

    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error in pre-save hook';
    next(new Error(`Workflow validation failed: ${message}`));
  }
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Clone a workflow with a new version
 */
WorkflowSchema.methods.clone = function (this: IWorkflow): IWorkflow {
  const cloned = this.toObject();
  delete cloned._id;
  delete cloned.createdAt;
  delete cloned.updatedAt;
  cloned.version = 1;
  cloned.isActive = false;
  return cloned as IWorkflow;
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get active workflows
 */
WorkflowSchema.statics.findActive = function (): mongoose.Query<IWorkflow[], IWorkflow> {
  return this.find({ isActive: true }).sort({ name: 1 });
};

/**
 * Get workflows by tag
 */
WorkflowSchema.statics.findByTag = function (tag: string): mongoose.Query<IWorkflow[], IWorkflow> {
  return this.find({ tags: tag, isActive: true }).sort({ name: 1 });
};

/**
 * Search workflows by text
 */
WorkflowSchema.statics.search = function (query: string): mongoose.Query<IWorkflow[], IWorkflow> {
  if (!query || query.trim().length === 0) {
    return this.find({ isActive: true });
  }
  return this.find(
    { $text: { $search: query }, isActive: true },
    { score: { $meta: 'textScore' } }
  ).sort({ score: { $meta: 'textScore' } });
};

// ============================================
// TOJSON TRANSFORM
// ============================================

WorkflowSchema.set('toJSON', {
  virtuals: true,
  transform: (_, ret): Record<string, unknown> => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

// ============================================
// MODEL CREATION
// ============================================

export const WorkflowModel = model<IWorkflow>('Workflow', WorkflowSchema);

// ============================================
// TYPE EXPORTS
// ============================================

export type WorkflowStep = IWorkflowStep;