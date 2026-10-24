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
import { AlertTriangle, Save, X } from "lucide-react"

interface UnsavedChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaveAndLeave: () => Promise<void>
  onDiscardChanges: () => void
  onCancel: () => void
  isSaving: boolean
}

export default function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  return props.open ? <UnsavedChangesForm {...props} /> : null
}

function UnsavedChangesForm({
  open,
  onOpenChange,
  onSaveAndLeave,
  onDiscardChanges,
  onCancel,
  isSaving
}: UnsavedChangesDialogProps) {
  const [isSavingAndLeaving, setIsSavingAndLeaving] = useState(false)
  const [discardClickCount, setDiscardClickCount] = useState(0)

  const handleSaveAndLeave = async () => {
    setIsSavingAndLeaving(true)
    try {
      await onSaveAndLeave()
    } finally {
      setIsSavingAndLeaving(false)
    }
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleDiscardChanges = () => {
    const newClickCount = discardClickCount + 1
    setDiscardClickCount(newClickCount)

    if (newClickCount === 1) {
      // First click - show warning, don't proceed
      return
    }

    // Second click - proceed with discard
    onDiscardChanges()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] w-full mx-4">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20 flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-left">
                Unsaved Changes
              </DialogTitle>
              <DialogDescription className="text-left mt-1">
                You have unsaved changes that will be lost.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm text-foreground leading-relaxed">
              Your canvas has unsaved changes. What would you like to do?
            </p>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              You can save your changes before leaving, or discard them and continue.
            </p>
          </div>

          {discardClickCount >= 1 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  Final confirmation required
                </p>
              </div>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                Click the discard button again to permanently lose your changes.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isSaving || isSavingAndLeaving}
            className="w-full sm:w-auto sm:min-w-[80px]"
          >
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDiscardChanges}
            disabled={isSaving || isSavingAndLeaving}
            className={`w-full sm:w-auto sm:min-w-[120px] ${
              discardClickCount >= 1 ? 'ring-2 ring-red-500 ring-offset-2' : ''
            }`}
          >
            {discardClickCount >= 1 ? 'Discard Forever' : 'Discard Changes'}
          </Button>
          <Button
            type="button"
            onClick={handleSaveAndLeave}
            disabled={isSaving || isSavingAndLeaving}
            className="w-full sm:w-auto sm:min-w-[130px]"
          >
            {isSavingAndLeaving ? (
              "Saving..."
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save & Leave
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
