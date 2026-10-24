"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  HardDrive,
  Loader2,
  Edit
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DEFAULT_STORAGE_LIMIT_BYTES } from "@/lib/storageConstants"
import { formatStorageSize } from "@/lib/formatUtils"

interface UserStorage {
  userId: string
  userEmail: string
  userName: string | null
  isOwner: boolean
  storage: {
    totalBytes: number
    formattedSize: string
    limitBytes: number | null
    limitFormatted: string | null
    usagePercentage?: number | null
    warningThreshold: number
    isOverLimit: boolean
    isNearLimit: boolean
    breakdown: {
      mediaFiles: number
      database: number
    }
  }
}

export default function UserStorageManagement() {
  const [users, setUsers] = useState<UserStorage[]>([])
  const [loading, setLoading] = useState(true)
  const [editingUser, setEditingUser] = useState<UserStorage | null>(null)
  const [editLimit, setEditLimit] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [defaultLimit] = useState<number>(DEFAULT_STORAGE_LIMIT_BYTES) // 1GB default

  const fetchUsers = async () => {
    try {
      // First, get all users
      const usersResponse = await fetch("/api/profile")
      if (!usersResponse.ok) {
        throw new Error("Failed to fetch current user")
      }
      const currentUser = await usersResponse.json()

      // Get all users (we'll need to add this endpoint or use statistics)
      // For now, we'll fetch storage info for known users
      // In a real implementation, we'd have an endpoint to list all users
      // For MVP, we'll show a message that this feature needs the user ID

      // Actually, we need an endpoint to list all users with storage info
      // Let's create a simple approach: fetch users from invites that were used
      const invitesResponse = await fetch("/api/invites")
      if (!invitesResponse.ok) {
        throw new Error("Failed to fetch invites")
      }
      const invitesData = await invitesResponse.json()

      // Get unique user IDs from used invites
      const usedUserIds = new Set<string>()
      invitesData.invites?.forEach((invite: any) => {
        if (invite.usedBy && invite.status === "used") {
          usedUserIds.add(invite.usedBy)
        }
      })

      // Fetch storage info for each user
      const storagePromises = Array.from(usedUserIds).map(async (userId) => {
        try {
          const response = await fetch(`/api/users/${userId}/storage`)
          if (response.ok) {
            return await response.json()
          }
        } catch (error) {
          console.error(`Error fetching storage for user ${userId}:`, error)
        }
        return null
      })

      const storageData = (await Promise.all(storagePromises)).filter(Boolean)

      // Also add owner info if current user is owner
      if (currentUser.isOwner) {
        try {
          const ownerStorage = await fetch(`/api/users/${currentUser.id}/storage`)
          if (ownerStorage.ok) {
            const ownerData = await ownerStorage.json()
            // Add owner at the beginning only if not already present
            // Check both storageData and usedUserIds to avoid duplicates
            const ownerIdStr = String(ownerData.userId)
            const alreadyExists = storageData.some(u => String(u.userId) === ownerIdStr) ||
              usedUserIds.has(currentUser.id)
            if (!alreadyExists) {
              storageData.unshift(ownerData)
            }
          }
        } catch (error) {
          console.error("Error fetching owner storage:", error)
        }
      }

      return storageData
    } catch (error) {
      console.error("Error fetching users:", error)
    }
  }

  useEffect(() => {
    // Get default limit (this will be read from env on server, but for UI we use a reasonable default)
    // The actual default is applied on the server
    void fetchUsers().then(users => { if (users) setUsers(users) }).finally(() => setLoading(false))
  }, [])



  const handleEditLimit = (user: UserStorage) => {
    setEditingUser(user)
    setEditLimit(user.storage.limitBytes?.toString() || "")
    setErrorMessage("") // Clear any previous errors
  }

  const handleSaveLimit = async () => {
    if (!editingUser) return

    // Clear previous errors
    setErrorMessage("")
    setSaving(true)

    try {
      // Empty string means "use default limit" (null on server)
      const limitBytes = editLimit.trim() === ""
        ? null
        : parseInt(editLimit, 10)

      if (limitBytes !== null && (isNaN(limitBytes) || limitBytes <= 0)) {
        setErrorMessage("Storage limit must be a positive integer or empty for default limit")
        setSaving(false)
        return
      }

      const response = await fetch(`/api/users/${editingUser.userId}/storage`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          storageLimitBytes: limitBytes
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to update storage limit")
      }

      // Refresh users list
      const users = await fetchUsers()
      if (users) setUsers(users)
      setEditingUser(null)
      setEditLimit("")
      setErrorMessage("")
    } catch (error) {
      console.error("Error updating storage limit:", error)
      setErrorMessage(error instanceof Error ? error.message : "Failed to update storage limit")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading user storage...
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            User Storage Management
          </CardTitle>
          <CardDescription>
            View and manage storage limits for invited users. Owner has unlimited storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No users found. Invite users to see their storage usage here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Storage Used</TableHead>
                  <TableHead>Storage Limit</TableHead>
                  <TableHead>Usage %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow
                    key={user.userId}
                    className={user.storage.isNearLimit || user.storage.isOverLimit ? "bg-yellow-500/10 dark:bg-yellow-500/5" : ""}
                  >
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {user.userName || user.userEmail}
                          {user.isOwner && (
                            <Badge variant="outline" className="ml-2">Owner</Badge>
                          )}
                        </div>
                        {user.userName && (
                          <div className="text-xs text-muted-foreground">{user.userEmail}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{user.storage.formattedSize}</div>
                      <div className="text-xs text-muted-foreground">
                        Media: {formatStorageSize(user.storage.breakdown.mediaFiles)} | DB: {formatStorageSize(user.storage.breakdown.database)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.isOwner ? (
                        <span className="text-muted-foreground italic">Unlimited</span>
                      ) : (
                        <span>{user.storage.limitFormatted || `Default (${formatStorageSize(defaultLimit)})`}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.isOwner ? (
                        <span className="text-muted-foreground">—</span>
                      ) : user.storage.usagePercentage != null ? (
                        <span className={
                          user.storage.isOverLimit
                            ? "font-medium text-red-600 dark:text-red-400"
                            : user.storage.isNearLimit
                              ? "font-medium text-yellow-600 dark:text-yellow-400"
                              : ""
                        }>
                          {user.storage.usagePercentage}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.isOwner ? (
                        <Badge variant="outline">Unlimited</Badge>
                      ) : user.storage.isOverLimit ? (
                        <Badge variant="destructive">Over Limit</Badge>
                      ) : user.storage.isNearLimit ? (
                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
                          Warning (85%+)
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Normal</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!user.isOwner && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleEditLimit(user)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Limit Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Storage Limit</DialogTitle>
            <DialogDescription>
              Set storage limit for {editingUser?.userEmail}. Leave empty to use the default limit ({formatStorageSize(defaultLimit)}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {errorMessage && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="limit">Storage Limit (bytes)</Label>
              <Input
                id="limit"
                type="number"
                value={editLimit}
                onChange={(e) => setEditLimit(e.target.value)}
                placeholder={`Default: ${formatStorageSize(defaultLimit)}`}
                min="0"
              />
              <p className="text-xs text-muted-foreground">
                Enter limit in bytes, or leave empty to use the default limit.
              </p>
            </div>
            {editingUser && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="text-sm font-medium">Current Usage</div>
                <div className="text-2xl font-bold">{editingUser.storage.formattedSize}</div>
                {editingUser.storage.limitFormatted && (
                  <div className="text-xs text-muted-foreground">
                    Limit: {editingUser.storage.limitFormatted}
                    {editingUser.storage.usagePercentage != null && (
                      <span> ({editingUser.storage.usagePercentage}%)</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLimit} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

