import { ErrorScreen, LoadingScreen } from './components/Screens';
import type { DiscordEnv } from './discord/sdk';
import { GameScreen } from './GameScreen';
import { useSession } from './session';
import { useSettings, type Settings } from './settings';
import { useAppliedTheme } from './theme';

interface AppProps {
  env: DiscordEnv;
  initialSettings?: Settings;
}

export function App({ env, initialSettings }: AppProps) {
  const [settings, updateSettings] = useSettings(initialSettings);
  const theme = useAppliedTheme(settings);
  const { state, retry } = useSession(env);

  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'error') {
    return <ErrorScreen title={state.title} message={state.message} detail={state.detail} onRetry={retry} />;
  }
  return (
    <GameScreen env={env} session={state.session} settings={settings} updateSettings={updateSettings} theme={theme} />
  );
}
