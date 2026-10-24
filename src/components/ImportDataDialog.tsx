"use client"

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Upload, FileArchive, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ImportDataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete?: () => void
}

interface ImportPreview {
  exportVersion: 'old' | 'new'
  canvases: Array<{
    originalId: string
    originalTitle: string
    newTitle: string
    nodeCount: number
    mediaCount: number
    mediaWithFiles: number
    hasConflicts: boolean
  }>
  settings: boolean
  totalNodes: number
  totalMedia: number
  warnings: string[]
}

export default function ImportDataDialog({
  open,
  onOpenChange,
  onImportComplete
}: ImportDataDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(new Set())
  const [importSettings, setImportSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string>("")
  const [success, setSuccess] = useState<string>("")
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = () => {
    setFile(null)
    setPreview(null)
    setSelectedCanvasIds(new Set())
    setImportSettings(false)
    setError("")
    setSuccess("")
  }

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.zip')) {
      setError('Please select a ZIP file')
      return
    }

    setFile(selectedFile)
    setError("")
    setSuccess("")
    setIsLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('action', 'preview')

      const response = await fetch('/api/import-data', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to analyze archive')
      }

      const previewData: ImportPreview = await response.json()
      setPreview(previewData)
      
      // Select all canvases by default
      setSelectedCanvasIds(new Set(previewData.canvases.map(c => c.originalId)))
    } catch (err: any) {
      setError(err.message || 'Error loading file')
      setPreview(null)
    } finally {
      setIsLoading(false)
    }
  }, [setFile, setError, setSuccess, setIsLoading, setPreview, setSelectedCanvasIds])

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }, [handleFileSelect])

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0])
    }
  }

  const toggleCanvasSelection = (canvasId: string) => {
    const newSelection = new Set(selectedCanvasIds)
    if (newSelection.has(canvasId)) {
      newSelection.delete(canvasId)
    } else {
      newSelection.add(canvasId)
    }
    setSelectedCanvasIds(newSelection)
  }

  const toggleAllCanvases = () => {
    if (!preview) return
    
    const allSelected = selectedCanvasIds.size === preview.canvases.length
    
    if (allSelected) {
      // If all are selected - deselect all
      setSelectedCanvasIds(new Set())
    } else {
      // If nothing is selected or some are selected - select all
      setSelectedCanvasIds(new Set(preview.canvases.map(c => c.originalId)))
    }
  }

  const selectAllCheckboxState = preview && preview.canvases.length > 0
    ? selectedCanvasIds.size === 0
      ? false
      : selectedCanvasIds.size === preview.canvases.length
        ? true
        : "indeterminate"
    : false

  const handleImport = async () => {
    if (!file || !preview || selectedCanvasIds.size === 0) {
      setError('Please select a file and canvases to import')
      return
    }

    setIsImporting(true)
    setError("")
    setSuccess("")

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('action', 'import')
      formData.append('selectedCanvasIds', JSON.stringify(Array.from(selectedCanvasIds)))
      formData.append('importSettings', importSettings.toString())

      const response = await fetch('/api/import-data', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to import data')
      }

      const result = await response.json()
      
      if (result.success) {
        setSuccess(
          `Import completed successfully! Imported: ${result.importedCanvases} canvases, ` +
          `${result.importedNodes} nodes, ${result.importedMedia} media files.`
        )
        
        if (result.errors && result.errors.length > 0) {
          setError(`Partial errors: ${result.errors.join(', ')}`)
        }
        
        setTimeout(() => {
          onImportComplete?.()
          onOpenChange(false)
          resetState()
        }, 2000)
      } else {
        throw new Error(result.errors?.join(', ') || 'Import completed with errors')
      }
    } catch (err: any) {
      setError(err.message || 'Error importing data')
    } finally {
      setIsImporting(false)
    }
  }

  const handleClose = () => {
    if (!isImporting) {
      onOpenChange(false)
      resetState()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`${preview ? 'max-w-7xl mx-4' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            Upload a ZIP archive with exported data to import
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload Area */}
          {!preview && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center
                ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
                ${isLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-primary/50'}
              `}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileInputChange}
                className="hidden"
              />
              
              {isLoading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Analyzing archive...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FileArchive className="h-12 w-12 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      Click to select a file or drag and drop a ZIP archive here
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Maximum size: 500MB
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview Section */}
          {preview && (
            <div className="space-y-4">
              {/* Export Version Badge */}
              <div className="flex items-center gap-2">
                <Badge variant={preview.exportVersion === 'new' ? 'default' : 'secondary'}>
                  {preview.exportVersion === 'new' ? 'New Format' : 'Old Format'}
                </Badge>
                {preview.exportVersion === 'old' && (
                  <span className="text-xs text-muted-foreground">
                    (Metadata only, no media files)
                  </span>
                )}
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside space-y-1">
                      {preview.warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm">{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Canvases:</span>
                    <span className="font-medium">{preview.canvases.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Nodes:</span>
                    <span className="font-medium">{preview.totalNodes}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Media files:</span>
                    <span className="font-medium">
                      {preview.totalMedia} 
                      {preview.exportVersion === 'new' && (
                        <span className="text-muted-foreground ml-1">
                          ({preview.canvases.reduce((sum, c) => sum + c.mediaWithFiles, 0)} with files)
                        </span>
                      )}
                    </span>
                  </div>
                  {preview.settings && (
                    <div className="flex justify-between">
                      <span>Settings:</span>
                      <span className="font-medium">Yes</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Canvas Selection */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Select Canvases to Import</CardTitle>
                      <CardDescription>
                        Selected: {selectedCanvasIds.size} of {preview.canvases.length}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectAllCheckboxState}
                        onCheckedChange={toggleAllCanvases}
                        id="select-all-canvases"
                      />
                      <label
                        htmlFor="select-all-canvases"
                        className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        Select All
                      </label>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {preview.canvases.map((canvas) => (
                      <div
                        key={canvas.originalId}
                        className={`
                          flex items-start gap-3 p-3 rounded-lg border
                          ${selectedCanvasIds.has(canvas.originalId)
                            ? 'border-primary bg-primary/5'
                            : 'border-muted-foreground/25'
                          }
                        `}
                      >
                        <Checkbox
                          checked={selectedCanvasIds.has(canvas.originalId)}
                          onCheckedChange={() => toggleCanvasSelection(canvas.originalId)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{canvas.newTitle}</p>
                            {canvas.hasConflicts && (
                              <Badge variant="outline" className="text-xs">
                                Name Conflict
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {canvas.nodeCount} nodes, {canvas.mediaCount} media
                            {preview.exportVersion === 'new' && (
                              <span> ({canvas.mediaWithFiles} with files)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Settings Import Option */}
              {preview.settings && (
                <div className="flex items-center gap-2 p-3 rounded-lg border">
                  <Checkbox
                    checked={importSettings}
                    onCheckedChange={(checked) => setImportSettings(checked === true)}
                  />
                  <div>
                    <p className="text-sm font-medium">Import Settings</p>
                    <p className="text-xs text-muted-foreground">
                      Provider settings will be merged with existing ones
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Message */}
          {success && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isImporting}
          >
            Cancel
          </Button>
          {preview && (
            <Button
              onClick={handleImport}
              disabled={isImporting || selectedCanvasIds.size === 0}
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Selected
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

