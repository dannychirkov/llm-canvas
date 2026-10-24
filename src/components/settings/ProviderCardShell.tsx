"use client"

import type { ReactNode } from "react"
import { ChevronDown, ChevronRight, KeyRound, Settings, CheckCircle2, AlertCircle } from "lucide-react"
import { Card, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

interface ProviderCardShellProps {
  title: string
  configured: boolean
  modelCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export default function ProviderCardShell({ title, configured, modelCount, open, onOpenChange, children }: ProviderCardShellProps) {
  const StatusIcon = configured ? CheckCircle2 : AlertCircle
  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <KeyRound className="h-5 w-5" />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusIcon className={`h-4 w-4 ${configured ? "text-green-600" : "text-muted-foreground"}`} />
                    <Badge variant={configured ? "default" : "secondary"} className="text-xs">{configured ? "Configured" : "Not configured"}</Badge>
                    {configured && <span className="text-xs text-muted-foreground">{modelCount} models active</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-2" />Edit</Button>
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
