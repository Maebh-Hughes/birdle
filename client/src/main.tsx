import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorScreen } from './components/Screens';
import { describeError } from './discord/errors';
import { createDiscordEnv, type DiscordEnv } from './discord/sdk';
import { loadSettings } from './settings';
import { applyTheme, resolveTheme } from './theme';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Apply the saved theme before the first paint (no inline scripts: Discord's CSP).
const settings = loadSettings();
const prefersLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
applyTheme(document.documentElement, resolveTheme(settings.theme, prefersLight), settings.colorBlind);

let env: DiscordEnv | null = null;
let startupError: unknown = null;
try {
  env = createDiscordEnv();
} catch (error) {
  startupError = error;
}

createRoot(container).render(
  <StrictMode>
    {env ? (
      <App env={env} initialSettings={settings} />
    ) : (
      <ErrorScreen
        title="BIRDLE couldn't start"
        message="Something went wrong while connecting to Discord."
        detail={describeError(startupError)}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
    )}
  </StrictMode>,
);
