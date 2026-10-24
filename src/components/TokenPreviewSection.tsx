"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { TokenProviderId } from "@/lib/providers/registry"
import type { TokenPreviewResult } from "@/lib/tokenPreviewCalculator"

interface TokenPreviewSectionProps {
  preview: TokenPreviewResult | null
  pending: boolean
  provider: TokenProviderId
}

export default function TokenPreviewSection({ preview, pending, provider }: TokenPreviewSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const fields = [
    { label: "CONTEXT", value: preview?.contextTokens[provider].totalTokens },
    { label: "PROMPT", value: preview?.promptTokens[provider] },
    { label: "THIS REQUEST", value: preview?.totalTokens[provider] }
  ]

  return (
    <div className="space-y-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Token Preview
      </button>
      {!collapsed && (
        pending || preview ? (
          <div className="grid gap-2 grid-cols-3">
            {fields.map(({ label, value }) => (
              <div key={label} className={label === "THIS REQUEST" ? "bg-blue-50 dark:bg-blue-950/30 rounded-md px-3 py-2" : "bg-muted/30 rounded-md px-3 py-2"}>
                <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
                <p className={`text-sm font-bold text-foreground ${pending ? "animate-pulse" : ""}`}>
                  {pending ? "..." : `~${value?.toLocaleString() ?? "—"}`}
                </p>
              </div>
            ))}
            <p className="col-span-3 mt-2 text-xs text-muted-foreground text-center">
              {pending ? "Calculating..." : "Token counts are estimated."}
            </p>
            {!pending && preview && preview.executedTokens[provider] > 0 && (
              <div className="col-span-3 mt-1 pt-2 border-t border-dashed flex items-center justify-between text-xs text-muted-foreground">
                <span>Chain history (recorded):</span>
                <span className="font-medium">{preview.executedTokens[provider].toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center p-3 bg-muted/30 rounded-md">
            <p className="text-xs text-muted-foreground">Unable to calculate token preview</p>
          </div>
        )
      )}
    </div>
  )
}
