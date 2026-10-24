"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Loader2,
  ExternalLink,
  Info
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import ProviderCardShell from "./ProviderCardShell"
import ModelSelectionModal from "./ModelSelectionModal"
import DeleteApiKeyDialog from "./DeleteApiKeyDialog"
import type { ModelInfo } from "./ModelDualListSelector"
import { ProviderKey, DEFAULT_MODELS } from "@/lib/providerConstants"

const PROVIDER_API_URLS: Record<ProviderKey, string> = {
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys"
}

interface ProviderCompactCardProps {
  provider: ProviderKey
  title: string
  hasKey: boolean
  activeModels: string[]
  onApiKeyChange: (apiKey: string) => Promise<void>
  onModelsChange: (models: string[]) => Promise<void>
  onTestKey: (apiKey: string) => Promise<{ valid: boolean; models?: ModelInfo[]; error?: string }>
  loading?: boolean
}

export default function ProviderCompactCard({
  provider,
  title,
  hasKey,
  activeModels,
  onApiKeyChange,
  onModelsChange,
  onTestKey,
  loading = false
}: ProviderCompactCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyValid, setKeyValid] = useState<boolean | undefined>(undefined)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsModalOpen, setModelsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [keyRevealed, setKeyRevealed] = useState(false)
  const [loadingKey, setLoadingKey] = useState(false)
  const [keyWasChanged, setKeyWasChanged] = useState(false)
  const [lastTestedKey, setLastTestedKey] = useState<string>("")

  // Memoized calculation of validDefaultModels
  const validDefaultModels = useMemo(() => {
    const defaultModels = DEFAULT_MODELS[provider] || []
    const availableModelIds = availableModels.map(m => m.id)
    return defaultModels.filter(m => availableModelIds.includes(m))
  }, [provider, availableModels])

  const [previousKey, setPreviousKey] = useState(apiKey)
  if (previousKey !== apiKey) {
    setPreviousKey(apiKey)
    if (apiKey.trim() !== lastTestedKey && lastTestedKey !== "") {
      setKeyValid(undefined)
      setAvailableModels([])
      setKeyError(null)
    }
  }

  const handleRevealKey = async () => {
    setLoadingKey(true)
    setKeyError(null)
    try {
      const response = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        cache: "no-store"
      })
      
      if (!response.ok) {
        throw new Error("Failed to load API key")
      }
      
      const data = await response.json()
      if (data.apiKey) {
        setApiKey(data.apiKey)
        setKeyRevealed(true)
      } else {
        setKeyError("API key not found")
      }
    } catch (error) {
      console.error("Failed to reveal API key:", error)
      setKeyError("Failed to load API key")
    } finally {
      setLoadingKey(false)
    }
  }

  const handleTestKey = async () => {
    if (!apiKey.trim()) return
    
    setTesting(true)
    setKeyError(null)
    try {
      const result = await onTestKey(apiKey)
      setKeyValid(result.valid)
      if (result.valid && result.models) {
        setAvailableModels(result.models)
        // Mark that key was changed/tested
        setKeyWasChanged(true)
        // Save last tested key
        setLastTestedKey(apiKey.trim())
      } else if (result.error) {
        setKeyError(result.error)
        // Even on error save key to know it was tested
        setLastTestedKey(apiKey.trim())
      }
    } catch (error) {
      setKeyValid(false)
      setKeyError("Failed to test API key")
      // Save key even on error
      setLastTestedKey(apiKey.trim())
    } finally {
      setTesting(false)
    }
  }

  const handleFetchStoredModels = useCallback(async () => {
    setTesting(true)
    setKeyError(null)
    try {
      // Call onTestKey with empty string - API will use stored key
      const result = await onTestKey("")
      if (result.valid && result.models) {
        setAvailableModels(result.models)
        setKeyValid(true)
        // When loading saved key don't mark as changed
        // and don't set lastTestedKey, to avoid resetting state when apiKey changes
      } else if (result.error) {
        setKeyError(result.error)
        setKeyValid(false)
      }
    } catch (error) {
      setKeyError("Failed to fetch models")
      setKeyValid(false)
    } finally {
      setTesting(false)
    }
  }, [onTestKey])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open && hasKey && availableModels.length === 0) void handleFetchStoredModels()
    if (!open) {
      setApiKey("")
      setKeyRevealed(false)
      setShowKey(false)
      setKeyWasChanged(false)
      setLastTestedKey("")
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onApiKeyChange(apiKey)
      
      // Apply default models only if:
      // 1. Key was tested in this session (keyWasChanged = true) AND current key matches tested one
      // 2. AND user doesn't have configured models yet (activeModels is empty)
      // 3. AND there are valid default models
      // 4. AND key is valid (keyValid = true)
      const isKeyTested = keyWasChanged && apiKey.trim() === lastTestedKey
      const shouldApplyDefaults = validDefaultModels.length > 0 && 
        keyValid && 
        availableModels.length > 0 &&
        (isKeyTested && activeModels.length === 0)
      
      if (shouldApplyDefaults) {
        await onModelsChange(validDefaultModels)
      }
      
      setKeyRevealed(false)
      handleOpenChange(false)
    } catch (error) {
      console.error("Failed to save API key:", error)
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    setSaving(true)
    try {
      await onApiKeyChange("")
      setApiKey("")
      setKeyValid(undefined)
      setAvailableModels([])
      handleOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveModels = async (selectedModels: string[]) => {
    await onModelsChange(selectedModels)
  }

  return (
    <>
      <ProviderCardShell title={title} configured={hasKey} modelCount={activeModels.length} open={isOpen} onOpenChange={handleOpenChange}>
            <CardContent className="space-y-4">
              {/* API Key Section */}
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={hasKey && !keyRevealed ? "•••••••••• (set)" : "Enter your API key"}
                    type={showKey ? "text" : "password"}
                    autoComplete={showKey ? "off" : "new-password"}
                    autoCorrect="off"
                    spellCheck={false}
                    name={`api-key-${provider}`}
                    id={`api-key-${provider}`}
                  />
                  {hasKey && !apiKey.trim() && (
                    <Button
                      variant="outline"
                      onClick={handleRevealKey}
                      disabled={loadingKey}
                    >
                      {loadingKey ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <KeyRound className="mr-2 h-4 w-4" />
                          Reveal Key
                        </>
                      )}
                    </Button>
                  )}
                  {apiKey.trim() && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={handleTestKey}
                    disabled={!apiKey.trim() || testing}
                  >
                    {testing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      "Test Key"
                    )}
                  </Button>
                </div>
                
                {/* API Key Registration Link */}
                <div className="text-sm text-muted-foreground">
                  <a
                    href={PROVIDER_API_URLS[provider]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Get API key here
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                
                {/* Key validation status */}
                {keyValid === true && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    API key is valid
                  </div>
                )}
                {keyValid === false && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    {keyError || "Invalid API key"}
                  </div>
                )}
              </div>

              {/* Models Section */}
              {((hasKey && availableModels.length > 0) || (keyValid === true && availableModels.length > 0)) && (
                <div className="space-y-4">
                  {(() => {
                    // Check if active models differ from defaults
                    const isCustomSelection = validDefaultModels.length > 0 && activeModels.length > 0 &&
                      (activeModels.length !== validDefaultModels.length ||
                       !activeModels.every(m => validDefaultModels.includes(m)) ||
                       !validDefaultModels.every(m => activeModels.includes(m)))
                    
                    const handleResetToDefaults = async () => {
                      if (validDefaultModels.length > 0) {
                        await onModelsChange(validDefaultModels)
                      }
                    }
                    
                    return keyValid === true && validDefaultModels.length > 0 && (
                      <div className="p-4 border rounded-lg bg-muted/30">
                        <div className="flex items-start gap-2">
                          <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <div className="flex-1 space-y-2">
                            {!isCustomSelection ? (
                              <>
                                <p className="text-sm font-medium">Default models will be selected:</p>
                                <div className="flex flex-wrap gap-2">
                                  {validDefaultModels.map((model) => (
                                    <Badge key={model} variant="secondary">
                                      {model}
                                    </Badge>
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                  You can reorder models and change this selection later in Settings. The order you set in Settings will be reflected in node dropdowns.
                                </p>
                              </>
                            ) : (
                              <>
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
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Models</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setModelsModalOpen(true)}
                      >
                        Manage Models
                      </Button>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {keyValid === true && validDefaultModels.length > 0 && activeModels.length === 0
                        ? `${validDefaultModels.length} models will be selected`
                        : `${activeModels.length} models selected`}
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex-1">
                        <Button
                          onClick={handleSave}
                          disabled={saving || !apiKey.trim() || keyValid !== true}
                          className="w-full"
                        >
                          {saving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {(!apiKey.trim() || keyValid !== true) && (
                      <TooltipContent>
                        <p>Please test the API key before saving</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                {hasKey && (
                  <Button
                    variant="destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={saving}
                  >
                    Delete Key
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
      </ProviderCardShell>

      {/* Models Selection Modal */}
      <ModelSelectionModal
        open={modelsModalOpen}
        onOpenChange={setModelsModalOpen}
        provider={title}
        providerKey={provider}
        availableModels={availableModels}
        selectedModels={activeModels}
        onSave={handleSaveModels}
        loading={loading}
      />

      {/* Delete API Key Dialog */}
      <DeleteApiKeyDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        providerTitle={title}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
