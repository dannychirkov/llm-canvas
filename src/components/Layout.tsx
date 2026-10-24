"use client"

import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
  LayoutDashboard, 
  User, 
  Settings, 
  LogOut,
  Menu,
  X
} from "lucide-react"
import { useState } from "react"
import { usePathname } from "next/navigation"

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" })
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-2xl font-semibold">Loading...</div>
      </div>
    )
  }

  if (!session) {
    router.push("/login")
    return null
  }

  const navigationItems = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      current: pathname?.startsWith("/dashboard")
    },
    {
      name: "Account",
      href: "/account",
      icon: User,
      current: pathname?.startsWith("/account")
    },
    {
      name: "Settings",
      href: "/settings",
      icon: Settings,
      current: pathname?.startsWith("/settings")
    }
  ]

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:h-screen lg:flex-shrink-0
      `}>
        <div className="flex flex-col h-full lg:h-screen">
          {/* Logo and close button */}
          <div className="flex items-center justify-between p-6 border-b">
            <div>
              <h1 className="text-xl font-bold">LLM Canvas</h1>
              <p className="text-sm text-muted-foreground">v{process.env.NEXT_PUBLIC_APP_VERSION}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-6 space-y-2">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.name}
                  variant={item.current ? "secondary" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => {
                    router.push(item.href)
                    setSidebarOpen(false)
                  }}
                >
                  <Icon className="mr-3 h-4 w-4" />
                  {item.name}
                </Button>
              )
            })}
          </nav>

          {/* User info and sign out */}
          <div className="p-6 border-t">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {/* User info with avatar */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        {session.user?.image ? (
                          <img 
                            src={session.user.image} 
                            alt={session.user?.name || "Avatar"}
                            className="h-8 w-8 rounded-full object-cover border-2 border-primary/20"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary border-2 border-primary/20">
                            {(() => {
                              if (session.user?.name) {
                                return session.user.name
                                  .split(" ")
                                  .map(n => n[0])
                                  .join("")
                                  .toUpperCase()
                                  .slice(0, 2)
                              }
                              if (session.user?.email) {
                                return session.user.email[0].toUpperCase()
                              }
                              return "U"
                            })()}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{session.user?.name || session.user?.email}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate w-full">{session.user?.email}</p>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full bg-black text-white border border-destructive hover:bg-black/90"
                    onClick={handleSignOut}
                  >
                    <LogOut className="mr-2 h-3 w-3" />
                    Sign out
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-64">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b bg-card">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">LLM Canvas</h1>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Page content */}
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  )
}
