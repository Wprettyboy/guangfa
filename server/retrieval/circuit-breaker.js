class CircuitBreaker {
  constructor({ failureThreshold = 3, resetMs = 30_000, now = Date.now } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpenProbe = false;
  }

  async run(operation, openCode) {
    const state = this.state();
    if (state === "open" || (state === "half-open" && this.halfOpenProbe)) {
      throw createCircuitOpenError(openCode);
    }
    if (state === "half-open") this.halfOpenProbe = true;
    try {
      const result = await operation();
      this.failures = 0;
      this.openedAt = 0;
      return result;
    } catch (error) {
      if (error?.circuitFailure) {
        this.failures += 1;
        if (this.failures >= this.failureThreshold) this.openedAt = this.now();
      }
      throw error;
    } finally {
      this.halfOpenProbe = false;
    }
  }

  state() {
    if (!this.openedAt) return "closed";
    return this.now() - this.openedAt >= this.resetMs ? "half-open" : "open";
  }
}

function createCircuitOpenError(code) {
  const error = new Error("Retrieval model circuit is open");
  error.code = code;
  return error;
}

export { CircuitBreaker };
