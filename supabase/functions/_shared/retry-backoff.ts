// ═══════════════════════════════════════════════════════════════
// SPICK: Retry-helper för optimistic-lock retry
// P1 Race Condition Fix #2 — escrow-state-transition
// ═══════════════════════════════════════════════════════════════

/**
 * Exponential backoff retry för Supabase operations.
 * Använd för optimistic-lock konflikter (409, 422).
 * 
 * Exempel:
 *   const result = await retryWithBackoff(
 *     () => sb.from("bookings").update(...).eq("escrow_state", fromState),
 *     { maxAttempts: 3, initialDelayMs: 100 }
 *   );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 100;
  const maxDelayMs = options?.maxDelayMs ?? 5000;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      
      // Om sista försöket eller feltypen ej retriable → throw
      if (attempt === maxAttempts) {
        throw lastError;
      }

      // Exponential backoff: 100ms, 200ms, 400ms (eller upp till maxDelay)
      const delayMs = Math.min(
        initialDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );

      // Betänkstid
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

