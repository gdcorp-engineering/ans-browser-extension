// Content script that runs on all pages to extract context and interact with the DOM

// Visual feedback for clicks with magical overlay effect
function highlightElement(element: Element, coordinates: { x: number; y: number }) {
  const originalOutline = (element as HTMLElement).style.outline;
  const originalBg = (element as HTMLElement).style.backgroundColor;

  (element as HTMLElement).style.outline = '3px solid #007AFF';
  (element as HTMLElement).style.backgroundColor = 'rgba(0, 122, 255, 0.1)';

  // Create magical overlay with blue tint
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 122, 255, 0.50);
    pointer-events: none;
    z-index: 999997;
    animation: atlasMagicOverlay 1.2s ease-out forwards;
  `;

  // Create magic wand with sparkle trail
  const wand = document.createElement('div');
  wand.innerHTML = '✨';
  wand.style.cssText = `
    position: fixed;
    left: ${coordinates.x}px;
    top: ${coordinates.y}px;
    font-size: 32px;
    pointer-events: none;
    z-index: 999999;
    animation: atlasMagicWand 0.8s ease-out;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.8),
                 0 0 20px rgba(138, 43, 226, 0.6);
  `;

  // Create sparkle particles
  const sparkleCount = 12;
  const sparkles: HTMLDivElement[] = [];

  for (let i = 0; i < sparkleCount; i++) {
    const sparkle = document.createElement('div');
    const angle = (i / sparkleCount) * Math.PI * 2;
    const distance = 60 + Math.random() * 40;
    const offsetX = Math.cos(angle) * distance;
    const offsetY = Math.sin(angle) * distance;
    const delay = i * 0.05;
    const size = 4 + Math.random() * 6;

    sparkle.style.cssText = `
      position: fixed;
      left: ${coordinates.x}px;
      top: ${coordinates.y}px;
      width: ${size}px;
      height: ${size}px;
      background: linear-gradient(45deg, #FFD700, #FFA500, #FF69B4);
      border-radius: 50%;
      pointer-events: none;
      z-index: 999998;
      box-shadow: 0 0 ${size * 2}px rgba(255, 215, 0, 0.8);
      animation: atlasSparkle 0.8s ease-out ${delay}s forwards;
      --offset-x: ${offsetX}px;
      --offset-y: ${offsetY}px;
    `;

    sparkles.push(sparkle);
    document.body.appendChild(sparkle);
  }

  // Create main click indicator
  const indicator = document.createElement('div');
  indicator.style.cssText = `
    position: fixed;
    left: ${coordinates.x}px;
    top: ${coordinates.y}px;
    width: 20px;
    height: 20px;
    margin-left: -10px;
    margin-top: -10px;
    border-radius: 50%;
    background: rgba(138, 43, 226, 0.5);
    border: 2px solid #8A2BE2;
    pointer-events: none;
    z-index: 999999;
    animation: atlasMagicPulse 0.8s ease-out;
    box-shadow: 0 0 20px rgba(138, 43, 226, 0.8),
                0 0 40px rgba(138, 43, 226, 0.4);
  `;

  // Add animation keyframes if not already present
  if (!document.getElementById('atlas-magic-animation')) {
    const style = document.createElement('style');
    style.id = 'atlas-magic-animation';
    style.textContent = `
      @keyframes atlasMagicOverlay {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }

      @keyframes atlasMagicPulse {
        0% {
          transform: scale(1) rotate(0deg);
          opacity: 1;
        }
        50% {
          transform: scale(1.5) rotate(180deg);
        }
        100% {
          transform: scale(3) rotate(360deg);
          opacity: 0;
        }
      }

      @keyframes atlasMagicWand {
        0% {
          transform: translate(-50%, -50%) scale(0) rotate(0deg);
          opacity: 0;
        }
        30% {
          opacity: 1;
        }
        50% {
          transform: translate(-50%, -50%) scale(1.5) rotate(180deg);
        }
        100% {
          transform: translate(-50%, -50%) scale(0.5) rotate(360deg);
          opacity: 0;
        }
      }

      @keyframes atlasSparkle {
        0% {
          transform: translate(-50%, -50%) scale(1);
          opacity: 1;
        }
        70% {
          opacity: 0.8;
        }
        100% {
          transform: translate(calc(-50% + var(--offset-x)), calc(-50% + var(--offset-y))) scale(0);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  document.body.appendChild(wand);
  document.body.appendChild(indicator);

  setTimeout(() => {
    (element as HTMLElement).style.outline = originalOutline;
    (element as HTMLElement).style.backgroundColor = originalBg;
    overlay.remove();
    wand.remove();
    indicator.remove();
    sparkles.forEach(s => s.remove());
  }, 1200);
}

interface PageContext {
  url: string;
  title: string;
  textContent: string;
  links: Array<{ text: string; href: string }>;
  images: Array<{ alt: string; src: string }>;
  forms: Array<{ id: string; action: string; inputs: Array<{ name: string; type: string }> }>;
  interactiveElements?: Array<{
    tag: string;
    text: string;
    value?: string;
    selector: string;
    type?: string;
    ariaLabel?: string;
    visible: boolean;
    priority?: number; // Higher priority = more likely to be clicked
    bounds?: { x: number; y: number; width: number; height: number };
    inModal?: boolean; // Whether element is inside a modal
  }>;
  metadata: {
    description?: string;
    keywords?: string;
    author?: string;
    ogType?: string;
  };
  structure?: {
    headings: Array<{ level: string; text: string }>;
    hasArticleStructure: boolean;
    hasMainStructure: boolean;
    hasNavigation: boolean;
    sectionCount: number;
    paragraphCount: number;
    mainContentLength: number;
    mainContentRatio: number;
  };
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  authentication?: {
    isLoginPage: boolean;
    isAuthenticated: boolean;
    loginIndicators: string[];
    requiresLogin: boolean;
  };
  modals?: Array<{
    element: Element;
    selector: string;
    isVisible: boolean;
    hasBackdrop: boolean;
    closeButton?: {
      selector: string;
      text: string;
    };
    interactiveElements: number;
    zIndex: number;
  }>;
  hasActiveModals?: boolean; // Flag indicating modals are present (use DOM, not screenshots)
}

// Cache for DOM queries to improve performance
// Use window property to avoid duplicate declaration errors if script is injected multiple times
interface DomCache {
  interactiveElements?: Array<any>;
  timestamp?: number;
  url?: string;
}

// Use window property to store function to avoid duplicate declaration errors
// Don't use const/let/var - just assign to window directly
if (typeof (window as any).__atlasGetDomCache === 'undefined') {
  (window as any).__atlasGetDomCache = (): DomCache => {
    if (!(window as any).__atlasDomCache) {
      (window as any).__atlasDomCache = {};
    }
    return (window as any).__atlasDomCache;
  };
}

// Access via window property, don't declare as const
function getDomCache(): DomCache {
  return (window as any).__atlasGetDomCache();
}

// Use window property to avoid duplicate declaration errors
if (typeof (window as any).__atlasCacheDuration === 'undefined') {
  (window as any).__atlasCacheDuration = 2000; // 2 seconds cache
}
// Use window property to store function to avoid duplicate declaration errors
if (typeof (window as any).__atlasGetCacheDuration === 'undefined') {
  (window as any).__atlasGetCacheDuration = (): number => {
    return (window as any).__atlasCacheDuration || 2000;
  };
}
// Access via window property, don't declare as const/function
function getCacheDuration(): number {
  return (window as any).__atlasGetCacheDuration();
}

// Check if element is truly visible (not just in viewport)
function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  
  // Basic visibility checks
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  
  // Check if element is in viewport (with some padding for partially visible elements)
  const padding = 10;
  return (
    rect.top < window.innerHeight + padding &&
    rect.bottom > -padding &&
    rect.left < window.innerWidth + padding &&
    rect.right > -padding
  );
}

// Detect if an element is inside a modal/dialog (enhanced for React/Jira)
function isElementInModal(el: Element): Element | null {
  let current: Element | null = el;
  
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    const className = current.className?.toLowerCase() || '';
    const id = current.id?.toLowerCase() || '';
    const dataTestId = current.getAttribute('data-testid')?.toLowerCase() || '';
    
    // Check for common modal indicators (framework-agnostic)
    if (
      tag === 'dialog' ||
      role === 'dialog' ||
      role === 'alertdialog' ||
      // Common class patterns (all frameworks)
      className.includes('modal') ||
      className.includes('dialog') ||
      className.includes('popup') ||
      className.includes('overlay') ||
      className.includes('drawer') ||
      className.includes('layer') ||
      className.includes('portal') ||
      className.includes('sheet') || // Bottom sheet modals
      className.includes('panel') || // Side panel modals
      className.includes('lightbox') || // Image/lightbox modals
      className.includes('popover') || // Popover modals
      // ID patterns
      id.includes('modal') ||
      id.includes('dialog') ||
      id.includes('popup') ||
      id.includes('drawer') ||
      // Data attribute patterns (React, Vue, Angular, etc.)
      dataTestId.includes('modal') ||
      dataTestId.includes('dialog') ||
      dataTestId.includes('drawer') ||
      dataTestId.includes('popup') ||
      dataTestId.includes('sheet') ||
      // Standard ARIA attributes
      current.hasAttribute('aria-modal') ||
      current.hasAttribute('data-modal') ||
      current.hasAttribute('data-dialog') ||
      current.hasAttribute('data-popup') ||
      // Framework-specific patterns
      // React (including styled-components, emotion, etc.)
      (className.includes('sc-') || className.includes('css-') || className.includes('emotion-')) && 
        (className.includes('modal') || className.includes('dialog') || className.includes('drawer')) ||
      // Vue.js patterns
      className.includes('v-modal') ||
      className.includes('vue-modal') ||
      dataTestId.includes('vue-modal') ||
      // Angular Material
      className.includes('mat-dialog') ||
      className.includes('cdk-overlay') ||
      // Bootstrap
      className.includes('modal') && className.includes('show') ||
      className.includes('modal-backdrop') ||
      // Material-UI / MUI
      className.includes('MuiModal') ||
      className.includes('MuiDialog') ||
      className.includes('MuiDrawer') ||
      // Ant Design
      className.includes('ant-modal') ||
      className.includes('ant-drawer') ||
      // Chakra UI
      className.includes('chakra-modal') ||
      className.includes('chakra-drawer') ||
      // Semantic UI
      className.includes('ui modal') ||
      className.includes('ui dialog') ||
      // Foundation
      className.includes('reveal') ||
      className.includes('foundation-modal') ||
      // Bulma
      className.includes('modal') && className.includes('is-active') ||
      // Tailwind-based modals (common patterns)
      (className.includes('fixed') && className.includes('inset-0') && zIndex > 500) ||
      // Generic portal patterns
      current.getAttribute('data-portal') !== null ||
      current.getAttribute('data-overlay') !== null
    ) {
      return current;
    }
    
    // Check for high z-index elements that might be modals (lowered threshold for React modals)
    const style = window.getComputedStyle(current);
    const zIndex = parseInt(style.zIndex, 10);
    // Lower threshold to catch more modals (Jira often uses 500-1000 range)
    if (zIndex > 500 && style.position !== 'static' && (style.position === 'fixed' || style.position === 'absolute')) {
      // Check if it covers a significant portion of the viewport
      const rect = current.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      // Lower threshold to 20% to catch smaller modals like Jira create modal
      if (elementArea > viewportArea * 0.2) {
        // Additional check: if it's centered or positioned like a modal
        const isCentered = (
          Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < window.innerWidth * 0.1 &&
          Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < window.innerHeight * 0.1
        );
        // Or if it has many interactive elements (likely a form modal)
        const interactiveCount = current.querySelectorAll(
          'button, input, select, textarea, [role="button"], [contenteditable="true"]'
        ).length;
        if (isCentered || interactiveCount > 3) {
          return current;
        }
      }
    }
    
    // Check shadow DOM
    if (current.shadowRoot) {
      const shadowModal = current.shadowRoot.querySelector('[role="dialog"], [aria-modal="true"], .modal, .dialog');
      if (shadowModal) {
        return current;
      }
    }
    
    current = current.parentElement;
  }
  
  // Check if element is in a React portal (rendered outside body but still visible)
  // Portals often have specific markers
  if (el.getRootNode() && el.getRootNode() !== document) {
    const root = el.getRootNode() as ShadowRoot | Document;
    if (root instanceof ShadowRoot || (root !== document && root.body)) {
      // Element is in a portal or shadow DOM
      const portalContainer = root instanceof ShadowRoot ? root.host : root.body;
      if (portalContainer) {
        const portalStyle = window.getComputedStyle(portalContainer);
        const portalZIndex = parseInt(portalStyle.zIndex, 10);
        if (portalZIndex > 500) {
          return portalContainer as Element;
        }
      }
    }
  }
  
  return null;
}

// Detect all visible modals on the page
function detectModals(): Array<{
  element: Element;
  selector: string;
  isVisible: boolean;
  hasBackdrop: boolean;
  closeButton?: {
    selector: string;
    text: string;
  };
  interactiveElements: number;
  zIndex: number;
}> {
  const modals: Array<{
    element: Element;
    selector: string;
    isVisible: boolean;
    hasBackdrop: boolean;
    closeButton?: {
      selector: string;
      text: string;
    };
    interactiveElements: number;
    zIndex: number;
  }> = [];
  
  // Common modal selectors (framework-agnostic, covers all major frameworks)
  const modalSelectors = [
    // Standard HTML5
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    // Generic class patterns
    '.modal',
    '.dialog',
    '.popup',
    '.overlay',
    '.drawer',
    '.layer',
    '.sheet',
    '.panel',
    '.lightbox',
    '.popover',
    // Data attributes (React, Vue, Angular, etc.)
    '[data-modal]',
    '[data-dialog]',
    '[data-popup]',
    '[data-drawer]',
    '[data-portal]',
    '[data-overlay]',
    // Test ID patterns (common in all frameworks)
    '[data-testid*="modal" i]',
    '[data-testid*="dialog" i]',
    '[data-testid*="drawer" i]',
    '[data-testid*="popup" i]',
    '[data-testid*="sheet" i]',
    // React patterns (including styled-components, emotion)
    '[class*="Modal"]',
    '[class*="Dialog"]',
    '[class*="Drawer"]',
    '[class*="Portal"]',
    '[class*="sc-"][class*="modal" i]',
    '[class*="css-"][class*="modal" i]',
    '[class*="emotion-"][class*="modal" i]',
    // Vue.js patterns
    '.v-modal',
    '.vue-modal',
    '[class*="v-modal"]',
    '[data-vue-modal]',
    // Angular Material
    '.mat-dialog-container',
    '.mat-dialog',
    '.cdk-overlay-container',
    '.cdk-overlay-pane',
    '[class*="mat-dialog"]',
    '[class*="cdk-overlay"]',
    // Bootstrap
    '.modal.show',
    '.modal-backdrop',
    '[class*="modal"][class*="show"]',
    // Material-UI / MUI
    '[class*="MuiModal"]',
    '[class*="MuiDialog"]',
    '[class*="MuiDrawer"]',
    '[class*="MuiPopover"]',
    // Ant Design
    '[class*="ant-modal"]',
    '[class*="ant-drawer"]',
    '[class*="ant-popover"]',
    // Chakra UI
    '[class*="chakra-modal"]',
    '[class*="chakra-drawer"]',
    // Semantic UI
    '.ui.modal',
    '.ui.dialog',
    // Foundation
    '.reveal',
    '[class*="foundation-modal"]',
    // Bulma
    '.modal.is-active',
    // Tailwind patterns (common modal structure)
    '[class*="fixed"][class*="inset-0"][class*="z-"]',
    // Generic portal/overlay patterns
    '[class*="portal"]',
    '[class*="overlay"]',
    '[class*="backdrop"]'
  ];
  
  const foundModals = new Set<Element>();
  
  // Find modals by selector
  modalSelectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (!foundModals.has(el) && isElementVisible(el)) {
          foundModals.add(el);
        }
      });
    } catch (e) {
      // Invalid selector, skip
    }
  });
  
  // Also check for high z-index elements that might be modals (enhanced for React/Jira)
  // Use a more efficient approach - check only fixed/absolute positioned elements
  const allElements = document.querySelectorAll('*');
  allElements.forEach(el => {
    if (foundModals.has(el)) return;
    
    const style = window.getComputedStyle(el);
    const zIndex = parseInt(style.zIndex, 10);
    const position = style.position;
    
    // Lower threshold to catch React modals (Jira uses 500-1000 range)
    // Only check fixed/absolute positioned elements
    if (zIndex > 500 && (position === 'fixed' || position === 'absolute')) {
      const rect = el.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      
      // Lower threshold to 20% to catch smaller modals like Jira create modal
      if (elementArea > viewportArea * 0.2 && isElementVisible(el)) {
        // Additional heuristics for React modals
        const interactiveCount = el.querySelectorAll(
          'button, input, select, textarea, [role="button"], [contenteditable="true"]'
        ).length;
        
        // Check if centered (typical modal pattern)
        const isCentered = (
          Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) < window.innerWidth * 0.15 &&
          Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2) < window.innerHeight * 0.15
        );
        
        // Check for form-like structure (common in create modals)
        const hasForm = el.querySelector('form, [role="form"]') !== null;
        const hasMultipleInputs = el.querySelectorAll('input, textarea, select').length >= 2;
        
        // If it looks like a modal (centered, has form, or has many interactive elements)
        if (isCentered || hasForm || hasMultipleInputs || interactiveCount > 3) {
          foundModals.add(el);
        }
      }
    }
  });
  
  // Check React portals (elements rendered outside normal DOM)
  // Portals are often in divs with high z-index at root level
  const rootLevelElements = Array.from(document.body.children);
  rootLevelElements.forEach(el => {
    if (foundModals.has(el)) return;
    
    const style = window.getComputedStyle(el);
    const zIndex = parseInt(style.zIndex, 10);
    if (zIndex > 500 && (style.position === 'fixed' || style.position === 'absolute')) {
      const rect = el.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const elementArea = rect.width * rect.height;
      
      if (elementArea > viewportArea * 0.2 && isElementVisible(el)) {
        // Check if it has modal-like content
        const hasDialogRole = el.querySelector('[role="dialog"]') !== null;
        const hasModalAria = el.hasAttribute('aria-modal') || el.querySelector('[aria-modal="true"]') !== null;
        const interactiveCount = el.querySelectorAll('button, input, select, textarea').length;
        
        if (hasDialogRole || hasModalAria || interactiveCount > 2) {
          foundModals.add(el);
        }
      }
    }
  });
  
  // Process found modals
  foundModals.forEach(modalEl => {
    const rect = modalEl.getBoundingClientRect();
    const style = window.getComputedStyle(modalEl);
    const zIndex = parseInt(style.zIndex, 10) || 0;
    
    // Generate selector for the modal (enhanced for React/Jira)
    const getElementSelector = (el: Element): string => {
      // Prefer data-testid (common in React/Jira)
      const dataTestId = el.getAttribute('data-testid');
      if (dataTestId) return `[data-testid="${dataTestId}"]`;
      
      // Prefer ID
      if (el.id) return `#${el.id}`;
      
      // Prefer name attribute
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      
      // Prefer data attributes
      const dataId = el.getAttribute('data-id');
      if (dataId) return `[data-id="${dataId}"]`;
      
      // For React components, look for stable class patterns
      if (el.className) {
        const classes = el.className.split(' ').filter(c => c.trim() && !c.match(/^(sc-|css-)[a-z0-9]+$/i));
        // Prefer semantic class names over generated ones
        const semanticClass = classes.find(c => 
          c.includes('modal') || c.includes('dialog') || c.includes('drawer') || 
          c.includes('Modal') || c.includes('Dialog') || c.includes('Drawer')
        );
        if (semanticClass) {
          return `${el.tagName.toLowerCase()}.${semanticClass}`;
        }
        if (classes.length > 0) {
          return `${el.tagName.toLowerCase()}.${classes[0]}`;
        }
      }
      
      // Fallback to tag with role
      const role = el.getAttribute('role');
      if (role) return `${el.tagName.toLowerCase()}[role="${role}"]`;
      
      return el.tagName.toLowerCase();
    };
    
    const selector = getElementSelector(modalEl);
    
    // Check for backdrop (sibling or parent element with overlay/backdrop class)
    let hasBackdrop = false;
    const parent = modalEl.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      hasBackdrop = siblings.some(sibling => {
        const className = sibling.className?.toLowerCase() || '';
        const id = sibling.id?.toLowerCase() || '';
        return (
          className.includes('backdrop') ||
          className.includes('overlay') ||
          className.includes('mask') ||
          id.includes('backdrop') ||
          id.includes('overlay')
        );
      });
    }
    
    // Find close button (framework-agnostic, covers all major frameworks and languages)
    const closeButtonSelectors = [
      // Standard ARIA patterns
      'button[aria-label*="close" i]',
      'button[aria-label*="dismiss" i]',
      'button[aria-label*="cancel" i]',
      'button[title*="close" i]',
      // Generic class patterns
      'button.close',
      'button[class*="close"]',
      '.close-button',
      '[class*="close-button"]',
      '[class*="close-btn"]',
      // Data attributes (all frameworks)
      '[data-dismiss]',
      '[data-close]',
      '[data-testid*="close" i]',
      '[data-testid*="dismiss" i]',
      '[data-testid*="cancel" i]',
      // International patterns (common close text in various languages)
      'button[aria-label*="Cancel" i]',
      'button[aria-label*="キャンセル" i]', // Japanese
      'button[aria-label*="取消" i]', // Chinese
      'button[aria-label*="취소" i]', // Korean
      'button[aria-label*="Annuler" i]', // French
      'button[aria-label*="Abbrechen" i]', // German
      'button[aria-label*="Cancelar" i]', // Spanish/Portuguese
      'button[aria-label*="Закрыть" i]', // Russian
      // Icon patterns (SVG close icons)
      'button:has(svg):has(path[d*="M"])', // SVG with path (often close icons)
      'button:has(svg[class*="close"])',
      'button:has(.close-icon)',
      '[class*="close-icon"]',
      // Framework-specific patterns
      // React component patterns
      'button[class*="Close"]',
      'button[class*="Dismiss"]',
      // Material-UI / MUI
      '[class*="MuiIconButton"][aria-label*="close" i]',
      '[class*="MuiDialogClose"]',
      // Ant Design
      '[class*="ant-modal-close"]',
      '[class*="ant-drawer-close"]',
      // Bootstrap
      '.modal-header .close',
      '.modal-header button[data-dismiss]',
      // Angular Material
      '[class*="mat-dialog-close"]',
      '[class*="mat-icon-button"][aria-label*="close" i]',
      // Chakra UI
      '[class*="chakra-modal__close-btn"]',
      // Semantic UI
      '.ui.modal .close',
      // Generic icon button patterns
      'button[type="button"][aria-label*="close" i]',
      'button[type="button"][aria-label*="dismiss" i]',
      // Jira/Atlassian specific
      'button[aria-label*="Cancel" i]',
      '[data-testid*="cancel" i]',
      // Look for icon buttons with close symbols
      'button:has(svg):has(path[d*="M"])', // SVG with path (often close icons)
      // React component patterns
      'button[class*="Close"]',
      'button[class*="Dismiss"]'
    ];
    
    let closeButton: { selector: string; text: string } | undefined;
    for (const closeSelector of closeButtonSelectors) {
      try {
        const closeBtn = modalEl.querySelector(closeSelector);
        if (closeBtn && isElementVisible(closeBtn)) {
          const btnText = closeBtn.textContent?.trim() || closeBtn.getAttribute('aria-label') || '';
          closeButton = {
            selector: getElementSelector(closeBtn),
            text: btnText
          };
          break;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    // If no close button found, look for X or close text (international patterns)
    if (!closeButton) {
      const allButtons = modalEl.querySelectorAll('button, [role="button"]');
      const closeTextPatterns = [
        '×', '✕', 'x', 'close', 'dismiss', 'cancel',
        'キャンセル', '取消', '취소', // Japanese, Chinese, Korean
        'annuler', 'abbrechen', 'cancelar', 'закрыть' // French, German, Spanish, Russian
      ];
      
      for (const btn of allButtons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
        const title = btn.getAttribute('title')?.toLowerCase() || '';
        const combined = `${text} ${ariaLabel} ${title}`;
        
        if (closeTextPatterns.some(pattern => combined.includes(pattern))) {
          closeButton = {
            selector: getElementSelector(btn),
            text: btn.textContent?.trim() || btn.getAttribute('aria-label') || ''
          };
          break;
        }
      }
    }
    
    // Count interactive elements in modal
    const interactiveInModal = modalEl.querySelectorAll(
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [contenteditable="true"]'
    ).length;
    
    modals.push({
      element: modalEl,
      selector,
      isVisible: isElementVisible(modalEl),
      hasBackdrop,
      closeButton,
      interactiveElements: interactiveInModal,
      zIndex
    });
  });
  
  // Sort by z-index (highest first) and visibility
  modals.sort((a, b) => {
    if (a.isVisible && !b.isVisible) return -1;
    if (!a.isVisible && b.isVisible) return 1;
    return b.zIndex - a.zIndex;
  });
  
  return modals;
}

// Calculate element priority for better action selection
function calculateElementPriority(el: Element, rect: DOMRect, inModal: boolean = false): number {
  let priority = 0;
  
  // Prioritize elements with IDs (more stable selectors)
  if (el.id) priority += 10;
  
  // Prioritize elements with specific roles
  const role = el.getAttribute('role');
  if (role === 'button' || role === 'link') priority += 5;
  
  // HEAVILY prioritize elements in modals (they're usually the focus)
  if (inModal) priority += 20;
  
  // Prioritize larger, more prominent elements
  const area = rect.width * rect.height;
  if (area > 2000) priority += 3;
  if (area > 5000) priority += 2;
  
  // Prioritize elements in viewport center
  const centerY = window.innerHeight / 2;
  const centerX = window.innerWidth / 2;
  const elCenterY = rect.top + rect.height / 2;
  const elCenterX = rect.left + rect.width / 2;
  const distanceFromCenter = Math.sqrt(
    Math.pow(elCenterX - centerX, 2) + Math.pow(elCenterY - centerY, 2)
  );
  if (distanceFromCenter < 200) priority += 5;
  
  // Prioritize elements with text content
  const text = el.textContent?.trim() || '';
  if (text.length > 0 && text.length < 50) priority += 3;
  
  // Prioritize common interactive patterns
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') priority += 5;
  if (tag === 'a' && (el as HTMLAnchorElement).href) priority += 4;
  if (tag === 'input' && ['submit', 'button'].includes((el as HTMLInputElement).type)) priority += 4;
  
  return priority;
}

// Detect authentication state
function detectAuthentication(): {
  isLoginPage: boolean;
  isAuthenticated: boolean;
  loginIndicators: string[];
  requiresLogin: boolean;
} {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = document.body.innerText.toLowerCase();
  
  const loginPageIndicators = [
    'login', 'sign in', 'signin', 'log in', 'sign up', 'signup', 'register',
    'authentication', 'auth', 'credentials', 'password', 'username', 'email'
  ];
  
  const authenticatedIndicators = [
    'logout', 'sign out', 'signout', 'log out', 'profile', 'dashboard',
    'account', 'settings', 'my account', 'welcome back'
  ];
  
  const urlMatches = loginPageIndicators.some(indicator => url.includes(indicator));
  const titleMatches = loginPageIndicators.some(indicator => title.includes(indicator));
  const bodyMatches = loginPageIndicators.some(indicator => bodyText.includes(indicator));
  
  const isLoginPage = urlMatches || titleMatches || bodyMatches;
  
  // Check for login forms
  const hasLoginForm = document.querySelector('input[type="password"], input[name*="password" i], input[id*="password" i]') !== null;
  const hasLoginButton = Array.from(document.querySelectorAll('button, input[type="submit"]')).some(
    el => {
      const text = el.textContent?.toLowerCase() || '';
      return loginPageIndicators.some(indicator => text.includes(indicator));
    }
  );
  
  const isAuthenticated = authenticatedIndicators.some(indicator => 
    url.includes(indicator) || title.includes(indicator) || bodyText.includes(indicator)
  ) || document.querySelector('[data-testid*="logout" i], [aria-label*="logout" i], [aria-label*="sign out" i]') !== null;
  
  const loginIndicators: string[] = [];
  if (hasLoginForm) loginIndicators.push('login_form');
  if (hasLoginButton) loginIndicators.push('login_button');
  if (urlMatches) loginIndicators.push('url');
  if (titleMatches) loginIndicators.push('title');
  if (bodyMatches) loginIndicators.push('body_text');
  
  const requiresLogin = (isLoginPage || hasLoginForm) && !isAuthenticated;
  
  return {
    isLoginPage: isLoginPage || hasLoginForm,
    isAuthenticated,
    loginIndicators,
    requiresLogin
  };
}

// Extract comprehensive page context with optimizations
function extractPageContext(): PageContext {
  const currentUrl = window.location.href;
  const now = Date.now();
  
  // Use cache if available and still valid
  const cache = getDomCache();
  if (cache.interactiveElements && cache.url === currentUrl && 
      cache.timestamp && (now - cache.timestamp) < getCacheDuration()) {
    console.log('📦 Using cached DOM data');
  } else {
    Object.assign(cache, { url: currentUrl, timestamp: now });
  }
  
  // Use more efficient selectors - prioritize common patterns
  const linkSelector = 'a[href]:not([href^="#"]):not([href^="javascript:"])';
  const links = Array.from(document.querySelectorAll(linkSelector))
    .slice(0, 50)
    .map(a => ({
      text: a.textContent?.trim() || '',
      href: a.href
    }));

  const images = Array.from(document.querySelectorAll('img[src]:not([src=""]), img[data-src]'))
    .slice(0, 20)
    .map(img => ({
      alt: img.alt,
      src: img.src || img.getAttribute('data-src') || ''
    }));

  const forms = Array.from(document.querySelectorAll('form')).map(form => ({
    id: form.id,
    action: form.action,
    inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
      name: (input as HTMLInputElement).name,
      type: (input as HTMLInputElement).type || 'text'
    }))
  }));

  // Improved element selector generation (enhanced for React/Jira)
  const getElementSelector = (el: Element): string => {
    // Prefer data-testid (very common in React/Jira, most stable)
    const dataTestId = el.getAttribute('data-testid');
    if (dataTestId) return `[data-testid="${dataTestId}"]`;
    
    // Prefer ID (most stable)
    if (el.id) return `#${el.id}`;
    
    // Prefer name attribute for form elements
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    
    // Use data attributes if available
    const dataId = el.getAttribute('data-id');
    if (dataId) return `[data-id="${dataId}"]`;
    
    // For all frameworks, prefer semantic class names over generated ones
    if (el.className) {
      const classes = el.className.split(' ').filter(c => {
        const trimmed = c.trim();
        // Filter out generated class names from various frameworks
        // React: sc-xxx, css-xxx, emotion-xxx
        // Vue: v-xxx, vue-xxx
        // Angular: ng-xxx, _ng-xxx
        // Styled-components, emotion, etc.
        return trimmed && !trimmed.match(/^(sc-|css-|chakra-|mui-|v-|vue-|ng-|_ng-|emotion-|styled-)[a-z0-9-]+$/i);
      });
      
      if (classes.length > 0) {
        // Prefer semantic class names (containing meaningful words)
        const semanticClass = classes.find(c => {
          const trimmed = c.trim();
          return trimmed.length > 3 && 
                 !trimmed.match(/^[a-z0-9]{1,3}$/i) && 
                 (trimmed.includes('-') || trimmed.match(/[A-Z]/)) && // Has structure
                 !trimmed.match(/^[a-f0-9]{6,}$/i); // Not a hex color
        });
        if (semanticClass) {
          // Check if this class is relatively unique (appears < 10 times)
          const sameClass = document.querySelectorAll(`.${semanticClass}`);
          if (sameClass.length < 10) {
            return `${el.tagName.toLowerCase()}.${semanticClass}`;
          }
        }
        
        // Fallback to first class if unique enough
        const firstClass = classes[0];
        const sameClass = document.querySelectorAll(`.${firstClass}`);
        if (sameClass.length < 5) {
          return `${el.tagName.toLowerCase()}.${firstClass}`;
        }
      }
    }
    
    // Use aria-label as selector if available
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      return `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
    }
    
    // Fallback to tag name with nth-child if needed
    return el.tagName.toLowerCase();
  };

  // Detect modals first (needed for priority calculation)
  const modals = detectModals();
  
  // Log modal detection for debugging (especially useful for Jira)
  if (modals.length > 0) {
    console.log(`🎯 Detected ${modals.length} modal(s):`, modals.map(m => ({
      selector: m.selector,
      zIndex: m.zIndex,
      interactiveElements: m.interactiveElements,
      hasCloseButton: !!m.closeButton
    })));
  }
  
  // Optimized interactive element extraction with priority scoring
  const interactiveSelectors = [
    'button:not([disabled])',
    'input[type="button"]:not([disabled])',
    'input[type="submit"]:not([disabled])',
    'a[href]:not([href^="#"]):not([href^="javascript:"])',
    '[role="button"]:not([disabled])',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    'select:not([disabled])',
    '[contenteditable="true"]',
    '[onclick]',
    'label[for]'
  ];
  
  // Use a single query with multiple selectors for better performance
  const allInteractive = Array.from(document.querySelectorAll(interactiveSelectors.join(', ')));
  
  // Process and prioritize elements
  const interactiveElements = allInteractive
    .map(el => {
      const rect = el.getBoundingClientRect();
      const visible = isElementVisible(el);
      
      if (!visible) return null;
      
      // Check if element is in a modal
      const modalParent = isElementInModal(el);
      const inModal = modalParent !== null;
      
      const priority = calculateElementPriority(el, rect, inModal);
      
      return {
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.trim().slice(0, 50) || '',
        value: (el as HTMLInputElement).value || undefined,
        selector: getElementSelector(el),
        type: (el as HTMLInputElement).type || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        visible: true,
        priority,
        inModal,
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })
    .filter((el): el is NonNullable<typeof el> => el !== null)
    .sort((a, b) => {
      // First sort by modal status (elements in modals first)
      if (a.inModal && !b.inModal) return -1;
      if (!a.inModal && b.inModal) return 1;
      // Then by priority
      return (b.priority || 0) - (a.priority || 0);
    })
    .slice(0, 50); // Increased limit but sorted by priority
  
  // Cache the results (reuse existing cache variable from top of function)
  cache.interactiveElements = interactiveElements;

  const getMetaContent = (name: string): string | undefined => {
    const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return meta?.getAttribute('content') || undefined;
  };

  // Extract structural information for better page type detection
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10).map(h => ({
    level: h.tagName.toLowerCase(),
    text: h.textContent?.trim() || ''
  }));

  // Detect main content area (article, main, or largest content container)
  const mainContent = document.querySelector('article, main, [role="main"]') || 
                     Array.from(document.querySelectorAll('div')).reduce((largest, div) => {
                       const text = div.textContent || '';
                       return text.length > (largest?.textContent?.length || 0) ? div : largest;
                     }, null as Element | null);

  const mainContentText = mainContent?.textContent?.slice(0, 5000) || '';
  const mainContentLength = mainContentText.length;
  const totalTextLength = document.body.innerText.length;

  // Analyze content structure
  const hasArticleStructure = !!document.querySelector('article, [role="article"]');
  const hasMainStructure = !!document.querySelector('main, [role="main"]');
  const hasNavigation = !!document.querySelector('nav, [role="navigation"]');
  
  // Count semantic elements
  const sectionCount = document.querySelectorAll('section, article').length;
  const paragraphCount = document.querySelectorAll('p').length;

  // Detect authentication state
  const authentication = detectAuthentication();

  // Prepare modal data (without circular references)
  const modalData = modals.map(modal => ({
    selector: modal.selector,
    isVisible: modal.isVisible,
    hasBackdrop: modal.hasBackdrop,
    closeButton: modal.closeButton,
    interactiveElements: modal.interactiveElements,
    zIndex: modal.zIndex
  }));
  
  // Add flag to page context indicating modals are present (prevents screenshot fallback)
  const hasActiveModals = modals.some(m => m.isVisible && m.interactiveElements > 0);

  // Find all search-related inputs for debugging (from PR #7)
  const searchInputs = Array.from(
    document.querySelectorAll('input[type="search"], input[type="text"]')
  )
    .map(el => {
      const input = el as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      return {
        selector: getElementSelector(input),
        type: input.type,
        id: input.id,
        name: input.name,
        placeholder: input.placeholder,
        'aria-label': input.getAttribute('aria-label'),
        'data-automation-id': input.getAttribute('data-automation-id'),
        role: input.getAttribute('role'),
        className: input.className,
        visible: rect.width > 0 && rect.height > 0 && rect.top >= 0,
        dimensions: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
      };
    })
    .filter(input => input.visible)
    .slice(0, 10); // Limit to first 10 visible inputs

  return {
    url: window.location.href,
    title: document.title,
    textContent: document.body.innerText.slice(0, 10000), // Limit to 10k chars
    links,
    images,
    forms,
    interactiveElements,
    searchInputs, // NEW: List of all visible search/text inputs for debugging (from PR #7)
    metadata: {
      description: getMetaContent('description') || getMetaContent('og:description'),
      keywords: getMetaContent('keywords'),
      author: getMetaContent('author'),
      ogType: getMetaContent('og:type')
    },
    structure: {
      headings,
      hasArticleStructure,
      hasMainStructure,
      hasNavigation,
      sectionCount,
      paragraphCount,
      mainContentLength,
      mainContentRatio: mainContentLength / Math.max(totalTextLength, 1) // Ratio of main content to total
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio
    },
    authentication,
    modals: modalData,
    hasActiveModals // Flag to prevent screenshot fallback when modals are present
  };
}

// Helper function to dispatch complete, realistic click event sequence
function dispatchClickSequence(element: HTMLElement, x: number, y: number): void {
  console.log('🖱️  Dispatching complete click sequence...');
  console.log('🎯 Target element:', {
    tag: element.tagName,
    id: element.id,
    className: element.className,
    type: (element as any).type,
    disabled: (element as any).disabled,
    readOnly: (element as any).readOnly,
    'pointer-events': window.getComputedStyle(element).pointerEvents,
    visibility: window.getComputedStyle(element).visibility,
    display: window.getComputedStyle(element).display,
    zIndex: window.getComputedStyle(element).zIndex
  });

  // Check if element is actually clickable at this position
  const topElement = document.elementFromPoint(x, y);
  if (topElement !== element) {
    console.warn('⚠️  Element at coordinates is different from target!');
    console.warn('   Target:', element.tagName, element.className);
    console.warn('   Actual top element:', topElement?.tagName, (topElement as HTMLElement)?.className);
    console.warn('   There might be an overlay or the element is not the topmost at these coordinates');
  }

  // Check for click event listeners
  const hasClickListeners = (element as any).onclick ||
                           element.getAttribute('onclick') ||
                           element.hasAttribute('ng-click') ||
                           element.hasAttribute('@click') ||
                           element.hasAttribute('v-on:click');
  console.log('🎧 Has click listeners/handlers:', hasClickListeners ? 'Yes' : 'Unknown (may use addEventListener)');

  // Try NATIVE click first (generates trusted events)
  console.log('1️⃣ Attempting native element.click()...');
  try {
    element.click();
    console.log('✅ Native click executed');
  } catch (error) {
    console.error('❌ Native click failed:', error);
  }

  // If it's a clickable parent, try clicking the actual interactive child
  const interactiveChild = element.querySelector('button, a, input, [role="button"], [onclick]') as HTMLElement;
  if (interactiveChild && interactiveChild !== element) {
    console.log('2️⃣ Found interactive child, clicking it...');
    console.log('   Child:', interactiveChild.tagName, interactiveChild.className);
    try {
      interactiveChild.click();
      console.log('✅ Child click executed');
    } catch (error) {
      console.error('❌ Child click failed:', error);
    }
  }

  // Dispatch synthetic events as additional attempt
  console.log('3️⃣ Dispatching synthetic events...');
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: 1,
    detail: 1,
    composed: true
  };

  const pointerOptions = {
    ...eventOptions,
    pointerId: 1,
    width: 1,
    height: 1,
    pressure: 0.5,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 'mouse',
    isPrimary: true
  };

  try {
    // Complete event sequence on the element
    element.dispatchEvent(new PointerEvent('pointerdown', pointerOptions));
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));

    // Small delay to simulate real mouse timing
    setTimeout(() => {
      element.dispatchEvent(new PointerEvent('pointerup', { ...pointerOptions, buttons: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, buttons: 0 }));
      element.dispatchEvent(new PointerEvent('click', { ...pointerOptions, buttons: 0 }));
      element.dispatchEvent(new MouseEvent('click', { ...eventOptions, buttons: 0 }));
      console.log('✅ Synthetic events dispatched with delay');
    }, 50);

    // Also try dispatching on the top element if different
    if (topElement && topElement !== element) {
      console.log('4️⃣ Also trying to click top element at coordinates...');
      (topElement as HTMLElement).click();
    }

    console.log('✅ All click attempts completed');
  } catch (error) {
    console.error('❌ Error dispatching events:', error);
  }
}

// Execute actions on the page
function executePageAction(
  action: string,
  target?: string,
  value?: string,
  selector?: string,
  coordinates?: { x: number; y: number },
  direction?: string,
  amount?: number,
  key?: string,
  keys?: string[],
  destination?: { x: number; y: number }
): any {
  try {
    switch (action) {
      case 'click':
        // Support selector, text-based, and coordinate-based clicking
        let element: Element | null = null;

        // 1. Try CSS selector first (most reliable)
        if (selector) {
          element = document.querySelector(selector);
          if (element) {
            console.log(`✅ Found element by selector: ${selector}`);
          }
        }

        // 2. Try finding by text content if selector failed or target is provided
        if (!element && target) {
          console.log(`🔍 Searching for element by text: "${target}"`);

          // Search through common clickable elements
          const clickableSelectors = [
            'button',
            'a',
            'input[type="button"]',
            'input[type="submit"]',
            '[role="button"]',
            '[onclick]'
          ];

          for (const sel of clickableSelectors) {
            const elements = Array.from(document.querySelectorAll(sel));
            element = elements.find(el => {
              const text = el.textContent?.trim().toLowerCase() || '';
              const value = (el as HTMLInputElement).value?.toLowerCase() || '';
              const targetLower = target.toLowerCase();
              return text.includes(targetLower) || value.includes(targetLower);
            }) as Element | undefined || null;

            if (element) {
              console.log(`✅ Found element by text in ${sel}: "${target}"`);
              break;
            }
          }

          // If still not found, try aria-label
          if (!element) {
            const elementsWithLabel = Array.from(document.querySelectorAll('[aria-label]'));
            element = elementsWithLabel.find(el => {
              const label = el.getAttribute('aria-label')?.toLowerCase() || '';
              return label.includes(target.toLowerCase());
            }) as Element | undefined || null;

            if (element) {
              console.log(`✅ Found element by aria-label: "${target}"`);
            }
          }
        }

        // 3. If we found an element (by selector or text), click it
        if (element) {
          const rect = element.getBoundingClientRect();
          const clickX = rect.left + rect.width / 2;
          const clickY = rect.top + rect.height / 2;

          // Use complete click sequence for better compatibility
          dispatchClickSequence(element, clickX, clickY);

          // Visual feedback
          highlightElement(element, coordinates || { x: clickX, y: clickY });

          return { success: true, message: `Clicked element: ${selector || target}`, element: element.tagName };
        }

        // 4. If element was searched but not found, return error
        if (!element && (selector || target)) {
          return {
            success: false,
            message: `Element not found: ${selector || `text="${target}"`}. Try using coordinates as fallback.`
          };
        }

        // 5. If no element found but we have coordinates, use coordinate-based clicking
        if (!element && !selector && !target && coordinates) {
          console.log(`🎯 Click coordinates received: x=${coordinates.x}, y=${coordinates.y}`);
          console.log(`📏 Viewport size: ${window.innerWidth}x${window.innerHeight}`);
          console.log(`📏 Device pixel ratio: ${window.devicePixelRatio}`);
          console.log(`📜 Document scroll: x=${window.scrollX}, y=${window.scrollY}`);
          console.log(`🖥️  Window size: ${window.outerWidth}x${window.outerHeight}`);
          console.log(`📱 Screen size: ${screen.width}x${screen.height}`);

          // Add visual debug marker at click coordinates with crosshairs
          const debugMarker = document.createElement('div');
          debugMarker.style.cssText = `
            position: fixed;
            left: ${coordinates.x}px;
            top: ${coordinates.y}px;
            width: 30px;
            height: 30px;
            background: rgba(255, 0, 0, 0.3);
            border: 3px solid red;
            border-radius: 50%;
            z-index: 999999;
            pointer-events: none;
            transform: translate(-50%, -50%);
          `;
          document.body.appendChild(debugMarker);

          // Add crosshair lines
          const crosshairV = document.createElement('div');
          crosshairV.style.cssText = `
            position: fixed;
            left: ${coordinates.x}px;
            top: 0;
            width: 2px;
            height: 100vh;
            background: rgba(255, 0, 0, 0.5);
            z-index: 999998;
            pointer-events: none;
          `;
          document.body.appendChild(crosshairV);

          const crosshairH = document.createElement('div');
          crosshairH.style.cssText = `
            position: fixed;
            left: 0;
            top: ${coordinates.y}px;
            width: 100vw;
            height: 2px;
            background: rgba(255, 0, 0, 0.5);
            z-index: 999998;
            pointer-events: none;
          `;
          document.body.appendChild(crosshairH);

          // Add coordinate label
          const label = document.createElement('div');
          label.style.cssText = `
            position: fixed;
            left: ${coordinates.x + 20}px;
            top: ${coordinates.y - 30}px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: monospace;
            z-index: 999999;
            pointer-events: none;
          `;
          label.textContent = `(${coordinates.x}, ${coordinates.y})`;
          document.body.appendChild(label);

          setTimeout(() => {
            debugMarker.remove();
            crosshairV.remove();
            crosshairH.remove();
            label.remove();
          }, 5000);

          let element = document.elementFromPoint(coordinates.x, coordinates.y) as HTMLElement;
          console.log(`🎯 Element at coordinates:`, element?.tagName, element?.className);

          if (element) {
            const rect = element.getBoundingClientRect();
            console.log(`📦 Element bounds:`, {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height
            });
            console.log(`📍 Click offset from element center:`, {
              dx: coordinates.x - (rect.left + rect.width / 2),
              dy: coordinates.y - (rect.top + rect.height / 2)
            });
          }

          // If element is an input or near an input, try to find the actual input field
          // This improves accuracy for search boxes and text inputs
          if (element) {
            const tagName = element.tagName;

            // If we clicked near but not on an input, try to find the nearest input
            if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && element.getAttribute('contenteditable') !== 'true') {
              // Check if clicked element contains an input
              const inputInside = element.querySelector('input, textarea, [contenteditable="true"]') as HTMLElement;
              if (inputInside) {
                console.log(`💡 Found input field inside clicked element: ${inputInside.tagName}`);
                element = inputInside;
              } else {
                // Try to find nearby visible input (within 100px)
                const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], textarea')) as HTMLElement[];
                const nearbyInput = allInputs.find(input => {
                  const rect = input.getBoundingClientRect();
                  const dx = Math.abs((rect.left + rect.width / 2) - coordinates.x);
                  const dy = Math.abs((rect.top + rect.height / 2) - coordinates.y);
                  const distance = Math.sqrt(dx * dx + dy * dy);
                  return distance < 100 && rect.width > 0 && rect.height > 0; // Within 100px
                });

                if (nearbyInput) {
                  console.log(`💡 Found nearby input field within 100px: ${nearbyInput.tagName}`);
                  element = nearbyInput;
                  // Update coordinates to center of input
                  const rect = nearbyInput.getBoundingClientRect();
                  coordinates = {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                  };
                } else {
                  // If still no input found, try to find the largest visible input/textarea on the page
                  console.log('🔍 Searching for largest visible input field on page...');
                  const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')) as HTMLElement[];
                  const visibleInputs = allInputs.filter(input => {
                    const rect = input.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 &&
                           rect.top >= 0 && rect.left >= 0 &&
                           rect.bottom <= window.innerHeight &&
                           rect.right <= window.innerWidth;
                  });

                  if (visibleInputs.length > 0) {
                    // Find the largest input (by area)
                    const largestInput = visibleInputs.reduce((largest, current) => {
                      const largestRect = largest.getBoundingClientRect();
                      const currentRect = current.getBoundingClientRect();
                      const largestArea = largestRect.width * largestRect.height;
                      const currentArea = currentRect.width * currentRect.height;
                      return currentArea > largestArea ? current : largest;
                    });

                    console.log(`💡 Found largest visible input on page: ${largestInput.tagName}`);
                    element = largestInput;
                    const rect = largestInput.getBoundingClientRect();
                    coordinates = {
                      x: rect.left + rect.width / 2,
                      y: rect.top + rect.height / 2
                    };
                  }
                }
              }
            }
          }

          if (element) {
            // Get element position for logging
            const rect = element.getBoundingClientRect();

            // Use complete click sequence for better compatibility
            dispatchClickSequence(element, coordinates.x, coordinates.y);

            // Visual feedback
            highlightElement(element, coordinates);


            return {
              success: true,
              message: `Clicked at (${coordinates.x}, ${coordinates.y})`,
              element: element.tagName,
              text: element.textContent?.slice(0, 50),
              elementBounds: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
              }
            };
          }
          console.error('❌ No element found at coordinates');
          return { success: false, message: `No element found at coordinates (${coordinates.x}, ${coordinates.y})` };
        }
        return { success: false, message: 'Target selector or coordinates required for click action' };

      case 'fill':
        if (value) {
          const textToType = value; // Capture value to preserve type narrowing
          let element: HTMLElement | null = null;

          console.log('🔍 fill action - target selector:', target);

          // Try to find element by selector if provided
          if (target && !target.includes(':focus')) {
            element = document.querySelector(target) as HTMLElement;
            if (element) {
              console.log('✅ Found element by selector:', target);
            } else {
              console.log('❌ No element found with selector:', target);
            }
          }

          // If no element found or selector was for focused elements, use the currently focused element
          if (!element) {
            element = document.activeElement as HTMLElement;
            console.log('🎯 Using currently focused element:', element?.tagName);
          }

          // If element is BODY (nothing focused), try to find a visible search/text input
          if (element && element.tagName === 'BODY') {
            console.log('💡 Nothing focused, searching for visible input field...');

            // Try to find common search input selectors (prioritize main search over autocomplete)
            const searchSelectors = [
              'input[type="search"][data-automation-id*="searchBox"]', // Workday main search
              'input[type="search"]:not([role="combobox"])', // Search inputs that aren't autocomplete
              'input[type="search"]',
              'input[name*="search" i]:not([role="combobox"])',
              'input[id*="search" i]:not([role="combobox"])',
              'input[placeholder*="search" i]:not([role="combobox"])',
              'input[aria-label*="search" i]:not([role="combobox"])',
              'input[type="text"][name="q"]', // Common search param
              'input[type="text"]:not([type="hidden"]):not([role="combobox"])', // Any visible text input that's not autocomplete
            ];

            for (const selector of searchSelectors) {
              const inputs = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
              // Find first visible input
              const visibleInput = inputs.find(input => {
                const rect = input.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.top >= 0;
              });

              if (visibleInput) {
                console.log(`✅ Found visible input with selector: ${selector}`);
                element = visibleInput;
                break;
              }
            }
          }

          // Log details about the element we found
          if (element && element.tagName === 'INPUT') {
            const inputEl = element as HTMLInputElement;
            console.log('📋 Selected input details:', {
              tagName: inputEl.tagName,
              type: inputEl.type,
              id: inputEl.id,
              name: inputEl.name,
              className: inputEl.className,
              placeholder: inputEl.placeholder,
              'aria-label': inputEl.getAttribute('aria-label'),
              'data-automation-id': inputEl.getAttribute('data-automation-id'),
              role: inputEl.getAttribute('role'),
              value: inputEl.value
            });
          }

          if (element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' ||
                         element.getAttribute('contenteditable') === 'true')) {

            // Click the element first to ensure it receives focus
            const rect = element.getBoundingClientRect();
            const clickX = rect.left + rect.width / 2;
            const clickY = rect.top + rect.height / 2;

            ['mousedown', 'mouseup', 'click'].forEach(eventType => {
              const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: clickX,
                clientY: clickY
              });
              element!.dispatchEvent(event);
            });

            // Explicitly focus the element
            element.focus();

            // Return a promise that resolves after a delay to ensure focus is established
            return new Promise<any>((resolve) => {
              setTimeout(() => {
                // Verify element still has focus
                const stillFocused = document.activeElement === element;

                if (!stillFocused) {
                  element!.focus();
                  // Add another small delay after re-focus
                  setTimeout(() => {
                    proceedWithTyping();
                  }, 100);
                } else {
                  proceedWithTyping();
                }

                function proceedWithTyping() {
                  // Clear existing value first
                  if (element!.tagName === 'INPUT' || element!.tagName === 'TEXTAREA') {
                    const inputElement = element as HTMLInputElement;

                    // Clear the value using multiple methods for compatibility
                    inputElement.value = '';

                    // Set the new value using native setter (works with React)
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype,
                      'value'
                    )?.set;

                    if (nativeInputValueSetter) {
                      nativeInputValueSetter.call(inputElement, textToType);
                    } else {
                      inputElement.value = textToType;
                    }

                    // Trigger all necessary events for React/Vue/Angular apps
                    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                    inputElement.dispatchEvent(new Event('change', { bubbles: true }));

                    // Check if this is a search input - if so, press Enter immediately
                    const isSearchInput = target?.includes('search') ||
                                         inputElement.type === 'search' ||
                                         inputElement.name?.toLowerCase().includes('search') ||
                                         inputElement.id?.toLowerCase().includes('search') ||
                                         inputElement.placeholder?.toLowerCase().includes('search') ||
                                         inputElement.getAttribute('aria-label')?.toLowerCase().includes('search');

                    // Exclude autocomplete/combobox inputs (those are dropdowns, not search boxes)
                    const isCombobox = inputElement.getAttribute('role') === 'combobox';

                    if (isSearchInput && !isCombobox) {
                      console.log('   🔍 Search input detected - pressing Enter immediately');
                      console.log('   📋 Pressing Enter on:', {
                        id: inputElement.id,
                        name: inputElement.name,
                        type: inputElement.type,
                        'data-automation-id': inputElement.getAttribute('data-automation-id'),
                        placeholder: inputElement.placeholder
                      });

                      // Dispatch Enter key events with all required properties
                      const enterKeyInit: KeyboardEventInit = {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true,
                        composed: true
                      };

                      inputElement.dispatchEvent(new KeyboardEvent('keydown', enterKeyInit));
                      inputElement.dispatchEvent(new KeyboardEvent('keypress', enterKeyInit));
                      inputElement.dispatchEvent(new KeyboardEvent('keyup', enterKeyInit));

                      // Try to submit the form
                      const form = inputElement.closest('form');
                      if (form) {
                        // Try clicking submit button first (more realistic)
                        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
                        if (submitBtn) {
                          console.log('   ✓ Clicking submit button');
                          submitBtn.click();
                        } else {
                          console.log('   ✓ Submitting form');
                          form.submit();
                        }
                      } else {
                        // No form - try to find nearby search/submit button
                        const nearbyButton = document.querySelector('button[type="submit"], button[aria-label*="search" i], button[aria-label*="submit" i]') as HTMLElement;
                        if (nearbyButton) {
                          console.log('   ✓ Clicking nearby search button');
                          nearbyButton.click();
                        }
                      }
                    }


                  } else if (element!.getAttribute('contenteditable') === 'true') {
                    // For contenteditable elements, clear and set text
                    element!.textContent = textToType;
                    element!.dispatchEvent(new Event('input', { bubbles: true }));
                    element!.dispatchEvent(new Event('change', { bubbles: true }));
                  }

                  resolve({
                    success: true,
                    message: `Typed "${textToType}" into ${element!.tagName}`,
                    element: element!.tagName
                  });
                }
              }, 300); // 300ms delay after focus to ensure it's established
            });
          }

          console.error('❌ Element not typeable:', element?.tagName, element);
          return {
            success: false,
            message: element ? `Element ${element.tagName} is not typeable` : `No focused element found. Try clicking on the input field first.`
          };
        }
        return { success: false, message: 'Value required for fill action' };

      case 'scroll':
        console.log('🔄 Scroll action:', { direction, amount, target, selector });
        console.log('   Window scroll position:', window.scrollY);
        console.log('   Page height:', document.body.scrollHeight);
        console.log('   Viewport height:', window.innerHeight);

        // Find the main scrollable element
        // Many SPAs (like Slack) use a custom scrollable container instead of window scroll
        const findScrollableElement = (): Element => {
          // First check if window is scrollable
          if (document.body.scrollHeight > window.innerHeight && window.scrollY >= 0) {
            console.log('   Using window scroll');
            return document.documentElement;
          }

          // Find elements with overflow scroll/auto that are actually scrollable
          // Also include overflow:hidden elements that have scrollHeight > clientHeight
          // (Slack uses hidden scrollbars that appear on hover)
          const scrollableElements = Array.from(
            document.querySelectorAll('*')
          ).filter((el: Element) => {
            const style = window.getComputedStyle(el);
            const hasScrollableContent = el.scrollHeight > el.clientHeight;

            // Check for explicit scrollable styles
            const hasScrollStyle =
              style.overflow === 'auto' || style.overflow === 'scroll' ||
              style.overflowY === 'auto' || style.overflowY === 'scroll';

            // Also check for hidden overflow with scrollable content (Slack pattern)
            const hasHiddenScrollable =
              (style.overflow === 'hidden' || style.overflowY === 'hidden') &&
              hasScrollableContent &&
              el.clientHeight > 100; // Must be reasonably sized

            return hasScrollableContent && (hasScrollStyle || hasHiddenScrollable);
          });

          console.log(`   Found ${scrollableElements.length} scrollable elements (including hidden scrollbars)`);

          // Find the largest scrollable element (likely the main content area)
          if (scrollableElements.length > 0) {
            // Prioritize elements with actual scroll position or large scroll height
            const sorted = scrollableElements.sort((a, b) => {
              // Prefer elements that are currently scrolled (user has interacted with them)
              if (a.scrollTop > 0 && b.scrollTop === 0) return -1;
              if (b.scrollTop > 0 && a.scrollTop === 0) return 1;

              // Then sort by area
              const aArea = a.clientHeight * a.clientWidth;
              const bArea = b.clientHeight * b.clientWidth;
              return bArea - aArea;
            });

            const largest = sorted[0];
            console.log('   Selected scrollable container:', {
              tag: largest.tagName,
              class: largest.className,
              id: (largest as HTMLElement).id,
              scrollTop: largest.scrollTop,
              scrollHeight: largest.scrollHeight,
              clientHeight: largest.clientHeight,
              overflow: window.getComputedStyle(largest).overflowY,
              canScrollMore: largest.scrollTop > 0 || (largest.scrollHeight - largest.clientHeight - largest.scrollTop) > 0
            });
            return largest;
          }

          console.log('   Fallback to document.documentElement');
          return document.documentElement;
        };

        const scrollableElement = findScrollableElement();
        const isWindow = scrollableElement === document.documentElement;

        if (direction === 'top' || target === 'top') {
          if (isWindow) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            scrollableElement.scrollTo({ top: 0, behavior: 'smooth' });
          }
          console.log('   ✓ Scrolled to top');
          return { success: true, message: 'Scrolled to top' };
        } else if (direction === 'bottom' || target === 'bottom') {
          const maxScroll = scrollableElement.scrollHeight - scrollableElement.clientHeight;
          if (isWindow) {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          } else {
            scrollableElement.scrollTo({ top: maxScroll, behavior: 'smooth' });
          }
          console.log('   ✓ Scrolled to bottom');
          return { success: true, message: 'Scrolled to bottom' };
        } else if (direction === 'up') {
          const scrollAmount = amount || 500;
          const beforeScroll = scrollableElement.scrollTop;
          scrollableElement.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
          setTimeout(() => {
            console.log(`   ✓ Scrolled up by ${scrollAmount}px (from ${beforeScroll} to ${scrollableElement.scrollTop})`);
          }, 100);
          return { success: true, message: `Scrolled up by ${scrollAmount}px` };
        } else if (direction === 'down') {
          const scrollAmount = amount || 500;
          const beforeScroll = scrollableElement.scrollTop;
          scrollableElement.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          setTimeout(() => {
            console.log(`   ✓ Scrolled down by ${scrollAmount}px (from ${beforeScroll} to ${scrollableElement.scrollTop})`);
          }, 100);
          return { success: true, message: `Scrolled down by ${scrollAmount}px` };
        } else if (selector || target) {
          const element = document.querySelector(selector || target!);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            console.log('   ✓ Scrolled to element:', selector || target);
            return { success: true, message: `Scrolled to: ${selector || target}` };
          }
          console.error('   ✗ Element not found:', selector || target);
          return { success: false, message: `Element not found: ${selector || target}` };
        }
        console.log('   ✓ Default scroll');
        return { success: true, message: 'Scrolled' };

      case 'keyboard_type':
        // Simulate actual keyboard typing character by character into the focused element
        // This mimics the Python playwright keyboard.type() behavior
        if (value) {
          const textToType = value;
          const focusedEl = document.activeElement;

          if (!focusedEl) {
            return { success: false, message: 'No element has focus. Click on an input field first.' };
          }


          // Check if it's a typeable element
          const isInput = focusedEl.tagName === 'INPUT';
          const isTextarea = focusedEl.tagName === 'TEXTAREA';
          const isContentEditable = focusedEl.getAttribute('contenteditable') === 'true';

          if (!isInput && !isTextarea && !isContentEditable) {
            return { success: false, message: `Element ${focusedEl.tagName} is not typeable. Click on an input field first.` };
          }

          // Type each character one by one
          for (let i = 0; i < textToType.length; i++) {
            const char = textToType[i];

            // Dispatch keyboard events for this character
            const keyEventInit: KeyboardEventInit = {
              key: char,
              code: char === ' ' ? 'Space' : `Key${char.toUpperCase()}`,
              bubbles: true,
              cancelable: true
            };

            focusedEl.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
            focusedEl.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));

            // Update the value directly (simpler approach that works for all input types)
            if (isInput || isTextarea) {
              const inputEl = focusedEl as HTMLInputElement | HTMLTextAreaElement;

              // Simply set the value directly (works for Google search and most inputs)
              inputEl.value = inputEl.value + char;

              // Dispatch input event for each character (for React/Vue/Angular)
              inputEl.dispatchEvent(new Event('input', { bubbles: true }));
              inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (isContentEditable) {
              // For contenteditable, append the character
              focusedEl.textContent = (focusedEl.textContent || '') + char;
              focusedEl.dispatchEvent(new Event('input', { bubbles: true }));
            }

            focusedEl.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
          }

          return {
            success: true,
            message: `Typed "${textToType}" into ${focusedEl.tagName}`,
            element: focusedEl.tagName
          };
        }
        return { success: false, message: 'Value required for keyboard_type action' };

      case 'press_key':
      case 'pressKey':
        // Press a specific key on the currently focused element or specified selector
        const keyToPress = (key || value || target || 'Enter') as string;

        // If a selector is provided, find and focus that element first
        let focusedElement = document.activeElement;
        if (selector || target) {
          const targetElement = document.querySelector(selector || target!) as HTMLElement;
          if (targetElement) {
            targetElement.focus();
            focusedElement = targetElement;
            console.log('   ✓ Re-focused element:', selector || target);
          }
        }

        if (focusedElement) {
          // Special handling for Enter key - actually submit the form
          if (keyToPress === 'Enter') {
            // First try dispatching keyboard events with all required properties for Chrome
            const keyEventInit: KeyboardEventInit = {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
              composed: true
            };

            const keydownEvent = new KeyboardEvent('keydown', keyEventInit);
            const keypressEvent = new KeyboardEvent('keypress', keyEventInit);
            const keyupEvent = new KeyboardEvent('keyup', keyEventInit);

            focusedElement.dispatchEvent(keydownEvent);
            focusedElement.dispatchEvent(keypressEvent);
            focusedElement.dispatchEvent(keyupEvent);

            // If it's an input field, try to submit the parent form
            if (focusedElement instanceof HTMLInputElement || focusedElement instanceof HTMLTextAreaElement) {
              const form = focusedElement.closest('form');
              if (form) {
                // Try clicking submit button first (more realistic)
                const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]') as HTMLElement;
                if (submitBtn) {
                  console.log('   ✓ Clicking submit button');
                  submitBtn.click();
                  return { success: true, message: 'Pressed Enter (clicked submit button)' };
                }

                // Otherwise submit the form directly
                console.log('   ✓ Submitting form');
                form.submit();
                return { success: true, message: 'Pressed Enter (submitted form)' };
              }

              // If no form, try to find and click a nearby search/submit button
              const nearbyButton = document.querySelector('button[type="submit"], button[aria-label*="search" i], button[aria-label*="submit" i]') as HTMLElement;
              if (nearbyButton) {
                console.log('   ✓ Clicking nearby submit button');
                nearbyButton.click();
                return { success: true, message: 'Pressed Enter (clicked search button)' };
              }
            }

            return { success: true, message: 'Pressed Enter key' };
          }

          // For other keys, dispatch normal keyboard events
          const keyEventInit: KeyboardEventInit = {
            key: keyToPress,
            code: keyToPress === 'Tab' ? 'Tab' : keyToPress === 'Escape' ? 'Escape' : `Key${keyToPress}`,
            bubbles: true,
            cancelable: true
          };

          focusedElement.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
          focusedElement.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));
          focusedElement.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

          return { success: true, message: `Pressed ${keyToPress} key` };
        }
        return { success: false, message: 'No focused element to send key to' };
      
      case 'clear_input':
        // Clear the currently focused input field
        const activeEl = document.activeElement as HTMLInputElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
          // Select all and delete
          if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
            activeEl.select();
            document.execCommand('delete');
            activeEl.value = '';
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            activeEl.textContent = '';
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { success: true, message: 'Cleared input field' };
        }
        return { success: false, message: 'No input field focused to clear' };
      
      case 'key_combination':
        // Press a combination of keys like ["Control", "A"] or ["Enter"]
        const keysList = keys || ['Enter'];
        const targetEl = document.activeElement || document.body;
        
        // Hold down all keys except the last one
        for (let i = 0; i < keysList.length - 1; i++) {
          const k = keysList[i];
          targetEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: k,
            code: k,
            bubbles: true,
            cancelable: true
          }));
        }
        
        // Press the last key
        const lastKey = keysList[keysList.length - 1];
        targetEl.dispatchEvent(new KeyboardEvent('keydown', { key: lastKey, code: lastKey, bubbles: true }));
        targetEl.dispatchEvent(new KeyboardEvent('keypress', { key: lastKey, code: lastKey, bubbles: true }));
        targetEl.dispatchEvent(new KeyboardEvent('keyup', { key: lastKey, code: lastKey, bubbles: true }));
        
        // Release all held keys in reverse order
        for (let i = keysList.length - 2; i >= 0; i--) {
          const k = keysList[i];
          targetEl.dispatchEvent(new KeyboardEvent('keyup', {
            key: k,
            code: k,
            bubbles: true,
            cancelable: true
          }));
        }
        
        return { success: true, message: `Pressed key combination: ${keysList.join('+')}` };
      
      case 'hover':
        // Hover at specific coordinates
        if (coordinates) {
          const hoverEl = document.elementFromPoint(coordinates.x, coordinates.y);
          if (hoverEl) {
            hoverEl.dispatchEvent(new MouseEvent('mouseover', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: coordinates.x,
              clientY: coordinates.y
            }));
            hoverEl.dispatchEvent(new MouseEvent('mouseenter', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: coordinates.x,
              clientY: coordinates.y
            }));
            return { success: true, message: `Hovered at (${coordinates.x}, ${coordinates.y})`, element: hoverEl.tagName };
          }
          return { success: false, message: `No element at (${coordinates.x}, ${coordinates.y})` };
        }
        return { success: false, message: 'Coordinates required for hover' };
      
      case 'drag_drop':
        // Drag and drop from coordinates to destination
        if (coordinates && destination) {
          const dragEl = document.elementFromPoint(coordinates.x, coordinates.y);
          const dropEl = document.elementFromPoint(destination.x, destination.y);

          if (dragEl && dropEl) {
            try {
              const dataTransfer = new DataTransfer();
              dataTransfer.effectAllowed = 'all';

              // Step 1: Mouse down at source
              dragEl.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: coordinates.x,
                clientY: coordinates.y,
                buttons: 1
              }));

              // Step 2: Drag start event
              dragEl.dispatchEvent(new DragEvent('dragstart', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: coordinates.x,
                clientY: coordinates.y,
                dataTransfer: dataTransfer
              }));

              // Step 3: Simulate drag movement with mousemove events
              // Calculate steps between source and destination
              const steps = 10;
              const stepX = (destination.x - coordinates.x) / steps;
              const stepY = (destination.y - coordinates.y) / steps;

              for (let i = 1; i <= steps; i++) {
                const currentX = coordinates.x + stepX * i;
                const currentY = coordinates.y + stepY * i;
                const currentEl = document.elementFromPoint(currentX, currentY);

                // Mouse move
                if (currentEl) {
                  currentEl.dispatchEvent(new MouseEvent('mousemove', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: currentX,
                    clientY: currentY,
                    buttons: 1
                  }));

                  // Drag over
                  currentEl.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: currentX,
                    clientY: currentY,
                    dataTransfer: dataTransfer
                  }));

                  // Drag enter on first arrival
                  if (i === 1 && currentEl !== dragEl) {
                    currentEl.dispatchEvent(new DragEvent('dragenter', {
                      bubbles: true,
                      cancelable: true,
                      view: window,
                      clientX: currentX,
                      clientY: currentY,
                      dataTransfer: dataTransfer
                    }));
                  }
                }
              }

              // Step 4: Drop at destination
              dropEl.dispatchEvent(new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: destination.x,
                clientY: destination.y,
                dataTransfer: dataTransfer
              }));

              // Step 5: Drag end on source
              dragEl.dispatchEvent(new DragEvent('dragend', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: destination.x,
                clientY: destination.y,
                dataTransfer: dataTransfer
              }));

              // Step 6: Mouse up at destination
              dropEl.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: destination.x,
                clientY: destination.y
              }));

              return { success: true, message: `Dragged from (${coordinates.x}, ${coordinates.y}) to (${destination.x}, ${destination.y})` };
            } catch (error) {
              return { success: false, message: `Drag and drop failed: ${error}` };
            }
          }
          return { success: false, message: 'Could not find elements at drag or drop coordinates' };
        }
        return { success: false, message: 'Both coordinates and destination required for drag_drop' };

      case 'mouse_move':
        // Simulate mouse move by dispatching mouse events
        if (coordinates) {
          const element = document.elementFromPoint(coordinates.x, coordinates.y);
          if (element) {
            const moveEvent = new MouseEvent('mousemove', {
              bubbles: true,
              cancelable: true,
              clientX: coordinates.x,
              clientY: coordinates.y,
              view: window
            });
            element.dispatchEvent(moveEvent);
            return { success: true, message: `Mouse moved to (${coordinates.x}, ${coordinates.y})` };
          }
          return { success: false, message: `No element at coordinates (${coordinates.x}, ${coordinates.y})` };
        }
        return { success: false, message: 'Coordinates required for mouse_move action' };

      case 'screenshot':
        // This would need to be handled by the background script
        return { success: true, message: 'Screenshot request sent to background' };

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, message: `Error: ${(error as Error).message}` };
  }
}

// Store original page title to restore it later
// Use window property to avoid duplicate declaration errors
if (typeof (window as any).__atlasOriginalPageTitle === 'undefined') {
  (window as any).__atlasOriginalPageTitle = null;
}
// Access via getter function to avoid const declaration issues
function getOriginalPageTitle(): string | null {
  return (window as any).__atlasOriginalPageTitle;
}
function setOriginalPageTitle(value: string | null): void {
  (window as any).__atlasOriginalPageTitle = value;
}

// Update page title to show agent mode status
function updatePageTitle(isActive: boolean) {
  try {
    console.log('📝 updatePageTitle called with isActive:', isActive, 'current title:', document.title);
    (window as any).__atlasIsAgentModeActive = isActive;
    
    if (isActive) {
      // Store original title if not already stored
      if (getOriginalPageTitle() === null) {
        // Remove any existing indicator before storing original
        const currentTitle = document.title;
        if (currentTitle.startsWith('◉ [AI] ')) {
          setOriginalPageTitle(currentTitle.replace('◉ [AI] ', ''));
        } else {
          setOriginalPageTitle(currentTitle);
        }
        console.log('📝 Stored original title:', getOriginalPageTitle());
      }
      // Always update title to ensure it has the indicator
      const indicator = '◉ [AI]';
      const newTitle = `${indicator} ${getOriginalPageTitle() || document.title.replace('◉ [AI] ', '')}`;
      document.title = newTitle;
      console.log('📝 Set title to:', document.title);
      // Start observing title changes to preserve indicator
      startTitleObserver();
    } else {
      // Stop observing title changes
      stopTitleObserver();
      // Restore original title
      if (getOriginalPageTitle() !== null) {
        document.title = getOriginalPageTitle()!;
        console.log('📝 Restored title to:', document.title);
        setOriginalPageTitle(null);
      } else {
        // Try to remove indicator if we don't have original
        const currentTitle = document.title;
        if (currentTitle.startsWith('◉ [AI] ')) {
          document.title = currentTitle.replace('◉ [AI] ', '');
          console.log('📝 Removed indicator, title now:', document.title);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error updating page title:', error, error instanceof Error ? error.stack : '');
  }
}

// Listen for messages from background script or sidebar
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'PING') {
    // Respond to ping to confirm content script is loaded
    sendResponse({ success: true });
    return true;
  }

  // Update page title for agent mode status
  if (request.type === 'UPDATE_AGENT_MODE_TITLE') {
    console.log('📝 Received UPDATE_AGENT_MODE_TITLE:', request.isActive, 'from:', _sender);
    try {
      updatePageTitle(request.isActive);
      sendResponse({ success: true, title: document.title, originalTitle: originalPageTitle });
    } catch (error) {
      console.error('❌ Error handling UPDATE_AGENT_MODE_TITLE:', error);
      sendResponse({ success: false, error: (error as Error).message });
    }
    return true;
  }

  if (request.type === 'GET_PAGE_CONTEXT') {
    const context = extractPageContext();
    sendResponse(context);
    return true;
  }

  if (request.type === 'GET_VIEWPORT_SIZE') {
    sendResponse({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    });
    return true;
  }

  if (request.type === 'EXECUTE_ACTION') {
    const result = executePageAction(
      request.action,
      request.target,
      request.value,
      request.selector,
      request.coordinates,
      request.direction,
      request.amount,
      request.key,
      request.keys,
      request.destination
    );

    // Handle both synchronous and asynchronous results
    if (result instanceof Promise) {
      result.then(sendResponse);
      return true; // Keep message channel open for async response
    } else {
      sendResponse(result);
      return true;
    }
  }

  if (request.type === 'WAIT_FOR_MODAL') {
    (async () => {
      const timeout = request.timeout || 5000;
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        const modals = detectModals();
        const visibleModals = modals.filter(m => m.isVisible);
        
        if (visibleModals.length > 0) {
          sendResponse({ 
            success: true, 
            modals: visibleModals.map(m => ({
              selector: m.selector,
              hasCloseButton: !!m.closeButton,
              closeButton: m.closeButton
            }))
          });
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      sendResponse({ success: false, error: 'No modal appeared within timeout' });
    })();
    return true;
  }

  if (request.type === 'CLOSE_MODAL') {
    try {
      const modals = detectModals();
      const visibleModals = modals.filter(m => m.isVisible);
      
      if (visibleModals.length === 0) {
        sendResponse({ success: false, error: 'No visible modals found' });
        return true;
      }
      
      // Try to close the topmost modal (highest z-index)
      const topModal = visibleModals[0];
      
      // Try close button first
      if (topModal.closeButton) {
        const closeBtn = document.querySelector(topModal.closeButton.selector);
        if (closeBtn && isElementVisible(closeBtn)) {
          (closeBtn as HTMLElement).click();
          sendResponse({ success: true, method: 'close_button' });
          return true;
        }
      }
      
      // Try ESC key
      const modalElement = topModal.element;
      modalElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      
      // Also try clicking backdrop if it exists
      if (topModal.hasBackdrop) {
        const backdrop = modalElement.parentElement?.querySelector(
          '.backdrop, .overlay, .modal-backdrop, [class*="backdrop"], [class*="overlay"]'
        );
        if (backdrop && isElementVisible(backdrop)) {
          (backdrop as HTMLElement).click();
          sendResponse({ success: true, method: 'backdrop_click' });
          return true;
        }
      }
      
      // Try setting dialog to closed if it's a <dialog> element
      if (modalElement.tagName.toLowerCase() === 'dialog') {
        (modalElement as HTMLDialogElement).close();
        sendResponse({ success: true, method: 'dialog_close' });
        return true;
      }
      
      sendResponse({ success: false, error: 'Could not close modal' });
    } catch (error) {
      sendResponse({ success: false, error: (error as Error).message });
    }
    return true;
  }

  if (request.type === 'GET_SELECTED_TEXT') {
    const selectedText = window.getSelection()?.toString() || '';
    sendResponse({ text: selectedText });
    return true;
  }

  // Show/hide browser automation overlay
  if (request.type === 'SHOW_BROWSER_AUTOMATION_OVERLAY') {
    showBrowserAutomationOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'HIDE_BROWSER_AUTOMATION_OVERLAY') {
    hideBrowserAutomationOverlay();
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Browser automation visual overlay
 * Shows blue border and "Take Over Control" button when AI is controlling the browser
 */
// Use window properties to avoid duplicate declaration errors
if (typeof (window as any).__atlasAutomationOverlay === 'undefined') {
  (window as any).__atlasAutomationOverlay = null;
  (window as any).__atlasAutomationButton = null;
  (window as any).__atlasIsUserAborted = false;
}
let automationOverlay: HTMLDivElement | null = (window as any).__atlasAutomationOverlay;
let automationButton: HTMLDivElement | null = (window as any).__atlasAutomationButton;
let isUserAborted = (window as any).__atlasIsUserAborted;

function showBrowserAutomationOverlay() {
  // Don't show overlay if user has aborted
  if (isUserAborted) {
    console.log('🚫 Overlay blocked - user has taken over control');
    return;
  }

  // Don't create duplicate overlay
  if (automationOverlay) return;

  // Ensure document.body exists before appending
  if (!document.body) {
    console.warn('⚠️  Cannot show overlay - document.body not ready yet');
    // Retry when body is ready
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        showBrowserAutomationOverlay();
      }
    });
    observer.observe(document.documentElement, { childList: true });
    return;
  }

  console.log('🔵 Showing browser automation overlay');

  // Create blue border overlay
  automationOverlay = document.createElement('div');
  automationOverlay.id = 'atlas-automation-overlay';
  automationOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border: 4px solid #007AFF;
    pointer-events: none;
    z-index: 999998;
    box-shadow: inset 0 0 20px rgba(0, 122, 255, 0.3);
  `;

  // Create "Take Over Control" button
  automationButton = document.createElement('div');
  automationButton.id = 'atlas-takeover-button';
  automationButton.innerHTML = `
    <button style="
      background: linear-gradient(135deg, #007AFF 0%, #0051D5 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 122, 255, 0.4);
      transition: all 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(0, 122, 255, 0.5)';"
       onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0, 122, 255, 0.4)';">
      🛑 Take Over Control
    </button>
  `;
  automationButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 999999;
    pointer-events: auto;
  `;

  // Handle button click
  const button = automationButton.querySelector('button');
  if (button) {
    button.addEventListener('click', () => {
      console.log('🛑 Take Over Control button clicked');
      // Set abort flag to prevent overlay from re-appearing
      isUserAborted = true;
      // Reset abort flag after 5 seconds to allow future operations
      setTimeout(() => {
        isUserAborted = false;
        console.log('✅ User abort flag cleared - ready for new operations');
      }, 5000);
      // Immediately hide overlay
      hideBrowserAutomationOverlay();
      // Send message to sidepanel to abort automation
      chrome.runtime.sendMessage({ type: 'ABORT_BROWSER_AUTOMATION' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidepanel not responding (this is OK)');
        }
      });
    });
  }

  document.body.appendChild(automationOverlay);
  document.body.appendChild(automationButton);
}

function hideBrowserAutomationOverlay() {
  console.log('🔵 Hiding browser automation overlay');

  if (automationOverlay && automationOverlay.parentNode) {
    automationOverlay.remove();
    automationOverlay = null;
  }
  if (automationButton && automationButton.parentNode) {
    automationButton.remove();
    automationButton = null;
  }
}

/**
 * Send page load event to background when DOM is fully ready
 * Waits for DOM to be interactive before sending message to ensure
 * all page data (links, forms, etc.) is available
 */
function sendPageLoadMessage() {
  // Clear DOM cache on page load/navigation
  const domCache = getDomCache();
  Object.keys(domCache).forEach(key => delete (domCache as any)[key]);
  
  chrome.runtime.sendMessage({
    type: 'PAGE_LOADED',
    url: window.location.href,
    title: document.title,
    timestamp: Date.now()
  }).catch(error => {
    // Silently fail if background script is not available
    // (might happen on restricted pages)
    console.debug('Could not send PAGE_LOADED message:', error);
  });

  console.log('Atlas content script loaded on:', window.location.href);
}

// Wait for DOM to be ready before sending page load message
// This prevents race conditions where page data isn't available yet
if (document.readyState === 'loading') {
  // DOM is still loading, wait for it
  document.addEventListener('DOMContentLoaded', sendPageLoadMessage, { once: true });
} else {
  // DOM is already interactive or complete
  sendPageLoadMessage();
}

/**
 * Inject floating "Ask GoDaddy ANS" button on web pages
 * Opens the sidebar when clicked
 * Only shows when sidebar is closed
 */
// Use window properties to avoid duplicate declaration errors
if (typeof (window as any).__atlasAnsFloatingButton === 'undefined') {
  (window as any).__atlasAnsFloatingButton = null;
  (window as any).__atlasSidebarOpen = false;
}
let ansFloatingButton: HTMLDivElement | null = (window as any).__atlasAnsFloatingButton;
let sidebarOpen = (window as any).__atlasSidebarOpen;

function showANSFloatingButton() {
  if (sidebarOpen) return;
  
  // Check if floating button is enabled in settings
  chrome.storage.local.get(['atlasSettings'], (result) => {
    const settings = result.atlasSettings;
    const floatingButtonEnabled = settings?.floatingButtonEnabled !== false; // Default to true
    
    if (!floatingButtonEnabled) {
      // Hide button if disabled
      if (ansFloatingButton) {
        ansFloatingButton.style.display = 'none';
      }
      return;
    }
    
    // Show button if enabled
    showANSFloatingButtonInternal();
  });
}

function showANSFloatingButtonInternal() {
  if (sidebarOpen) return;
  
  if (ansFloatingButton) {
    ansFloatingButton.style.display = 'block';
    return;
  }

  // Ensure document.body exists
  if (!document.body) {
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        showANSFloatingButton();
      }
    });
    observer.observe(document.documentElement, { childList: true });
    return;
  }

  // Get extension icon URL
  const iconUrl = chrome.runtime.getURL('icons/icon.png');

  // Create button container
  ansFloatingButton = document.createElement('div');
  ansFloatingButton.id = 'ans-floating-button';
  ansFloatingButton.innerHTML = `
    <button id="ans-floating-btn" style="
      display: flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #00B140 0%, #008A32 100%);
      color: white;
      border: none;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 24px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 177, 64, 0.3);
      transition: all 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      white-space: nowrap;
    ">
      <img src="${iconUrl}" alt="GoDaddy ANS" style="width: 20px; height: 20px; object-fit: contain; display: block;" onerror="this.style.display='none';" />
      Ask GoDaddy ANS
    </button>
  `;
  ansFloatingButton.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999997;
    pointer-events: auto;
    display: block;
  `;

  // Add hover effects
  const button = ansFloatingButton.querySelector('#ans-floating-btn') as HTMLButtonElement;
  if (button) {
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 6px 16px rgba(0, 177, 64, 0.4)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 4px 12px rgba(0, 177, 64, 0.3)';
    });
    button.addEventListener('click', () => {
      // Hide button immediately when clicked
      hideANSFloatingButton();
      // Open sidebar via background script
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error opening sidebar:', chrome.runtime.lastError);
          // Show button again if sidebar failed to open
          showANSFloatingButton();
        }
      });
    });
  }

  document.body.appendChild(ansFloatingButton);
}

function hideANSFloatingButton() {
  if (ansFloatingButton) {
    ansFloatingButton.style.display = 'none';
  }
}

// Listen for sidebar state changes and settings updates
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'SIDEBAR_OPENED') {
    sidebarOpen = true;
    hideANSFloatingButton();
  } else if (request.type === 'SIDEBAR_CLOSED') {
    sidebarOpen = false;
    showANSFloatingButton();
  } else if (request.type === 'SETTINGS_UPDATED' && request.action === 'floating_button_changed') {
    // Settings changed, update button visibility
    checkSidebarStateAndUpdateButton();
  }
});

// Simple function to check sidebar state and update button
function checkSidebarStateAndUpdateButton() {
  chrome.runtime.sendMessage({ type: 'CHECK_SIDEBAR_STATE' }, (response) => {
    const isOpen = response && response.sidebarOpen === true;
    sidebarOpen = isOpen;
    
    if (isOpen) {
      hideANSFloatingButton();
    } else {
      // Check settings before showing
      showANSFloatingButton();
    }
  });
}

// Reset original title on page navigation
window.addEventListener('beforeunload', () => {
  setOriginalPageTitle(null);
});

// Monitor for title changes and preserve the indicator if agent mode is active
// Use window properties to avoid duplicate declaration errors
if (typeof (window as any).__atlasTitleObserver === 'undefined') {
  (window as any).__atlasTitleObserver = null;
  (window as any).__atlasIsAgentModeActive = false;
}
let titleObserver: MutationObserver | null = (window as any).__atlasTitleObserver;
let isAgentModeActive = (window as any).__atlasIsAgentModeActive;

function startTitleObserver() {
  if ((window as any).__atlasTitleObserver) return;
  
  (window as any).__atlasTitleObserver = new MutationObserver(() => {
    // If agent mode is active and title doesn't have indicator, add it
    if ((window as any).__atlasIsAgentModeActive && getOriginalPageTitle() !== null) {
      const indicator = '◉ [AI]';
      if (!document.title.startsWith(indicator + ' ')) {
        // Title was changed externally, update it
        document.title = `${indicator} ${getOriginalPageTitle()}`;
      }
    }
  });
  
  // Observe title element changes
  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, { childList: true, subtree: true });
  }
}

function stopTitleObserver() {
  if ((window as any).__atlasTitleObserver) {
    (window as any).__atlasTitleObserver.disconnect();
    (window as any).__atlasTitleObserver = null;
  }
}

// Initialize button on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    checkSidebarStateAndUpdateButton();
  }, { once: true });
} else {
  checkSidebarStateAndUpdateButton();
}

// Check state on page refresh and navigation
window.addEventListener('pageshow', () => {
  checkSidebarStateAndUpdateButton();
});

// Check state when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkSidebarStateAndUpdateButton();
  }
});

// Check state when window gains focus
window.addEventListener('focus', () => {
  checkSidebarStateAndUpdateButton();
});

// Additional check on beforeunload to reset state (optional, but helps with cleanup)
window.addEventListener('beforeunload', () => {
  // Reset local state on page unload
  sidebarOpen = false;
});
