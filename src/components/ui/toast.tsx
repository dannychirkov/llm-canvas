"use client"

import React, { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

interface ToastProps {
  message: string
  duration?: number
  onClose: () => void
}

export function Toast({ message, duration = 300, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // Show toast immediately
    
    // Hide toast after duration
    const timer = setTimeout(() => {
      setIsVisible(false)
      // Wait for animation to complete before calling onClose
      setTimeout(onClose, 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50",
        "bg-background border border-border rounded-lg shadow-lg",
        "px-4 py-3 flex items-center gap-2 text-sm",
        "transition-all duration-300 ease-in-out",
        isVisible 
          ? "opacity-100 translate-y-0" 
          : "opacity-0 translate-y-2"
      )}
    >
      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
      <span className="text-foreground">{message}</span>
    </div>
  )
}
