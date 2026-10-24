"use client"
import type { CredentialProviderId } from "@/lib/providers/registry"


import React from "react"
import type { SafeCustomEndpoint } from "@/lib/providers/customTypes"
import { useSession } from "next-auth/react"

type ProviderKey = CredentialProviderId

export interface ProviderSettingsClient {
	hasKey: boolean
	activeModels: string[]
}

export interface CanvasPreferences {
	selectionMode: 'default' | 'inverted'  // default: LTR=intersection, RTL=containment
}

export interface SettingsContextValue {
	customEndpoints: SafeCustomEndpoint[]
	providers: Record<ProviderKey, ProviderSettingsClient>
	loaded: boolean
	refresh: () => Promise<void>
	canvasPreferences: CanvasPreferences
	updateCanvasPreferences: (prefs: Partial<CanvasPreferences>) => Promise<void>
}

const defaultValue: SettingsContextValue = {
	customEndpoints: [],
	providers: {
		openai: { hasKey: false, activeModels: [] },
		gemini: { hasKey: false, activeModels: [] },
		openrouter: { hasKey: false, activeModels: [] },
	},
	loaded: false,
	refresh: async () => { },
	canvasPreferences: {
		selectionMode: 'default'
	},
	updateCanvasPreferences: async () => { },
}

export const SettingsContext = React.createContext<SettingsContextValue>(defaultValue)

export function useSettings() {
	return React.useContext(SettingsContext)
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
	const [value, setValue] = React.useState<SettingsContextValue>(defaultValue)
	const { status } = useSession()

	// Load canvas preferences from localStorage
	const loadCanvasPreferences = React.useCallback((): CanvasPreferences => {
		try {
			const stored = localStorage.getItem('canvasPreferences')
			if (stored) {
				const parsed = JSON.parse(stored)
				return {
					selectionMode: parsed.selectionMode || 'default'
				}
			}
		} catch (error) {
			console.warn('Failed to load canvas preferences:', error)
		}
		return { selectionMode: 'default' }
	}, [])

	// Save canvas preferences to localStorage
	const saveCanvasPreferences = React.useCallback((prefs: CanvasPreferences) => {
		try {
			localStorage.setItem('canvasPreferences', JSON.stringify(prefs))
		} catch (error) {
			console.warn('Failed to save canvas preferences:', error)
		}
	}, [])

	// Update canvas preferences
	const updateCanvasPreferences = React.useCallback(async (prefs: Partial<CanvasPreferences>) => {
		const currentPrefs = loadCanvasPreferences()
		const newPrefs = { ...currentPrefs, ...prefs }
		saveCanvasPreferences(newPrefs)
		setValue(prev => ({ ...prev, canvasPreferences: newPrefs }))
	}, [loadCanvasPreferences, saveCanvasPreferences])

	const load = React.useCallback(async function refreshSettings() {
		try {
			const res = await fetch("/api/settings", { cache: "no-store" })
			if (!res.ok) {
				// If unauthorized (401), user is not logged in - this is expected on login page
				if (res.status === 401) {
					const canvasPreferences = loadCanvasPreferences()
					setValue((prev) => ({ ...prev, providers: defaultValue.providers, customEndpoints: [], loaded: true, canvasPreferences, updateCanvasPreferences }))
					return
				}
				const errorText = await res.text()
				throw new Error(`Failed to load settings: ${res.status} ${errorText}`)
			}
			const data = await res.json()
			const providers: Record<ProviderKey, ProviderSettingsClient> = {
				openai: { hasKey: Boolean(data?.openai?.hasKey), activeModels: data?.openai?.activeModels || [] },
				gemini: { hasKey: Boolean(data?.gemini?.hasKey), activeModels: data?.gemini?.activeModels || [] },
				openrouter: { hasKey: Boolean(data?.openrouter?.hasKey), activeModels: data?.openrouter?.activeModels || [] },
			}
			const canvasPreferences = loadCanvasPreferences()
			setValue({ providers, customEndpoints: Array.isArray(data?.custom) ? data.custom : [], loaded: true, refresh: refreshSettings, canvasPreferences, updateCanvasPreferences })
		} catch (error) {
			console.error("Error loading settings:", error)
			// fallback from local backup written on save
			try {
				const backupRaw = localStorage.getItem("settingsBackup")
				if (backupRaw) {
					const backup = JSON.parse(backupRaw)
					const providers: Record<ProviderKey, ProviderSettingsClient> = {
						openai: { hasKey: Boolean(backup?.openai?.hasKey), activeModels: backup?.openai?.activeModels || [] },
						gemini: { hasKey: Boolean(backup?.gemini?.hasKey), activeModels: backup?.gemini?.activeModels || [] },
						openrouter: { hasKey: Boolean(backup?.openrouter?.hasKey), activeModels: backup?.openrouter?.activeModels || [] },
					}
					const canvasPreferences = loadCanvasPreferences()
					setValue({ providers, customEndpoints: [], loaded: true, refresh: refreshSettings, canvasPreferences, updateCanvasPreferences })
					return
				}
			} catch { }
			const canvasPreferences = loadCanvasPreferences()
			setValue((prev) => ({ ...prev, loaded: true, canvasPreferences, updateCanvasPreferences }))
		}
	}, [loadCanvasPreferences, updateCanvasPreferences])

	React.useEffect(() => {
		if (status === "loading") return

		void load()
	}, [status, load, loadCanvasPreferences, updateCanvasPreferences])

	// Listen for settings updates from other components
	React.useEffect(() => {
		const handleSettingsUpdate = () => {
			load()
		}

		window.addEventListener('settingsUpdated', handleSettingsUpdate)
		return () => window.removeEventListener('settingsUpdated', handleSettingsUpdate)
	}, [load])

	return (
		<SettingsContext.Provider value={value}>
			{children}
		</SettingsContext.Provider>
	)
}


