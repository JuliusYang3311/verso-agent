export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diff < 60) {
    return "Just now";
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`;
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`;
  }
  return `${Math.floor(diff / 86400)}d ago`;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function generateId(): string {
  return `wm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Simple in-memory rate limiter / circuit breaker state
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const FEED_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FAILURES = 2;

export function isFeedOnCooldown(feedName: string): boolean {
  const state = feedFailures.get(feedName);
  if (!state) {
    return false;
  }
  if (Date.now() < state.cooldownUntil) {
    return true;
  }
  if (state.cooldownUntil > 0) {
    feedFailures.delete(feedName);
  }
  return false;
}

export function recordFeedFailure(feedName: string): void {
  const state = feedFailures.get(feedName) || { count: 0, cooldownUntil: 0 };
  state.count++;
  if (state.count >= MAX_FAILURES) {
    state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    // console.warn(`[RSS] ${feedName} on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedName, state);
}

export function recordFeedSuccess(feedName: string): void {
  feedFailures.delete(feedName);
}
