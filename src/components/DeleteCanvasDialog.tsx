"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, Trash2 } from "lucide-react"

interface DeleteCanvasDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canvasName: string
  onConfirm: () => Promise<void>
}

export default function DeleteCanvasDialog(props: DeleteCanvasDialogProps) {
  return props.open ? <DeleteCanvasForm key={props.canvasName} {...props} /> : null
}

function DeleteCanvasForm({
  open,
  onOpenChange,
  canvasName,
  onConfirm
}: DeleteCanvasDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const [error, setError] = useState("")

  const handleDeleteClick = async () => {
    const newClickCount = clickCount + 1
    setClickCount(newClickCount)

    if (newClickCount === 1) {
      // First click - show warning
      return
    }

    // Second click - proceed with deletion
    setIsDeleting(true)
    setError("")

    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError("Failed to delete canvas. Please try again.")
      console.error("Error deleting canvas:", err)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const isSecondClick = clickCount >= 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle className="text-left">
                Delete Canvas
              </DialogTitle>
              <DialogDescription className="text-left">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm text-foreground">
              Are you sure you want to delete <strong>"{canvasName}"</strong>?
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              This will permanently delete the canvas and all its content.
            </p>
          </div>

          {isSecondClick && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Final confirmation required
                </p>
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Click the delete button again to permanently remove this canvas.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-sm text-destructive">
                  {error}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDeleteClick}
            disabled={isDeleting}
            className="min-w-[100px]"
          >
            {isDeleting ? (
              "Deleting..."
            ) : isSecondClick ? (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Forever
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Canvas
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
