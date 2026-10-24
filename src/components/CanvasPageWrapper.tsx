"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Node, Edge } from "reactflow"
import CanvasEditor from "./CanvasEditor"
import CanvasLoading from "./CanvasLoading"

interface CanvasPageWrapperProps {
  canvasId: string
  canvasTitle: string
  initialUpdatedAt: string
  initialData?: {
    nodes?: Node[]
    edges?: Edge[]
  } | null
}

export default function CanvasPageWrapper({ 
  canvasId, 
  canvasTitle, 
  initialUpdatedAt,
  initialData 
}: CanvasPageWrapperProps) {
  const [loadingStage, setLoadingStage] = useState<'loading' | 'parsing' | 'initializing' | 'rendering' | 'ready'>('loading')
  const [progress, setProgress] = useState(0)
  const router = useRouter()

  useEffect(() => {
    const loadCanvas = async () => {
      try {
        // Stage 1: Loading (20%)
        setLoadingStage('loading')
        setProgress(20)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Stage 2: Parsing (40%)
        setLoadingStage('parsing')
        setProgress(40)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Stage 3: Initializing (60%)
        setLoadingStage('initializing')
        setProgress(60)
        await new Promise(resolve => setTimeout(resolve, 300))

        // Stage 4: Rendering (80%)
        setLoadingStage('rendering')
        setProgress(80)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Stage 5: Ready (100%)
        setLoadingStage('ready')
        setProgress(100)
        await new Promise(resolve => setTimeout(resolve, 300))
      } catch (error) {
        console.error('Error loading canvas:', error)
        // On error, still show ready state
        setLoadingStage('ready')
        setProgress(100)
      }
    }

    loadCanvas()
  }, [canvasId])

  // const handleBack = () => {
  //   router.push('/dashboard')
  // }

  return (
    <div className="h-screen w-full bg-background">
      {loadingStage !== 'ready' ? (
        <CanvasLoading 
          stage={loadingStage}
          progress={progress}
        />
      ) : (
        <CanvasEditor 
          canvasId={canvasId}
          canvasTitle={canvasTitle}
          initialUpdatedAt={initialUpdatedAt}
          initialData={initialData}
        />
      )}
    </div>
  )
}
