"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import CanvasLoading from "./CanvasLoading"

interface CanvasDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initialData?: { title: string; description: string }
  onSubmit: (data: { title: string; description: string }) => Promise<any>
  onCanvasCreated?: (canvasId: string) => void
}

export default function CanvasDialog(props: CanvasDialogProps) {
  return props.open ? <CanvasDialogForm key={`${props.mode}:${props.initialData?.title}:${props.initialData?.description}`} {...props} /> : null
}

function CanvasDialogForm({
  open,
  onOpenChange,
  mode,
  initialData,
  onSubmit,
  onCanvasCreated
}: CanvasDialogProps) {
  const [title, setTitle] = useState(mode === 'edit' ? initialData?.title || "" : "")
  const [description, setDescription] = useState(mode === 'edit' ? initialData?.description || "" : "")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [loadingStage, setLoadingStage] = useState<'creating' | 'redirecting' | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      setError("Title is required")
      return
    }

    setIsSubmitting(true)
    setError("")

    try {
      if (mode === 'create') {
        setLoadingStage('creating')
      }
      
      const result = await onSubmit({
        title: title.trim(),
        description: description.trim()
      })
      
      if (mode === 'create' && onCanvasCreated) {
        setLoadingStage('redirecting')
        // Call the callback with the canvas ID if available
        if (result && typeof result === 'object' && 'id' in result) {
          onCanvasCreated(result.id as string)
        }
      } else {
        onOpenChange(false)
      }
    } catch (err) {
      setError("Failed to save canvas. Please try again.")
      console.error("Error submitting canvas:", err)
      setLoadingStage(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Create New Canvas' : 'Edit Canvas'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create' 
                ? 'Enter a name and description for your new canvas.'
                : 'Update the name and description of your canvas.'
              }
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter canvas title..."
                className={error && !title.trim() ? "border-destructive" : ""}
                disabled={isSubmitting}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter canvas description (optional)..."
                disabled={isSubmitting}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || isSubmitting}
              >
                {isSubmitting ? "Saving..." : mode === 'create' ? "Create Canvas" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loadingStage && (
        <CanvasLoading 
          stage={loadingStage === 'creating' ? 'creating' : 'loading'}
          message={loadingStage === 'creating' ? "Creating canvas..." : "Redirecting to canvas..."}
        />
      )}
    </>
  )
}
