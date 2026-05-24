export class Logger {
  private static instance: Logger;
  private debugMode: boolean;
  private prefix: string;

  private constructor(debug: boolean = false, prefix: string = 'ClientMCP') {
    this.debugMode = debug;
    this.prefix = `[${prefix}]:`;
  }

  /**
   * Initialize the logger
   */
  public static getInstance(debug: boolean = false, prefix?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(debug, prefix);
    }
    return Logger.instance;
  }

  /**
   * Log debug message
   */
  public debug(...args: unknown[]): void {
    if (this.debugMode) {
      console.debug(this.prefix, "[debug]:", ...args);
    }
  }

  /**
   * Log info message
   */
  public info(...args: unknown[]): void {
    console.info(this.prefix, "[info]:", ...args);
  }

  /**
   * Log warning message
   */
  public warn(...args: unknown[]): void {
    console.warn(this.prefix, "[warn]:", ...args);
  }

  /**
   * Log error message
   */
  public error(...args: unknown[]): void {
    console.error(this.prefix, "[error]:", ...args);
  }
}
