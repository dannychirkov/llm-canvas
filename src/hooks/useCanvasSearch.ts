import { useEffect, useCallback } from 'react';

interface UseCanvasSearchReturn {
  openSearch: () => void;
  closeSearch: () => void;
}

export function useCanvasSearch(
  isOpen: boolean,
  onOpen: () => void,
  onClose: () => void
): UseCanvasSearchReturn {
  const openSearch = useCallback(() => {
    onOpen();
  }, [onOpen]);

  const closeSearch = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle canvas search shortcut (Ctrl+F or Cmd+F)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyF') {
        event.preventDefault();
        if (isOpen) {
          closeSearch();
        } else {
          openSearch();
        }
      }
      
      // Handle Escape key to close search
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        closeSearch();
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, openSearch, closeSearch]);

  return {
    openSearch,
    closeSearch,
  };
}
