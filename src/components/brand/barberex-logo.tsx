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
}

export function BarberExLogo({
  variant,
  tone,
  className,
  alt,
  priority,
  quality,
  sizes,
  ...props
}: BarberExLogoProps) {
  const asset = BRAND_ASSETS[variant][tone]

  return (
    <Image
      src={asset.src}
      alt={alt ?? asset.alt}
      width={asset.width}
      height={asset.height}
      className={cn('max-w-full h-auto object-contain', className)}
      priority={priority}
      quality={quality ?? 100}
      sizes={sizes}
      {...props}
    />
  )
}
