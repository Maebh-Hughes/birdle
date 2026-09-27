import { msUntilNextLocalMidnight } from '@birdle/shared';
import { useEffect, useState } from 'react';

/** Milliseconds until the next local midnight (the next daily puzzle), ticking every second. */
export function useCountdown(): number {
  const [ms, setMs] = useState(() => msUntilNextLocalMidnight());
  useEffect(() => {
    const timer = window.setInterval(() => setMs(msUntilNextLocalMidnight()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return ms;
}
