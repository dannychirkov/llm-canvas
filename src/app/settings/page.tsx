"use client"
import type { CredentialProviderId } from "@/lib/providers/registry"


import { useEffect, useState } from "react"
import Layout from "@/components/Layout"
import SettingsTabs from "@/components/settings/SettingsTabs"
import { SettingsProvider, useSettings } from "@/components/providers/SettingsProvider"

type ProviderKey = CredentialProviderId

interface ProviderSettings {
  hasKey: boolean
  activeModels: string[]
}

function SettingsPageContent() {
  const settings = useSettings()
  const [isOwner, setIsOwner] = useState(false)
  const [loadingOwner, setLoadingOwner] = useState(true)

  const fetchOwnerStatus = async () => {
    try {
      const response = await fetch("/api/profile")
      if (response.ok) {
        const data = await response.json()
        return data.isOwner === true
      }
    } catch (error) {
      console.error("Error fetching owner status:", error)
    }
  }

  useEffect(() => {
    void fetchOwnerStatus().then(owner => setIsOwner(owner === true)).finally(() => setLoadingOwner(false))
  }, [])



  const handleProviderUpdate = async (provider: ProviderKey, apiKey: string) => {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey
      })
    })
    
    if (!response.ok) {
      throw new Error("Failed to save API key")
    }
    
    await settings.refresh()
    // Trigger global settings refresh for other components
    window.dispatchEvent(new CustomEvent('settingsUpdated'))
  }

  const handleModelsUpdate = async (provider: ProviderKey, models: string[]) => {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        activeModels: models
      })
    })
    
    if (!response.ok) {
      throw new Error("Failed to save models")
    }
    
    await settings.refresh()
    // Trigger global settings refresh for other components
    window.dispatchEvent(new CustomEvent('settingsUpdated'))
  }

  const handleTestKey = async (provider: ProviderKey, apiKey: string) => {
    try {
      // First validate the key
      const validateResponse = await fetch(`/api/providers/${provider}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      })
      
      if (!validateResponse.ok) {
        const error = await validateResponse.text()
        return { valid: false, error }
      }
      
      const validateData = await validateResponse.json()
      if (!validateData.valid) {
        return { valid: false, error: validateData.error }
      }
      
      // If valid, fetch models
      const modelsResponse = await fetch(`/api/providers/${provider}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      })
      
      if (!modelsResponse.ok) {
        return { valid: false, error: "Failed to fetch models" }
      }
      
      const modelsData = await modelsResponse.json()
      return { 
        valid: true, 
        models: modelsData.modelsWithCapabilities || [] 
      }
      
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }
    }
  }

  const handleSelectionModeChange = async (mode: "default" | "inverted") => {
    await settings.updateCanvasPreferences({ selectionMode: mode })
  }

  return (
    <Layout>
      <SettingsTabs
        providers={settings.providers}
        loaded={settings.loaded && !loadingOwner}
        onProviderUpdate={handleProviderUpdate}
        onModelsUpdate={handleModelsUpdate}
        onTestKey={handleTestKey}
        selectionMode={settings.canvasPreferences.selectionMode}
        onSelectionModeChange={handleSelectionModeChange}
        isOwner={isOwner}
      />
    </Layout>
  )
}

export default function SettingsPage() {
  return (
    <SettingsProvider>
      <SettingsPageContent />
    </SettingsProvider>
  )
}
