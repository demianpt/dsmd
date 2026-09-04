interface DsmdLogoProps {
  size?: number;
  title?: string;
}

/**
 * DSMD wordmark. Drawn as geometric paths rather than <text> so it renders
 * identically everywhere without depending on a webfont being loaded.
 */
export function DsmdLogo({ size = 30, title = 'DSMD' }: DsmdLogoProps) {
  return (
    <svg
      viewBox="0 0 94 32"
      height={size}
      width={(size * 94) / 32}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="dsmd-stroke" x1="0" y1="0" x2="99" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-primary-glow, #1a26ff)" />
          <stop offset="1" stopColor="var(--color-accent-violet, #7b3aed)" />
        </linearGradient>
      </defs>

      {/* D — square counter, industrial */}
      <path
        d="M4 4h9a12 12 0 0 1 0 24H4V4Zm6 5v14h3a7 7 0 0 0 0-14h-3Z"
        fill="currentColor"
      />
      {/* S */}
      <path
        d="M33.5 27.6c-4.7 0-8-2.3-8.7-6.3l5.6-.9c.4 1.7 1.6 2.6 3.3 2.6 1.5 0 2.5-.7 2.5-1.8 0-1.2-.9-1.7-3.6-2.4-4.9-1.2-7.2-2.9-7.2-6.6 0-4 3.3-6.8 8-6.8 4.5 0 7.6 2.2 8.3 6l-5.5 1c-.3-1.5-1.3-2.4-2.9-2.4-1.4 0-2.3.7-2.3 1.7 0 1.1.9 1.6 3.6 2.3 5 1.3 7.3 3 7.3 6.7 0 4.2-3.4 6.9-8.4 6.9Z"
        fill="currentColor"
      />
      {/* M and the accent D, nudged left to close the DS|MD gap */}
      <g transform="translate(-5 0)">
        <path
          d="M47 28V4h6.6l5.7 12.6L65 4h6.6v24h-5.7V14.7L61.2 25h-3.9l-4.6-10.3V28H47Z"
          fill="currentColor"
        />
        <path
          d="M74 4h9a12 12 0 0 1 0 24h-9V4Zm6 5v14h3a7 7 0 0 0 0-14h-3Z"
          fill="url(#dsmd-stroke)"
        />
      </g>
    </svg>
  );
}
