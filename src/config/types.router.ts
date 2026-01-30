/**
 * Smart model router configuration types.
 * Router classifies user input and selects appropriate model for execution.
 */

/**
 * Built-in task categories for router classification.
 * Users can also define custom task types as strings.
 */
export type RouterTaskType =
  | "coding"
  | "writing"
  | "analysis"
  | "chat"
  | "reasoning"
  | "creative"
  | string;

/**
 * Smart model router configuration.
 */
export type RouterConfig = {
  /**
   * Enable smart model routing based on task classification.
   * When disabled, uses the default model for all tasks.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Model used for task classification.
   * Should be a fast, low-cost model (e.g., "google/gemini-2.0-flash").
   * Format: "provider/model"
   */
  classifierModel?: string;

  /**
   * Task type to model mappings.
   * Example: { coding: "anthropic/claude-sonnet-4-5", writing: "google/gemini-2.5-pro" }
   */
  taskModels?: Record<RouterTaskType, string>;

  /**
   * Default task type when classification fails or returns unknown.
   * Default: "chat"
   */
  defaultTask?: RouterTaskType;

  /**
   * Custom classification prompt override.
   * Use {input} placeholder for user input.
   */
  classificationPrompt?: string;

  /**
   * Timeout for classification LLM call in milliseconds.
   * Default: 5000
   */
  classificationTimeoutMs?: number;
};
