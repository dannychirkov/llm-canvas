"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertCircle, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface ApiSetupToastProps {
  onClose: () => void
}

export function ApiSetupToast({ onClose }: ApiSetupToastProps) {
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => {
      setIsVisible(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    setIsVisible(false)
    // Wait for animation to complete before calling onClose
    setTimeout(onClose, 300)
  }

  const handleGoToSettings = () => {
    setIsVisible(false)
    setTimeout(() => {
      router.push('/settings')
    }, 300)
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50",
        "transition-all duration-300 ease-in-out",
        isVisible 
          ? "opacity-100 translate-y-0" 
          : "opacity-0 translate-y-4"
      )}
    >
      <Card className="backdrop-blur-md bg-background/95 border-border shadow-2xl w-[380px]">
        <CardContent className="pt-6 pb-4 px-6 relative">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* Content */}
          <div className="flex gap-4">
            {/* Icon */}
            <div className="flex-shrink-0">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              </div>
            </div>

            {/* Text and Actions */}
            <div className="flex-1 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  API Keys Required
                </h3>
                <p className="text-sm text-muted-foreground">
                  Set up your API keys to start using LLM models
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={handleGoToSettings}
                  size="sm"
                  className="h-8"
                >
                  Go to Settings
                </Button>
                <Button
                  onClick={handleClose}
                  variant="ghost"
                  size="sm"
                  className="h-8"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

