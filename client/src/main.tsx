import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorScreen, LoadingScreen } from './components/Screens';
import { createDiscordEnv } from './discord/sdk';
import { loadSettings } from './settings';
import { startupFailure } from './startup';
import { applyTheme, resolveTheme } from './theme';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Apply the saved theme before the first paint (no inline scripts: Discord's CSP).
const settings = loadSettings();
const prefersLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
applyTheme(document.documentElement, resolveTheme(settings.theme, prefersLight), settings.colorBlind);

const root = createRoot(container);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

// Inside Discord the SDK may need the application id from the server first
// (GET /api/config), so it is created asynchronously behind the loading screen.
render(<LoadingScreen />);
createDiscordEnv().then(
  (env) => render(<App env={env} initialSettings={settings} />),
  (error: unknown) => {
    console.error('BIRDLE: startup failed:', error);
    const failure = startupFailure(error);
    render(
      <ErrorScreen
        title={failure.title}
        message={failure.message}
        detail={failure.detail}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />,
    );
  },
);
