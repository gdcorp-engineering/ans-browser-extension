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
        visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      };
    })
    .filter(el => el.visible); // Only return visible elements

  const getMetaContent = (name: string): string | undefined => {
    const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return meta?.getAttribute('content') || undefined;
  };

  return {
    url: window.location.href,
    title: document.title,
    textContent: document.body.innerText.slice(0, 10000), // Limit to 10k chars
    links,
    images,
    forms,
    interactiveElements, // NEW: List of clickable elements with selectors
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

          // Add visual debug marker at click coordinates
          const debugMarker = document.createElement('div');
          debugMarker.style.cssText = `
            position: fixed;
            left: ${coordinates.x}px;
            top: ${coordinates.y}px;
            width: 20px;
            height: 20px;
            background: red;
            border: 3px solid yellow;
            border-radius: 50%;
            z-index: 999999;
            pointer-events: none;
            transform: translate(-50%, -50%);
          `;
          document.body.appendChild(debugMarker);
          setTimeout(() => debugMarker.remove(), 3000);

          let element = document.elementFromPoint(coordinates.x, coordinates.y) as HTMLElement;
          console.log(`🎯 Element at coordinates:`, element?.tagName, element?.className);

          if (element) {
            const rect = element.getBoundingClientRect();
            console.log(`📦 Element bounds: left=${Math.round(rect.left)}, top=${Math.round(rect.top)}, width=${Math.round(rect.width)}, height=${Math.round(rect.height)}`);
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

            // Dispatch full mouse event sequence
            ['mousedown', 'mouseup', 'click'].forEach(eventType => {
              const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: coordinates.x,
                clientY: coordinates.y
              });
              element.dispatchEvent(event);
            });

            // If it's an input field, explicitly focus it
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' ||
                element.getAttribute('contenteditable') === 'true') {
              console.log(`💡 Focusing input field: ${element.tagName}`);
              element.focus();
            }

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

          // Try to find element by selector if provided
          if (target && !target.includes(':focus')) {
            element = document.querySelector(target) as HTMLElement;
          }

          // If no element found or selector was for focused elements, use the currently focused element
          if (!element) {
            element = document.activeElement as HTMLElement;
          }

          // If element is BODY (nothing focused), try to find a visible search/text input
          if (element && element.tagName === 'BODY') {
            console.log('💡 Nothing focused, searching for visible input field...');

            // Try to find common search input selectors
            const searchSelectors = [
              'input[type="search"]',
              'input[name*="search" i]',
              'input[id*="search" i]',
              'input[placeholder*="search" i]',
              'input[aria-label*="search" i]',
              'input[type="text"][name="q"]', // Common search param
              'input[type="text"]:not([type="hidden"])', // Any visible text input
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
                    inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                    inputElement.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
                    inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));


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
        if (direction === 'top' || target === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return { success: true, message: 'Scrolled to top' };
        } else if (direction === 'bottom' || target === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          return { success: true, message: 'Scrolled to bottom' };
        } else if (direction === 'up') {
          window.scrollBy({ top: -(amount || 300), behavior: 'smooth' });
          return { success: true, message: `Scrolled up by ${amount || 300}px` };
        } else if (direction === 'down') {
          window.scrollBy({ top: (amount || 300), behavior: 'smooth' });
          return { success: true, message: `Scrolled down by ${amount || 300}px` };
        } else if (selector || target) {
          const element = document.querySelector(selector || target!);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { success: true, message: `Scrolled to: ${selector || target}` };
          }
          return { success: false, message: `Element not found: ${selector || target}` };
        }
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
        // Press a specific key on the currently focused element
        const keyToPress = (key || value || target || 'Enter') as string;
        const focusedElement = document.activeElement;

        if (focusedElement) {
          const keyEventInit: KeyboardEventInit = {
            key: keyToPress,
            code: keyToPress === 'Enter' ? 'Enter' : keyToPress === 'Tab' ? 'Tab' : keyToPress === 'Escape' ? 'Escape' : `Key${keyToPress}`,
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

// Listen for messages from background script or sidebar
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'PING') {
    // Respond to ping to confirm content script is loaded
    sendResponse({ success: true });
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
