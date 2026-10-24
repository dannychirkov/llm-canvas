import React from 'react'
import { OpenAI, Gemini, OpenRouter } from '@lobehub/icons'
import { 
  FileText, 
  Circle,
  Image,
  StickyNote,
  Database,
  TestTube
} from 'lucide-react'

export function getNodeTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'gemini':
      return <Gemini size={20} />
    case 'custom':
    case 'openai':
      return <OpenAI size={20} />
    case 'openrouter':
      return <OpenRouter size={20} />
    case 'summarizer':
      return <FileText className="h-4 w-4" />
    case 'media':
      return <Image className="h-4 w-4" />
    case 'text':
      return <StickyNote className="h-4 w-4" />
    case 'memory':
      return <Database className="h-4 w-4" />
    case 'notes':
      return <StickyNote className="h-4 w-4" />
    case 'nanobanana':
      return <Image className="h-4 w-4" />
    case 'test':
      return <TestTube className="h-4 w-4" />
    default:
      return <Circle className="h-4 w-4" />
  }
}

export function isNavigableNodeType(type: string): boolean {
  return ['summarizer', 'gemini', 'openai', 'openrouter', 'custom', 'nanobanana'].includes(type)
}
