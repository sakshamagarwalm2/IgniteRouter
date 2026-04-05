// src/logger.ts

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  trace(msg: string, fields?: LogFields): void
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(component: string): Logger  // creates subsystem logger
}

// The minimum log level — reads from env IGNITEROUTER_LOG_LEVEL or defaults to 'info'
// Levels in order: trace < debug < info < warn < error
const LEVEL_ORDER: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']

function shouldLog(msgLevel: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(msgLevel) >= LEVEL_ORDER.indexOf(minLevel)
}

function createLogger(subsystem: string): Logger {
  const minLevel = (process.env.IGNITEROUTER_LOG_LEVEL ?? 'info') as LogLevel

  function log(level: LogLevel, msg: string, fields?: LogFields): void {
    if (!shouldLog(level, minLevel)) return

    // entry is not used directly but represents what OpenClaw expects in JSONL
    // const entry = {
    //   time: new Date().toISOString(),
    //   level,
    //   subsystem,
    //   msg,
    //   ...fields
    // }

    // Write structured JSON to stderr (OpenClaw captures this for file logs)
    // AND write readable prefix format to stdout (OpenClaw shows this in console)
    const prefix = `[${subsystem}]`
    const fieldStr = fields && Object.keys(fields).length > 0
      ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : ''

    switch (level) {
      case 'error': console.error(prefix, 'ERROR', msg + fieldStr); break
      case 'warn':  console.warn(prefix, 'WARN ', msg + fieldStr); break
      case 'debug': console.debug(prefix, 'DEBUG', msg + fieldStr); break
      case 'trace': console.debug(prefix, 'TRACE', msg + fieldStr); break
      default:      console.log(prefix, 'INFO ', msg + fieldStr); break
    }
  }

  return {
    trace: (msg, fields) => log('trace', msg, fields),
    debug: (msg, fields) => log('debug', msg, fields),
    info:  (msg, fields) => log('info', msg, fields),
    warn:  (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: (component: string) => createLogger(`igniterouter/${component}`)
  }
}

// Root logger — subsystem: "igniterouter"
export const logger = createLogger('igniterouter')

// Pre-built subsystem loggers — import these directly in each file
export const routingLog  = logger.child('routing')
export const proxyLog    = logger.child('proxy')
export const fallbackLog = logger.child('fallback')
export const configLog   = logger.child('config')
export const overrideLog = logger.child('override')

// Legacy support for logUsage if needed by existing code
export async function logUsage(entry: any): Promise<void> {
  // This can be expanded to write to a local JSONL file if needed
  // For now, it's just a placeholder to prevent build errors
}

export interface UsageEntry {
  timestamp: string;
  model: string;
  tier: string;
  cost: number;
  baselineCost: number;
  savings: number;
  latencyMs: number;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  partnerId?: string;
  service?: string;
  [key: string]: unknown;
}
