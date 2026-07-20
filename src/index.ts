export interface OwlConfig {
    apiKey: string;
    endpoint?: string;
    environment?: string;
    beforeSend?: (error: ErrorPayload) => ErrorPayload | null;
    batchSize?: number;
    flushInterval?: number;
    autoCapture?: boolean;
    maxBreadcrumbs?: number;
    healthInterval?: number;
    debug?: boolean;
    dryRun?: boolean;
}

export interface ErrorPayload {
    message: string;
    stack?: string;
    timestamp: number;
    context?: Record<string, any>;
    environment: string;
    user?: { id?: string; email?: string };
}

class TelemetryLimiter {
    private tokens = 50;
    private lastRefill = Date.now();

    consume(): boolean {
        const now = Date.now();
        const delta = (now - this.lastRefill) / 1000;
        this.tokens = Math.max(0, Math.min(50, this.tokens + delta * 0.16666666666666666));
        this.lastRefill = now;

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
}

class OwlWatch {
    private config: Required<Omit<OwlConfig, 'beforeSend'>> & Pick<OwlConfig, 'beforeSend'>;
    private queue: ErrorPayload[] = [];
    private breadcrumbs: any[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private healthTimer: NodeJS.Timeout | null = null;
    private clientHeaders: Record<string, string>;
    private currentUser?: { id?: string; email?: string };
    private limiter = new TelemetryLimiter();

    constructor(config: OwlConfig) {
        this.config = {
            endpoint: 'https://api.deployowl.com',
            environment: process.env.NODE_ENV || 'production',
            batchSize: 10,
            flushInterval: 5000,
            autoCapture: true,
            maxBreadcrumbs: 50,
            healthInterval: 3600000, // 1 hour
            debug: false,
            dryRun: false,
            ...config,
        };


        this.clientHeaders = {
            'X-API-Key': this.config.apiKey,
            'Content-Type': 'application/json',
        };

        // Start periodic flush
        this.startFlushInterval();

        // Flush on process exit
        if (typeof process !== 'undefined') {
            process.on('beforeExit', () => this.flush());
            process.on('SIGTERM', () => this.flush());
            process.on('SIGINT', () => this.flush());
        }

        // Phase 1: Auto Capture
        if (this.config.autoCapture) {
            this.setupGlobalListeners();
        }

        // Phase 3: Infrastructure Sync
        this.syncInfrastructure();

        // Phase 4: Proactive Health Sync
        this.startHealthSync();
    }

    private startHealthSync(): void {
        if (typeof process === 'undefined') return;

        // Run immediately on start
        this.syncHealth();

        this.healthTimer = setInterval(() => {
            this.syncHealth();
        }, this.config.healthInterval);
    }

    private async syncHealth(): Promise<void> {
        try {
            const lag = await this.measureEventLoopLag();
            const memory = process.memoryUsage();
            const cpu = process.cpuUsage();

            const payload = {
                cpuUsage: (cpu.user + cpu.system) / 1000, // Simple aggregate
                memoryUsage: (memory.heapUsed / memory.heapTotal) * 100,
                eventLoopLag: lag,
                timestamp: Date.now()
            };

            if (this.config.dryRun) {
                if (this.config.debug) console.log(`[DeployOwl SDK] [DRY RUN] Would sync health metrics:`, payload);
                return;
            }

            await fetch(`${this.config.endpoint}/api/v1/health`, {
                method: 'POST',
                headers: this.clientHeaders,
                body: JSON.stringify(payload)
            });

            if (this.config.debug) {
                console.log(`[DeployOwl SDK] Proactive health metrics synced`);
            }
        } catch (err) {
            if (process.env.NODE_ENV === 'development') {
                console.error('[DeployOwl] Failed to sync health metrics:', err);
            }
        }
    }

    private measureEventLoopLag(): Promise<number> {
        return new Promise((resolve) => {
            const start = Date.now();
            setTimeout(() => {
                resolve(Date.now() - start - 10); // Subtract 10ms (the delay)
            }, 10);
        });
    }

    private addBreadcrumb(type: string, data: any): void {
        const breadcrumb = {
            timestamp: Date.now(),
            type,
            data
        };
        this.breadcrumbs.push(breadcrumb);
        const max = this.config.maxBreadcrumbs || 50;
        if (this.breadcrumbs.length > max) {
            this.breadcrumbs.shift();
        }
    }

    private setupGlobalListeners(): void {
        // Monkey-patch console for breadcrumbs
        if (typeof console !== 'undefined') {
            const originalLog = console.log;
            const originalWarn = console.warn;
            const originalError = console.error;

            console.log = (...args: any[]) => {
                this.addBreadcrumb('console.log', args);
                originalLog.apply(console, args);
            };
            console.warn = (...args: any[]) => {
                this.addBreadcrumb('console.warn', args);
                originalWarn.apply(console, args);
            };
            console.error = (...args: any[]) => {
                this.addBreadcrumb('console.error', args);
                originalError.apply(console, args);
            };
        }

        if (typeof process !== 'undefined') {
            process.on('uncaughtException', (err: Error) => {
                this.capture(err, { type: 'uncaughtException' });
                this.flush(); // Fire and forget async flush
            });
            process.on('unhandledRejection', (reason: any) => {
                const err = reason instanceof Error ? reason : new Error(String(reason));
                this.capture(err, { type: 'unhandledRejection' });
            });
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('error', (event: ErrorEvent) => {
                if (event.error) this.capture(event.error, { type: 'window.onerror' });
            });
            window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
                const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
                this.capture(err, { type: 'window.onunhandledrejection' });
            });
        }
    }

    private async syncInfrastructure(): Promise<void> {
        try {
            const payload: any = {};
            if (typeof process !== 'undefined') {
                payload.nodeVersion = process.versions?.node;
                payload.platform = process.platform;
                payload.arch = process.arch;

                // Try to read package.json (Bundler-safe check)
                try {
                    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
                    if (isNode) {
                        const fs = eval('require')('fs');
                        const path = eval('require')('path');
                        const pkgPath = path.resolve(process.cwd(), 'package.json');
                        if (fs.existsSync(pkgPath)) {
                            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                            payload.dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
                        }
                    }
                } catch (e) {
                    // Ignore fs errors silently
                }
            } else if (typeof window !== 'undefined') {
                payload.platform = navigator.userAgent;
                payload.nodeVersion = 'Browser';
            }

            if (this.config.dryRun) {
                if (this.config.debug) console.log(`[DeployOwl SDK] [DRY RUN] Would sync infrastructure:`, payload);
                return;
            }

            await fetch(`${this.config.endpoint}/api/v1/infrastructure`, {
                method: 'POST',
                headers: this.clientHeaders,
                body: JSON.stringify(payload)
            });

            if (this.config.debug) {
                console.log(`[DeployOwl SDK] Infrastructure synced`);
            }
        } catch (err) {
            if (process.env.NODE_ENV === 'development') {
                console.error('[DeployOwl] Failed to sync infrastructure:', err);
            }
        }
    }
    private captureSnapshot(): any {
        const snapshot: any = {};
        
        if (typeof process !== 'undefined' && process.env) {
            const scrubbedEnv: Record<string, string> = {};
            const sensitiveKeys = ['SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'AUTH', 'CREDENTIAL', 'PRIVATE', 'URI', 'PASS', 'STRIPE', 'AWS', 'DATABASE'];
            
            for (const [k, v] of Object.entries(process.env)) {
                if (!v) continue;
                const isSensitive = sensitiveKeys.some(sk => k.toUpperCase().includes(sk));
                
                if (isSensitive) {
                    scrubbedEnv[k] = v.substring(0, 3) + '***';
                } else {
                    scrubbedEnv[k] = v;
                }
            }
            snapshot.env = scrubbedEnv;
        }

        if (typeof window !== 'undefined') {
            snapshot.url = window.location?.href;
            snapshot.userAgent = navigator.userAgent;
            try {
                snapshot.localStorageKeys = Object.keys(window.localStorage);
            } catch (e) {
                // Ignore cross-origin localStorage errors
            }
        }

        return snapshot;
    }

    capture(error: Error, customContext?: Record<string, any>): void {
        if (!this.limiter.consume()) {
            if (this.config.debug) {
                console.warn('[DeployOwl SDK] Rate limit exceeded (50/5min). Error dropped.');
            }
            return;
        }

        const finalContext = {
            ...(customContext || {}),
            breadcrumbs: [...this.breadcrumbs],
            snapshot: this.captureSnapshot()
        };

        const payload: ErrorPayload = {
            message: error.message,
            stack: error.stack,
            timestamp: Date.now(),
            context: finalContext,
            environment: this.config.environment,
            user: this.currentUser,
        };

        // Allow user to modify/filter
        const filtered = this.config.beforeSend?.(payload) ?? payload;
        if (!filtered) return;

        this.queue.push(filtered);

        // Flush immediately if queue is full
        if (this.queue.length >= this.config.batchSize) {
            this.flush();
        }
    }

    setUser(user: { id?: string; email?: string }): void {
        this.currentUser = user;
    }

    private startFlushInterval(): void {
        this.flushInterval = setInterval(() => {
            this.flush();
        }, this.config.flushInterval);
    }

    private async flush(): Promise<void> {
        if (this.queue.length === 0) return;

        const batch = [...this.queue];
        this.queue = [];

        try {
            if (this.config.debug) {
                console.log(`[DeployOwl SDK] Flushing ${batch.length} errors...`);
            }
            
            if (this.config.dryRun) {
                if (this.config.debug) console.log(`[DeployOwl SDK] [DRY RUN] Would flush batch:`, batch);
                return;
            }

            const response = await fetch(`${this.config.endpoint}/api/v1/errors`, {
                method: 'POST',
                headers: this.clientHeaders,
                body: JSON.stringify({ errors: batch })
            });

            if (!response.ok) {
                throw new Error(`API returned status: ${response.status}`);
            }

            if (this.config.debug) {
                console.log(`[DeployOwl SDK] Flush successful`);
            }
        } catch (err: any) {
            // Silent fail - don't break user's app
            if (process.env.NODE_ENV === 'development') {
                console.error('[DeployOwl] Failed to send errors:', err);
            }

            // Re-queue on network error or 5xx server errors
            const isNetworkError = err.message === 'fetch failed' || err.message.includes('Network') || err.message.includes('network');
            const isServerError = err.message.includes('status: 5');
            
            if (isNetworkError || isServerError) {
                this.queue.push(...batch.slice(0, 5)); // Keep only last 5 to prevent memory leaks
            }
        }
    }

    async close(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        if (this.healthTimer) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
        await this.flush();
    }
}

// Singleton instance
let instance: OwlWatch | null = null;

export function init(config: OwlConfig): OwlWatch {
    if (instance) {
        console.warn('[DeployOwl] SDK already initialized');
        return instance;
    }
    instance = new OwlWatch(config);
    return instance;
}

export function captureError(error: Error, context?: Record<string, any>): void {
    if (!instance) {
        throw new Error('[DeployOwl] SDK not initialized. Call init() first.');
    }
    instance.capture(error, context);
}

export function setUser(user: { id?: string; email?: string }): void {
    if (!instance) {
        throw new Error('[DeployOwl] SDK not initialized. Call init() first.');
    }
    instance.setUser(user);
}

export async function close(): Promise<void> {
    if (instance) {
        await instance.close();
        instance = null;
    }
}

export { OwlWatch };