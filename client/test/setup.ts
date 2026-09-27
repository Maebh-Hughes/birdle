// Adds jest-dom matchers (toBeInTheDocument, ...) to vitest's expect and
// unmounts rendered trees between tests (vitest globals are off, so
// @testing-library/react cannot register its own cleanup).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
