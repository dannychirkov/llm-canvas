"use client"

import { useState, useEffect } from "react"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  UserPlus,
  Copy,
  Trash2,
  Loader2,
  Check,
  AlertTriangle
} from "lucide-react"
import { format } from "date-fns"

interface Invite {
  id: string
  code: string
  createdBy: string
  creatorEmail: string | null
  createdAt: string
  usedAt: string | null
  usedBy: string | null
  usedByEmail: string | null
  status: "active" | "used" | "pending"
  storageUsage?: {
    totalBytes: number
    formattedSize: string
    limitBytes: number | null
    limitFormatted: string | null
    usagePercentage?: number | null
  } | null
  storageWarning?: boolean
}

interface InviteStats {
  currentUsers: number
  limit: number
  availableSlots: number
}

export default function InviteManagement() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [stats, setStats] = useState<InviteStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Delete user dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<{ id: string; email: string } | null>(null)
  const [confirmEmail, setConfirmEmail] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchInvites = async () => {
    try {
      const response = await fetch("/api/invites")
      if (!response.ok) {
        throw new Error("Failed to fetch invites")
      }
      const data = await response.json()
      setInvites(data.invites || [])
      setStats(data.stats || null)
    } catch (error) {
      console.error("Error fetching invites:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const abort = new AbortController()
    fetch("/api/invites", { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error("Unable to load invites"); return response.json() })
      .then(data => { if (!abort.signal.aborted) { setInvites(data.invites || []); setStats(data.stats || null) } })
      .catch(() => {})
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [])

  const handleGenerateInvite = async () => {
    setGenerating(true)
    try {
      const response = await fetch("/api/invites", {
        method: "POST"
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to generate invite code")
      }

      const newInvite = await response.json()
      
      // Refresh invites list
      await fetchInvites()
      
      // Copy to clipboard first, then show feedback only on success
      try {
        await navigator.clipboard.writeText(newInvite.code)
        setCopiedCode(newInvite.code)
        setTimeout(() => setCopiedCode(null), 2000)
      } catch (error) {
        console.error("Failed to copy invite code to clipboard:", error)
        // Don't show success feedback if clipboard write failed
      }
    } catch (error) {
      console.error("Error generating invite:", error)
      alert(error instanceof Error ? error.message : "Failed to generate invite code")
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  const handleDeleteInvite = async (inviteId: string) => {
    if (!confirm("Are you sure you want to revoke this invite code?")) {
      return
    }

    try {
      const response = await fetch(`/api/invites/${inviteId}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to delete invite code")
      }

      // Refresh invites list
      await fetchInvites()
    } catch (error) {
      console.error("Error deleting invite:", error)
      alert(error instanceof Error ? error.message : "Failed to delete invite code")
    }
  }

  const openDeleteUserDialog = (userId: string, userEmail: string) => {
    setUserToDelete({ id: userId, email: userEmail })
    setConfirmEmail("")
    setDeleteDialogOpen(true)
  }

  const closeDeleteUserDialog = () => {
    setDeleteDialogOpen(false)
    setUserToDelete(null)
    setConfirmEmail("")
  }

  const handleDeleteUser = async () => {
    if (!userToDelete) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/users/${userToDelete.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ confirmEmail })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to delete user")
      }

      // Refresh invites list
      await fetchInvites()
      closeDeleteUserDialog()
    } catch (error) {
      console.error("Error deleting user:", error)
      alert(error instanceof Error ? error.message : "Failed to delete user")
    } finally {
      setIsDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading invites...
        </div>
      </div>
    )
  }

  const canGenerate = stats && stats.availableSlots > 0

  return (
    <div className="space-y-6">
      {/* Stats Card */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              User Access
            </CardTitle>
            <CardDescription>
              Manage invite codes and user access to this installation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats.currentUsers} / {stats.limit}</p>
                <p className="text-sm text-muted-foreground">Current users</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{stats.availableSlots}</p>
                <p className="text-sm text-muted-foreground">Available slots</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate Invite Card */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Invite Code</CardTitle>
          <CardDescription>
            Create a new invite code to share with friends. Each code can be used once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGenerateInvite}
            disabled={generating || !canGenerate}
            className="w-full sm:w-auto"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Generate Invite Code
              </>
            )}
          </Button>
          {stats && !canGenerate && (
            <p className="mt-2 text-sm text-destructive">
              User limit reached. Cannot generate new invite codes.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invites List */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Codes</CardTitle>
          <CardDescription>
            All invite codes that have been generated. Active codes can be shared with friends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No invite codes have been generated yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Used By</TableHead>
                  <TableHead>Storage Usage</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow 
                    key={invite.id}
                    className={invite.storageWarning ? "bg-red-500/10 dark:bg-red-500/5" : ""}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                          {invite.code}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleCopyCode(invite.code)}
                          className="h-6 w-6"
                        >
                          {copiedCode === invite.code ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      {invite.status === "pending" ? (
                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20">
                          Pending
                        </Badge>
                      ) : invite.status === "active" ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Used</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(invite.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invite.status === "pending" ? (
                        <span className="text-muted-foreground italic">Registration in progress...</span>
                      ) : invite.usedByEmail && invite.usedByEmail !== "pending" ? (
                        invite.usedByEmail
                      ) : invite.usedBy && invite.usedBy !== "pending" ? (
                        "Unknown user"
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {invite.status === "used" && invite.storageUsage ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className={invite.storageWarning ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                              {invite.storageUsage.formattedSize}
                            </span>
                            {invite.storageUsage.limitFormatted && (
                              <span className="text-xs text-muted-foreground ml-2">
                                / {invite.storageUsage.limitFormatted}
                              </span>
                            )}
                          </div>
                          {invite.storageUsage.usagePercentage != null && (
                            <div className="w-full bg-secondary rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full transition-all ${
                                  invite.storageWarning
                                    ? 'bg-red-600 dark:bg-red-400'
                                    : 'bg-primary'
                                }`}
                                style={{
                                  width: `${Math.min(100, invite.storageUsage.usagePercentage!)}%`
                                }}
                              />
                            </div>
                          )}
                          {invite.storageWarning && (
                            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                              Warning: 85%+ usage
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {invite.status === "active" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDeleteInvite(invite.id)}
                          className="text-destructive hover:text-destructive"
                          title="Revoke invite code"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {invite.status === "used" && invite.usedBy && invite.usedByEmail && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openDeleteUserDialog(invite.usedBy!, invite.usedByEmail!)}
                          className="text-destructive hover:text-destructive"
                          title="Delete user"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Delete User Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete User Account
            </DialogTitle>
            <DialogDescription>
              This action is irreversible. All user data including canvases, media files, and settings will be permanently deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p className="text-sm">
              To confirm deletion, please type the user&apos;s email address:
            </p>
            <p className="text-sm font-medium bg-muted px-3 py-2 rounded">
              {userToDelete?.email}
            </p>
            <Input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder="Enter email to confirm"
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeleteUserDialog}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={confirmEmail !== userToDelete?.email || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

