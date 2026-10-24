"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit,
  Calendar,
  FileText,
  Pin,
  PinOff,
  HardDrive
} from "lucide-react"
import Layout from "@/components/Layout"
import CanvasDialog from "@/components/CanvasDialog"
import DeleteCanvasDialog from "@/components/DeleteCanvasDialog"
import CanvasLoading from "@/components/CanvasLoading"
import SearchModal from "@/components/SearchModal"
import { ApiSetupToast } from "@/components/ApiSetupToast"
import { useGlobalSearch } from "@/hooks/useGlobalSearch"
import { useSettings } from "@/components/providers/SettingsProvider"

interface Canvas {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  nodeCount: number
  largestContextTokens: number
  totalTokensUsed: number
  isPinned: boolean
}

interface Statistics {
  active: {
    canvases: number
    nodes: number
    tokens: number
    avgNodesPerCanvas: number
  }
  total: {
    canvases: number
    nodes: number
    tokens: number
    avgNodesPerCanvas: number
  }
  storageUsed: string
  storageLimit?: {
    limitBytes: number | null
    limitFormatted: string | null
    usagePercentage?: number | null
    warningThreshold: number | null
    isOverLimit: boolean
    isNearLimit: boolean
  }
  isOwner?: boolean
}

export default function DashboardPage() {
  const router = useRouter()
  const settings = useSettings()
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const [statistics, setStatistics] = useState<Statistics>({
    active: {
      canvases: 0,
      nodes: 0,
      tokens: 0,
      avgNodesPerCanvas: 0
    },
    total: {
      canvases: 0,
      nodes: 0,
      tokens: 0,
      avgNodesPerCanvas: 0
    },
    storageUsed: "0 B"
  })
  const [statisticsMode, setStatisticsMode] = useState<'active' | 'total'>('active')
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [selectedCanvas, setSelectedCanvas] = useState<Canvas | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [canvasToDelete, setCanvasToDelete] = useState<Canvas | null>(null)
  const [isNavigating, setIsNavigating] = useState(false)
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [apiSetupDismissed, setApiSetupDismissed] = useState(false)
  const showApiSetupToast = settings.loaded && !apiSetupDismissed && !Object.values(settings.providers).some(provider => provider.hasKey) && !settings.customEndpoints.length
  const [userName, setUserName] = useState<string | null>(null)

  // Global search hook
  useGlobalSearch(
    searchModalOpen,
    () => setSearchModalOpen(true),
    () => setSearchModalOpen(false)
  )

  // Check if user needs to setup API keys

  // Fetch user profile data
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const response = await fetch('/api/profile')
        if (response.ok) {
          const userData = await response.json()
          setUserName(userData.name || null)
        }
      } catch (error) {
        console.error('Error fetching user profile:', error)
      }
    }

    fetchUserProfile()
  }, [])

  // Fetch data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch canvases and statistics in parallel
        const [canvasesResponse, statisticsResponse] = await Promise.all([
          fetch('/api/canvases'),
          fetch('/api/statistics')
        ])

        if (canvasesResponse.ok && statisticsResponse.ok) {
          const canvasesData = await canvasesResponse.json()
          const statisticsData = await statisticsResponse.json()

          // Transform canvas data to match our interface
          const transformedCanvases = canvasesData.map((canvas: any) => ({
            id: canvas.id,
            name: canvas.title,
            description: canvas.description || "",
            createdAt: new Date(canvas.createdAt).toLocaleDateString(),
            updatedAt: new Date(canvas.updatedAt).toLocaleDateString(),
            nodeCount: canvas.nodeCount || 0,
            largestContextTokens: canvas.largestContextTokens || 0,
            totalTokensUsed: canvas.totalTokensUsed || 0,
            isPinned: canvas.isPinned || false
          }))

          setCanvases(transformedCanvases)
          setStatistics(statisticsData)
        } else {
          console.error('Failed to fetch data')
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const filteredCanvases = canvases.filter(canvas =>
    canvas.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    canvas.description.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleCreateCanvas = () => {
    setDialogMode('create')
    setSelectedCanvas(null)
    setDialogOpen(true)
  }

  const handleEditCanvas = (canvas: Canvas) => {
    setDialogMode('edit')
    setSelectedCanvas(canvas)
    setDialogOpen(true)
  }

  const handleDialogSubmit = async (data: { title: string; description: string }) => {
    if (dialogMode === 'create') {
      const response = await fetch('/api/canvases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const newCanvas = await response.json()
        return newCanvas // Return the canvas for the dialog to handle
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Canvas creation failed:', {
          status: response.status,
          statusText: response.statusText,
          errorData
        })
        throw new Error(`Failed to create canvas: ${errorData.error || response.statusText}`)
      }
    } else if (dialogMode === 'edit' && selectedCanvas) {
      const response = await fetch(`/api/canvases/${selectedCanvas.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        // Update the canvas in local state
        setCanvases(prev => prev.map(canvas => 
          canvas.id === selectedCanvas.id 
            ? { ...canvas, name: data.title, description: data.description }
            : canvas
        ))
        setDialogOpen(false)
      } else {
        throw new Error('Failed to update canvas')
      }
    }
  }

  const handleCanvasCreated = async (canvasId: string) => {
    setIsNavigating(true)
    // Small delay to show the loading state
    await new Promise(resolve => setTimeout(resolve, 500))
    router.push(`/canvas/${canvasId}`)
  }

  const handleDeleteCanvas = (canvas: Canvas) => {
    setCanvasToDelete(canvas)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!canvasToDelete) return

    try {
      // Get accurate token usage if totalTokensUsed is not available
      let totalTokensUsed = canvasToDelete.totalTokensUsed
      if (totalTokensUsed === undefined || totalTokensUsed === null) {
        try {
          const canvasResponse = await fetch(`/api/canvases/${canvasToDelete.id}`)
          if (canvasResponse.ok) {
            const canvasData = await canvasResponse.json()
            totalTokensUsed = canvasData.totalTokensUsed || canvasData.largestContextTokens || 0
          }
        } catch (fetchError) {
          console.warn('Failed to fetch canvas data, using fallback:', fetchError)
          // Fallback to largestContextTokens if API call fails
          totalTokensUsed = canvasToDelete.largestContextTokens || 0
        }
      }

      const response = await fetch(`/api/canvases/${canvasToDelete.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Remove from local state
        setCanvases(prev => prev.filter(canvas => canvas.id !== canvasToDelete.id))
        // Update statistics - subtract deleted canvas contribution
        setStatistics(prev => ({
          ...prev,
          active: {
            ...prev.active,
            canvases: prev.active.canvases - 1,
            nodes: Math.max(0, prev.active.nodes - (canvasToDelete.nodeCount || 0)),
            tokens: Math.max(0, prev.active.tokens - (totalTokensUsed || 0))
          }
        }))
      } else {
        throw new Error('Failed to delete canvas')
      }
    } catch (error) {
      console.error('Error deleting canvas:', error)
      throw error // Re-throw to be handled by the dialog
    }
  }

  const handleOpenCanvas = (canvasId: string) => {
    // Navigate to canvas editor
    setIsNavigating(true)
    router.push(`/canvas/${canvasId}`)
  }

  const handlePinToggle = async (canvasId: string) => {
    try {
      const response = await fetch(`/api/canvases/${canvasId}/pin`, {
        method: 'PATCH',
      })

      if (response.ok) {
        const updatedCanvas = await response.json()
        // Update the canvas in local state
        setCanvases(prev => prev.map(canvas => 
          canvas.id === canvasId 
            ? { ...canvas, isPinned: updatedCanvas.isPinned }
            : canvas
        ))
      } else {
        console.error('Failed to toggle pin')
      }
    } catch (error) {
      console.error('Error toggling pin:', error)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading dashboard...</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome back{userName ? `, ${userName}` : ''}! Here&apos;s an overview of your canvases and activity.
            </p>
          </div>
          {/* Statistics Toggle */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm text-muted-foreground">Statistics:</span>
            <div className="inline-flex items-center rounded-lg border bg-muted p-1">
              <button
                onClick={() => setStatisticsMode('active')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  statisticsMode === 'active'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setStatisticsMode('total')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  statisticsMode === 'total'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Total
              </button>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Projects</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statisticsMode === 'active' 
                  ? statistics.active.canvases 
                  : statistics.total.canvases}
              </div>
              <p className="text-xs text-muted-foreground">
                {statisticsMode === 'active' 
                  ? 'Current canvases' 
                  : 'All time created'}
              </p>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tokens</CardTitle>
              <Badge variant="secondary">Sum</Badge>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(statisticsMode === 'active' 
                  ? statistics.active.tokens 
                  : statistics.total.tokens).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                {statisticsMode === 'active' 
                  ? 'Current usage' 
                  : 'All time used'}
              </p>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Nodes per Canvas</CardTitle>
              <div className="h-4 w-4 rounded-full bg-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(statisticsMode === 'active'
                  ? statistics.active.avgNodesPerCanvas
                  : statistics.total.avgNodesPerCanvas
                ).toFixed(1)}
              </div>
              <p className="text-xs text-muted-foreground">
                {statisticsMode === 'active'
                  ? 'Current average'
                  : 'All time average'}
              </p>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Nodes</CardTitle>
              <div className="h-4 w-4 rounded-full bg-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statisticsMode === 'active' 
                  ? statistics.active.nodes 
                  : statistics.total.nodes}
              </div>
              <p className="text-xs text-muted-foreground">
                {statisticsMode === 'active' 
                  ? 'Current nodes' 
                  : 'All time created'}
              </p>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statistics.storageUsed}</div>
              {!statistics.isOwner && statistics.storageLimit && statistics.storageLimit.limitBytes && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {statistics.storageLimit.limitFormatted} limit
                    </span>
                    {statistics.storageLimit.usagePercentage != null && (
                      <span className={`font-medium ${
                        statistics.storageLimit.isOverLimit 
                          ? 'text-red-600 dark:text-red-400'
                          : statistics.storageLimit.isNearLimit
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-muted-foreground'
                      }`}>
                        {statistics.storageLimit.usagePercentage}%
                      </span>
                    )}
                  </div>
                  {statistics.storageLimit.usagePercentage != null && (
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          statistics.storageLimit.isOverLimit
                            ? 'bg-red-600 dark:bg-red-400'
                            : statistics.storageLimit.isNearLimit
                            ? 'bg-yellow-600 dark:bg-yellow-400'
                            : 'bg-primary'
                        }`}
                        style={{
                          width: `${Math.min(100, statistics.storageLimit.usagePercentage!)}%`
                        }}
                      />
                    </div>
                  )}
                  {statistics.storageLimit.isOverLimit && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      Storage limit exceeded
                    </p>
                  )}
                  {statistics.storageLimit.isNearLimit && !statistics.storageLimit.isOverLimit && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                      Near storage limit (15% free remaining)
                    </p>
                  )}
                </div>
              )}
              {(!statistics.storageLimit || statistics.isOwner) && (
                <p className="text-xs text-muted-foreground">
                  Media files & database
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Canvas List */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle>Your Canvases</CardTitle>
                <CardDescription>
                  Manage and organize your creative workspaces
                </CardDescription>
              </div>
              <Button onClick={handleCreateCanvas} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" />
                Create New Canvas
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and Filter Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search canvases..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-10"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setSearchModalOpen(true)}
                className="h-10 px-4"
                title="Global search (Ctrl+K)"
              >
                <Search className="mr-2 h-4 w-4" />
                Global Search
              </Button>
            </div>

            {/* Canvas Table */}
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="font-semibold">Name</TableHead>
                    <TableHead className="font-semibold">Description</TableHead>
                    <TableHead className="font-semibold text-center">Nodes</TableHead>
                    <TableHead className="font-semibold text-center" title="Largest estimated input prompt on this canvas. Not total usage or the model's context capacity.">Largest Input (est.)</TableHead>
                    <TableHead className="font-semibold">Last Updated</TableHead>
                    <TableHead className="w-[100px] text-right font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCanvases.map((canvas) => (
                    <TableRow 
                      key={canvas.id} 
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={(e) => {
                        // Check that click was not on button or its child elements
                        const target = e.target as HTMLElement
                        const isButton = target.closest('button')
                        if (!isButton) {
                          handleOpenCanvas(canvas.id)
                        }
                      }}
                    >
                      <TableCell className="font-medium py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handlePinToggle(canvas.id)
                            }}
                            className="p-1 rounded hover:bg-muted/50 transition-colors"
                            title={canvas.isPinned ? "Unpin canvas" : "Pin canvas"}
                          >
                            {canvas.isPinned ? (
                              <Pin className="h-4 w-4 text-amber-500 fill-amber-500" />
                            ) : (
                              <PinOff className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenCanvas(canvas.id)
                            }}
                            className="text-left text-foreground hover:text-muted-foreground hover:underline transition-colors"
                          >
                            {canvas.name}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground py-4">
                        {canvas.description || "No description"}
                      </TableCell>
                      <TableCell className="py-4 text-center">
                        <Badge variant="outline" className="font-medium">
                          {canvas.nodeCount} nodes
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4 text-center">
                        <Badge variant="default" className="font-medium">
                          {(canvas.largestContextTokens || 0).toLocaleString()} tokens
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground py-4">
                        <div className="flex items-center">
                          <Calendar className="mr-2 h-3 w-3" />
                          {canvas.updatedAt}
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex items-center justify-end space-x-1">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditCanvas(canvas)
                            }}
                            className="h-8 w-8 p-0"
                            title="Edit Canvas"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteCanvas(canvas)
                            }}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {filteredCanvases.length === 0 && (
              <div className="text-center py-12">
                <FileText className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No canvases found</h3>
                <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                  {searchTerm ? "Try adjusting your search terms." : "Get started by creating your first canvas."}
                </p>
                {!searchTerm && (
                  <Button onClick={handleCreateCanvas} size="lg">
                    <Plus className="mr-2 h-5 w-5" />
                    Create New Canvas
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CanvasDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        initialData={selectedCanvas ? { title: selectedCanvas.name, description: selectedCanvas.description } : undefined}
        onSubmit={handleDialogSubmit}
        onCanvasCreated={handleCanvasCreated}
      />

      <DeleteCanvasDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        canvasName={canvasToDelete?.name || ""}
        onConfirm={handleConfirmDelete}
      />

      {isNavigating && (
        <CanvasLoading 
          stage="loading"
          message="Opening canvas..."
        />
      )}

      <SearchModal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
      />

      {showApiSetupToast && (
        <ApiSetupToast onClose={() => setApiSetupDismissed(true)} />
      )}
    </Layout>
  )
}
