import "dotenv/config";

import pino from "pino";
import { LOG_LEVEL } from "./constants";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: LOG_LEVEL,
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

export function createChildLogger(module: string) {
  return logger.child({ module });
}

class MetricsCollector {
  private metrics: Map<string, number[]> = new Map();
  private readonly maxSamples = 1200;

  record(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const values = this.metrics.get(name)!;
    values.push(value);

    if (values.length > this.maxSamples) {
      values.shift();
    }
  }

  increment(name: string, value: number = 1) {
    const current = this.metrics.get(name)?.[0] || 0;
    this.metrics.set(name, [current + value]);
  }

  getStats(name: string) {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  getAllStats() {
    const stats: Record<string, ReturnType<typeof this.getStats>> = {};
    for (const [name] of this.metrics) {
      stats[name] = this.getStats(name);
    }
    return stats;
  }

  reset() {
    this.metrics.clear();
  }

  report() {
    const stats = this.getAllStats();
    logger.info({ metrics: stats }, "Metrics Report");
    this.reset();
    return stats;
  }
}

export const metrics = new MetricsCollector();

export function createPerformanceMonitor(name: string) {
  const start = Date.now();

  return {
    end: () => {
      const duration = Date.now() - start;
      metrics.record(`${name}.duration`, duration);
      logger.debug({ name, duration }, "Operation completed");
      return duration;
    },
  };
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  services: {
    database: boolean;
    redis: boolean;
    storage: boolean;
  };
  metrics: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
}

export async function getHealthStatus(checks: {
  database: () => Promise<boolean>;
  redis: () => Promise<boolean>;
  storage: () => Promise<boolean>;
}): Promise<HealthStatus> {
  const [database, redis, storage] = await Promise.allSettled([
    checks.database(),
    checks.redis(),
    checks.storage(),
  ]);

  const services = {
    database: database.status === "fulfilled" && database.value,
    redis: redis.status === "fulfilled" && redis.value,
    storage: storage.status === "fulfilled" && storage.value,
  };

  const allHealthy = Object.values(services).every((v) => v);
  const someHealthy = Object.values(services).some((v) => v);

  return {
    status: allHealthy ? "healthy" : someHealthy ? "degraded" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services,
    metrics: {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    },
  };
}

if (isDevelopment) {
  setInterval(() => {
    metrics.report();
  }, 60000);
}
