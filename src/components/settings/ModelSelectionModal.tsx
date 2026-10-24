"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Loader2, Info } from "lucide-react"
import ModelDualListSelector, { ModelInfo } from "./ModelDualListSelector"
import { ProviderKey, DEFAULT_MODELS } from "@/lib/providerConstants"

interface ModelSelectionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: string
  providerKey: ProviderKey | "custom"
  availableModels: ModelInfo[]
  selectedModels: string[]
  onSave: (selectedModels: string[]) => Promise<void>
  loading?: boolean
}

export default function ModelSelectionModal(props: ModelSelectionModalProps) {
  return props.open ? <ModelSelectionForm key={props.providerKey} {...props} /> : null
}

function ModelSelectionForm({
  open,
  onOpenChange,
  provider,
  providerKey,
  availableModels,
  selectedModels,
  onSave,
  loading = false
}: ModelSelectionModalProps) {
  const [snapshotValidDefaultModels] = useState(() => {
    const defaults = providerKey === "custom" ? [] : DEFAULT_MODELS[providerKey] || []
    return defaults.filter(model => availableModels.some(available => available.id === model))
  })
  const [localSelected, setLocalSelected] = useState<string[]>(() => selectedModels.length ? selectedModels : snapshotValidDefaultModels)
  const [saving, setSaving] = useState(false)
  const [useAdvancedOptions, setUseAdvancedOptions] = useState(() => selectedModels.length > 0 && (selectedModels.length !== snapshotValidDefaultModels.length || selectedModels.some(model => !snapshotValidDefaultModels.includes(model))))

  const handleSave = async () => {
    setSaving(true)
    try {
      // If Advanced Options not enabled and localSelected is empty, use saved snapshot of default models
      const modelsToSave = !useAdvancedOptions && localSelected.length === 0 && snapshotValidDefaultModels.length > 0
        ? snapshotValidDefaultModels
        : localSelected
      await onSave(modelsToSave)
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save models:", error)
      // Could add toast notification here
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setLocalSelected(selectedModels) // Reset to original state
    setUseAdvancedOptions(false)
    onOpenChange(false)
  }

  // Check if selected models differ from defaults
  const isCustomSelection = useMemo(() => {
    if (snapshotValidDefaultModels.length === 0) return false
    if (localSelected.length !== snapshotValidDefaultModels.length) return true
    return !localSelected.every(m => snapshotValidDefaultModels.includes(m)) ||
      !snapshotValidDefaultModels.every(m => localSelected.includes(m))
  }, [localSelected, snapshotValidDefaultModels])

  const handleResetToDefaults = () => {
    setLocalSelected(snapshotValidDefaultModels)
    setUseAdvancedOptions(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden w-[95vw]">
        <DialogHeader>
          <DialogTitle>Manage {provider} Models</DialogTitle>
          <DialogDescription>
            {useAdvancedOptions || providerKey === "custom"
              ? "Choose which models you want to use. You can change this later."
              : `By default, ${snapshotValidDefaultModels.length} recommended models will be selected. Enable Advanced Options to choose manually.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {!useAdvancedOptions && snapshotValidDefaultModels.length > 0 && !isCustomSelection && (
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium">Default models will be selected:</p>
                  <div className="flex flex-wrap gap-2">
                    {snapshotValidDefaultModels.map((model) => (
                      <Badge key={model} variant="secondary">
                        {model}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    You can reorder models and change this selection later in Settings. The order you set in Settings will be reflected in node dropdowns.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!useAdvancedOptions && snapshotValidDefaultModels.length > 0 && isCustomSelection && (
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium">Custom models selected</p>
                  <p className="text-xs text-muted-foreground">
                    You have selected custom models. You can reset to default models if needed.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetToDefaults}
                    className="mt-2"
                  >
                    Reset to Default Models
                  </Button>
                </div>
              </div>
            </div>
          )}

          {providerKey !== "custom" && <div className="flex items-center space-x-2 p-4 border rounded-lg bg-muted/30">
            <Checkbox
              id="advanced-options-modal"
              checked={useAdvancedOptions}
              onCheckedChange={(checked) => {
                setUseAdvancedOptions(checked === true)
                if (!checked && snapshotValidDefaultModels.length > 0) {
                  // When disabling Advanced Options use saved snapshot of default models
                  setLocalSelected(snapshotValidDefaultModels)
                }
              }}
            />
            <label
              htmlFor="advanced-options-modal"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
            >
              Advanced Options
            </label>
          </div>}

          {(useAdvancedOptions || providerKey === "custom") && (
            <div className="flex-1 overflow-hidden">
              <ModelDualListSelector
                availableModels={availableModels}
                selectedModels={localSelected}
                onSelectionChange={setLocalSelected}
                provider={provider}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="min-w-[100px]"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Models"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
