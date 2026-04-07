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
  if (status === 422) return "bad-request"; // Validation error - don't retry
  if (status === 403) {
    if (body && typeof body === "string" && (body.includes("quota") || body.includes("limit"))) {
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
      fallbackLog.debug("Trying provider", {
        model: candidate.provider.id,
        attempt: attemptNumber,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        fallbackLog.info(`Fetching ${url} with model ${candidate.provider.id}`);
        fallbackLog.debug(`Request init: ${JSON.stringify({ ...init, body: undefined })}`);
        response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        const isTimeout =
          errMsg.toLowerCase().includes("abort") || errMsg.toLowerCase().includes("timeout");

        fallbackLog.error("Fetch failed", {
          error: errMsg,
          url,
          isTimeout,
          model: candidate.provider.id,
        });
        attempts.push({
          provider: candidate.provider,
          success: false,
          failureReason: isTimeout ? "timeout" : "unknown",
          errorMessage: errMsg,
          latencyMs: Date.now() - startTime,
        });
        continue;
      }

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
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
          finalResponse: response,
          usedProvider: candidate.provider,
        };
      }

      const body = await response.text().catch(() => "");
      const reason = classifyHttpError(response.status, body);

      // Log the raw response for debugging
      fallbackLog.warn("Provider failed", {
        model: candidate.provider.id,
        reason,
        status: response.status,
        body: body.substring(0, 500),
        latencyMs,
      });

      // Don't retry on bad-request (validation errors)
      if (reason === "bad-request" && retryableOnly) {
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

      // Auth errors and quota errors - try next provider
      if (reason === "auth-error" || reason === "quota-exceeded") {
        fallbackLog.info("Trying next provider after failure", {
          reason,
          model: candidate.provider.id,
        });
        attempts.push({
          provider: candidate.provider,
          success: false,
          failureReason: reason,
          statusCode: response.status,
          errorMessage: body || undefined,
          latencyMs,
        });
        // Continue to next provider - don't break out of the loop
        continue;
      }

      // Server errors and timeouts - can retry
      if (reason === "server-error" || reason === "rate-limit" || reason === "timeout") {
        fallbackLog.info("Server error/rate-limit, trying next provider", {
          reason,
          model: candidate.provider.id,
        });
        attempts.push({
          provider: candidate.provider,
          success: false,
          failureReason: reason,
          statusCode: response.status,
          errorMessage: body || undefined,
          latencyMs,
        });
        continue;
      }

      // Unknown errors - try next provider
      fallbackLog.info("Unknown error, trying next provider", {
        reason,
        model: candidate.provider.id,
      });
      attempts.push({
        provider: candidate.provider,
        success: false,
        failureReason: reason,
        statusCode: response.status,
        errorMessage: body || undefined,
        latencyMs,
      });
      continue;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const error = err as Error;

      let reason: FailureReason = "unknown";
      if (
        error.name === "AbortError" ||
        error.message.toLowerCase().includes("aborted") ||
        error.message.toLowerCase().includes("timeout")
      ) {
        reason = "timeout";
      }

      fallbackLog.warn("Provider failed", {
        model: candidate.provider.id,
        reason,
        errorMessage: error.message,
        latencyMs,
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
