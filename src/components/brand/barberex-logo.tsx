import Image, { type ImageProps } from 'next/image'
import { cn } from '@/lib/utils'

const BRAND_ASSETS = {
  full: {
    white: {
      src: '/brand/barberex-logo-white.png',
      width: 1421,
      height: 319,
      alt: 'BarberEX',
    },
    dark: {
      src: '/brand/barberex-logo-dark.png',
      width: 484,
      height: 130,
      alt: 'BarberEX',
    },
  },
  symbol: {
    white: {
      src: '/brand/barberex-symbol-white.png',
      width: 951,
      height: 858,
      alt: 'Simbolo BarberEX',
    },
    dark: {
      src: '/brand/barberex-symbol-dark.png',
      width: 332,
      height: 302,
      alt: 'Simbolo BarberEX',
    },
  },
} as const

interface BarberExLogoProps extends Omit<ImageProps, 'src' | 'width' | 'height' | 'alt'> {
  variant: 'full' | 'symbol'
  tone: 'white' | 'dark'
  alt?: string
  priority?: boolean
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'auto' | 'low'
}

export function BarberExLogo({
  variant,
  tone,
  className,
  alt,
  priority,
  loading,
  fetchPriority,
  quality,
  unoptimized,
  sizes,
  ...props
}: BarberExLogoProps) {
  const asset = BRAND_ASSETS[variant][tone]
  const resolvedPriority = priority ?? false
  const resolvedLoading = resolvedPriority ? undefined : (loading ?? 'lazy')
  const resolvedFetchPriority = fetchPriority ?? (resolvedPriority ? 'high' : 'auto')
  const resolvedUnoptimized = unoptimized ?? true

  return (
    <Image
      src={asset.src}
      alt={alt ?? asset.alt}
      width={asset.width}
      height={asset.height}
      className={cn('max-w-full h-auto object-contain', className)}
      priority={resolvedPriority}
      loading={resolvedLoading}
      fetchPriority={resolvedFetchPriority}
      quality={resolvedUnoptimized ? undefined : quality}
      unoptimized={resolvedUnoptimized}
      placeholder="empty"
      sizes={sizes}
      {...props}
    />
  )
}
