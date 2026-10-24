import { useEffect, useCallback } from 'react';

interface UseGlobalSearchReturn {
  openSearch: () => void;
  closeSearch: () => void;
}

export function useGlobalSearch(
  isOpen: boolean,
  onOpen: () => void,
  onClose: () => void
): UseGlobalSearchReturn {
  const openSearch = useCallback(() => {
    onOpen();
  }, [onOpen]);

  const closeSearch = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle search shortcut (Ctrl+K or Cmd+K)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
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
