"use client"

import { useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Keyboard, X } from "lucide-react"

interface HotkeysPanelProps {
  className?: string
}

interface HotkeyGroup {
  title: string
  shortcuts: Array<{
    keys: string[]
    description: string
  }>
}

const HOTKEY_GROUPS: HotkeyGroup[] = [
  {
    title: "Copy & Paste",
    shortcuts: [
      { keys: ["Ctrl", "A"], description: "Select all nodes" },
      { keys: ["Ctrl", "C"], description: "Copy selected nodes" },
      { keys: ["Ctrl", "V"], description: "Paste nodes" },
      { keys: ["Ctrl", "X"], description: "Cut selected nodes" },
      { keys: ["Ctrl", "D"], description: "Duplicate selected nodes" }
    ]
  },
  {
    title: "File Operations",
    shortcuts: [
      { keys: ["Ctrl", "S"], description: "Save canvas" },
      { keys: ["Ctrl", "Z"], description: "Undo" },
      { keys: ["Ctrl", "Y"], description: "Redo" },
      { keys: ["Ctrl", "Shift", "Z"], description: "Redo (alternative)" }
    ]
  },
  {
    title: "Zoom & View",
    shortcuts: [
      { keys: ["Z"], description: "Zoom to selected node (or fit view if none selected)" },
      { keys: ["F"], description: "Fit view (show all nodes)" },
      { keys: ["Ctrl", "0"], description: "Reset zoom to 100%" },
      { keys: ["Ctrl", "+"], description: "Zoom in" },
      { keys: ["Ctrl", "-"], description: "Zoom out" },
      { keys: ["1"], description: "Zoom to 50%" },
      { keys: ["2"], description: "Zoom to 100%" },
      { keys: ["3"], description: "Zoom to 200%" }
    ]
  },
  {
    title: "Node Operations",
    shortcuts: [
      { keys: ["Delete"], description: "Delete selected nodes" },
      { keys: ["H"], description: "Toggle hidden status" },
      { keys: ["Q"], description: "Toggle collapse/expand" },
      { keys: ["Space"], description: "Run selected nodes" },
      { keys: ["↑", "↓", "←", "→"], description: "Move nodes (20px)" },
      { keys: ["Shift", "↑", "↓", "←", "→"], description: "Move nodes (100px)" },
      { keys: ["Ctrl", "Mouse"], description: "Multi-select nodes with mouse" }
    ]
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Escape"], description: "Deselect all & close panels" }
    ]
  }
]

export default function HotkeysPanel({ className = "" }: HotkeysPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isMac = useSyncExternalStore(
    () => () => {},
    () => navigator.platform.toUpperCase().includes("MAC"),
    () => false
  )

  const openPanel = () => {
    setIsOpen(true)
  }

  const closePanel = () => {
    setIsOpen(false)
  }

  const formatKeys = (keys: string[]) => {
    return keys.map(key => {
      if (key === 'Ctrl') return isMac ? '⌘' : 'Ctrl'
      if (key === 'Shift') return '⇧'
      if (key === 'Alt') return isMac ? '⌥' : 'Alt'
      if (key === 'Delete') return 'Del'
      if (key === 'Escape') return 'Esc'
      if (key === '+') return '+'
      if (key === '-') return '-'
      if (key === '0') return '0'
      if (key === '1') return '1'
      if (key === '2') return '2'
      if (key === '3') return '3'
      if (key === '↑') return '↑'
      if (key === '↓') return '↓'
      if (key === '←') return '←'
      if (key === '→') return '→'
      if (key === 'Mouse') return '🖱️'
      if (key === 'Space') return 'Space'
      return key.toUpperCase()
    })
  }

  return (
    <>
      {/* Button to open panel - bottom left */}
      <div className={`fixed bottom-4 left-4 z-40 ${className}`}>
        <Button
          onClick={openPanel}
          size="sm"
          variant="outline"
          className="h-9 w-9 rounded-full bg-background/90 backdrop-blur-sm border-border hover:bg-muted/80 shadow-lg"
          aria-label="Show keyboard shortcuts"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </div>

      {/* Instructions card - appears above button */}
      {isOpen && (
        <div className="fixed bottom-16 left-4 z-50 w-96 max-h-[calc(100vh-6rem)] overflow-hidden hotkeys-modal">
          {/* Card */}
          <div className="relative bg-background border border-border rounded-lg shadow-xl w-full h-full overflow-hidden">
            {/* Header with close button */}
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Keyboard className="h-4 w-4" />
                Keyboard Shortcuts
              </h3>
              <Button
                onClick={closePanel}
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                aria-label="Close keyboard shortcuts"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Content */}
            <div className="p-3 overflow-y-auto h-[calc(100%-80px)]">
              <div className="space-y-4">
                {HOTKEY_GROUPS.map((group, groupIndex) => (
                  <div key={groupIndex}>
                    <h4 className="text-xs font-medium text-foreground mb-2 pb-1 border-b border-border">
                      {group.title}
                    </h4>
                    <div className="space-y-1.5">
                      {group.shortcuts.map((shortcut, shortcutIndex) => (
                        <div key={shortcutIndex} className="flex items-center justify-between text-xs">
                          <span className="text-foreground/90">{shortcut.description}</span>
                          <div className="flex items-center gap-0.5">
                            {formatKeys(shortcut.keys).map((key, keyIndex) => (
                              <div key={keyIndex} className="flex items-center">
                                <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded text-foreground/80 min-w-[20px] text-center shadow-sm">
                                  {key}
                                </kbd>
                                {keyIndex < shortcut.keys.length - 1 && (
                                  <span className="text-muted-foreground/60 mx-0.5 text-xs">+</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Shortcuts work when canvas is focused and not typing in inputs.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
