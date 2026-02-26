/**
 * Structured logging for WeCom plugin.
 * Respects WECOM_LOG_LEVEL / LOG_LEVEL env vars.
 */

const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

type LogLevel = "debug" | "info" | "warn" | "error";

function getEnvLogLevel(): string {
  const raw = (process.env.WECOM_LOG_LEVEL || process.env.LOG_LEVEL || "info").toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? raw : "info";
}

export class Logger {
  private readonly prefix: string;
  private readonly level: string;

  constructor(prefix = "[wecom]", level = getEnvLogLevel()) {
    this.prefix = prefix;
    this.level = level;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if ((LEVELS[level] ?? 0) < (LEVELS[this.level] ?? 0)) return;
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    const logMessage = `${timestamp} ${level.toUpperCase()} ${this.prefix} ${message}${contextStr}`;
    switch (level) {
      case "debug":
        console.debug(logMessage);
        break;
      case "info":
        console.info(logMessage);
        break;
      case "warn":
        console.warn(logMessage);
        break;
      case "error":
        console.error(logMessage);
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }
  child(subPrefix: string): Logger {
    return new Logger(`${this.prefix}:${subPrefix}`, this.level);
  }
}

export const logger = new Logger();
