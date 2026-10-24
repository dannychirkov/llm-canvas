"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
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
import { Eye, EyeOff, Loader2 } from "lucide-react"

interface UpdateProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onProfileUpdated?: () => void
}

export default function UpdateProfileDialog(props: UpdateProfileDialogProps) {
  return props.open ? <UpdateProfileForm {...props} /> : null
}

function UpdateProfileForm({
  open,
  onOpenChange,
  onProfileUpdated,
}: UpdateProfileDialogProps) {
  const { data: session, update } = useSession()
  const [name, setName] = useState(session?.user?.name || "")
  const [email, setEmail] = useState(session?.user?.email || "")
  const [password, setPassword] = useState("")
  const [analyticsEnabled, setAnalyticsEnabled] = useState(session?.user?.analyticsEnabled === true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  // Initialize form with current user data
  useEffect(() => {
    if (open && session?.user) {
      // Load analyticsEnabled from API
      const loadUserData = async () => {
        try {
          const response = await fetch("/api/profile")
          if (response.ok) {
            const userData = await response.json()
            setAnalyticsEnabled(userData.analyticsEnabled === true) // Default to true if undefined
          }
        } catch (error) {
          console.error("Failed to load user data:", error)
          setAnalyticsEnabled(false) // Default to true on error
        }
      }
      loadUserData()
    }
  }, [open, session])

  const validateForm = () => {
    if (!name.trim()) {
      setError("Name is required")
      return false
    }

    if (!email.trim()) {
      setError("Email is required")
      return false
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address")
      return false
    }

    // If email is being changed, require password
    const emailChanged = email !== session?.user?.email
    if (emailChanged && !password.trim()) {
      setError("Password is required to change email address")
      return false
    }

    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    setError("")
    setSuccess("")

    const requestData = {
      name: name.trim(),
      email: email.trim(),
      password: password.trim() || null,
      analyticsEnabled: analyticsEnabled,
    }
    
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to update profile")
      }

      setSuccess("Profile updated successfully!")
      
      // Update the session with new data

      await update({
        name: name.trim(),
        email: email.trim(),
      })

      
      // Notify parent component that profile was updated
      if (onProfileUpdated) {
        onProfileUpdated()
      }
      
      // Close dialog after a short delay
      setTimeout(() => {
        onOpenChange(false)
      }, 1500)

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const emailChanged = email !== session?.user?.email

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Update Profile</DialogTitle>
          <DialogDescription>
            Update your profile information. Password is required to change your email address.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className={error && !name.trim() ? "border-destructive" : ""}
              disabled={isSubmitting}
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className={error && !email.trim() ? "border-destructive" : ""}
              disabled={isSubmitting}
              autoComplete="email"
            />
          </div>


          {emailChanged && (
            <div className="space-y-2">
              <Label htmlFor="password">Current Password *</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter current password to confirm email change"
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
          )}

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="analytics"
                checked={analyticsEnabled}
                onCheckedChange={(checked) => setAnalyticsEnabled(checked === true)}
                disabled={isSubmitting}
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

          <DialogFooter>
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
              disabled={isSubmitting || !name.trim() || !email.trim() || (emailChanged && !password.trim())}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Profile"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
