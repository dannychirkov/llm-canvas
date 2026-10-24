import Fuse, { IFuseOptions, FuseResult } from 'fuse.js';
import { SearchItem } from './searchService';

class CanvasSearchService {
  private fuse: Fuse<SearchItem> | null = null;
  private searchItems: SearchItem[] = [];

  buildIndex(canvas: any) {
    this.searchItems = [];
    this.indexCanvas(canvas);

    // Fuse.js options for fuzzy search (same as global search)
    const options: IFuseOptions<SearchItem> = {
      keys: ['content', 'canvasName', 'nodeType'],
      threshold: 0.3, // Lower threshold for more lenient matching
      includeMatches: true,
      includeScore: true,
    };

    this.fuse = new Fuse(this.searchItems, options);
  }

  private indexCanvas(canvas: any) {
    const { id: canvasId, title: canvasName, description } = canvas;

    // Index canvas name
    if (canvasName) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId: '',
        content: canvasName,
        type: 'canvas-name',
        fullContent: canvasName,
      });
    }

    // Index canvas description
    if (description) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId: '',
        content: description,
        type: 'canvas-description',
        fullContent: description,
      });
    }

    // Index nodes from Canvas.content JSON
    if (canvas.content) {
      try {
        const contentData = typeof canvas.content === 'string' 
          ? JSON.parse(canvas.content) 
          : canvas.content;
        
        if (contentData.nodes) {
          contentData.nodes.forEach((node: any) => {
            this.indexNode(node, canvasId, canvasName);
          });
        }
      } catch (error) {
        console.warn('Failed to parse canvas content:', error);
      }
    }

    // Index nodes from separate Node table
    if (!canvas.content && canvas.nodes) {
      canvas.nodes.forEach((node: any) => {
        this.indexNode(node, canvasId, canvasName);
      });
    }
  }

  private indexNode(node: any, canvasId: string, canvasName: string) {
    const { id: nodeId, type: nodeType, data } = node;

    // Index prompt text
    if (data.promptText) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.promptText,
        type: 'prompt',
        fullContent: data.promptText,
        nodeType,
      });
    }

    // Index response text
    if (data.responseText) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.responseText,
        type: 'response',
        fullContent: data.responseText,
        nodeType,
      });
    }

    // Index text content (for text nodes)
    if (data.textContent) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.textContent,
        type: 'text',
        fullContent: data.textContent,
        nodeType,
      });
    }

    // Index note content (for note nodes)
    if (data.noteContent || data.notes) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.noteContent || data.notes,
        type: 'note',
        fullContent: data.noteContent || data.notes,
        nodeType,
      });
    }

    // Index memory value (for memory nodes)
    if (data.value) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.value,
        type: 'memory',
        fullContent: data.value,
        nodeType,
      });
    }

    // Index summary text (for summarizer nodes)
    if (data.summaryText) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.summaryText,
        type: 'summary',
        fullContent: data.summaryText,
        nodeType,
      });
    }

    // Index input text
    if (data.inputText) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.inputText,
        type: 'input',
        fullContent: data.inputText,
        nodeType,
      });
    }

    // Index error text
    if (data.errorText) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.errorText,
        type: 'error',
        fullContent: data.errorText,
        nodeType,
      });
    }

    // Index media file names
    if (data.mediaFiles && Array.isArray(data.mediaFiles)) {
      data.mediaFiles.forEach((file: any) => {
        if (file.name) {
          this.searchItems.push({
            canvasId,
            canvasName,
            nodeId,
            content: file.name,
            type: 'filename',
            fullContent: file.name,
            nodeType,
          });
        }
      });
    }

    // Index title (for nodes with titles)
    if (data.title && data.title !== nodeType) {
      this.searchItems.push({
        canvasId,
        canvasName,
        nodeId,
        content: data.title,
        type: 'title',
        fullContent: data.title,
        nodeType,
      });
    }
  }

  search(query: string): FuseResult<SearchItem>[] {
    if (!this.fuse) {
      throw new Error('Search index not built. Call buildIndex() first.');
    }
    return this.fuse.search(query);
  }

  getAllItems(): SearchItem[] {
    return this.searchItems;
  }

  // Rebuild index (useful when canvas is updated)
  rebuildIndex(canvas: any) {
    this.buildIndex(canvas);
  }
}

export const canvasSearchService = new CanvasSearchService();
export type { SearchItem } from './searchService';
