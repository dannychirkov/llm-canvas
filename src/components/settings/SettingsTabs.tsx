"use client"
import type { CredentialProviderId } from "@/lib/providers/registry"


import { useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
  Settings as SettingsIcon, 
  KeyRound,
  Loader2,
  UserPlus,
  HardDrive
} from "lucide-react"
import CustomProviderSettings from "./CustomProviderSettings"
import ProviderSetupWizard from "./ProviderSetupWizard"
import ProviderCompactCard from "./ProviderCompactCard"
import InviteManagement from "./InviteManagement"
import UserStorageManagement from "./UserStorageManagement"
import { useSettings } from "@/components/providers/SettingsProvider"

type ProviderKey = CredentialProviderId

interface ProviderSettings {
  hasKey: boolean
  activeModels: string[]
}

interface SettingsTabsProps {
  providers: Record<ProviderKey, ProviderSettings>
  loaded: boolean
  onProviderUpdate: (provider: ProviderKey, apiKey: string) => Promise<void>
  onModelsUpdate: (provider: ProviderKey, models: string[]) => Promise<void>
  onTestKey: (provider: ProviderKey, apiKey: string) => Promise<{ valid: boolean; models?: any[]; error?: string }>
  selectionMode: "default" | "inverted"
  onSelectionModeChange: (mode: "default" | "inverted") => void
  isOwner?: boolean
}

export default function SettingsTabs({
  providers,
  loaded,
  onProviderUpdate,
  onModelsUpdate,
  onTestKey,
  selectionMode,
  onSelectionModeChange,
  isOwner = false
}: SettingsTabsProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const settings = useSettings()
  const requestedTab = searchParams.get("tab")
  const activeTab = requestedTab === "providers" || (isOwner && (requestedTab === "access" || requestedTab === "storage")) ? requestedTab : "providers"
  const [wizardOverride, setShowWizard] = useState<boolean | null>(null)

  // Check if any provider is configured
  const hasConfiguredProvider = Object.values(providers).some(p => p.hasKey) || settings.customEndpoints.length > 0

  const showWizard = wizardOverride ?? (!hasConfiguredProvider && loaded)

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", value)
    router.push(`/settings?${params.toString()}`)
  }

  const handleWizardComplete = async () => {
    setShowWizard(false)
    // Refresh settings provider instead of reloading the page
    await settings.refresh()
  }

  const handleWizardSkip = () => {
    setShowWizard(false)
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading settings...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-7 w-7" />
            Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your AI providers and system settings.
          </p>
        </div>
      </div>

      {showWizard ? (
        <div className="space-y-6">
          <ProviderSetupWizard
            onStart={() => setShowWizard(true)}
            onComplete={handleWizardComplete}
            onSkip={handleWizardSkip}
          />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className={`grid w-full ${isOwner ? "grid-cols-3" : "grid-cols-1"}`}>
            <TabsTrigger value="providers" className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Providers
            </TabsTrigger>
            {isOwner && (
              <>
                <TabsTrigger value="access" className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Access
                </TabsTrigger>
                <TabsTrigger value="storage" className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Storage
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="providers" className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">AI Providers</h2>
                  <p className="text-muted-foreground">
                    Configure your API keys and select models for each provider.
                  </p>
                </div>
                {!hasConfiguredProvider && (
                  <Button onClick={() => setShowWizard(true)}>
                    Setup Wizard
                  </Button>
                )}
              </div>

              <div className="grid gap-6">
                <ProviderCompactCard
                  provider="openai"
                  title="OpenAI"
                  hasKey={providers.openai.hasKey}
                  activeModels={providers.openai.activeModels}
                  onApiKeyChange={(apiKey) => onProviderUpdate("openai", apiKey)}
                  onModelsChange={(models) => onModelsUpdate("openai", models)}
                  onTestKey={(apiKey) => onTestKey("openai", apiKey)}
                />
                
                <ProviderCompactCard
                  provider="gemini"
                  title="Google Gemini"
                  hasKey={providers.gemini.hasKey}
                  activeModels={providers.gemini.activeModels}
                  onApiKeyChange={(apiKey) => onProviderUpdate("gemini", apiKey)}
                  onModelsChange={(models) => onModelsUpdate("gemini", models)}
                  onTestKey={(apiKey) => onTestKey("gemini", apiKey)}
                />
                
                <ProviderCompactCard
                  provider="openrouter"
                  title="OpenRouter"
                  hasKey={providers.openrouter.hasKey}
                  activeModels={providers.openrouter.activeModels}
                  onApiKeyChange={(apiKey) => onProviderUpdate("openrouter", apiKey)}
                  onModelsChange={(models) => onModelsUpdate("openrouter", models)}
                  onTestKey={(apiKey) => onTestKey("openrouter", apiKey)}
                />
                <CustomProviderSettings />
              </div>
            </div>
          </TabsContent>

          {isOwner && (
            <>
              <TabsContent value="access" className="space-y-6">
                <InviteManagement />
              </TabsContent>
              <TabsContent value="storage" className="space-y-6">
                <UserStorageManagement />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  )
}
