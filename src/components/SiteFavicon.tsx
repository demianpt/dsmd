import { useEffect, useState } from 'react';
import { GlobeIcon } from './Icons';

interface SiteFaviconProps {
  src?: string;
  size: number;
}

export function SiteFavicon({ src, size }: SiteFaviconProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return <GlobeIcon size={size} />;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}
