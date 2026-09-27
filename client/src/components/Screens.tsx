import { RefreshIcon } from './Icons';
import { Logo } from './Logo';

export function LoadingScreen({ message = 'Waking up the birds…' }: { message?: string }) {
  return (
    <main className="screen" aria-busy="true">
      <Logo size={88} className="screen__logo screen__logo--bob" />
      <p className="screen__title">BIRDLE</p>
      <p className="screen__message" role="status">
        {message}
      </p>
    </main>
  );
}

interface ErrorScreenProps {
  title: string;
  message: string;
  detail?: string;
  onRetry: () => void;
  retryLabel?: string;
}

export function ErrorScreen({ title, message, detail, onRetry, retryLabel = 'Retry' }: ErrorScreenProps) {
  return (
    <main className="screen screen--error">
      <Logo size={72} className="screen__logo" />
      <h1 className="screen__title">{title}</h1>
      <p className="screen__message" role="alert">
        {message}
      </p>
      {detail && <p className="screen__detail">{detail}</p>}
      <button type="button" className="button button--primary" onClick={onRetry}>
        <RefreshIcon /> {retryLabel}
      </button>
    </main>
  );
}
