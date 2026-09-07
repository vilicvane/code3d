const MiB = 1024 * 1024;
const dayMs = 24 * 60 * 60 * 1000;

export type TrafficBudget = {
  kibPerSecond: number;
  burstMiB: number;
  dailyMiB: number;
  requestsPerSecond: number;
  requestBurst: number;
};
export type TrafficOptions = {
  global?: Partial<TrafficBudget>;
  ip?: Partial<TrafficBudget>;
  session?: Partial<TrafficBudget>;
  maxSubjects?: number;
};

export const defaultTrafficBudgets = {
  global: {
    kibPerSecond: 2048,
    burstMiB: 128,
    dailyMiB: 10240,
    requestsPerSecond: 100,
    requestBurst: 200,
  },
  ip: {
    kibPerSecond: 512,
    burstMiB: 64,
    dailyMiB: 1024,
    requestsPerSecond: 20,
    requestBurst: 60,
  },
  session: {
    kibPerSecond: 512,
    burstMiB: 64,
    dailyMiB: 512,
    requestsPerSecond: 10,
    requestBurst: 30,
  },
} satisfies Record<string, TrafficBudget>;

class Budget {
  private updated: number;
  private day: number;
  private used = 0;
  private bytes: number;
  private requests: number;

  constructor(
    readonly limits: TrafficBudget,
    now: number,
  ) {
    this.updated = now;
    this.day = Math.floor(now / dayMs);
    this.bytes = limits.burstMiB * MiB;
    this.requests = limits.requestBurst;
  }

  refresh(now: number): void {
    const elapsed = Math.max(0, now - this.updated) / 1000;
    this.updated = Math.max(now, this.updated);
    this.bytes = Math.min(
      this.limits.burstMiB * MiB,
      this.bytes + elapsed * this.limits.kibPerSecond * 1024,
    );
    this.requests = Math.min(
      this.limits.requestBurst,
      this.requests + elapsed * this.limits.requestsPerSecond,
    );
    const day = Math.floor(now / dayMs);
    if (day > this.day) {
      this.day = day;
      this.used = 0;
    }
  }

  wait(bytes: number, requests: number, now: number): number {
    this.refresh(now);
    return Math.max(
      0,
      (bytes - this.bytes) / (this.limits.kibPerSecond * 1024),
      (requests - this.requests) / this.limits.requestsPerSecond,
      this.used + bytes > this.limits.dailyMiB * MiB
        ? ((this.day + 1) * dayMs - now) / 1000
        : 0,
    );
  }

  consume(bytes: number, requests: number): void {
    this.bytes -= bytes;
    this.used += bytes;
    this.requests -= requests;
  }

  expired(now: number): boolean {
    this.refresh(now);
    return (
      this.used === 0 &&
      this.bytes === this.limits.burstMiB * MiB &&
      this.requests === this.limits.requestBurst
    );
  }
}

/** In-memory admission budgets; reconnects cannot reset them or evict spent quota. */
export class TrafficLimiter {
  private readonly global: Budget;
  private readonly ips = new Map<string, Budget>();
  private readonly sessions = new Map<string, Budget>();
  private readonly limits: Record<'global' | 'ip' | 'session', TrafficBudget>;
  private readonly maxSubjects: number;

  constructor(
    options: TrafficOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.limits = {
      global: {...defaultTrafficBudgets.global, ...options.global},
      ip: {...defaultTrafficBudgets.ip, ...options.ip},
      session: {...defaultTrafficBudgets.session, ...options.session},
    };
    this.maxSubjects = options.maxSubjects ?? 4096;
    this.global = new Budget(this.limits.global, this.now());
  }

  /** Returns zero when admitted, otherwise the delay in whole seconds. */
  take(
    ip: string,
    session: string | undefined,
    bytes = 0,
    requests = 0,
  ): number {
    const now = this.now();
    const globalWait = this.global.wait(bytes, requests, now);
    if (globalWait > 0) return Math.ceil(globalWait);
    if (
      (!this.ips.has(ip) && this.ips.size >= this.maxSubjects) ||
      (session &&
        !this.sessions.has(session) &&
        this.sessions.size >= this.maxSubjects)
    )
      this.sweep();
    const peer = this.subject(this.ips, ip, this.limits.ip, now);
    const project = session
      ? this.subject(this.sessions, session, this.limits.session, now)
      : undefined;
    if (!peer || (session && !project))
      return Math.max(
        1,
        Math.ceil(((Math.floor(now / dayMs) + 1) * dayMs - now) / 1000),
      );
    const budgets = project
      ? [this.global, peer, project]
      : [this.global, peer];
    const wait = Math.max(
      ...budgets.map(budget => budget.wait(bytes, requests, now)),
    );
    if (wait > 0) return Math.ceil(wait);
    for (const budget of budgets) budget.consume(bytes, requests);
    return 0;
  }

  sweep(): void {
    const now = this.now();
    for (const subjects of [this.ips, this.sessions])
      for (const [key, budget] of subjects)
        if (budget.expired(now)) subjects.delete(key);
  }

  private subject(
    subjects: Map<string, Budget>,
    key: string,
    limits: TrafficBudget,
    now: number,
  ): Budget | undefined {
    const existing = subjects.get(key);
    if (existing) return existing;
    if (subjects.size >= this.maxSubjects) return undefined;
    const budget = new Budget(limits, now);
    subjects.set(key, budget);
    return budget;
  }
}

/** Parse the operator-owned JSON file before accepting any connections. */
export function parseTrafficOptions(value: unknown): TrafficOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Relay traffic limits must be an object.');
  const result: TrafficOptions = {};
  for (const [scope, settings] of Object.entries(value)) {
    if (scope === 'maxSubjects') {
      if (
        !Number.isSafeInteger(settings) ||
        settings < 1 ||
        settings > 1_000_000
      )
        throw new Error('maxSubjects must be an integer from 1 to 1000000.');
      result.maxSubjects = settings;
      continue;
    }
    if (!['global', 'ip', 'session'].includes(scope))
      throw new Error('Unknown relay traffic limit scope: ' + scope);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error(scope + ' limits must be an object.');
    const budget: Partial<TrafficBudget> = {};
    for (const [key, limit] of Object.entries(settings)) {
      if (!Object.hasOwn(defaultTrafficBudgets.global, key))
        throw new Error('Unknown relay traffic limit: ' + key);
      if (
        typeof limit !== 'number' ||
        !Number.isFinite(limit) ||
        limit <= 0 ||
        limit > Number.MAX_SAFE_INTEGER / MiB ||
        (key === 'requestBurst' && !Number.isSafeInteger(limit))
      )
        throw new Error(
          scope + '.' + key + ' must be a positive finite limit.',
        );
      budget[key as keyof TrafficBudget] = limit;
    }
    result[scope as 'global' | 'ip' | 'session'] = budget;
  }
  return result;
}
