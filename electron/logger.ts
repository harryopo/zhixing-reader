import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** 敏感键名：命中时字符串值会被脱敏（total_tokens 之类统计字段不命中） */
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|cookie|password|credential|authorization|llmkey|wereadkey)/i;

const MAX_REDACT_DEPTH = 6;

/**
 * 深度脱敏：遍历对象/数组，敏感键名的非空字符串值替换为 [REDACTED]。
 * 在 write 落盘前统一应用，任何调用方都不会意外把密钥写进日志文件。
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(source)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === 'string' && val.length > 0) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitive(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
}

class Logger {
  private logPath: string;
  private logLevel: LogLevel = LogLevel.INFO;
  private stream: fs.WriteStream | null = null;

  constructor() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const date = new Date().toISOString().split('T')[0];
    this.logPath = path.join(logDir, `${date}.log`);
    this.initStream();
  }

  private initStream(): void {
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
  }

  setLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private formatEntry(level: string, message: string, data?: unknown): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
  }

  private write(level: LogLevel, levelName: string, message: string, data?: unknown): void {
    if (level < this.logLevel) return;

    const safeData = data === undefined ? undefined : redactSensitive(data);
    const entry = this.formatEntry(levelName, message, safeData);
    const line = safeData !== undefined
      ? `[${entry.timestamp}] [${entry.level}] ${entry.message} ${JSON.stringify(safeData)}\n`
      : `[${entry.timestamp}] [${entry.level}] ${entry.message}\n`;

    if (this.stream && !this.stream.destroyed) {
      this.stream.write(line);
    }

    const consoleMethod = level === LogLevel.ERROR ? 'error' : level === LogLevel.WARN ? 'warn' : 'log';
    // logger 本身负责把日志写到 console，动态方法名静态分析无法识别，此处豁免
    // eslint-disable-next-line no-console
    console[consoleMethod](line.trim());
  }

  debug(message: string, data?: unknown): void {
    this.write(LogLevel.DEBUG, 'DEBUG', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write(LogLevel.INFO, 'INFO', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write(LogLevel.WARN, 'WARN', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write(LogLevel.ERROR, 'ERROR', message, data);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

export const logger = new Logger();
export default logger;
