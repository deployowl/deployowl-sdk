# deployowl

> Official error tracking SDK for [DeployOwl](https://deployowl.com) — a platform for error monitoring and edge deployment.

[![npm version](https://img.shields.io/npm/v/@deployowl/deployowl.svg)](https://www.npmjs.com/package/@deployowl/deployowl)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

`deployowl` is a Sentry-like error tracking SDK that captures runtime errors, breadcrumbs, and infrastructure metadata, then ships them to the DeployOwl platform for grouping, analysis, and remediation.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [Env Var Allowlist](#env-var-allowlist)
- [API Reference](#api-reference)
- [What Data Is Sent](#what-data-is-sent)
- [Privacy & Security](#privacy--security)
- [Security Notice (v2.3.0+)](#security-notice-v230)
- [Building from Source](#building-from-source)
- [License](#license)

---

## Features

- **Error capture** — `captureError(err, context)` with breadcrumbs, stack traces, and user context
- **Auto capture** — uncaught exceptions, unhandled rejections, and console breadcrumbs (opt-in via `autoCapture`)
- **Infrastructure sync** — sends `nodeVersion`, `platform`, `arch`, and dependency name+version pairs on init
- **Health sync** — periodically sends CPU usage, memory usage, and event-loop lag
- **Rate limiting** — 50 errors per 5 minutes per client (token bucket)
- **Batching & flushing** — configurable batch size and flush interval
- **Before-send hook** — filter, redact, or drop errors before transmission
- **Dry-run mode** — inspect payloads without sending them
- **Dual CJS + ESM** — works in Node.js, edge workers, and browsers
- **Bundler-safe** — uses `module.createRequire()` for `fs` access (no `eval`, no hidden `require`)
- **Zero env-var leakage** — only vars you explicitly allowlist are sent

---

## Installation

```bash
npm install deployowl
# or
yarn add deployowl
# or
pnpm add deployowl
```

---

## Quick Start

### Basic Setup

```typescript
import { init, captureError } from 'deployowl';

init({
  apiKey: 'your-api-key',
  environment: 'production'
});

try {
  riskyOperation();
} catch (error) {
  captureError(error);
  throw error;
}
```

### With Context

```typescript
captureError(error, {
  userId: '123',
  action: 'checkout',
  cart: { items: 3, total: 99.99 }
});
```

### Set User Info

```typescript
import { setUser } from 'deployowl';

setUser({
  id: 'user_123',
  email: 'user@example.com'
});
```

### Graceful Shutdown

```typescript
import { close } from 'deployowl';

process.on('SIGTERM', async () => {
  await close();
  process.exit(0);
});
```

---

## Configuration Options

```typescript
init({
  apiKey: 'your-api-key',              // Required
  endpoint: 'https://custom.com',      // Optional: custom endpoint (default: https://api.deployowl.com)
  environment: 'staging',               // Optional: environment tag
  batchSize: 10,                        // Optional: errors per flush (default: 10)
  flushInterval: 5000,                  // Optional: ms between flushes (default: 5000)
  maxBreadcrumbs: 50,                   // Optional: breadcrumb buffer size (default: 50)
  debug: false,                         // Optional: verbose logging (default: false)
  dryRun: false,                        // Optional: log payloads instead of sending (default: false)
  autoCapture: true,                    // Optional: capture uncaughtException/unhandledRejection + console breadcrumbs (default: true)
  collectDependencies: true,            // Optional: send package name+version pairs on init (default: true)
  collectInfrastructure: true,          // Optional: send nodeVersion/platform/arch on init (default: true)
  collectHealth: true,                  // Optional: periodically send CPU/memory/event-loop metrics (default: true)
  healthInterval: 3600000,             // Optional: ms between health syncs (default: 3600000 = 1 hour)
  allowedEnvVars: [],                   // Optional: allowlist of env var names to include in error snapshots (default: [])
  beforeSend: (error) => {              // Optional: filter/modify errors before sending
    if (error.message.includes('ignore')) {
      return null; // Don't send
    }
    return error;
  }
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | *(required)* | Your DeployOwl project API key |
| `endpoint` | `string` | `https://api.deployowl.com` | Custom ingest endpoint |
| `environment` | `string` | `process.env.NODE_ENV \|\| 'production'` | Environment tag attached to errors |
| `beforeSend` | `(error) => ErrorPayload \| null` | `undefined` | Filter/modify/drop errors before sending |
| `batchSize` | `number` | `10` | Errors per flush |
| `flushInterval` | `number` | `5000` | Milliseconds between flushes |
| `autoCapture` | `boolean` | `true` | Capture uncaught exceptions, unhandled rejections, and console breadcrumbs |
| `maxBreadcrumbs` | `number` | `50` | Breadcrumb buffer size |
| `healthInterval` | `number` | `3600000` | Milliseconds between health syncs (1 hour) |
| `debug` | `boolean` | `false` | Verbose logging |
| `dryRun` | `boolean` | `false` | Log payloads instead of sending |
| `collectDependencies` | `boolean` | `true` | Send package name+version pairs on init |
| `collectInfrastructure` | `boolean` | `true` | Send nodeVersion/platform/arch on init |
| `collectHealth` | `boolean` | `true` | Periodically send CPU/memory/event-loop metrics |
| `allowedEnvVars` | `string[]` | `[]` | Allowlist of env var names to include in error snapshots |

---

## Env Var Allowlist

By default, **no environment variables are sent**. To include specific env vars in error snapshots, list them explicitly:

```typescript
init({
  apiKey: 'your-key',
  allowedEnvVars: ['NODE_ENV', 'APP_NAME', 'DATABASE_CLIENT'],
  // Only these 3 vars will be included in error snapshots.
  // All other env vars (including secrets) are never read or sent.
});
```

The SDK does **not** iterate `process.env`. It only reads vars whose names appear in your `allowedEnvVars` array.

---

## API Reference

### `init(config: OwlConfig): OwlWatch`

Initialize the SDK. Must be called before capturing errors. Returns the singleton `OwlWatch` instance.

```typescript
import { init } from 'deployowl';

const owl = init({ apiKey: 'your-api-key' });
```

### `captureError(error: Error, context?: Record<string, any>): void`

Capture an error with optional context. Context is merged with breadcrumbs and the snapshot.

```typescript
import { captureError } from 'deployowl';

captureError(error, { userId: '123', action: 'checkout' });
```

### `setUser(user: { id?: string; email?: string }): void`

Set user information to be attached to all future errors.

```typescript
import { setUser } from 'deployowl';

setUser({ id: 'user_123', email: 'user@example.com' });
```

### `close(): Promise<void>`

Flush any pending errors and close the SDK. Call before process exit.

```typescript
import { close } from 'deployowl';

process.on('SIGTERM', async () => {
  await close();
  process.exit(0);
});
```

### `OwlWatch` (named export)

The underlying class. Useful for advanced setups or testing.

```typescript
import { OwlWatch } from 'deployowl';

const owl = new OwlWatch({ apiKey: 'your-api-key' });
owl.capture(error);
await owl.close();
```

---

## What Data Is Sent

### On `captureError()` — to `/api/v1/errors`

| Field | Source | Default |
|---|---|---|
| `message`, `stack` | Error object | always |
| `timestamp`, `environment` | SDK config | always |
| `user` | `setUser()` | if set |
| `context` | `captureError(err, context)` | if passed |
| `breadcrumbs` | console.log/warn/error (if `autoCapture: true`) | if enabled |
| `snapshot.env` | `allowedEnvVars` allowlist | **empty by default** |
| `snapshot.url`, `userAgent`, `localStorageKeys` | browser only | browser only |

### On `init()` — to `/api/v1/infrastructure`

| Field | Source | Config flag | Default |
|---|---|---|---|
| `nodeVersion`, `platform`, `arch` | `process.*` | `collectInfrastructure` | `true` |
| `dependencies` | `package.json` name+version pairs only | `collectDependencies` | `true` |

**What is NOT sent:** env vars, secrets, scripts, package.json metadata, lockfiles, or any file contents.

### Periodically — to `/api/v1/health` (if `collectHealth: true`)

| Field | Source | Default |
|---|---|---|
| `cpuUsage` | `process.cpuUsage()` | `true` |
| `memoryUsage` | `process.memoryUsage()` | `true` |
| `eventLoopLag` | measured | `true` |

---

## Privacy & Security

- **No secrets are collected.** The SDK does not iterate `process.env`. Only vars you explicitly allowlist are sent.
- **No `eval()` or hidden `require()`.** Uses `module.createRequire()` — a legitimate, scanner-visible pattern.
- **Dependency collection is name+version only.** No scripts, metadata, or other package.json fields.
- All collection flags default to `true` but can be disabled: `collectDependencies: false`, `collectInfrastructure: false`, `collectHealth: false`.
- Use `dryRun: true` to inspect payloads without sending them.
- Use `beforeSend` to filter or redact any data before transmission.

---

## Security Notice (v2.3.0+)

**This version fixes [MAL-2026-10677](https://osv.dev/).** The SDK now follows the Sentry model: collect what's useful for analysis, scrub what's sensitive, document everything, let the user control it.

| Behavior | v2.1.0 (vulnerable) | v2.3.0 (fixed) |
|---|---|---|
| Environment variables | ❌ Iterated ALL of `process.env`, weak keyword redaction, leaked 3-char secret prefixes | ✅ **Allowlist** — only vars explicitly listed in `allowedEnvVars` are sent (default: empty) |
| `eval('require')` to evade static analysis | ❌ Present | ✅ **Removed** — uses `module.createRequire()` (legitimate, scanner-visible) |
| `package.json` dependency upload | ❌ Full manifest via `eval('require')` | ✅ **Name+version pairs only** via `collectDependencies` (default: true) |
| Infrastructure sync (nodeVersion/platform/arch) | ❌ Auto-on, undocumented | ✅ Auto-on, documented (`collectInfrastructure: true`) |
| Health metrics sync (CPU/memory/lag) | ❌ Auto-on, undocumented | ✅ Auto-on, documented (`collectHealth: true`) |
| Console monkey-patching for breadcrumbs | ❌ Auto-on, undocumented | ✅ Tied to `autoCapture` (documented above) |
| Hardcoded shared secret | ❌ `DEPLOYOWL_SUPER_SECRET_2026_XYZ` | ✅ **Removed** |

**No secrets are collected.** The SDK does not iterate `process.env`. Only vars you explicitly allowlist are sent.

---

## Building from Source

```bash
git clone https://github.com/deployowl/deployowl-sdk.git
cd deployowl-sdk
npm install
npm run build
```

Build output:
- `dist/index.js` — CommonJS
- `dist/index.mjs` — ES Module
- `dist/index.d.ts` — TypeScript declarations

---

## License

Proprietary © DeployOwl. All rights reserved.
