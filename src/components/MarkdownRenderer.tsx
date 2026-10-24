"use client"

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import { GroundingChunk } from '@/types'

interface MarkdownRendererProps {
  content?: string | null
  className?: string
  groundingSources?: GroundingChunk[]
}

export default function MarkdownRenderer({ content, className = "", groundingSources }: MarkdownRendererProps) {
  // Check that content exists and is a string
  if (!content || typeof content !== 'string') {
    return (
      <div className={`prose prose-sm max-w-none dark:prose-invert overflow-hidden ${className}`}>
        <div className="text-muted-foreground italic">No content to display</div>
      </div>
    )
  }

  return (
    <div className={`prose prose-sm max-w-none dark:prose-invert overflow-hidden ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Customize components for better display
          code: ({ node, className, children, ...props }: {
            node?: any
            inline?: boolean
            className?: string
            children?: React.ReactNode
            [key: string]: any
          }) => {
            const inline = (props as any).inline
            const match = /language-(\w+)/.exec(className || '')
            return !inline && match ? (
              <pre className="bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-x-auto">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            ) : (
              <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
                {children}
              </code>
            )
          },
          // Table styling
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 dark:border-gray-600 px-3 py-2">
              {children}
            </td>
          ),
          // Code block styling
          pre: ({ children }) => (
            <pre className="bg-gray-100 dark:bg-gray-800 rounded p-3 overflow-x-auto text-sm">
              {children}
            </pre>
          ),
          // List styling
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1">
              {children}
            </ol>
          ),
          // Heading styling
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mb-3 mt-5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-bold mb-2 mt-4 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-bold mb-2 mt-3 first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-bold mb-1 mt-2 first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-semibold mb-1 mt-2 first:mt-0">
              {children}
            </h6>
          ),
          // Paragraph styling
          p: ({ children }) => (
            <p className="mb-3 last:mb-0">
              {children}
            </p>
          ),
          // Blockquote styling
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-4">
              {children}
            </blockquote>
          ),
          // Link styling
          a: ({ children, href }) => (
            <a 
              href={href} 
              className="text-blue-600 dark:text-blue-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          // Horizontal rule styling
          hr: () => (
            <hr className="border-gray-300 dark:border-gray-600 my-6" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      
      {groundingSources && groundingSources.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Sources:
          </div>
          <div className="space-y-1">
            {groundingSources.map((chunk, idx) => (
              chunk.web?.uri && (
                <a
                  key={idx}
                  href={chunk.web.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline block"
                >
                  [{idx + 1}] {chunk.web.title || chunk.web.uri}
                </a>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
