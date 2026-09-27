interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * BIRDLE's songbird: a round wren-like bird with a leaf-green feather wing.
 * Decorative; colours come from the .logo__* rules in styles.css.
 */
export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      className={className ? `logo ${className}` : 'logo'}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path className="logo__tail" d="M17 36 3 26.5l3.2 13.3L16 44z" />
      <path
        className="logo__body"
        d="M14 40c0-10.6 8.6-19 19.3-19 1.5 0 3 .2 4.4.5A11.4 11.4 0 0 1 58 27.8L51.6 31c-.3 12.2-9 22-20.5 22C21 53 14 47.7 14 40z"
      />
      <path className="logo__breast" d="M50.5 34.5C49 44.4 41.6 51 33 51c-5 0-9-1.8-11.2-4.9 11.7 1.6 22.6-3.8 28.7-11.6z" />
      <path className="logo__beak" d="M57 26.4 63 29l-6.2 2.6z" />
      <path className="logo__wing" d="M21.5 36.5c6.6-8.3 18-9.4 24.3-3.4-5.4 8.4-16.2 11.6-24.3 3.4z" />
      <path className="logo__quill" d="M23.8 36.6c6-3.7 12.5-4.9 19.7-3.6" />
      <circle className="logo__eye" cx="49" cy="26" r="2.6" />
      <circle className="logo__glint" cx="49.8" cy="25.2" r="0.8" />
      <path className="logo__legs" d="M30 52.5 28.5 59M37 52l1 7" />
    </svg>
  );
}
