"use client"

import { useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Eye, EyeOff, Loader2, AlertTriangle, Download, Trash2 } from "lucide-react"

interface DeleteAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function DeleteAccountDialog(props: DeleteAccountDialogProps) {
  return props.open ? <DeleteAccountForm {...props} /> : null
}

function DeleteAccountForm({
  open,
  onOpenChange,
}: DeleteAccountDialogProps) {
  const { data: session } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmDeletion, setConfirmDeletion] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const validateForm = () => {
    if (!email.trim()) {
      setError("Email is required")
      return false
    }

    if (email.trim() !== session?.user?.email) {
      setError("Email must match your account email")
      return false
    }

    // Password is always required for account deletion verification
    if (!password.trim()) {
      setError("Password is required")
      return false
    }

    if (!confirmDeletion) {
      setError("You must confirm that you understand this action cannot be undone")
      return false
    }

    return true
  }

  const handleExportData = async () => {
    setIsExporting(true)
    setError("")
    
    try {
      const response = await fetch('/api/export-data')
      
      if (!response.ok) {
        throw new Error('Failed to export data')
      }
      
      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition')
      const filename = contentDisposition 
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '') 
        : `user-data-export-${new Date().toISOString().split('T')[0]}.zip`
      
      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      setSuccess("Data exported successfully! You can now proceed with account deletion.")
      
    } catch (error) {
      console.error('Export failed:', error)
      setError('Failed to export data. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setError("")
    setSuccess("")

    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete account")
      }

      setSuccess("Account deleted successfully. You will be signed out shortly.")
      
      // Sign out and redirect after a short delay
      setTimeout(async () => {
        await signOut({ 
          callbackUrl: "/login?message=account-deleted",
          redirect: true 
        })
      }, 2000)

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const isFormValid = email.trim() === session?.user?.email && 
                     password.trim() && 
                     confirmDeletion

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Account
          </DialogTitle>
          <DialogDescription>
            This action will permanently delete your account and all associated data. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> This will permanently delete your account, all canvases, 
              media files, settings, and any other data associated with your account. 
              This action cannot be undone.
            </AlertDescription>
          </Alert>

          {/* Export Data Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Before you delete your account:</h4>
            <p className="text-sm text-muted-foreground">
              We recommend exporting your data first. This will download a ZIP file containing 
              all your canvases, settings, and media metadata.
            </p>
            <Button 
              type="button"
              variant="outline" 
              onClick={handleExportData}
              disabled={isExporting}
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting Data...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export My Data
                </>
              )}
            </Button>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-4">Confirm Account Deletion</h4>
            
            <form onSubmit={handleDeleteAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  className={error && !email.trim() ? "border-destructive" : ""}
                  disabled={isSubmitting}
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">
                  Must match your account email: {session?.user?.email}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className={error && !password.trim() ? "border-destructive" : ""}
                    disabled={isSubmitting}
                    autoComplete="current-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isSubmitting}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="confirmDeletion"
                  checked={confirmDeletion}
                  onCheckedChange={(checked) => setConfirmDeletion(checked as boolean)}
                  disabled={isSubmitting}
                />
                <Label 
                  htmlFor="confirmDeletion" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I understand that this action cannot be undone and will permanently delete all my data
                </Label>
              </div>

              {error && (
                <div className="text-sm text-destructive">
                  {error}
                </div>
              )}

              {success && (
                <div className="text-sm text-green-600">
                  {success}
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isSubmitting || !isFormValid}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting Account...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Account Permanently
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
