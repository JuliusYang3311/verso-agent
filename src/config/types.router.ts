/**
 * Smart model router configuration types.
 * Router dynamically selects models based on user input.
 */

/**
 * Smart model router configuration.
 */
export type RouterConfig = {
  /**
   * Enable smart model routing based on dynamic selection.
   * When disabled, uses the default model for all tasks.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Model used for dynamic model selection.
   * Should be a fast, low-cost model (e.g., "google/gemini-2.5-flash").
   * Format: "provider/model"
   */
  classifierModel?: string;

  /**
   * Timeout for selection LLM call in milliseconds.
   * Default: 10000
   */
  classificationTimeoutMs?: number;
};
