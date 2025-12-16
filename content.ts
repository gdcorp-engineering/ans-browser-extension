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
  wand.textContent = '✨';
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
    boundingRect?: {
      top: number;
      left: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
      centerX: number;
      centerY: number;
    };
  }>;
  searchInputs?: Array<{
    selector: string;
    type: string;
    id: string;
    name: string;
    placeholder: string;
    'aria-label': string | null;
    'data-automation-id': string | null;
    role: string | null;
    className: string;
    visible: boolean;
    dimensions: {
      width: number;
      height: number;
      top: number;
      left: number;
    };
  }>;
  metadata: {
    description?: string;
    keywords?: string;
    author?: string;
  };
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
}

// Extract comprehensive page context
function extractPageContext(): PageContext {
  const links = Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
    text: a.textContent?.trim() || '',
    href: a.href
  }));

  const images = Array.from(document.querySelectorAll('img')).slice(0, 20).map(img => ({
    alt: img.alt,
    src: img.src
  }));

  const forms = Array.from(document.querySelectorAll('form')).map(form => ({
    id: form.id,
    action: form.action,
    inputs: Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
      name: (input as HTMLInputElement).name,
      type: (input as HTMLInputElement).type || 'text'
    }))
  }));

  // Extract interactive elements with their selectors for easy DOM-based clicking
  const getElementSelector = (el: Element): string => {
    if (el.id) return `#${el.id}`;
    if (el.className) {
      const classes = el.className.split(' ').filter(c => c.trim());
      if (classes.length > 0) return `${el.tagName.toLowerCase()}.${classes[0]}`;
    }
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    return el.tagName.toLowerCase();
  };

  // Find all interactive/clickable elements
  const interactiveElements = Array.from(
    document.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"], [onclick]')
  )
    .slice(0, 30)
    .map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.trim().slice(0, 50) || '',
        value: (el as HTMLInputElement).value || undefined,
        selector: getElementSelector(el),
        type: (el as HTMLInputElement).type || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
        boundingRect: {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2
        }
      };
    })
    .filter(el => el.visible); // Only return visible elements

  const getMetaContent = (name: string): string | undefined => {
    const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return meta?.getAttribute('content') || undefined;
  };

  // Find all search-related inputs for debugging
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
    interactiveElements, // NEW: List of clickable elements with selectors
    searchInputs, // NEW: List of all visible search/text inputs for debugging
    metadata: {
      description: getMetaContent('description') || getMetaContent('og:description'),
      keywords: getMetaContent('keywords'),
      author: getMetaContent('author')
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio
    }
  };
}

// Helper function to dispatch complete, realistic click event sequence
async function dispatchClickSequence(element: HTMLElement, x: number, y: number): Promise<void> {
  console.log('🖱️  Starting NATIVE-ONLY click sequence...');
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
    zIndex: window.getComputedStyle(element).zIndex,
    offsetParent: element.offsetParent?.tagName || 'none'
  });

  // Check if element is actually clickable at this position
  const topElement = document.elementFromPoint(x, y);
  if (topElement !== element) {
    console.warn('⚠️  Element at coordinates is different from target!');
    console.warn('   Target:', element.tagName, element.className);
    console.warn('   Actual top element:', topElement?.tagName, (topElement as HTMLElement)?.className);

    // Try to click the actual top element if it's different
    if (topElement && topElement !== element) {
      console.log('   📍 Will try clicking the actual top element instead');
      element = topElement as HTMLElement;
    }
  }

  // Check for click event listeners
  const hasClickListeners = (element as any).onclick ||
                           element.getAttribute('onclick') ||
                           element.hasAttribute('ng-click') ||
                           element.hasAttribute('@click') ||
                           element.hasAttribute('v-on:click');
  console.log('🎧 Has click listeners/handlers:', hasClickListeners ? 'Yes' : 'Unknown (may use addEventListener)');

  // CRITICAL: For Slack and React apps, ONLY native clicks generate trusted events
  // Synthetic events are marked isTrusted=false and ignored by security-sensitive apps

  console.log('1️⃣ Finding best clickable element...');

  // If it's a clickable parent, find the actual interactive child
  const interactiveChild = element.querySelector('button, a, input, [role="button"], [role="link"], [onclick], [tabindex]') as HTMLElement;
  if (interactiveChild && interactiveChild !== element) {
    console.log('   Found interactive child:', interactiveChild.tagName, interactiveChild.className);
    element = interactiveChild; // Target the child instead
  }

  // Look for parent clickable elements if current element seems non-interactive
  if (!['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) &&
      !element.hasAttribute('onclick') &&
      !element.getAttribute('role')?.includes('button')) {
    const clickableParent = element.closest('button, a, [role="button"], [role="link"], [onclick]') as HTMLElement;
    if (clickableParent) {
      console.log('   Found clickable parent:', clickableParent.tagName, clickableParent.className);
      element = clickableParent;
    }
  }

  console.log('2️⃣ Final target element:', element.tagName, element.className);

  // Scroll element into view first
  try {
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    console.log('✅ Scrolled into view');
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for scroll
  } catch (error) {
    console.error('❌ Scroll failed:', error);
  }

  // Set focus first (required for some elements)
  try {
    if (element instanceof HTMLElement && typeof element.focus === 'function') {
      element.focus();
      console.log('✅ Focus set');
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for focus handlers
    }
  } catch (error) {
    console.error('❌ Focus failed:', error);
  }

  // STRATEGY: Use simple native click - avoid over-clicking
  // Previous logic was too aggressive (5x clicks + parent + all children = chaos)
  try {
    console.log('3️⃣ NATIVE CLICK (single, targeted)...');

    // Single native click - this generates a trusted event
    element.click();
    console.log('   ✅ Native click executed (isTrusted: true)');

    // Wait for any async handlers
    await new Promise(resolve => setTimeout(resolve, 100));

    // If the first click didn't seem to work (element still exists and is clickable),
    // try ONE more time with a delay
    const stillExists = document.body.contains(element);
    const stillVisible = element.offsetParent !== null;
    if (stillExists && stillVisible && element.tagName === 'BUTTON') {
      console.log('4️⃣ Element still visible, trying one more click...');
      await new Promise(resolve => setTimeout(resolve, 200));
      element.click();
      console.log('   ✅ Second native click executed');
    }

    // NOTE: We intentionally do NOT click parent or child elements anymore
    // This was causing multiple unrelated elements to be clicked (e.g., "Learn about priority levels" link)

    console.log('✅ All click attempts completed');
  } catch (error) {
    console.error('❌ Error dispatching events:', error);
  }
}

// Execute actions on the page
async function executePageAction(
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
): Promise<any> {
  try {
    switch (action) {
      case 'click':
        // DEBUG: Log all click parameters
        console.log('🔧 CLICK ACTION DEBUG - Start');
        console.log('   📋 Parameters:', {
          selector,
          target,
          coordinates,
          value,
          hasCoordinates: !!coordinates,
          hasSelector: !!selector,
          hasTarget: !!target
        });
        console.log('   🎯 Currently focused element:', {
          tagName: document.activeElement?.tagName,
          id: document.activeElement?.id,
          className: document.activeElement?.className
        });

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

          // Search through common clickable elements (prioritized by specificity)
          const clickableSelectors = [
            // High priority: Form submit buttons and primary actions
            'button[type="submit"]',
            'input[type="submit"]',

            // Modal and dialog buttons (often more specific)
            '[role="dialog"] button',
            '.modal button',
            '.dialog button',
            '[data-testid*="publish"] button',
            '[data-testid*="submit"] button',

            // Primary/CTA buttons (common class patterns)
            'button.primary',
            'button.btn-primary',
            'button[class*="primary"]',
            'button[class*="cta"]',

            // Confluence-specific selectors
            'button[data-test-id*="publish"]',
            'button[aria-label*="publish"]',
            '#publish-modal-form button',
            '[data-testid="publish-button"]',
            '[data-testid="publish-modal"] button',
            '.publish-modal button',

            // General buttons (lower priority)
            'button',
            'a',
            'input[type="button"]',
            '[role="button"]',
            '[role="tab"]',
            '[role="link"]',
            'span[onclick]',
            'div[onclick]',
            '[onclick]'
          ];

          for (const sel of clickableSelectors) {
            const elements = Array.from(document.querySelectorAll(sel));
            const matchingElements = elements.filter(el => {
              const text = el.textContent?.trim().toLowerCase() || '';
              const value = (el as HTMLInputElement).value?.toLowerCase() || '';
              const targetLower = target.toLowerCase();
              return text.includes(targetLower) || value.includes(targetLower);
            });

            if (matchingElements.length > 0) {
              // If multiple matches, prefer the most specific/visible one
              element = matchingElements.find(el => {
                const rect = (el as HTMLElement).getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 &&
                                 rect.top >= 0 && rect.left >= 0;

                // Prefer buttons in modals/dialogs (higher z-index, overlay context)
                const isInModal = el.closest('[role="dialog"], .modal, .dialog, [data-testid*="modal"]');

                // Prefer exact text matches over partial matches
                const text = el.textContent?.trim().toLowerCase() || '';
                const targetLower = target.toLowerCase();
                const isExactMatch = text === targetLower;

                return isVisible && (isInModal || isExactMatch);
              }) || matchingElements[0]; // Fallback to first match

              console.log(`✅ Found ${matchingElements.length} matching elements for "${target}" in ${sel}`);
              console.log(`   Selected: "${element.textContent?.trim()}"`);
              console.log(`   Element bounds:`, (element as HTMLElement).getBoundingClientRect());
              console.log(`   Is in modal:`, !!element.closest('[role="dialog"], .modal, .dialog'));
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

          // Last resort: search ALL elements for matching text (slow but comprehensive)
          if (!element) {
            console.log(`🔍 Last resort: searching all elements for text "${target}"`);
            const allElements = Array.from(document.querySelectorAll('*'));
            element = allElements.find(el => {
              // Only consider visible elements
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return false;

              const text = el.textContent?.trim().toLowerCase() || '';
              const targetLower = target.toLowerCase();

              // Match if this element's direct text includes target
              // (not just descendant text which would match parent containers)
              if (text.includes(targetLower)) {
                // Prefer elements with click handlers or cursor pointer
                const style = window.getComputedStyle(el);
                const clickable = style.cursor === 'pointer' ||
                                el.hasAttribute('onclick') ||
                                el.getAttribute('role') === 'button' ||
                                el.getAttribute('role') === 'tab';
                if (clickable) return true;
              }
              return false;
            }) as Element | undefined || null;

            if (element) {
              console.log(`✅ Found element by text in all elements: "${target}"`);
              console.log(`   Element: ${element.tagName}.${element.className}`);
            }
          }
        }

        // 3. If we found an element (by selector or text), click it
        if (element) {
          const rect = (element as HTMLElement).getBoundingClientRect();
          const clickX = rect.left + rect.width / 2;
          const clickY = rect.top + rect.height / 2;

          console.log(`🎯 Click position calculated:`);
          console.log(`   Element: ${element.tagName}.${element.className}`);
          console.log(`   Element bounds: left=${rect.left}, top=${rect.top}, width=${rect.width}, height=${rect.height}`);
          console.log(`   Click coordinates: (${Math.round(clickX)}, ${Math.round(clickY)}) - center of element`);
          console.log(`   Element text: "${element.textContent?.trim().substring(0, 50)}"`);

          // Use complete click sequence for better compatibility
          await dispatchClickSequence(element as HTMLElement, clickX, clickY);

          // Visual feedback
          highlightElement(element, coordinates || { x: clickX, y: clickY });

          // Track recently clicked element for better type targeting
          recentlyClickedElement = element as HTMLElement;
          recentlyClickedTimestamp = Date.now();

          return {
            success: true,
            message: `Clicked element at (${Math.round(clickX)}, ${Math.round(clickY)}): ${selector || target}`,
            element: element.tagName,
            clickCoordinates: { x: Math.round(clickX), y: Math.round(clickY) }
          };
        }

        // 4. If element was searched but not found, return error
        if (!element && (selector || target)) {
          return {
            success: false,
            message: `Element not found: ${selector || `text="${target}"`}. Try using coordinates as fallback.`
          };
        }

        // 5. If no element found but we have coordinates, use coordinate-based clicking
        // OR if we have coordinates, show debug markers regardless
        if (coordinates) {
          console.log(`🎯 Click coordinates received: x=${coordinates.x}, y=${coordinates.y}`);
          console.log(`📏 Viewport size: ${window.innerWidth}x${window.innerHeight}`);
          console.log(`📏 Device pixel ratio: ${window.devicePixelRatio}`);
          console.log(`📜 Document scroll: x=${window.scrollX}, y=${window.scrollY}`);
          console.log(`🖥️  Window size: ${window.outerWidth}x${window.outerHeight}`);
          console.log(`📱 Screen size: ${screen.width}x${screen.height}`);

          // ALWAYS show debug marker when coordinates are provided (for debugging)
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

          // If element was already found by selector/text but we also have coordinates,
          // verify the element is actually at those coordinates
          if (element) {
            const rect = (element as HTMLElement).getBoundingClientRect();
            const isInBounds = coordinates.x >= rect.left && coordinates.x <= rect.right &&
                              coordinates.y >= rect.top && coordinates.y <= rect.bottom;
            console.log(`✓ Found element by selector/text, coordinates ${isInBounds ? 'MATCH' : 'MISMATCH'}`);
            if (!isInBounds) {
              console.warn(`⚠️  Coordinates (${coordinates.x}, ${coordinates.y}) are NOT within element bounds!`);
              console.warn(`   Element bounds:`, rect);
            }
          }

          // Get element at coordinates (may override selector-found element if mismatch)
          if (!element) {
            element = document.elementFromPoint(coordinates.x, coordinates.y) as HTMLElement;
          }
          console.log(`🎯 Element at coordinates:`, element?.tagName, element?.className);

          if (element) {
            const rect = (element as HTMLElement).getBoundingClientRect();
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

          // DISABLED: Smart input-finding was redirecting clicks to wrong elements
          // When AI provides explicit coordinates from screenshot, trust them exactly
          // Previous behavior: searched 100px radius for inputs and redirected clicks
          // Problem: clicks meant for links/buttons were landing on nearby search boxes
          console.log('✓ Using exact coordinates from AI - no smart input search');

          if (element) {
            // Get element position for logging
            const rect = element.getBoundingClientRect();

            // Use complete click sequence for better compatibility
            await dispatchClickSequence(element as HTMLElement, coordinates.x, coordinates.y);

            // Visual feedback
            highlightElement(element, coordinates);

            // Track recently clicked element for better type targeting
            recentlyClickedElement = element as HTMLElement;
            recentlyClickedTimestamp = Date.now();

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
        console.log('🔍 FILL ACTION CALLED:', { target, value, selector, hasValue: !!value });
        console.log('🚀 CONTENT SCRIPT UPDATED - NEW FILL LOGIC ACTIVE');
        if (value) {
          const textToType = value; // Capture value to preserve type narrowing
          let element: HTMLElement | null = null;

          console.log('🔍 FILL ACTION DEBUG - Start');
          console.log('   📋 Parameters:', { target, value: textToType, hasTarget: !!target });
          console.log('   🎯 Currently focused element:', {
            tagName: document.activeElement?.tagName,
            id: document.activeElement?.id,
            className: document.activeElement?.className,
            contentEditable: document.activeElement?.getAttribute('contenteditable'),
            isTypeable: document.activeElement?.tagName === 'INPUT' ||
                       document.activeElement?.tagName === 'TEXTAREA' ||
                       document.activeElement?.getAttribute('contenteditable') === 'true'
          });

          // PROACTIVE APPROACH: If no target is specified, try to find the best editable element automatically
          if (!target) {
            console.log('🎯 No target specified - searching for best editable element...');

            // PRIORITY: Check if recently clicked element is editable and suitable for typing
            const recentClickWindow = 10000; // 10 seconds
            if (recentlyClickedElement &&
                recentlyClickedTimestamp &&
                (Date.now() - recentlyClickedTimestamp) < recentClickWindow) {

              const isEditable = recentlyClickedElement.tagName === 'INPUT' ||
                               recentlyClickedElement.tagName === 'TEXTAREA' ||
                               recentlyClickedElement.getAttribute('contenteditable') === 'true';

              if (isEditable) {
                // Check if the element is still visible and in the DOM
                const rect = recentlyClickedElement.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 &&
                                document.body.contains(recentlyClickedElement);

                if (isVisible) {
                  console.log('✅ Using recently clicked editable element:', {
                    tagName: recentlyClickedElement.tagName,
                    className: recentlyClickedElement.className,
                    contentEditable: recentlyClickedElement.getAttribute('contenteditable'),
                    clickedAgo: Date.now() - recentlyClickedTimestamp
                  });
                  element = recentlyClickedElement;
                }
              }
            }

            // If no recently clicked element found, fall back to selector-based search
            if (!element) {
              const bestEditableSelectors = [
              // Confluence main content areas (highest priority - avoid headers)
              '.ak-editor-content-area[contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',
              '.ProseMirror[contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',
              'div[role="textbox"][contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',

              // Generic content editors (avoid headers)
              '.editor[contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',
              '.rich-text-editor[contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',
              'div[role="textbox"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)',

              // Main content containers
              '[contenteditable="true"]:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6):not([role="heading"])',

              // Regular inputs as fallback
              'textarea:not([readonly]):not([disabled])',
              'input[type="text"]:not([readonly]):not([disabled])',

              // Last resort - any contenteditable (including headers, but we'll handle appending)
              '[contenteditable="true"]',
            ];

            for (const selector of bestEditableSelectors) {
              const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
              const bestCandidate = candidates.find(el => {
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 50 && rect.height > 20 && rect.top >= 0;

                // Check if element contains only placeholder text
                const text = el.textContent?.trim() || '';
                const placeholderTexts = ['Type / to insert elements', 'Type something...', 'Start typing...'];
                const isOnlyPlaceholder = placeholderTexts.some(placeholder =>
                  text.toLowerCase() === placeholder.toLowerCase()
                );

                // Prefer elements without placeholder text, but don't exclude them entirely
                return isVisible && !isOnlyPlaceholder;
              }) || candidates.find(el => {
                // Fallback: any visible element (even with placeholder)
                const rect = el.getBoundingClientRect();
                return rect.width > 50 && rect.height > 20 && rect.top >= 0;
              });

              if (bestCandidate) {
                // Check if this is a heading element
                const isHeading = bestCandidate.tagName.match(/^H[1-6]$/) ||
                                 bestCandidate.getAttribute('role') === 'heading' ||
                                 bestCandidate.classList.contains('heading') ||
                                 bestCandidate.textContent?.trim().length < 100; // Short text likely to be heading

                console.log(`   ✅ Found best editable element: ${selector}`);
                console.log('   📋 Element details:', {
                  tagName: bestCandidate.tagName,
                  id: bestCandidate.id,
                  className: bestCandidate.className,
                  contentEditable: bestCandidate.getAttribute('contenteditable'),
                  isHeading: isHeading,
                  textContent: bestCandidate.textContent?.slice(0, 50) + '...'
                });

                if (isHeading) {
                  console.log('   ⚠️ Selected element appears to be a heading - content will be appended');
                }

                element = bestCandidate;
                break;
              }
            }
            } // End of "if (!element)" selector fallback
          }

          console.log('🔍 fill action - target selector:', target);

          // Try to find element by selector if provided
          if (target && !target.includes(':focus')) {
            element = document.querySelector(target) as HTMLElement;
            if (element) {
              console.log('✅ Found element by selector:', target);
              console.log('   📋 Element details:', {
                tagName: element.tagName,
                id: element.id,
                className: element.className,
                contentEditable: element.getAttribute('contenteditable'),
                type: (element as HTMLInputElement).type,
                isTypeable: element.tagName === 'INPUT' ||
                           element.tagName === 'TEXTAREA' ||
                           element.getAttribute('contenteditable') === 'true'
              });
            } else {
              console.log('❌ No element found with selector:', target);
              console.log('   🔍 Available elements with similar selectors:');
              // Try to find similar elements for debugging
              const similarElements = Array.from(document.querySelectorAll('*')).filter(el =>
                el.id?.includes(target?.replace(/[#.]/, '') || '') ||
                el.className?.includes(target?.replace(/[#.]/, '') || '') ||
                el.tagName?.toLowerCase().includes(target?.toLowerCase() || '')
              ).slice(0, 5);
              similarElements.forEach(el => console.log(`      - ${el.tagName}#${el.id}.${el.className}`));
            }
          }

          // If no element found or selector was for focused elements, use the currently focused element
          if (!element) {
            element = document.activeElement as HTMLElement;
            console.log('🎯 Using currently focused element:', element?.tagName);
            console.log('   📋 Focused element details:', {
              tagName: element?.tagName,
              id: element?.id,
              className: element?.className,
              contentEditable: element?.getAttribute('contenteditable'),
              isTypeable: element?.tagName === 'INPUT' ||
                         element?.tagName === 'TEXTAREA' ||
                         element?.getAttribute('contenteditable') === 'true'
            });
          }

          // If element is BODY (nothing focused), try to find a visible search/text input
          if (element && element.tagName === 'BODY') {
            console.log('💡 Nothing focused (BODY element), searching for visible input field...');
            console.log('   🔍 Looking for editable elements in DOM...');

            // Try to find editable elements (prioritize content editors over search)
            const editableSelectors = [
              // Confluence-specific editor selectors
              '[contenteditable="true"]', // Confluence rich text editor
              '.ak-editor-content-area[contenteditable="true"]', // Atlassian editor
              '.ProseMirror[contenteditable="true"]', // ProseMirror editor used by Confluence
              '#tinymce', // TinyMCE editor (if used)
              '.confluence-editor [contenteditable="true"]', // Confluence wrapper
              '.content-body [contenteditable="true"]', // Content area

              // Generic editor patterns
              '.editor[contenteditable="true"]',
              '.rich-text-editor[contenteditable="true"]',
              '.wysiwyg[contenteditable="true"]',
              'div[role="textbox"]', // ARIA textbox
              'div[role="textbox"][contenteditable="true"]',

              // Fallback to input fields
              'textarea:not([type="hidden"]):not([role="combobox"])',
              'input[type="text"]:not([type="hidden"]):not([role="combobox"])',
              'input[type="search"]:not([role="combobox"])',

              // Search inputs as last resort
              'input[type="search"][data-automation-id*="searchBox"]', // Workday main search
              'input[name*="search" i]:not([role="combobox"])',
              'input[id*="search" i]:not([role="combobox"])',
              'input[placeholder*="search" i]:not([role="combobox"])',
              'input[aria-label*="search" i]:not([role="combobox"])',
              'input[type="text"][name="q"]', // Common search param
            ];

            for (const selector of editableSelectors) {
              const inputs = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
              console.log(`   🔍 Trying selector "${selector}" - found ${inputs.length} elements`);

              // Find first visible input
              const visibleInput = inputs.find(input => {
                const rect = input.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;
                console.log(`      - ${input.tagName}#${input.id}.${input.className} - ${rect.width}x${rect.height} - visible: ${isVisible}`);
                return isVisible;
              });

              if (visibleInput) {
                console.log(`   ✅ Found visible editable element with "${selector}":`, {
                  tagName: visibleInput.tagName,
                  id: visibleInput.id,
                  className: visibleInput.className,
                  contentEditable: visibleInput.getAttribute('contenteditable')
                });
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
                    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;

                    // Clear the value using multiple methods for compatibility
                    inputElement.value = '';

                    // Set the new value using native setter (works with React)
                    // Use the correct prototype based on element type
                    const isTextarea = element!.tagName === 'TEXTAREA';
                    const prototype = isTextarea
                      ? window.HTMLTextAreaElement.prototype
                      : window.HTMLInputElement.prototype;

                    const nativeValueSetter = Object.getOwnPropertyDescriptor(
                      prototype,
                      'value'
                    )?.set;

                    if (nativeValueSetter) {
                      nativeValueSetter.call(inputElement, textToType);
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
                    // For contenteditable elements, check if we should append or replace
                    const existingText = element!.textContent?.trim() || '';

                    // Common placeholder texts to ignore
                    const placeholderTexts = [
                      'Type / to insert elements',
                      'Type something...',
                      'Start typing...',
                      'Click here to add content',
                      'Add content here',
                      'Enter text here'
                    ];

                    const isPlaceholder = placeholderTexts.some(placeholder =>
                      existingText.toLowerCase().includes(placeholder.toLowerCase())
                    );

                    console.log('📝 Contenteditable element handling:', {
                      existingText: existingText,
                      textToType: textToType,
                      isPlaceholder: isPlaceholder,
                      shouldAppend: existingText.length > 0 && !isPlaceholder
                    });

                    if (existingText.length > 0 && !isPlaceholder) {
                      // If there's existing real content (not placeholder), append new content
                      console.log('   📝 Appending to existing content...');

                      // Use DOM manipulation instead of innerHTML to prevent XSS
                      // Get current selection to preserve cursor position
                      const selection = window.getSelection();
                      const range = document.createRange();
                      
                      // Move to end of element
                      range.selectNodeContents(element!);
                      range.collapse(false);
                      
                      // Insert line break and text using DOM methods (XSS-safe)
                      const br = document.createElement('br');
                      range.insertNode(br);
                      range.setStartAfter(br);
                      range.collapse(true);
                      
                      // Insert text node (automatically escapes HTML)
                      const textNode = document.createTextNode(textToType);
                      range.insertNode(textNode);
                      
                      // Position cursor at end
                      range.setStartAfter(textNode);
                      range.collapse(true);
                      selection?.removeAllRanges();
                      selection?.addRange(range);

                    } else {
                      // If empty or placeholder, replace with new content
                      console.log(isPlaceholder ?
                        '   📝 Replacing placeholder text with new content...' :
                        '   📝 Setting text in empty element...');

                      // Clear the element completely first (textContent clears all content safely)
                      element!.textContent = '';

                      // Set new content
                      element!.textContent = textToType;
                    }

                    element!.dispatchEvent(new Event('input', { bubbles: true }));
                    element!.dispatchEvent(new Event('change', { bubbles: true }));
                  }

                  // Verify that the content was actually added
                  setTimeout(() => {
                    try {
                      const finalContent = element!.textContent || element!.innerText || '';

                      // Check if content was added (using textContent only, which is XSS-safe)
                      const contentWasAdded = finalContent.includes(textToType);

                      console.log('🔍 Content verification:', {
                        textToType: textToType,
                        finalTextContent: finalContent.substring(0, 200) + (finalContent.length > 200 ? '...' : ''),
                        contentWasAdded: contentWasAdded
                      });

                      if (contentWasAdded) {
                        resolve({
                          success: true,
                          message: `Successfully typed "${textToType}" into ${element!.tagName}`,
                          element: element!.tagName,
                          finalContent: finalContent.length > 100 ? finalContent.substring(0, 100) + '...' : finalContent
                        });
                      } else {
                        resolve({
                          success: false,
                          message: `Failed to add content "${textToType}" to ${element!.tagName}. Content verification failed. Current content: "${finalContent.substring(0, 50)}${finalContent.length > 50 ? '...' : ''}"`,
                          element: element!.tagName
                        });
                      }
                    } catch (verificationError) {
                      console.error('❌ Error during content verification:', verificationError);
                      resolve({
                        success: false,
                        message: `Content verification error: ${verificationError}`,
                        element: element!.tagName
                      });
                    }
                  }, 100); // Small delay to let content settle
                }
              }, 300); // 300ms delay after focus to ensure it's established
            });
          }

          console.error('❌ FILL FAILED - Element not typeable');
          console.error('   📋 Element details:', {
            tagName: element?.tagName,
            id: element?.id,
            className: element?.className,
            contentEditable: element?.getAttribute('contenteditable'),
            type: (element as HTMLInputElement)?.type
          });
          console.error('   🔍 Attempted text to type:', textToType);
          console.error('   💡 Available editable elements on page:');

          // Show available editable elements for debugging
          const editableElements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
          editableElements.slice(0, 10).forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            console.error(`      ${i+1}. ${el.tagName}#${el.id}.${el.className} - ${rect.width}x${rect.height} - visible: ${rect.width > 0 && rect.height > 0}`);
          });

          return {
            success: false,
            message: element ? `Element ${element.tagName} is not typeable. Available editable elements: ${editableElements.length}` : `No focused element found. Try clicking on the input field first. Available editable elements: ${editableElements.length}`
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
          // Special handling for SharePoint/Office Online documents
          // Look for Office Online's canvas or document container
          const officeCanvases = [
            document.querySelector('#WACViewPanel_EditingElement'),  // Word Online
            document.querySelector('.CanvasElement'),                // Office canvas
            document.querySelector('[role="document"]'),             // Generic document role
            document.querySelector('#m_excelWebRenderer_ewaCtl_scrollableContainer'), // Excel Online
            document.querySelector('.ewaCtl_table')                  // Excel table
          ].filter(el => el !== null);

          if (officeCanvases.length > 0) {
            for (const canvas of officeCanvases) {
              if (canvas && canvas.scrollHeight > canvas.clientHeight) {
                console.log('   Using Office Online canvas:', {
                  tag: canvas.tagName,
                  class: canvas.className,
                  id: (canvas as HTMLElement).id
                });
                return canvas;
              }
            }
          }

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

          // Last resort: if nothing scrollable found, check if page is actually scrollable
          console.log('   ⚠️ No scrollable elements found, checking if page is scrollable...');
          console.log('   Page dimensions:', {
            bodyHeight: document.body.scrollHeight,
            windowHeight: window.innerHeight,
            scrollY: window.scrollY,
            isScrollable: document.body.scrollHeight > window.innerHeight
          });

          // Force window scroll even if it doesn't look scrollable - might be a detection issue
          return document.documentElement;
        };

        const scrollableElement = findScrollableElement();
        const isWindow = scrollableElement === document.documentElement;

        console.log('📍 Final scroll target:', {
          isWindow,
          element: isWindow ? 'document.documentElement (window)' : scrollableElement.tagName,
          className: isWindow ? 'n/a' : scrollableElement.className,
          currentScrollTop: scrollableElement.scrollTop,
          scrollHeight: scrollableElement.scrollHeight,
          clientHeight: scrollableElement.clientHeight,
          remainingScroll: scrollableElement.scrollHeight - scrollableElement.clientHeight - scrollableElement.scrollTop
        });

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

          console.log(`🔼 Attempting to scroll UP by ${scrollAmount}px from position ${beforeScroll}`);

          // Use scrollBy for window, scrollTop for elements (better compatibility)
          if (isWindow) {
            window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
          } else {
            // Use scrollTop for better compatibility with all elements
            const targetScroll = Math.max(0, scrollableElement.scrollTop - scrollAmount);
            scrollableElement.scrollTop = targetScroll;
          }

          setTimeout(() => {
            const afterScroll = scrollableElement.scrollTop;
            const actualDelta = beforeScroll - afterScroll;
            console.log(`   ✓ Scrolled up by ${actualDelta}px (from ${beforeScroll} to ${afterScroll})`);
          }, 100);
          return { success: true, message: `Scrolled up by ${scrollAmount}px from position ${beforeScroll}` };
        } else if (direction === 'down') {
          const scrollAmount = amount || 500;
          const beforeScroll = scrollableElement.scrollTop;
          const maxScroll = scrollableElement.scrollHeight - scrollableElement.clientHeight;

          console.log(`🔽 Attempting to scroll DOWN by ${scrollAmount}px from position ${beforeScroll} (max: ${maxScroll})`);

          // Use scrollBy for window, scrollTop for elements (better compatibility)
          if (isWindow) {
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          } else {
            // Use scrollTop for better compatibility with all elements
            const targetScroll = Math.min(maxScroll, scrollableElement.scrollTop + scrollAmount);
            console.log(`   Setting scrollTop from ${scrollableElement.scrollTop} to ${targetScroll}`);
            scrollableElement.scrollTop = targetScroll;
          }

          setTimeout(() => {
            const afterScroll = scrollableElement.scrollTop;
            const actualDelta = afterScroll - beforeScroll;
            console.log(`   ✓ Scrolled down by ${actualDelta}px (from ${beforeScroll} to ${afterScroll})`);
            if (actualDelta === 0 && beforeScroll < maxScroll) {
              console.warn(`   ⚠️ Scroll didn't move! This might indicate a scrolling issue with this element.`);
            }
          }, 100);
          return { success: true, message: `Scrolled down by ${scrollAmount}px from position ${beforeScroll} to ${Math.min(maxScroll, beforeScroll + scrollAmount)}` };
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
          // Ensure element is focused
          if (focusedElement instanceof HTMLElement) {
            focusedElement.focus();
          }

          // Special handling for Enter key - actually submit the form
          if (keyToPress === 'Enter') {
            // First try dispatching keyboard events with all required properties for Chrome
            const keyEventInit: KeyboardEventInit = {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              charCode: 13,
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window
            };

            // Dispatch beforeinput event for React apps
            const beforeInputEvent = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: '\n',
              inputType: 'insertLineBreak'
            });
            focusedElement.dispatchEvent(beforeInputEvent);

            const keydownEvent = new KeyboardEvent('keydown', keyEventInit);
            const keypressEvent = new KeyboardEvent('keypress', keyEventInit);
            const keyupEvent = new KeyboardEvent('keyup', keyEventInit);

            focusedElement.dispatchEvent(keydownEvent);
            focusedElement.dispatchEvent(keypressEvent);

            // Dispatch input event for React apps
            focusedElement.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              data: '\n',
              inputType: 'insertLineBreak'
            }));

            focusedElement.dispatchEvent(keyupEvent);

            // Check if this is a combobox/dropdown (react-select, etc.)
            // For these, we should ONLY dispatch keyboard events and let the component handle selection
            // Do NOT try to click submit buttons - that causes unintended side effects
            const isCombobox = focusedElement.getAttribute('role') === 'combobox' ||
                              focusedElement.getAttribute('aria-haspopup') === 'listbox' ||
                              focusedElement.getAttribute('aria-autocomplete') !== null;

            if (isCombobox) {
              console.log('   ⚡ Combobox/dropdown detected - letting component handle Enter');
              // For comboboxes, the keyboard events we dispatched above should trigger selection
              // We do NOT try to click buttons or submit forms
              return { success: true, message: 'Pressed Enter key (combobox selection)' };
            }

            // For regular input fields (not comboboxes), try to submit the parent form
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

              // If no form, check if this is a search input
              const isSearchInput = focusedElement.type === 'search' ||
                                   focusedElement.getAttribute('aria-label')?.toLowerCase().includes('search');

              // Only try to find nearby submit buttons for search inputs, not for all inputs
              if (isSearchInput) {
                const parentContainer = focusedElement.closest('div, section, fieldset, [role="search"]');
                if (parentContainer) {
                  const nearbyButton = parentContainer.querySelector('button[type="submit"], button[aria-label*="search" i]') as HTMLElement;
                  if (nearbyButton) {
                    console.log('   ✓ Clicking nearby search button');
                    nearbyButton.click();
                    return { success: true, message: 'Pressed Enter (clicked search button)' };
                  }
                }
              }
              // NOTE: For non-search inputs without forms, we just let the keyboard event propagate
            }

            return { success: true, message: 'Pressed Enter key' };
          }

          // For other keys, dispatch normal keyboard events
          // Map key names to proper key codes
          const getKeyCode = (key: string): string => {
            // Navigation keys
            if (key === 'ArrowUp') return 'ArrowUp';
            if (key === 'ArrowDown') return 'ArrowDown';
            if (key === 'ArrowLeft') return 'ArrowLeft';
            if (key === 'ArrowRight') return 'ArrowRight';
            if (key === 'PageUp') return 'PageUp';
            if (key === 'PageDown') return 'PageDown';
            if (key === 'Home') return 'Home';
            if (key === 'End') return 'End';

            // Special keys
            if (key === 'Tab') return 'Tab';
            if (key === 'Escape') return 'Escape';
            if (key === 'Enter') return 'Enter';
            if (key === 'Backspace') return 'Backspace';
            if (key === 'Delete') return 'Delete';
            if (key === 'Space' || key === ' ') return 'Space';

            // Function keys
            if (key.startsWith('F') && key.length <= 3) return key; // F1-F12

            // Letter keys get Key prefix
            if (key.length === 1 && key.match(/[A-Za-z]/)) {
              return `Key${key.toUpperCase()}`;
            }

            // Digit keys
            if (key.length === 1 && key.match(/[0-9]/)) {
              return `Digit${key}`;
            }

            // Default: return as-is
            return key;
          };

          // Get proper keyCode for compatibility with older apps
          const getKeyCodeValue = (key: string): number => {
            if (key === 'Enter') return 13;
            if (key === 'Escape') return 27;
            if (key === 'Backspace') return 8;
            if (key === 'Tab') return 9;
            if (key === 'Space' || key === ' ') return 32;
            if (key === 'PageUp') return 33;
            if (key === 'PageDown') return 34;
            if (key === 'End') return 35;
            if (key === 'Home') return 36;
            if (key === 'ArrowLeft') return 37;
            if (key === 'ArrowUp') return 38;
            if (key === 'ArrowRight') return 39;
            if (key === 'ArrowDown') return 40;
            if (key === 'Delete') return 46;

            // Letter keys
            if (key.length === 1 && key.match(/[A-Za-z]/)) {
              return key.toUpperCase().charCodeAt(0);
            }

            // Digit keys
            if (key.length === 1 && key.match(/[0-9]/)) {
              return key.charCodeAt(0);
            }

            return 0;
          };

          const keyCode = getKeyCodeValue(keyToPress);
          const code = getKeyCode(keyToPress);

          console.log(`⌨️  Pressing key: "${keyToPress}" (code: ${code}, keyCode: ${keyCode})`);

          const keyEventInit: KeyboardEventInit = {
            key: keyToPress,
            code: code,
            keyCode: keyCode,
            which: keyCode,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
          };

          // Dispatch beforeinput for printable characters
          if (keyToPress.length === 1) {
            focusedElement.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: keyToPress,
              inputType: 'insertText'
            }));
          }

          focusedElement.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
          focusedElement.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));

          // IMPORTANT: Synthetic keyboard events have isTrusted=false and browsers
          // won't perform default actions (scrolling, navigation, etc.) for security.
          // We need to manually implement the default behavior for navigation keys.

          // Manually perform default action for navigation keys
          if (keyToPress === 'PageDown') {
            console.log('   ↳ Manually scrolling page down (synthetic events cannot trigger default scroll)');
            window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
          } else if (keyToPress === 'PageUp') {
            console.log('   ↳ Manually scrolling page up (synthetic events cannot trigger default scroll)');
            window.scrollBy({ top: -window.innerHeight, behavior: 'smooth' });
          } else if (keyToPress === 'ArrowDown') {
            console.log('   ↳ Manually scrolling down (synthetic events cannot trigger default scroll)');
            window.scrollBy({ top: 40, behavior: 'smooth' });
          } else if (keyToPress === 'ArrowUp') {
            console.log('   ↳ Manually scrolling up (synthetic events cannot trigger default scroll)');
            window.scrollBy({ top: -40, behavior: 'smooth' });
          } else if (keyToPress === 'Home') {
            console.log('   ↳ Manually scrolling to top (synthetic events cannot trigger default scroll)');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (keyToPress === 'End') {
            console.log('   ↳ Manually scrolling to bottom (synthetic events cannot trigger default scroll)');
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }

          // Dispatch input for printable characters
          if (keyToPress.length === 1) {
            focusedElement.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              data: keyToPress,
              inputType: 'insertText'
            }));
          }

          focusedElement.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

          return { success: true, message: `Pressed ${keyToPress} key` };
        }
        return { success: false, message: 'No focused element to send key to' };

      case 'clear_input':
        // Clear the currently focused input field
        const activeEl = document.activeElement as HTMLInputElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
          // Clear value directly (avoid execCommand which can trigger CSP violations)
          if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
            // Use native setter for React compatibility
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value'
            )?.set;

            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(activeEl, '');
            } else {
              activeEl.value = '';
            }
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
            activeEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            activeEl.textContent = '';
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
            activeEl.dispatchEvent(new Event('change', { bubbles: true }));
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

// Listen for messages from background script or sidebar
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'PING') {
    // Respond to ping to confirm content script is loaded
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'GET_PAGE_CONTEXT') {
    const context = extractPageContext();
    console.log('📄 GET_PAGE_CONTEXT payload:', context);
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
let automationOverlay: HTMLDivElement | null = null;
let automationButton: HTMLDivElement | null = null;
let isUserAborted = false; // Track if user manually aborted

// Track recently clicked elements for better type targeting
let recentlyClickedElement: HTMLElement | null = null;
let recentlyClickedTimestamp = 0;

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

  console.log('🔵 Showing browser automation indicator');

  // Create small floating indicator badge (no interference with clicks)
  // Use DOM manipulation instead of innerHTML to prevent XSS
  automationOverlay = document.createElement('div');
  automationOverlay.id = 'atlas-automation-indicator';
  
  const indicatorContainer = document.createElement('div');
  indicatorContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, rgba(0, 122, 255, 0.95) 0%, rgba(0, 81, 213, 0.95) 100%);
    backdrop-filter: blur(10px);
    color: white;
    padding: 10px 16px;
    border-radius: 24px;
    font-size: 13px;
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 4px 16px rgba(0, 122, 255, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
    animation: atlasIndicatorSlideIn 0.3s ease-out;
  `;
  
  const statusDot = document.createElement('div');
  statusDot.style.cssText = `
    width: 8px;
    height: 8px;
    background: #00ff88;
    border-radius: 50%;
    box-shadow: 0 0 8px #00ff88;
    animation: atlasIndicatorPulse 2s ease-in-out infinite;
  `;
  
  const statusText = document.createElement('span');
  statusText.textContent = 'AI Automation Active';
  
  const abortButton = document.createElement('button');
  abortButton.id = 'atlas-abort-btn';
  abortButton.textContent = 'Stop';
  abortButton.style.cssText = `
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: white;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    pointer-events: auto;
  `;
  
  indicatorContainer.appendChild(statusDot);
  indicatorContainer.appendChild(statusText);
  indicatorContainer.appendChild(abortButton);
  automationOverlay.appendChild(indicatorContainer);
  automationOverlay.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999;
    pointer-events: none;
  `;

  // Add animation styles if not already present
  if (!document.getElementById('atlas-indicator-animation')) {
    const style = document.createElement('style');
    style.id = 'atlas-indicator-animation';
    style.textContent = `
      @keyframes atlasIndicatorSlideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes atlasIndicatorPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(1.2); }
      }
    `;
    document.head.appendChild(style);
  }

  // Handle stop button click and hover events
  const stopBtn = automationOverlay.querySelector('#atlas-abort-btn') as HTMLElement;
  if (stopBtn) {
    // Add hover event listeners (replacing inline handlers to avoid CSP violations)
    stopBtn.addEventListener('mouseover', () => {
      stopBtn.style.background = 'rgba(255, 255, 255, 0.3)';
    });
    stopBtn.addEventListener('mouseout', () => {
      stopBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    });

    // Add click event listener
    stopBtn.addEventListener('click', () => {
      console.log('🛑 Stop button clicked');
      isUserAborted = true;
      setTimeout(() => {
        isUserAborted = false;
        console.log('✅ User abort flag cleared - ready for new operations');
      }, 5000);
      hideBrowserAutomationOverlay();
      chrome.runtime.sendMessage({ type: 'ABORT_BROWSER_AUTOMATION' }, () => {
        if (chrome.runtime.lastError) {
          console.log('Sidepanel not responding (this is OK)');
        }
      });
    });
  }

  document.body.appendChild(automationOverlay);
}

function hideBrowserAutomationOverlay() {
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
