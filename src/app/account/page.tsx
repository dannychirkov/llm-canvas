"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { 
  User, 
  Mail, 
  Calendar, 
  Shield, 
  Download, 
  Upload, 
  Loader2, 
  Palette, 
  Trash2,
  Sun,
  Moon,
  Monitor,
  Lock,
  Database,
  Save,
  X,
  BarChart3,
  Pencil
} from "lucide-react"
import Layout from "@/components/Layout"
import ChangePasswordDialog from "@/components/ChangePasswordDialog"
import ImportDataDialog from "@/components/ImportDataDialog"
import DeleteAccountDialog from "@/components/DeleteAccountDialog"
import { Toast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export default function AccountPage() {
  const { data: session, update } = useSession()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [importDataOpen, setImportDataOpen] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [userCreatedAt, setUserCreatedAt] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [theme, setTheme] = useState<"light" | "dark" | "system">("dark")
  
  // Profile editing state
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [analyticsEnabled, setAnalyticsEnabled] = useState(session?.user?.analyticsEnabled === true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState("")
  const [profileSuccess, setProfileSuccess] = useState("")
  
  // Avatar upload state
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  
  // Avatar delete confirmation dialog state
  const [deleteAvatarDialogOpen, setDeleteAvatarDialogOpen] = useState(false)

  useEffect(() => {
    const synchronizeTheme = () => {
      const saved = localStorage.getItem("theme")
      setTheme(saved === "light" || saved === "dark" || saved === "system" ? saved : "dark")
    }
    window.addEventListener("storage", synchronizeTheme)
    const frame = requestAnimationFrame(synchronizeTheme)
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", synchronizeTheme) }
  }, [])

  const [profileIdentity, setProfileIdentity] = useState(session?.user?.id)
  if (profileIdentity !== session?.user?.id) {
    setProfileIdentity(session?.user?.id)
    setName(session?.user?.name || "")
    setEmail(session?.user?.email || "")
    setAnalyticsEnabled(session?.user?.analyticsEnabled === true)
  }

  // Fetch user creation date and analytics setting
  useEffect(() => {
    const fetchUserData = async () => {
      if (session?.user?.id) {
        try {
          const response = await fetch("/api/profile")
          if (response.ok) {
            const userData = await response.json()
            if (userData.createdAt) {
              const date = new Date(userData.createdAt)
              setUserCreatedAt(date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long' 
              }))
            }
            if (userData.analyticsEnabled !== undefined) {
              setAnalyticsEnabled(userData.analyticsEnabled)
            }
          }
        } catch (error) {
          console.error("Failed to fetch user data:", error)
        }
      }
    }

    fetchUserData()
  }, [session?.user?.id, session?.user?.email, session?.user?.name])

  // Get user initials for avatar
  const getInitials = () => {
    if (session?.user?.name) {
      return session.user.name
        .split(" ")
        .map(n => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    }
    if (session?.user?.email) {
      return session.user.email[0].toUpperCase()
    }
    return "U"
  }

  // Handle profile save
  const handleSaveProfile = async () => {
    if (!name.trim() || !email.trim()) {
      setProfileError("Name and email are required")
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setProfileError("Please enter a valid email address")
      return
    }

    setIsSavingProfile(true)
    setProfileError("")
    setProfileSuccess("")

    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          analyticsEnabled: analyticsEnabled,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to update profile")
      }

      setProfileSuccess("Profile updated successfully!")
      await update({
        name: name.trim(),
        email: email.trim(),
        analyticsEnabled: analyticsEnabled,
      })
      
      setIsEditingProfile(false)
      setTimeout(() => setProfileSuccess(""), 3000)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleCancelEdit = () => {
    setName(session?.user?.name || "")
    setEmail(session?.user?.email || "")
    setAnalyticsEnabled((session?.user as any)?.analyticsEnabled !== false)
    setIsEditingProfile(false)
    setProfileError("")
    setProfileSuccess("")
  }

  // Handle avatar upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setToastMessage('Please select an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setToastMessage('File size must be less than 5MB')
      return
    }

    setIsUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload avatar')
      }

      const data = await response.json()
      
      // Update session to reflect new avatar
      await update({
        image: data.image
      })

      setProfileSuccess('Avatar updated successfully!')
      setTimeout(() => setProfileSuccess(""), 3000)
    } catch (err) {
      console.error('Error uploading avatar:', err)
      setProfileError(err instanceof Error ? err.message : 'Failed to upload avatar')
      setTimeout(() => setProfileError(""), 3000)
    } finally {
      setIsUploadingAvatar(false)
      // Reset input
      e.target.value = ''
    }
  }

  // Handle avatar delete confirmation
  const handleAvatarDeleteClick = () => {
    setDeleteAvatarDialogOpen(true)
  }

  // Handle avatar delete
  const handleAvatarDelete = async () => {
    setDeleteAvatarDialogOpen(false)
    setIsUploadingAvatar(true)
    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'DELETE'
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete avatar')
      }

      // Update session to remove avatar
      await update({
        image: null
      })

      setProfileSuccess('Avatar removed successfully!')
      setTimeout(() => setProfileSuccess(""), 3000)
    } catch (err) {
      console.error('Error deleting avatar:', err)
      setProfileError(err instanceof Error ? err.message : 'Failed to delete avatar')
      setTimeout(() => setProfileError(""), 3000)
    } finally {
      setIsUploadingAvatar(false)
    }
  }


  const applyTheme = (newTheme: "light" | "dark" | "system") => {
    const root = document.documentElement
    const resolved = newTheme === "system"
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light")
      : newTheme
    
    if (resolved === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    
    root.setAttribute("data-theme", resolved)
    
    try {
      localStorage.setItem("theme", newTheme)
    } catch {}
    
    setTheme(newTheme)
  }

  // Handle data export
  const handleExportData = async () => {
    if (!session?.user?.id) return

    setIsExporting(true)
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

    } catch (error) {
      console.error('Export failed:', error)
      setToastMessage('Failed to export data. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Layout>
      <div className="flex justify-center">
        <div className="w-full max-w-[1200px] space-y-8 py-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Account</h1>
            <p className="text-muted-foreground mt-1">
              Manage your account settings and preferences.
            </p>
          </div>

          {/* Profile Header */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Avatar and Profile Fields */}
                <div className="lg:col-span-2">
                  <div className="flex items-start gap-6">
                    {/* Avatar */}
                    <div className="flex-shrink-0 relative">
                      {session?.user?.image ? (
                        <img 
                          src={session.user.image} 
                          alt={session.user?.name || "Avatar"}
                          className="h-20 w-20 rounded-full object-cover border-2 border-primary/20"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-semibold text-primary border-2 border-primary/20">
                          {getInitials()}
                        </div>
                      )}
                      <div className="absolute bottom-0 right-0 flex gap-1">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarUpload}
                          disabled={isUploadingAvatar}
                          className="hidden"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 w-7 p-0 rounded-full"
                          disabled={isUploadingAvatar}
                          title="Upload avatar"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isUploadingAvatar ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        {session?.user?.image && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 w-7 p-0 rounded-full"
                            onClick={handleAvatarDeleteClick}
                            disabled={isUploadingAvatar}
                            title="Remove avatar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Profile Fields */}
                    <div className="flex-1 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-xs text-muted-foreground">
                          Name
                        </Label>
                        {isEditingProfile ? (
                          <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isSavingProfile}
                            className="h-9"
                          />
                        ) : (
                          <div 
                            className="text-base font-medium cursor-pointer hover:text-primary transition-colors flex items-center gap-2"
                            onClick={() => setIsEditingProfile(true)}
                          >
                            {session?.user?.name || "Not provided"}
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-xs text-muted-foreground">
                          Email
                        </Label>
                        {isEditingProfile ? (
                          <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isSavingProfile}
                            className="h-9"
                          />
                        ) : (
                          <div 
                            className="text-base text-muted-foreground cursor-pointer hover:text-foreground transition-colors flex items-center gap-2"
                            onClick={() => setIsEditingProfile(true)}
                          >
                            {session?.user?.email}
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Meta Info */}
                      <div className="flex items-center gap-4 pt-2">
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          <Shield className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                        {userCreatedAt && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            Member since {userCreatedAt}
                          </div>
                        )}
                      </div>

                      {/* Edit Actions */}
                      {isEditingProfile && (
                        <div className="flex items-center gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={handleSaveProfile}
                            disabled={isSavingProfile}
                          >
                            {isSavingProfile ? (
                              <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-3.5 w-3.5" />
                                Save
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            disabled={isSavingProfile}
                          >
                            <X className="mr-2 h-3.5 w-3.5" />
                            Cancel
                          </Button>
                          {profileError && (
                            <span className="text-sm text-destructive">{profileError}</span>
                          )}
                          {profileSuccess && (
                            <span className="text-sm text-green-600">{profileSuccess}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Appearance and Security */}
                <div className="space-y-4">
                  {/* Appearance */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Palette className="h-4 w-4" />
                      Appearance
                    </Label>
                    <div className="w-full flex items-center justify-center rounded-lg bg-muted p-1.5 text-muted-foreground gap-1.5">
                      <button
                        onClick={() => applyTheme("light")}
                        className={`flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                          theme === "light"
                            ? "bg-background text-foreground shadow-sm"
                            : "hover:bg-background/50"
                        }`}
                      >
                        <Sun className="h-4 w-4 mr-2" />
                        Light
                      </button>
                      <button
                        onClick={() => applyTheme("dark")}
                        className={`flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                          theme === "dark"
                            ? "bg-background text-foreground shadow-sm"
                            : "hover:bg-background/50"
                        }`}
                      >
                        <Moon className="h-4 w-4 mr-2" />
                        Dark
                      </button>
                      <button
                        onClick={() => applyTheme("system")}
                        className={`flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                          theme === "system"
                            ? "bg-background text-foreground shadow-sm"
                            : "hover:bg-background/50"
                        }`}
                      >
                        <Monitor className="h-4 w-4 mr-2" />
                        System
                      </button>
                    </div>
                  </div>

                  {/* Security */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Security
                    </Label>
                    <Button
                      variant="outline"
                      onClick={() => setChangePasswordOpen(true)}
                      className="w-full"
                    >
                      <Lock className="mr-2 h-4 w-4" />
                      Change Password
                    </Button>
                  </div>
                </div>

                {/* Analytics - Full Width */}
                <div className="col-span-full pt-6 border-t">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Analytics
                    </Label>
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="analytics"
                          checked={analyticsEnabled}
                          onCheckedChange={(checked) => {
                            setAnalyticsEnabled(checked === true)
                            if (!isEditingProfile) {
                              setIsEditingProfile(true)
                            }
                          }}
                          disabled={isSavingProfile}
                        />
                        <Label
                          htmlFor="analytics"
                          className="text-sm font-normal cursor-pointer"
                        >
                          Help improve the product with analytics
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">
                        Analytics are confidential, minimal, and transparent. They help me to understand if I should continue development. You can disable this at any time.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Data Management */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Database className="h-4 w-4" />
                  Data Management
                </CardTitle>
                <CardDescription>
                  Export or import your account data.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="flex flex-col gap-3 flex-1">
                  <Button
                    variant="outline"
                    onClick={handleExportData}
                    disabled={isExporting}
                    className="w-full"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Export Data
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setImportDataOpen(true)}
                    className="w-full"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Import Data
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Danger Zone */}
            <Card className="flex flex-col border-destructive/50 bg-destructive/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Danger Zone
                </CardTitle>
                <CardDescription>
                  Irreversible and destructive actions.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <Separator className="mb-4" />
                <div className="space-y-3 flex-1 flex flex-col">
                  <p className="text-sm text-muted-foreground">
                    Once you delete your account, there is no going back. Please be certain.
                  </p>
                  <div className="mt-auto">
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteAccountOpen(true)}
                      className="w-full"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Account
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Modals */}
          <ChangePasswordDialog 
            open={changePasswordOpen}
            onOpenChange={setChangePasswordOpen}
          />

          <ImportDataDialog 
            open={importDataOpen}
            onOpenChange={setImportDataOpen}
            onImportComplete={() => {
              window.location.reload()
            }}
          />

          <DeleteAccountDialog 
            open={deleteAccountOpen}
            onOpenChange={setDeleteAccountOpen}
          />

          {/* Avatar Delete Confirmation Dialog */}
          <Dialog open={deleteAvatarDialogOpen} onOpenChange={setDeleteAvatarDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove Avatar</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove your avatar? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteAvatarDialogOpen(false)}
                  disabled={isUploadingAvatar}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleAvatarDelete}
                  disabled={isUploadingAvatar}
                >
                  {isUploadingAvatar ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Removing...
                    </>
                  ) : (
                    'Remove Avatar'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Toast Notification */}
          {toastMessage && (
            <Toast
              message={toastMessage}
              duration={3000}
              onClose={() => setToastMessage(null)}
            />
          )}
        </div>
      </div>
    </Layout>
  )
}
