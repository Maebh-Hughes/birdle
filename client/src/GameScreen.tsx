import { buildShareText, puzzleNumberForDate, statsForDisplay, type GameView } from '@birdle/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BirdCard } from './components/BirdCard';
import { Board } from './components/Board';
import { CopyModal } from './components/CopyModal';
import { FlockPanel } from './components/FlockPanel';
import { Header } from './components/Header';
import { HelpModal } from './components/HelpModal';
import { HintButton } from './components/HintButton';
import { FeatherIcon, RefreshIcon, ShareIcon } from './components/Icons';
import { Keyboard } from './components/Keyboard';
import { Logo } from './components/Logo';
import { SettingsModal } from './components/SettingsModal';
import { StatsModal } from './components/StatsModal';
import { Toasts } from './components/Toasts';
import { openExternal } from './discord/links';
import { usePresence } from './discord/presence';
import type { DiscordEnv } from './discord/sdk';
import { shareResult } from './discord/share';
import { hideUnrevealedRows } from './flock';
import { gameBeforeReveal } from './game/reducer';
import { useGame } from './game/useGame';
import { useFlock } from './hooks/useFlock';
import { useMediaQuery, useReducedMotion } from './hooks/useMediaQuery';
import { usePhysicalKeyboard } from './hooks/usePhysicalKeyboard';
import type { Session } from './session';
import type { ResolvedTheme, Settings, UpdateSettings } from './settings';

type ModalName = 'help' | 'stats' | 'settings' | 'bird' | 'copy';

interface GameScreenProps {
  env: DiscordEnv;
  session: Session;
  settings: Settings;
  updateSettings: UpdateSettings;
  theme: ResolvedTheme;
}

function Caption({ game, loading }: { game: GameView | null; loading: boolean }) {
  if (!game) {
    return <p className="caption">{loading ? 'Finding today’s bird…' : ' '}</p>;
  }
  const letters = `${game.wordLength} letters`;
  return (
    <p className="caption">
      {game.mode === 'daily' ? (
        <>
          <span className="caption__chip">#{game.puzzleNumber}</span> Today&rsquo;s bird has <strong>{letters}</strong>
        </>
      ) : (
        <>
          <span className="caption__chip caption__chip--free">Free Flight</span> This bird has <strong>{letters}</strong>
        </>
      )}
    </p>
  );
}

export function GameScreen({ env, session, settings, updateSettings, theme }: GameScreenProps) {
  const reducedMotion = useReducedMotion();
  const wide = useMediaQuery('(min-width: 900px)');
  const [modal, setModal] = useState<ModalName | null>(settings.seenHelp ? null : 'help');
  const [copyText, setCopyText] = useState('');
  const refreshFlock = useRef<() => void>(() => undefined);

  const controller = useGame({
    api: session.api,
    initialStats: session.stats,
    hardMode: settings.hardMode,
    reducedMotion,
    // Don't cover a modal the player opened in the meantime.
    onGameOver: () => setModal((current) => current ?? 'bird'),
    onDailyGuess: () => refreshFlock.current(),
  });
  const { state, game, showToast } = controller;
  const daily = state.games.daily;

  // The bird card belongs to a finished game on screen. If the game changes
  // (new bird, other mode, new day) it closes instead of lingering unseen,
  // which would also leave the physical keyboard switched off.
  const gameOver = game !== null && game.status !== 'playing';
  const openModal = modal === 'bird' && !gameOver ? null : modal;
  useEffect(() => {
    if (modal === 'bird' && !gameOver) setModal(null);
  }, [modal, gameOver]);

  const flock = useFlock({ env, api: session.api, date: state.dailyDate, selfId: session.user.id });
  useEffect(() => {
    refreshFlock.current = flock.refresh;
  }, [flock.refresh]);
  // Settled rows of the player's own daily board while a guess is in flight or flipping.
  const settledDailyRows =
    state.mode === 'daily' && daily !== null && (state.pending?.mode === 'daily' || state.revealingRow !== null)
      ? (state.revealingRow ?? daily.guesses.length)
      : null;
  const flockEntries = useMemo(() => hideUnrevealedRows(flock.entries, settledDailyRows), [flock.entries, settledDailyRows]);

  usePresence(env.sdk, session.presenceEnabled, game);
  usePhysicalKeyboard(controller.pressKey, openModal === null);

  // The Hint button disappears once the hint is revealed: move focus to the hint
  // rather than leaving it stranded on the page.
  const hintRef = useRef<HTMLParagraphElement>(null);
  const focusHint = useRef(false);
  const hintText = game?.hintUsed ? game.hint : null;
  useEffect(() => {
    if (!focusHint.current || state.hintPending) return;
    focusHint.current = false;
    const active = document.activeElement;
    const focusLost = active === null || active === document.body || !active.isConnected;
    if (hintText !== null && focusLost) hintRef.current?.focus();
  }, [state.hintPending, hintText]);

  const closeModal = useCallback(() => setModal(null), []);
  const closeHelp = useCallback(() => {
    setModal(null);
    if (!settings.seenHelp) updateSettings({ seenHelp: true });
  }, [settings.seenHelp, updateSettings]);

  const share = useCallback(
    async (target: GameView) => {
      if (target.status === 'playing') return;
      const text = buildShareText(target, { colorBlind: settings.colorBlind, theme });
      const customId = target.mode === 'daily' ? `birdle-${target.puzzleNumber}` : 'birdle-free-flight';
      const outcome = await shareResult(env, text, customId);
      if (outcome === 'shared') showToast('Shared!', 'success');
      else if (outcome === 'link-copied') showToast('Link copied', 'success');
      else if (outcome === 'copied') showToast('Copied to clipboard', 'success');
      else if (outcome === 'manual') {
        setCopyText(text);
        setModal('copy');
      }
    },
    [env, settings.colorBlind, theme, showToast],
  );

  const learnMore = useCallback(
    async (url: string) => {
      if (!(await openExternal(env, url))) showToast("Couldn't open the link", 'error');
    },
    [env, showToast],
  );

  const toggleMode = () => controller.setMode(state.mode === 'daily' ? 'practice' : 'daily');
  const { setMode, startNewDay } = controller;
  const playToday = useCallback(() => {
    setModal(null);
    setMode('daily');
    startNewDay();
  }, [setMode, startNewDay]);
  const onPlayToday = controller.newDayAvailable ? playToday : undefined;
  const busy = state.pending !== null || state.hintPending;

  const displayStats = useMemo(
    () => statsForDisplay(state.stats, puzzleNumberForDate(state.dailyDate)),
    [state.stats, state.dailyDate],
  );
  // While a game-ending guess flips, the actions and settings still show the game in progress.
  const shownGame = game && gameBeforeReveal(game, state.revealingRow);
  const lockedHardMode = shownGame && shownGame.status === 'playing' && shownGame.guesses.length > 0 ? shownGame.hardMode : null;
  const playerNote = env.embedded
    ? `Playing as ${session.user.displayName}.`
    : `Browser preview: playing as ${session.user.displayName}. Add ?user=<name> to the URL to play as someone else.`;

  let actions = null;
  if (shownGame?.status === 'playing') {
    actions = (
      <HintButton
        game={shownGame}
        pending={state.hintPending}
        onReveal={() => {
          focusHint.current = true;
          void controller.revealHint();
        }}
      />
    );
  } else if (game && state.revealingRow === null) {
    actions = (
      <>
        <button type="button" className="button button--ghost" onClick={() => setModal('bird')}>
          <Logo size={20} /> Bird card
        </button>
        <button type="button" className="button button--primary" onClick={() => void share(game)}>
          <ShareIcon /> Share
        </button>
        {game.mode === 'practice' && (
          <button type="button" className="button button--gold" onClick={() => void controller.newPracticeGame()}>
            <RefreshIcon /> New bird
          </button>
        )}
      </>
    );
  }

  return (
    <div className="app" data-mode={state.mode}>
      <Header
        mode={state.mode}
        onToggleMode={toggleMode}
        onHelp={() => setModal('help')}
        onStats={() => setModal('stats')}
        onSettings={() => setModal('settings')}
      />

      <div className="app__body">
        <main className="play" aria-label={state.mode === 'daily' ? 'Daily BIRDLE' : 'Free Flight'}>
          {!wide && <FlockPanel entries={flockEntries} variant="strip" />}

          <Caption game={game} loading={state.loading} />
          {hintText !== null && (
            <p className="hint-callout" ref={hintRef} tabIndex={-1}>
              <FeatherIcon />
              <span>
                <span className="sr-only">Hint: </span>
                {hintText}
              </span>
            </p>
          )}
          {controller.newDayAvailable && state.mode === 'daily' && (
            <div className="new-day">
              <span>A new BIRDLE has hatched!</span>
              <button
                type="button"
                className="button button--gold button--small"
                onClick={controller.startNewDay}
                disabled={busy}
              >
                Play today&rsquo;s
              </button>
            </div>
          )}

          <div className="play__board">
            {game ? (
              <Board
                game={game}
                current={state.current}
                revealingRow={state.revealingRow}
                bounceRow={state.bounceRow}
                shake={state.shake}
              />
            ) : state.loadError ? (
              <div className="board-message" role="alert">
                <p>{state.loadError}</p>
                <button type="button" className="button button--primary" onClick={controller.reload}>
                  <RefreshIcon /> Try again
                </button>
              </div>
            ) : (
              <div className="board-message" aria-busy="true">
                <Logo size={56} className="screen__logo--bob" />
              </div>
            )}
          </div>

          <div className="play__actions">{actions}</div>
          <Keyboard states={controller.keys} onKey={controller.pressKey} />
        </main>

        {wide && <FlockPanel entries={flockEntries} variant="column" />}
      </div>

      <p className="sr-only" aria-live="polite">
        {state.announcement}
      </p>
      <Toasts toasts={state.toasts} onDismiss={controller.dismissToast} />

      {openModal === 'help' && <HelpModal onClose={closeHelp} />}
      {openModal === 'stats' && (
        <StatsModal
          stats={displayStats}
          highlight={daily?.status === 'won' && daily.date === state.dailyDate ? daily.guesses.length : null}
          onShare={daily && daily.status !== 'playing' ? () => void share(daily) : undefined}
          onPlayToday={onPlayToday}
          onClose={closeModal}
        />
      )}
      {openModal === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          lockedHardMode={lockedHardMode}
          playerNote={playerNote}
          onClose={closeModal}
        />
      )}
      {openModal === 'bird' && game && (
        <BirdCard
          game={game}
          onShare={() => void share(game)}
          onLearnMore={(url) => void learnMore(url)}
          onNewBird={() => {
            setModal(null);
            void controller.newPracticeGame();
          }}
          onPlayFreeFlight={() => {
            setModal(null);
            controller.setMode('practice');
          }}
          onStats={() => setModal('stats')}
          onPlayToday={onPlayToday}
          onClose={closeModal}
        />
      )}
      {openModal === 'copy' && <CopyModal text={copyText} onClose={closeModal} />}
    </div>
  );
}
