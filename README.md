# @deployowl/watch

Official SDK for DeployOwl error tracking.

## Installation
```bash
npm install @deployowl/watch
```

## Usage

### Basic Setup
```typescript
import { init, captureError } from '@deployowl/watch';

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
import { setUser } from '@deployowl/watch';

setUser({
  id: 'user_123',
  email: 'user@example.com'
});
```

### Configuration Options
```typescript
init({
  apiKey: 'your-api-key',          // Required
  endpoint: 'https://custom.com',  // Optional: custom endpoint
  environment: 'staging',          // Optional: environment tag
  beforeSend: (error) => {         // Optional: filter/modify errors
    if (error.message.includes('ignore')) {
      return null; // Don't send
    }
    return error;
  }
});
```

## API Reference

### `init(config: OwlConfig)`

Initialize the SDK. Must be called before capturing errors.

### `captureError(error: Error, context?: object)`

Capture an error with optional context.

### `setUser(user: { id?: string; email?: string })`

Set user information to be attached to all future errors.

### `close()`

Flush any pending errors and close the SDK. Call before process exit.
```typescript
process.on('SIGTERM', async () => {
  await close();
  process.exit(0);
});
```

## License

Proprietary © DeployOwl. All rights reserved.