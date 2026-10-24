"use client"

import { useState, useMemo } from "react"
import type React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { 
  Search,
  Eye,
  Zap,
  Image,
  Mic,
  Brain,
  MessageSquare,
  GripVertical
} from "lucide-react"

export interface ModelInfo {
  id: string
  contextWindow: number
  capabilities?: {
    vision?: boolean
    function_calling?: boolean
    json_mode?: boolean
  }
}

interface ModelDualListSelectorProps {
  availableModels: ModelInfo[]
  selectedModels: string[]
  onSelectionChange: (selected: string[]) => void
  provider: string
}

type FilterType = "all" | "chat" | "embeddings" | "image" | "audio" | "reasoning"

function getModelCategory(modelId: string): FilterType {
  const id = modelId.toLowerCase()
  if (id.includes("embed")) return "embeddings"
  if (id.includes("image") || id.includes("vision")) return "image"
  if (id.includes("audio") || id.includes("tts") || id.includes("whisper")) return "audio"
  if (id.includes("reason") || id.includes("deepseek-r1") || id.includes("r1")) return "reasoning"
  if (id.includes("gpt") || id.includes("chat") || id.includes("turbo") || id.includes("llama") || id.includes("sonnet") || id.includes("haiku")) return "chat"
  return "chat" // default to chat
}

function getCategoryIcon(category: FilterType) {
  switch (category) {
    case "chat": return <MessageSquare className="h-4 w-4" />
    case "embeddings": return <Zap className="h-4 w-4" />
    case "image": return <Image className="h-4 w-4" />
    case "audio": return <Mic className="h-4 w-4" />
    case "reasoning": return <Brain className="h-4 w-4" />
    default: return <MessageSquare className="h-4 w-4" />
  }
}

function formatContextWindow(contextWindow: number): string {
  if (!contextWindow) return "Not reported"
  if (contextWindow >= 1000000) {
    return `${(contextWindow / 1000000).toFixed(1)}M`
  } else if (contextWindow >= 1000) {
    return `${(contextWindow / 1000).toFixed(0)}K`
  }
  return contextWindow.toString()
}

export default function ModelDualListSelector({
  availableModels,
  selectedModels,
  onSelectionChange,
  provider
}: ModelDualListSelectorProps) {
  const [availableSearch, setAvailableSearch] = useState("")
  const [selectedSearch, setSelectedSearch] = useState("")
  const [filter, setFilter] = useState<FilterType>("all")
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const selectedSet = useMemo(() => new Set(selectedModels), [selectedModels])

  const filteredAvailable = useMemo(() => {
    let filtered = availableModels.filter(model => !selectedSet.has(model.id))
    
    if (filter !== "all") {
      filtered = filtered.filter(model => getModelCategory(model.id) === filter)
    }
    
    if (availableSearch) {
      const search = availableSearch.toLowerCase()
      filtered = filtered.filter(model => model.id.toLowerCase().includes(search))
    }
    
    return filtered
  }, [availableModels, selectedSet, filter, availableSearch])

  // Preserve order from selectedModels
  const filteredSelected = useMemo(() => {
    // Create map for quick access to model information
    const modelMap = new Map(availableModels.map(m => [m.id, m]))
    
    // Preserve order from selectedModels
    const orderedModels = selectedModels
      .map(id => modelMap.get(id))
      .filter((model): model is ModelInfo => model !== undefined)
    
    if (selectedSearch) {
      const search = selectedSearch.toLowerCase()
      return orderedModels.filter(model => model.id.toLowerCase().includes(search))
    }
    
    return orderedModels
  }, [availableModels, selectedModels, selectedSearch])

  const handleAdd = (modelId: string) => {
    onSelectionChange([...selectedModels, modelId])
  }

  const handleRemove = (modelId: string) => {
    onSelectionChange(selectedModels.filter(id => id !== modelId))
  }

  // Drag and drop handlers for selected models
  const handleDragStart = (modelId: string) => {
    setDraggedId(modelId)
  }

  const handleDragOver = (e: React.DragEvent, modelId: string) => {
    e.preventDefault()
    setDragOverId(modelId)
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e: React.DragEvent, dropId: string) => {
    e.preventDefault()
    
    if (draggedId === null || draggedId === dropId) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }

    // Get current order from selectedModels (not from filteredSelected, as there may be a filter)
    const modelMap = new Map(availableModels.map(m => [m.id, m]))
    const orderedModels = selectedModels
      .map(id => modelMap.get(id))
      .filter((model): model is ModelInfo => model !== undefined)
    
    // Calculate indices by ID
    const from = orderedModels.findIndex(m => m.id === draggedId)
    const to = orderedModels.findIndex(m => m.id === dropId)
    
    if (from === -1 || to === -1) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }
    
    // Move element
    const newOrderedModels = [...orderedModels]
    const [draggedItem] = newOrderedModels.splice(from, 1)
    
    // Insert at the original 'to' index after removal
    newOrderedModels.splice(to, 0, draggedItem)
    
    // Update selectedModels with new order
    const newSelectedModels = newOrderedModels.map(m => m.id)
    onSelectionChange(newSelectedModels)
    
    setDraggedId(null)
    setDragOverId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  const ModelItem = ({ model, isSelected }: { model: ModelInfo; isSelected: boolean }) => (
    <div 
      className={`flex items-center justify-between p-2 rounded-md border cursor-pointer transition-colors ${
        isSelected 
          ? "bg-primary/10 border-primary/20" 
          : "bg-background hover:bg-muted/50 border-border"
      }`}
      onClick={() => isSelected ? handleRemove(model.id) : handleAdd(model.id)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate" title={model.id}>
            {model.id}
          </span>
          <Badge variant="secondary" className="text-xs">
            {formatContextWindow(model.contextWindow)}
          </Badge>
        </div>
        {model.capabilities && (
          <div className="flex gap-1 mt-1">
            {model.capabilities.vision && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                <Eye className="h-3 w-3 mr-1" />
                Vision
              </Badge>
            )}
            {model.capabilities.function_calling && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                Functions
              </Badge>
            )}
            {model.capabilities.json_mode && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                JSON
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {(["all", "chat", "embeddings", "image", "audio", "reasoning"] as FilterType[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className="flex items-center gap-2"
          >
            {getCategoryIcon(f)}
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available Models */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Available Models</span>
              <Badge variant="secondary">
                {filteredAvailable.length}
              </Badge>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search models..."
                value={availableSearch}
                onChange={(e) => setAvailableSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {filteredAvailable.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {availableSearch || filter !== "all" ? "No models match your filters" : "All models are selected"}
              </p>
            ) : (
              filteredAvailable.map((model) => (
                <ModelItem key={model.id} model={model} isSelected={false} />
              ))
            )}
          </CardContent>
        </Card>

        {/* Selected Models */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Selected Models</span>
              <Badge variant="default">
                {selectedModels.length}
              </Badge>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search selected..."
                value={selectedSearch}
                onChange={(e) => setSelectedSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {filteredSelected.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {selectedSearch ? "No selected models match your search" : "No models selected"}
              </p>
            ) : (
              filteredSelected.map((model) => {
                const isDragging = draggedId === model.id
                const isDragOver = dragOverId === model.id
                
                return (
                  <div
                    key={model.id}
                    draggable={!selectedSearch}
                    onDragStart={() => handleDragStart(model.id)}
                    onDragOver={(e) => handleDragOver(e, model.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, model.id)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-2 rounded-md border transition-colors ${
                      isDragging
                        ? "opacity-50 bg-muted"
                        : isDragOver
                        ? "border-primary bg-primary/5"
                        : "bg-background hover:bg-muted/50 border-border"
                    } ${!selectedSearch ? "cursor-move" : ""}`}
                  >
                    {!selectedSearch && (
                      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <div 
                      className="flex-1 min-w-0"
                      onClick={() => handleRemove(model.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate" title={model.id}>
                          {model.id}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {formatContextWindow(model.contextWindow)}
                        </Badge>
                      </div>
                      {model.capabilities && (
                        <div className="flex gap-1 mt-1">
                          {model.capabilities.vision && (
                            <Badge variant="outline" className="text-xs px-1 py-0">
                              <Eye className="h-3 w-3 mr-1" />
                              Vision
                            </Badge>
                          )}
                          {model.capabilities.function_calling && (
                            <Badge variant="outline" className="text-xs px-1 py-0">
                              Functions
                            </Badge>
                          )}
                          {model.capabilities.json_mode && (
                            <Badge variant="outline" className="text-xs px-1 py-0">
                              JSON
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary */}
      <div className="text-sm text-muted-foreground text-center">
        {selectedModels.length} of {availableModels.length} models selected
      </div>
    </div>
  )
}
