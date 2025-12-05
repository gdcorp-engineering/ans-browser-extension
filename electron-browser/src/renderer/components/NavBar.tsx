import { useState, useEffect } from 'react';

interface NavBarProps {
  onNewChat: () => void;
  showBrowserSidebar: boolean;
  onToggleBrowser: () => void;
  onBrowserBack: () => void;
  onBrowserForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  currentMode: 'chat' | 'web';
  onOpenSettings: () => void;
  currentUrl: string;
  onNavigateUrl: (url: string) => void;
}

export default function NavBar({
  onNewChat,
  showBrowserSidebar,
  onToggleBrowser,
  onBrowserBack,
  onBrowserForward,
  canGoBack,
  canGoForward,
  currentMode,
  onOpenSettings,
  currentUrl,
  onNavigateUrl,
}: NavBarProps) {
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [isNavigating, setIsNavigating] = useState(false);

  // Update URL input when currentUrl changes
  useEffect(() => {
    setUrlInput(currentUrl);
  }, [currentUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      let urlToNavigate = urlInput.trim();
      // Add https:// if no protocol is specified
      if (!urlToNavigate.match(/^https?:\/\//i)) {
        urlToNavigate = 'https://' + urlToNavigate;
      }
      setIsNavigating(true);
      onNavigateUrl(urlToNavigate);
      setTimeout(() => setIsNavigating(false), 1000);
    }
  };
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        paddingLeft: '80px', // Space for macOS traffic lights
        borderBottom: '1px solid #e5e5e5',
        backgroundColor: '#fafafa',
        height: '52px',
        gap: '8px',
        WebkitAppRegion: 'drag', // Make navbar draggable
      } as React.CSSProperties}
    >
      {/* Left side - Brand/Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>GoDaddy ANS Desktop</span>
      </div>

      {/* Center - Browser Controls (show in chat mode when browser sidebar is visible, or in web mode) */}
      {(currentMode === 'web' || (currentMode === 'chat' && showBrowserSidebar)) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, maxWidth: '600px', margin: '0 auto', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={onBrowserBack}
            disabled={!canGoBack}
            style={{
              padding: '6px 10px',
              backgroundColor: canGoBack ? '#f0f0f0' : 'transparent',
              color: canGoBack ? '#1a1a1a' : '#ccc',
              border: 'none',
              borderRadius: '6px',
              cursor: canGoBack ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: canGoBack ? 1 : 0.5,
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Go Back"
          >
            ←
          </button>
          <button
            onClick={onBrowserForward}
            disabled={!canGoForward}
            style={{
              padding: '6px 10px',
              backgroundColor: canGoForward ? '#f0f0f0' : 'transparent',
              color: canGoForward ? '#1a1a1a' : '#ccc',
              border: 'none',
              borderRadius: '6px',
              cursor: canGoForward ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
              opacity: canGoForward ? 1 : 0.5,
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Go Forward"
          >
            →
          </button>
          {/* Address Bar */}
          <form onSubmit={handleUrlSubmit} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter URL or search"
              style={{
                flex: 1,
                padding: '6px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#1a1a1a',
                outline: 'none',
                minWidth: 0,
              }}
              onFocus={(e) => {
                e.target.select();
              }}
            />
            <button
              type="submit"
              disabled={isNavigating}
              style={{
                padding: '6px 12px',
                backgroundColor: isNavigating ? '#e5e5e5' : '#2563eb',
                color: isNavigating ? '#666' : '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: isNavigating ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
              }}
              title="Go"
            >
              {isNavigating ? '...' : 'Go'}
            </button>
          </form>
        </div>
      )}

      {/* Right side - Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={onNewChat}
          style={{
            padding: '6px 10px',
            backgroundColor: 'transparent',
            color: '#666',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '32px',
            minHeight: '32px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f0f0f0';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          }}
          title="New Chat"
        >
          ➕
        </button>

        {currentMode === 'chat' && (
          <button
            onClick={onToggleBrowser}
            style={{
              padding: '6px 10px',
              backgroundColor: showBrowserSidebar ? '#e5e5e5' : 'transparent',
              color: showBrowserSidebar ? '#1a1a1a' : '#666',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: showBrowserSidebar ? 600 : 400,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '32px',
              minHeight: '32px',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = showBrowserSidebar
                ? '#e5e5e5'
                : '#f0f0f0';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = showBrowserSidebar
                ? '#e5e5e5'
                : 'transparent';
            }}
            title="Toggle Browser"
          >
            🌐
          </button>
        )}

        <button
          onClick={onOpenSettings}
          style={{
            padding: '6px 10px',
            backgroundColor: 'transparent',
            color: '#666',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '32px',
            minHeight: '32px',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f0f0f0';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
          }}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6"></path>
            <path d="M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"></path>
          </svg>
        </button>
      </div>
    </nav>
  );
}
