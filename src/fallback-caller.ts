import { RankedCandidate } from "./priority-selector.js";
import { UserProvider } from "./user-providers.js";
import { fallbackLog } from "./logger.js";

export type FailureReason =
  | "rate-limit"
  | "server-error"
  | "quota-exceeded"
  | "timeout"
  | "bad-request"
  | "auth-error"
  | "empty-response"
  | "unknown";

export interface AttemptResult {
  provider: UserProvider;
  success: boolean;
  failureReason?: FailureReason;
  statusCode?: number;
  errorMessage?: string;
  latencyMs: number;
}

export interface FallbackResult {
  success: boolean;
  attempts: AttemptResult[];
  finalResponse?: Response;
  errorSummary?: string;
  usedProvider?: UserProvider;
}

export interface FallbackOptions {
  timeoutMs: number;
  retryableOnly: boolean;
}

export function classifyHttpError(status: number, body?: string): FailureReason {
  if (status === 429) return "rate-limit";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "server-error";
  if (status === 402) return "quota-exceeded";
  if (status === 403) {
    if (body && (body.includes("quota") || body.includes("limit"))) {
      return "quota-exceeded";
    }
    return "auth-error";
  }
  if (status === 400) return "bad-request";
  if (status === 401) return "auth-error";
  return "unknown";
}

export async function callWithFallback(
  candidates: RankedCandidate[],
  buildRequest: (provider: UserProvider) => { url: string; init: RequestInit },
  options?: Partial<FallbackOptions>,
): Promise<FallbackResult> {
  const timeoutMs = options?.timeoutMs ?? 30000;
  const retryableOnly = options?.retryableOnly ?? false;

  const attempts: AttemptResult[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const attemptNumber = i + 1;
    const startTime = Date.now();

    try {
      const { url, init } = buildRequest(candidate.provider);
      fallbackLog.debug("Trying provider", { model: candidate.provider.id, attempt: attemptNumber });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        const text = await response.text();
        if (!text || text.trim() === "") {
          attempts.push({
            provider: candidate.provider,
            success: false,
            failureReason: "empty-response",
            statusCode: response.status,
            latencyMs,
          });
          continue;
        }

        attempts.push({
          provider: candidate.provider,
          success: true,
          statusCode: response.status,
          latencyMs,
        });

        fallbackLog.info("Provider succeeded", { model: candidate.provider.id, latencyMs });

        return {
          success: true,
          attempts,
          finalResponse: new Response(text, { status: response.status, headers: response.headers }),
          usedProvider: candidate.provider,
        };
      }

      const body = await response.text().catch(() => "");
      const reason = classifyHttpError(response.status, body);
      fallbackLog.warn("Provider failed", { 
        model: candidate.provider.id, 
        reason, 
        status: response.status,
        latencyMs 
      });

      if (reason === "bad-request") {
        attempts.push({
          provider: candidate.provider,
          success: false,
          failureReason: reason,
          statusCode: response.status,
          errorMessage: body || undefined,
          latencyMs,
        });

        return {
          success: false,
          attempts,
          errorSummary: buildErrorSummary(attempts),
        };
      }

      attempts.push({
        provider: candidate.provider,
        success: false,
        failureReason: reason,
        statusCode: response.status,
        errorMessage: body || undefined,
        latencyMs,
      });

      if (reason === "auth-error") {
        continue;
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const error = err as Error;

      let reason: FailureReason = "unknown";
      if (error.name === "AbortError" || error.message.toLowerCase().includes("aborted") || error.message.toLowerCase().includes("timeout")) {
        reason = "timeout";
      }

      fallbackLog.warn("Provider failed", { 
        model: candidate.provider.id, 
        reason, 
        errorMessage: error.message,
        latencyMs 
      });

      attempts.push({
        provider: candidate.provider,
        success: false,
        failureReason: reason,
        errorMessage: error.message,
        latencyMs,
      });
    }
  }

  fallbackLog.error("All providers exhausted", { tried: attempts.length });
  return {
    success: false,
    attempts,
    errorSummary: buildErrorSummary(attempts),
  };
}

function buildErrorSummary(attempts: AttemptResult[]): string {
  const lines = attempts.map((a) => {
    const status = a.statusCode ? ` (${a.statusCode})` : "";
    return `  ${a.provider.id.padEnd(25)} ${a.failureReason}${status}`;
  });

  return `IgniteRouter tried ${attempts.length} model${attempts.length !== 1 ? "s" : ""}:\n${lines.join("\n")}\nPlease try again, or add more models to your provider list.`;
}
