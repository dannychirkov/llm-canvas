import Image from "next/image"
import { cn } from "@/lib/utils"

interface BrandLogoProps {
  size?: number
  className?: string
  alt?: string
}

export default function BrandLogo({ size = 32, className, alt = "LLM Canvas" }: BrandLogoProps) {
  return (
    <Image
      src="/brand/icon.png"
      alt={alt}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      unoptimized
    />
  )
}
