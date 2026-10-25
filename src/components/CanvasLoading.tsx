"use client"

import { useEffect, useState } from "react"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import BrandLogo from "@/components/BrandLogo"

interface CanvasLoadingProps {
  stage: 'creating' | 'loading' | 'parsing' | 'initializing' | 'rendering' | 'ready'
  progress?: number
  message?: string
  className?: string
}

const stageMessages = {
  creating: "Creating canvas...",
  loading: "Loading canvas...",
  parsing: "Parsing canvas data...",
  initializing: "Initializing nodes...",
  rendering: "Rendering canvas...",
  ready: "Ready!"
}

const stageProgress = {
  creating: 20,
  loading: 40,
  parsing: 60,
  initializing: 80,
  rendering: 90,
  ready: 100
}

export default function CanvasLoading({ 
  stage, 
  progress, 
  message, 
  className = "" 
}: CanvasLoadingProps) {
  const [displayProgress, setDisplayProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  // Animate progress bar
  useEffect(() => {
    const targetProgress = progress ?? stageProgress[stage]
    const duration = 300 // ms
    const steps = 20
    const stepDuration = duration / steps
    const stepSize = targetProgress / steps

    let currentStep = 0
    const interval = setInterval(() => {
      currentStep++
      setDisplayProgress(Math.min(stepSize * currentStep, targetProgress))
      
      if (currentStep >= steps) {
        clearInterval(interval)
      }
    }, stepDuration)

    return () => clearInterval(interval)
  }, [stage, progress])

  // Hide loading component when ready
  useEffect(() => {
    if (stage === 'ready') {
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 500) // Show "Ready!" for 500ms
      return () => clearTimeout(timer)
    }
  }, [stage])

  if (!isVisible) return null

  const displayMessage = message || stageMessages[stage]
  const showSpinner = stage !== 'ready'

  return (
    <div className={`fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center ${className}`}>
      <Card className="w-96 mx-4">
        <CardContent className="p-6">
          <div className="space-y-4">
            <BrandLogo size={48} className="mx-auto" />
            <div className="flex items-center justify-center space-x-3">
              {showSpinner && (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              )}
              <h3 className="text-lg font-semibold text-center">
                {displayMessage}
              </h3>
            </div>
            
            <div className="space-y-2">
              <Progress 
                value={displayProgress} 
                className="h-2"
              />
              <p className="text-sm text-muted-foreground text-center">
                {Math.round(displayProgress)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
