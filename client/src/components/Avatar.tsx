import { hashString } from '@birdle/shared';
import { useState, type CSSProperties } from 'react';

interface AvatarProps {
  id: string;
  name: string;
  url: string | null;
  size?: number;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[1]![0]] : [...(words[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase() || '?';
}

/** Discord avatar, or an initials bubble when there is none or it fails to load (CSP, 404). */
export function Avatar({ id, name, url, size = 32 }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { '--avatar-size': `${size}px`, '--avatar-hue': hashString(id) % 360 } as CSSProperties;

  if (url && failedUrl !== url) {
    return (
      <img
        className="avatar"
        style={style}
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span className="avatar avatar--initials" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
