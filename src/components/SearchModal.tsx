"use client"

import { escapeHtml } from "@/lib/htmlEscape"

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { FuseResult } from 'fuse.js';
import { searchService, type SearchItem } from '@/lib/searchService';
import { Search, Loader2 } from 'lucide-react';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SearchModalContent: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [canvases, setCanvases] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [searchTruncated, setSearchTruncated] = useState(false);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      const input = document.getElementById('search-input');
      if (input) {
        input.focus();
      }
    }
  }, [isOpen]);

  // Fetch search data from API
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const collected: Array<Record<string, unknown>> = [];
        let cursor = "";
        let truncated = false;
        do {
          const response = await fetch("/api/search?limit=10" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { signal: abort.signal });
          if (!response.ok) throw new Error("Search data unavailable");
          const page = await response.json();
          collected.push(...page);
          truncated ||= page.some((canvas: { searchTruncated?: boolean }) => canvas.searchTruncated);
          cursor = response.headers.get("X-Next-Cursor") || "";
        } while (cursor);
        if (abort.signal.aborted) return;
        setCanvases(collected);
        setSearchTruncated(truncated);
        searchService.buildIndex(collected);
      } catch {
        if (!abort.signal.aborted) setCanvases([]);
      } finally { if (!abort.signal.aborted) setIsLoadingData(false); }
    };
    void load();
    return () => abort.abort();
  }, []);

  // Get type display name
  const getTypeDisplay = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      'canvas-name': 'Canvas Name',
      'canvas-description': 'Canvas Description',
      prompt: 'Prompt',
      response: 'Response',
      text: 'Text Content',
      note: 'Note',
      memory: 'Memory',
      summary: 'Summary',
      input: 'Input',
      error: 'Error',
      filename: 'File',
      title: 'Title',
    };
    return typeMap[type] || type;
  };

  // Get node type display name
  const getNodeTypeDisplay = (nodeType?: string): string => {
    if (!nodeType) return '';
    const typeMap: { [key: string]: string } = {
      memory: 'Memory',
      gemini: 'Gemini',
      openai: 'OpenAI',
      openrouter: 'OpenRouter',
      text: 'Text',
      media: 'Media',
      notes: 'Notes',
      summarizer: 'Summarizer',
    };
    return typeMap[nodeType] || nodeType;
  };

  // Highlight matching text in snippet
  const highlightMatch = (text: string, query: string): string => {
    text = escapeHtml(text);
    query = escapeHtml(query);
    if (!query) return text;
    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
      'gi'
    );
    return text.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>');
  };

  // Create snippet with context around match
  const createSnippet = (fullContent: string, matches: any[]): string => {
    if (!matches || matches.length === 0) return fullContent.substring(0, 100);

    const match = matches[0];
    const indices = match.indices[0];
    const start = Math.max(0, indices[0] - 50);
    const end = Math.min(fullContent.length, indices[1] + 50);
    return fullContent.substring(start, end);
  };

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || isSearching || isLoadingData) return [];

    try {
      const results = searchService.search(searchQuery);
      return results.slice(0, 50); // Limit to 50 results
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }, [searchQuery, isSearching, isLoadingData]);

  // Handle keyboard navigation
  // Handle result click
  const handleResultClick = (result: SearchItem) => {
    router.push(`/canvas/${result.canvasId}`);
    onClose();
  };


  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, searchResults.length - 1)
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && searchResults[selectedIndex]) {
        e.preventDefault();
        const result = searchResults[selectedIndex].item;
        handleResultClick(result);
      }
    },
    [searchResults, selectedIndex]
  );


  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20 z-50 animate-in fade-in-0 duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-96 flex flex-col animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {searchTruncated && <p className="px-4 pt-3 text-xs text-muted-foreground">Large documents are indexed partially. Open the canvas to search its complete text.</p>}
        {/* Search Input */}
        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              id="search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search across all canvases..."
              className="w-full pl-10 pr-4 py-3 text-lg border-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground"
              disabled={isLoadingData}
            />
            {isLoadingData && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto max-h-80">
          {isLoadingData ? (
            <div className="p-4 text-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              Loading search data...
            </div>
          ) : searchResults.length === 0 && searchQuery ? (
            <div className="p-4 text-center text-muted-foreground">
              No results found for "{searchQuery}"
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              Start typing to search across all canvases...
            </div>
          ) : (
            <div className="py-2">
              {searchResults.map((fuseResult, index) => {
                const result = fuseResult.item;
                const snippet = createSnippet(
                  result.fullContent,
                  [...(fuseResult.matches || [])]
                );
                const highlightedSnippet = highlightMatch(snippet, searchQuery);

                return (
                  <div
                    key={`${result.canvasId}-${result.nodeId}-${result.type}-${index}`}
                    className={`px-4 py-3 cursor-pointer border-b border-border hover:bg-muted/50 ${
                      index === selectedIndex ? 'bg-muted' : ''
                    }`}
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Breadcrumb */}
                        <div className="text-xs text-muted-foreground mb-1">
                          In Canvas: "{result.canvasName}"{' '}
                          {result.nodeId ? `/ Node: ${result.nodeId}` : ''}
                        </div>
                        {/* Match snippet */}
                        <div
                          className="text-sm text-foreground"
                          dangerouslySetInnerHTML={{
                            __html: highlightedSnippet,
                          }}
                        />
                        {/* Type and Node Type */}
                        <div className="text-xs text-muted-foreground mt-1 flex gap-2">
                          <span className="capitalize">{getTypeDisplay(result.type)}</span>
                          {result.nodeType && (
                            <>
                              <span>•</span>
                              <span>{getNodeTypeDisplay(result.nodeType)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex justify-between">
          <div>
            {searchResults.length > 0 && (
              <span>
                {searchResults.length} result
                {searchResults.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <span>↑↓ Navigate</span>
            <span>Enter Select</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function SearchModal(props: SearchModalProps) {
  return props.isOpen ? <SearchModalContent {...props} /> : null;
}
