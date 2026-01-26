// Install stack trace mapper (side-effect)
import './patches/install';

// Re-export utilities for external use
export { captureLogOrigin, formatOrigin } from './source';
export type { CaptureOriginOptions, LogOrigin } from './source';
