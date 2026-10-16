// Slip and Thumb: thermal paper at real size. Loads slip.css (paper and
// torn ends), so only pages with paper carry those rules.
//
// Slip: an 80 mm slip, 320px wide, the 576-dot print at 288px (exact on
// 2x screens). `tear`: new (the newest slip, torn at the bottom), old
// (torn at both ends: its top matches a newer slip's bottom), solo (one
// slip alone), top (rising out of a platen), none. `exact`: a preview of
// what will print, no grain over it. Pass the image's height in dots so
// the slip keeps its space while the image loads.
//
// Thumb: the same paper laid on a record sheet, small, torn at both ends.

import './slip.css';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/utils';

export type Tear = 'new' | 'old' | 'solo' | 'top' | 'none';

export function Slip({
  src,
  alt = '',
  imageWidth = 576,
  imageHeight,
  tear = 'solo',
  exact = false,
  loading,
  as: Tag = 'figure',
  className,
  style,
  children,
}: {
  src?: string;
  alt?: string;
  /** The image's width in dots (576 for a full-width print). */
  imageWidth?: number;
  /** The image's height in dots. */
  imageHeight?: number;
  tear?: Tear;
  exact?: boolean;
  loading?: 'lazy' | 'eager';
  as?: 'figure' | 'div';
  className?: string;
  style?: CSSProperties;
  /** Over the paper: a stamp, a caption laid on it. */
  children?: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'pk-slip',
        tear !== 'none' && `pk-tear-${tear}`,
        exact && 'pk-slip--exact',
        className,
      )}
      style={style}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          width={288}
          height={
            imageHeight
              ? Math.round((imageHeight * 288) / imageWidth)
              : undefined
          }
          loading={loading}
          decoding="async"
        />
      ) : null}
      {children}
    </Tag>
  );
}

export function Thumb({
  src,
  alt,
  imageWidth = 576,
  imageHeight,
  rotate,
  className,
}: {
  src: string;
  alt: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Laid down by hand: a fraction of a degree. */
  rotate?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('pk-thumb', className)}
      style={rotate ? { rotate: `${rotate}deg` } : undefined}
    >
      <span className="pk-thumb-slip pk-tear-old">
        <img
          src={src}
          alt={alt}
          width={imageWidth}
          height={imageHeight}
          loading="lazy"
          decoding="async"
        />
      </span>
    </span>
  );
}
