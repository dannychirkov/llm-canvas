import React, { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { usageTotal } from '@/lib/tokenUsage'

interface TokenUsageSectionProps {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  audioTokens?: number
  videoTokens?: number
  imageTokens?: number
  className?: string
  isExact?: boolean
  provider?: string
}

const TokenUsageSection: React.FC<TokenUsageSectionProps> = ({
  inputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
  cachedTokens,
  audioTokens,
  videoTokens,
  imageTokens,
  totalTokens: totalTokensProp,
  className = '',
  isExact = false,
  provider,
}) => {
  const [showDetails, setShowDetails] = useState(false)
  const detailsRef = useRef<HTMLDivElement>(null)
  const totalTokens = usageTotal(totalTokensProp, { inputTokens, outputTokens, reasoningTokens }, provider)

  // Format token count
  const formatTokenCount = (count: number): string => {
    const formatted = count.toLocaleString()
    return isExact ? formatted : `~${formatted}`
  }

  // Check if there are additional details to display
  // Check not only if field exists, but also that value > 0 (as in rendering)
  const hasAdditionalDetails = (cachedTokens !== undefined && cachedTokens > 0) || 
                               (audioTokens !== undefined && audioTokens > 0) || 
                               (videoTokens !== undefined && videoTokens > 0) || 
                               (imageTokens !== undefined && imageTokens > 0)

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof globalThis.Node)) return;
      if (detailsRef.current && !detailsRef.current.contains(event.target)) {
        setShowDetails(false)
      }
    }

    if (showDetails) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showDetails])

  const stats = [
    {
      label: 'INPUT TOKENS',
      value: formatTokenCount(inputTokens),
      icon: (
        <svg
          className="w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16l-4-4m0 0l4-4m-4 4h18"
          />
        </svg>
      ),
    },
    {
      label: 'OUTPUT TOKENS',
      value: formatTokenCount(outputTokens),
      icon: (
        <svg
          className="w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 8l4 4m0 0l-4 4m4-4H3"
          />
        </svg>
      ),
    },
    ...(reasoningTokens > 0 ? [{
      label: provider === "gemini" || provider === "nanobanana" ? 'REASONING' : 'REASONING (IN OUTPUT)',
      value: formatTokenCount(reasoningTokens),
      icon: (
        <svg
          className="w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
      ),
    }] : []),
    {
      label: 'TOTAL',
      value: formatTokenCount(totalTokens),
      icon: (
        <svg
          className="w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ]

  // Don't render if no tokens and no additional details
  // Show component if there are any tokens or if there are additional details (e.g., cached tokens)
  const hasAnyTokens = totalTokens > 0 || hasAdditionalDetails
  if (!hasAnyTokens && !isExact) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className={`grid gap-2 ${className || 'grid-cols-2'}`}>
        {stats.map((stat, index) => (
          <div
            key={index}
            className="bg-muted/30 rounded-md px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {stat.label}
                </p>
                <p className="text-sm font-bold text-foreground">{stat.value}</p>
              </div>
              <div className="text-muted-foreground">{stat.icon}</div>
            </div>
          </div>
        ))}

        {/* Token estimation disclaimer - inside grid for proper col-span-* functionality */}
        {!isExact && !hasAdditionalDetails && (
          <div className={`${className?.includes('grid-cols-4') ? 'col-span-4' : className?.includes('grid-cols-3') ? 'col-span-3' : 'col-span-2'} mt-2`}>
            <p className="text-xs text-muted-foreground text-center">
              Token counts are estimated.
            </p>
          </div>
        )}
      </div>

      {/* Detailed information with popover */}
      {hasAdditionalDetails && (
        <div className="relative" ref={detailsRef}>
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Info className="h-3 w-3" />
            <span>Detailed information</span>
          </button>
          
          {showDetails && (
            <div className="absolute z-50 mt-2 p-3 bg-popover border rounded-md shadow-lg min-w-[200px]">
              <div className="space-y-2">
                <div className="text-xs font-medium text-popover-foreground mb-2">
                  Detailed token breakdown
                </div>
                
                {cachedTokens !== undefined && cachedTokens > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Cached input (included in input):</span>
                    <span className="font-medium">{cachedTokens.toLocaleString()}</span>
                  </div>
                )}
                
                {audioTokens !== undefined && audioTokens > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Audio tokens:</span>
                    <span className="font-medium">{audioTokens.toLocaleString()}</span>
                  </div>
                )}
                
                {videoTokens !== undefined && videoTokens > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Video tokens:</span>
                    <span className="font-medium">{videoTokens.toLocaleString()}</span>
                  </div>
                )}
                
                {imageTokens !== undefined && imageTokens > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Image tokens:</span>
                    <span className="font-medium">{imageTokens.toLocaleString()}</span>
                  </div>
                )}
                
                <div className="pt-2 border-t border-border">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Source:</span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {isExact ? 'From API response' : 'Estimated'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TokenUsageSection
