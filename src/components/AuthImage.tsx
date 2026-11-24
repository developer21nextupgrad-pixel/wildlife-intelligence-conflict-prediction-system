import React, { useEffect, useState } from 'react';
import { getStoredAuthToken, isProtectedApiUrl } from '../utils/authStorage';

interface AuthImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string;
}

export const AuthImage: React.FC<AuthImageProps> = ({ src, alt = '', className = '', onError, ...rest }) => {
  const needsAuth = isProtectedApiUrl(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() =>
    needsAuth ? undefined : src
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!src) {
      setResolvedSrc(undefined);
      return;
    }
    if (!isProtectedApiUrl(src)) {
      setResolvedSrc(src);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    async function loadProtectedImage() {
      const token = getStoredAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      try {
        const res = await fetch(src as string, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setFailed(true);
          setResolvedSrc(undefined);
        }
      }
    }

    loadProtectedImage();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (failed || (needsAuth && !resolvedSrc)) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center bg-slate-950/90 text-slate-500 text-[11px] font-mono ${className}`}
      >
        {failed ? 'Image unavailable' : 'Loading secure image...'}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={(e) => {
        setFailed(true);
        onError?.(e);
      }}
      {...rest}
    />
  );
};
