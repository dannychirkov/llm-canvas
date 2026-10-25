"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { 
  ChevronLeft, 
  ChevronRight, 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Loader2,
  ExternalLink,
  Plug
} from "lucide-react"
import { OpenAI, Gemini, OpenRouter } from "@lobehub/icons"
import ModelDualListSelector, { ModelInfo } from "./ModelDualListSelector"
import { Checkbox } from "@/components/ui/checkbox"
import { Info } from "lucide-react"
import { CustomEndpointCard } from "./CustomProviderSettings"
import { DEFAULT_MODELS, type ProviderKey } from "@/lib/providerConstants"

interface ProviderSetupWizardProps {
  onComplete: () => void
  onSkip: () => void
  onStart?: () => void
}

const PROVIDERS = [
  {
    key: "openai" as ProviderKey,
    name: "OpenAI",
    description: "Chat and image models from OpenAI",
    icon: <OpenAI size={30} />,
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    apiKeyUrl: "https://platform.openai.com/api-keys"
  },
  {
    key: "gemini" as ProviderKey,
    name: "Google Gemini",
    description: "Gemini Pro and other Google AI models",
    icon: <Gemini size={30} />,
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    apiKeyUrl: "https://aistudio.google.com/app/apikey"
  },
  {
    key: "openrouter" as ProviderKey,
    name: "OpenRouter",
    description: "Access to multiple AI providers through one API",
    icon: <OpenRouter size={30} />,
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    apiKeyUrl: "https://openrouter.ai/keys"
  },
  {
    key: "custom" as const,
    name: "Custom endpoint",
    description: "Connect OmniRoute, Ollama, LM Studio, an OpenAI-compatible API, or ComfyUI",
    icon: <Plug className="h-[30px] w-[30px]" />,
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    apiKeyUrl: undefined
  }
]

export default function ProviderSetupWizard({ onComplete, onSkip, onStart }: ProviderSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1)
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | "custom" | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyValid, setKeyValid] = useState<boolean | undefined>(undefined)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [modelsWarning, setModelsWarning] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [useAdvancedOptions, setUseAdvancedOptions] = useState(false)

  const customSetup = selectedProvider === "custom"
  const totalSteps = customSetup ? 2 : 3
  const progress = ((currentStep - 1) / (totalSteps - 1)) * 100

  // Memoized calculation of validDefaultModels
  const validDefaultModels = useMemo(() => {
    if (!selectedProvider || selectedProvider === "custom") return []
    const defaultModels = DEFAULT_MODELS[selectedProvider] || []
    const availableModelIds = availableModels.map(m => m.id)
    return defaultModels.filter(m => availableModelIds.includes(m))
  }, [selectedProvider, availableModels])

  const handleTestKey = async () => {
    if (!apiKey.trim() || !selectedProvider || selectedProvider === "custom") return
    
    setTesting(true)
    setKeyError(null)
    setModelsWarning(null)
    try {
      const response = await fetch(`/api/providers/${selectedProvider}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      })
      
      if (!response.ok) {
        const error = await response.text()
        setKeyValid(false)
        setKeyError(error)
        setModelsWarning(null)
        return
      }
      
      const data = await response.json()
      setKeyValid(true)
      setAvailableModels(data.modelsWithCapabilities || [])
      // If Advanced Options not selected, use default models
      if (!useAdvancedOptions && selectedProvider) {
        const defaultModels = DEFAULT_MODELS[selectedProvider] || []
        // Check that default models are available
        const availableModelIds = (data.modelsWithCapabilities || []).map((m: ModelInfo) => m.id)
        const validDefaultModels = defaultModels.filter(m => availableModelIds.includes(m))
        setSelectedModels(validDefaultModels)
        
        // Warn if default models not found
        if (validDefaultModels.length === 0 && defaultModels.length > 0) {
          setModelsWarning(`None of the default models (${defaultModels.join(', ')}) are available. Please enable Advanced Options to select models manually.`)
        } else {
          setModelsWarning(null)
        }
      } else {
        setSelectedModels([]) // Reset selection
        setModelsWarning(null)
      }
    } catch (error) {
      setKeyValid(false)
      setKeyError("Failed to test API key")
      setModelsWarning(null)
    } finally {
      setTesting(false)
    }
  }

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleFinish = async () => {
    if (!selectedProvider || selectedProvider === "custom" || !apiKey.trim()) return
    
    // If Advanced Options not selected, use default models
    let modelsToSave = selectedModels
    if (!useAdvancedOptions && selectedProvider) {
      // Use memoized validDefaultModels value
      modelsToSave = validDefaultModels
      
      // This check is already prevented by Finish button disabled logic,
      // but keep for additional safety
      if (modelsToSave.length === 0) {
        return
      }
    }
    
    // This check is also prevented by disabled logic
    if (modelsToSave.length === 0) {
      return
    }
    
    setSaving(true)
    setKeyError(null) // Clear previous errors
    try {
      // Save the provider configuration
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [selectedProvider]: {
            apiKey,
            activeModels: modelsToSave
          }
        })
      })
      
      if (!response.ok) {
        throw new Error("Failed to save settings")
      }
      
      // Trigger global settings refresh
      window.dispatchEvent(new CustomEvent('settingsUpdated'))
      
      onComplete()
    } catch (error) {
      console.error("Failed to save settings:", error)
      // Could add toast notification here
    } finally {
      setSaving(false)
    }
  }

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Choose Your AI Provider</h2>
        <p className="text-muted-foreground">
          Select which AI provider you'd like to configure first. You can add more later.
        </p>
      </div>
      
      <div className="grid gap-4">
        {PROVIDERS.map((provider) => (
          <Card
            key={provider.key}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedProvider === provider.key 
                ? "ring-2 ring-primary" 
                : "hover:ring-1 hover:ring-border"
            }`}
            onClick={() => {
              onStart?.()
              if (selectedProvider === provider.key) return
              setSelectedProvider(provider.key)
              setApiKey("")
              setShowKey(false)
              setKeyValid(undefined)
              setKeyError(null)
              setModelsWarning(null)
              setAvailableModels([])
              setSelectedModels([])
              setUseAdvancedOptions(false)
            }}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${provider.color}`}>
                  {provider.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{provider.name}</h3>
                  <p className="text-muted-foreground">{provider.description}</p>
                </div>
                {selectedProvider === provider.key && (
                  <CheckCircle2 className="h-6 w-6 text-primary" />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Enter Your API Key</h2>
        <p className="text-muted-foreground">
          Enter your {PROVIDERS.find(p => p.key === selectedProvider)?.name} API key to continue.
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>API Key</Label>
          <div className="flex gap-2">
            <Input
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setKeyValid(undefined); setKeyError(null); setAvailableModels([]); setSelectedModels([]) }}
              disabled={testing || saving}
              placeholder="Enter your API key"
              type={showKey ? "text" : "password"}
              autoComplete={showKey ? "off" : "new-password"}
              autoCorrect="off"
              spellCheck={false}
              name={`api-key-${selectedProvider}`}
              id={`api-key-${selectedProvider}`}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowKey(!showKey)}
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              onClick={handleTestKey}
              disabled={!apiKey.trim() || testing}
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test & Fetch Models"
              )}
            </Button>
          </div>
          
          {/* API Key Registration Link */}
          {selectedProvider && (
            <div className="text-sm text-muted-foreground">
              <a
                href={PROVIDERS.find(p => p.key === selectedProvider)?.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                Get API key here
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
        
        {/* Key validation status */}
        {keyValid === true && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            API key is valid and models loaded successfully
          </div>
        )}
        {keyValid === false && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" />
            {keyError || "Invalid API key"}
          </div>
        )}
        
        {availableModels.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Found {availableModels.length} available models
          </div>
        )}
      </div>
    </div>
  )

  const renderStep3 = () => {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Select Models</h2>
          <p className="text-muted-foreground">
            {useAdvancedOptions 
              ? "Choose which models you want to use. You can change this later."
              : `By default, ${validDefaultModels.length} recommended models will be selected. Enable Advanced Options to choose manually.`
            }
          </p>
        </div>
        
        {/* Display warning about unavailable default models */}
        {modelsWarning && (
          <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500 p-4 border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{modelsWarning}</p>
          </div>
        )}
        
        <div className="space-y-4">
          {!useAdvancedOptions && validDefaultModels.length > 0 && (
            <div className="p-4 border rounded-lg bg-muted/30">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-2">
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
                </div>
              </div>
            </div>
          )}
          
          <div className="flex items-center space-x-2 p-4 border rounded-lg bg-muted/30">
            <Checkbox
              id="advanced-options"
              checked={useAdvancedOptions}
              onCheckedChange={(checked) => {
                setUseAdvancedOptions(checked === true)
                if (!checked && selectedProvider) {
                  // When disabling Advanced Options use memoized default models
                  setSelectedModels(validDefaultModels)
                }
              }}
            />
            <label
              htmlFor="advanced-options"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
            >
              Advanced Options
            </label>
          </div>
          
          {useAdvancedOptions && (
            <div className="w-full">
              <ModelDualListSelector
                availableModels={availableModels}
                selectedModels={selectedModels}
                onSelectionChange={setSelectedModels}
                provider={PROVIDERS.find(p => p.key === selectedProvider)?.name || ""}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <Card className="w-full max-w-6xl mx-auto">
      <CardHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Setup Your First AI Provider</CardTitle>
            <Button variant="ghost" disabled={testing || saving} onClick={onSkip}>
              Skip Wizard
            </Button>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Step {currentStep} of {totalSteps}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {currentStep === 1 && renderStep1()}
        {customSetup && (
          <div className="space-y-6" hidden={currentStep !== 2}>
            <div className="text-center">
              <h2 className="text-2xl font-bold mb-2">Configure Your Endpoint</h2>
              <p className="text-muted-foreground">Connect your provider, then select models or enter model IDs manually.</p>
            </div>
            <CustomEndpointCard setup onSaved={() => onComplete()} onCancel={handlePrevious} onBusyChange={setSaving} />
          </div>
        )}
        {currentStep === 2 && !customSetup && renderStep2()}
        {currentStep === 3 && renderStep3()}
        
        {!(customSetup && currentStep === 2) && <div className="flex justify-between pt-6 border-t">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1 || testing || saving}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous
          </Button>
          
          <div className="flex gap-2">
            {currentStep < totalSteps ? (
              <Button
                onClick={handleNext}
                disabled={
                  (currentStep === 1 && !selectedProvider) ||
                  (currentStep === 2 && (!apiKey.trim() || !keyValid))
                }
              >
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={Boolean(
                  saving || 
                  (!useAdvancedOptions && selectedProvider && (!keyValid || availableModels.length === 0)) ||
                  (useAdvancedOptions && selectedModels.length === 0) ||
                  (!useAdvancedOptions && selectedProvider && keyValid && availableModels.length > 0 && validDefaultModels.length === 0)
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  "Finish Setup"
                )}
              </Button>
            )}
          </div>
        </div>}
      </CardContent>
    </Card>
  )
}
