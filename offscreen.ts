// Offscreen document for microphone access
// This is required because sidepanels cannot use getUserMedia directly

let mediaRecorder: MediaRecorder | null = null;
let audioStream: MediaStream | null = null;
let audioChunks: Blob[] = [];

// Log that offscreen document is ready
console.log('[Offscreen] Offscreen document loaded and ready');
console.log('[Offscreen] Document URL:', window.location.href);
console.log('[Offscreen] Extension ID:', chrome.runtime.id);

// Listen for messages from the sidepanel (via background script)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Offscreen] ====== MESSAGE RECEIVED ======');
  console.log('[Offscreen] Message type:', request?.type);
  console.log('[Offscreen] Request ID:', request?.requestId);
  console.log('[Offscreen] Sender URL:', sender?.url || 'unknown');
  console.log('[Offscreen] Full request:', JSON.stringify(request, null, 2));
  
  // Validate request
  if (!request || !request.type) {
    console.error('[Offscreen] Invalid message received:', request);
    return false;
  }
  
  // Handle ping for readiness check
  if (request.type === 'PING') {
    console.log('[Offscreen] Responding to ping');
    sendResponse({ type: 'PONG', ready: true });
    return true;
  }
  
  if (request.type === 'START_RECORDING') {
    console.log('[Offscreen] Handling START_RECORDING request...');
    
    // Use chrome.runtime.sendMessage to send response back (not sendResponse)
    // because background script is listening via onMessage, not sendMessage callback
    startRecording()
      .then(() => {
        const response = { 
          type: 'RECORDING_RESPONSE',
          success: true, 
          requestId: request.requestId 
        };
        console.log('[Offscreen] Sending success response via sendMessage:', JSON.stringify(response));
        
        chrome.runtime.sendMessage(response)
          .then(() => {
            console.log('[Offscreen] ✅ Response sent successfully');
          })
          .catch((err: any) => {
            console.error('[Offscreen] ❌ Failed to send response:', err);
            // Fallback: try sendResponse
            try {
              sendResponse({ success: true, requestId: request.requestId });
            } catch (sendErr) {
              console.error('[Offscreen] ❌ Fallback sendResponse also failed:', sendErr);
            }
          });
      })
      .catch((error: any) => {
        console.error('[Offscreen] ❌ Error starting recording:', error);
        console.error('[Offscreen] Error name:', error.name);
        console.error('[Offscreen] Error message:', error.message);
        console.error('[Offscreen] Error stack:', error.stack);
        const errorMsg = error.message || error.name || 'Failed to start recording';
        const response = { 
          type: 'RECORDING_RESPONSE',
          success: false, 
          error: errorMsg,
          requestId: request.requestId
        };
        console.log('[Offscreen] Sending error response via sendMessage:', JSON.stringify(response));
        
        chrome.runtime.sendMessage(response)
          .then(() => {
            console.log('[Offscreen] ✅ Error response sent successfully');
          })
          .catch((err: any) => {
            console.error('[Offscreen] ❌ Failed to send error response:', err);
            // Fallback: try sendResponse
            try {
              sendResponse({ success: false, error: errorMsg, requestId: request.requestId });
            } catch (sendErr) {
              console.error('[Offscreen] ❌ Fallback sendResponse also failed:', sendErr);
            }
          });
      });
    
    return true; // Keep channel open (though we're not using sendResponse)
  }

  if (request.type === 'STOP_RECORDING') {
    console.log('[Offscreen] Handling STOP_RECORDING request...');
    
    // Generate requestId if not provided (for compatibility)
    const requestId = request.requestId || `stop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    stopRecording()
      .then((audioBlob) => {
        console.log('[Offscreen] Recording stopped, converting to base64...');
        // Convert blob to base64 for transmission
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          const response = { 
            type: 'RECORDING_RESPONSE',
            success: true, 
            audioBlob: base64Audio,
            mimeType: mediaRecorder?.mimeType || 'audio/webm',
            requestId: requestId
          };
          console.log('[Offscreen] Audio converted, size:', base64Audio.length);
          console.log('[Offscreen] Sending STOP_RECORDING response:', JSON.stringify({ ...response, audioBlob: '...' }));
          
          chrome.runtime.sendMessage(response)
            .then(() => {
              console.log('[Offscreen] ✅ STOP_RECORDING response sent successfully');
            })
            .catch((err: any) => {
              console.error('[Offscreen] ❌ Failed to send STOP_RECORDING response:', err);
              // Fallback: try sendResponse
              try {
                sendResponse({ success: true, audioBlob: base64Audio, mimeType: mediaRecorder?.mimeType || 'audio/webm', requestId: requestId });
                console.log('[Offscreen] ✅ Fallback sendResponse succeeded');
              } catch (sendErr) {
                console.error('[Offscreen] ❌ Fallback sendResponse also failed:', sendErr);
              }
            });
        };
        reader.onerror = () => {
          console.error('[Offscreen] Failed to convert audio to base64');
          const errorResponse = { 
            type: 'RECORDING_RESPONSE',
            success: false, 
            error: 'Failed to convert audio to base64',
            requestId: requestId
          };
          chrome.runtime.sendMessage(errorResponse).catch(() => {
            try {
              sendResponse({ success: false, error: 'Failed to convert audio to base64', requestId: requestId });
            } catch (sendErr) {
              console.error('[Offscreen] ❌ Fallback sendResponse failed:', sendErr);
            }
          });
        };
        reader.readAsDataURL(audioBlob);
      })
      .catch((error: any) => {
        console.error('[Offscreen] Error stopping recording:', error);
        const errorResponse = { 
          type: 'RECORDING_RESPONSE',
          success: false, 
          error: error.message || 'Failed to stop recording',
          requestId: requestId
        };
        chrome.runtime.sendMessage(errorResponse).catch(() => {
          try {
            sendResponse({ success: false, error: error.message || 'Failed to stop recording', requestId: requestId });
          } catch (sendErr) {
            console.error('[Offscreen] ❌ Fallback sendResponse failed:', sendErr);
          }
        });
      });
    return true; // Keep channel open
  }

  if (request.type === 'CHECK_PERMISSION' || request.type === 'CHECK_MIC_PERMISSION') {
    checkMicrophonePermission()
      .then((hasPermission) => {
        sendResponse({ hasPermission, requestId: request.requestId });
      })
      .catch((error: any) => {
        sendResponse({ 
          hasPermission: false, 
          error: error.message,
          requestId: request.requestId
        });
      });
    return true;
  }
  
  // Return false for unhandled messages
  return false;
});

async function checkMicrophonePermission(): Promise<boolean> {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return false;
    }
    
    // Try to get user media to check permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    return false;
  }
}

async function startRecording(): Promise<void> {
  try {
    console.log('[Offscreen] Starting recording in offscreen document...');
    
    // Check if already recording
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.warn('[Offscreen] Recording already in progress, state:', mediaRecorder.state);
      throw new Error('Recording is already in progress');
    }
    
    // Clean up any existing stream/recorder
    if (audioStream) {
      console.log('[Offscreen] Cleaning up existing audio stream');
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    if (mediaRecorder) {
      console.log('[Offscreen] Cleaning up existing mediaRecorder');
      mediaRecorder = null;
    }
    audioChunks = [];
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported');
    }

    // Request microphone access directly
    // Note: Extension offscreen document needs its own microphone permission (separate from website)
    console.log('[Offscreen] Requesting microphone access...');
    console.log('[Offscreen] Extension needs its own microphone permission (separate from site permission)');
    
    try {
      // Request microphone - this will show a prompt if permission hasn't been granted
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('[Offscreen] ✅ getUserMedia succeeded, stream obtained');
    } catch (getUserMediaError: any) {
      console.error('[Offscreen] getUserMedia failed:', getUserMediaError.name, getUserMediaError.message);
      
      // Clean up on error
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
      }
      
      // Handle permission errors
      if (getUserMediaError.name === 'NotAllowedError' || getUserMediaError.name === 'PermissionDeniedError') {
        // Check permission state to provide better error message
        let permissionState = 'unknown';
        try {
          if (navigator.permissions && navigator.permissions.query) {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            permissionState = permissionStatus.state;
            console.log('[Offscreen] Permission state after error:', permissionState);
          }
        } catch (permError) {
          console.log('[Offscreen] Could not query permission state');
        }
        
        // Provide concise error message
        if (permissionState === 'denied') {
          throw new Error('Microphone permission denied. Remove and reinstall the extension to reset permissions.');
        } else {
          throw new Error('Microphone permission denied. Click the button again and allow access when prompted.');
        }
      }
      
      // Re-throw other errors
      throw getUserMediaError;
    }

    console.log('Microphone access granted, stream:', audioStream);
    console.log('Audio tracks:', audioStream.getAudioTracks());

    if (audioStream.getAudioTracks().length === 0) {
      throw new Error('No audio tracks available in the stream');
    }

    // Check which MIME types are supported
    const supportedTypes = [
      'audio/webm',
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav'
    ];
    
    let mimeType = 'audio/webm';
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        console.log('Using MIME type:', mimeType);
        break;
      }
    }

    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: mimeType
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      console.log('[Offscreen] Data available, size:', event.data.size);
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    // Handle stream disconnection
    if (audioStream) {
      audioStream.getTracks().forEach(track => {
        track.onended = () => {
          console.warn('[Offscreen] Audio track ended unexpectedly');
          // If recording is active, this is a problem
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            console.error('[Offscreen] Audio stream lost during recording');
          }
        };
      });
    }

    // Create promise FIRST, then set up handlers, then call start()
    // This prevents race condition where onstart fires before handlers are ready
    let startResolve: (() => void) | null = null;
    let startReject: ((error: Error) => void) | null = null;
    let startTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Create the promise and assign resolve/reject
    const startPromise = new Promise<void>((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
    });
    
    // NOW set up event handlers (after promise is created)
    mediaRecorder.onstart = () => {
      console.log('[Offscreen] MediaRecorder onstart fired, state:', mediaRecorder?.state);
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      if (startResolve) {
        startResolve();
        startResolve = null;
        startReject = null;
      }
    };
    
    // Combined error handler for both start and recording errors
    mediaRecorder.onerror = (event: any) => {
      console.error('[Offscreen] MediaRecorder error:', event.error);
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      // If we're waiting for start, reject the promise
      if (startReject) {
        startReject(new Error(event.error?.message || 'MediaRecorder error'));
        startResolve = null;
        startReject = null;
      } else {
        // Error during recording (not during start)
        console.error('[Offscreen] Error during recording - user may need to stop manually');
      }
    };

    // Start recording with timeslice to get data chunks
    console.log('[Offscreen] Calling mediaRecorder.start()...');
    mediaRecorder.start(100); // Get data every 100ms
    console.log('[Offscreen] mediaRecorder.start() called, state:', mediaRecorder.state);
    
    // Check if already recording (some browsers start synchronously)
    // Do this BEFORE setting timeout to avoid race condition
    if (mediaRecorder.state === 'recording') {
      console.log('[Offscreen] MediaRecorder started synchronously');
      if (startResolve) {
        startResolve();
        startResolve = null;
        startReject = null;
      }
      // No need to wait or set timeout
    } else {
      // Set up timeout AFTER start() is called (only if not already recording)
      startTimeout = setTimeout(() => {
        startTimeout = null;
        if (mediaRecorder.state !== 'recording' && startReject) {
          const error = new Error('MediaRecorder failed to start - still in state: ' + mediaRecorder.state);
          startReject(error);
          startResolve = null;
          startReject = null;
        }
      }, 2000);
      
      // Wait for onstart event to confirm recording actually started
      await startPromise;
    }
    
    console.log('[Offscreen] ✅ Recording confirmed started, state:', mediaRecorder.state);
  } catch (error: any) {
    console.error('Error in startRecording:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    // Clean up on error
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    // Clean up MediaRecorder if it was created
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (stopError) {
        // Ignore errors when stopping
      }
    }
    mediaRecorder = null;
    
    // Provide user-friendly error messages
    let errorMessage = error.message || 'Failed to start recording';
    let errorName = error.name || 'UnknownError';
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage = 'Microphone permission denied. Click again and allow access, or reinstall the extension to reset permissions.';
      errorName = 'PermissionDeniedError';
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      errorMessage = 'No microphone found. Connect a microphone and try again.';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage = 'Microphone is in use by another app. Close other apps and try again.';
    } else if (error.name === 'OverconstrainedError') {
      errorMessage = 'Microphone does not meet requirements.';
    }
    
    const enhancedError = new Error(errorMessage);
    enhancedError.name = errorName;
    throw enhancedError;
  }
}

async function stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    console.log('[Offscreen] stopRecording called, mediaRecorder state:', mediaRecorder?.state);
    
    if (!mediaRecorder) {
      console.warn('[Offscreen] No mediaRecorder instance, nothing to stop');
      reject(new Error('No active recording to stop'));
      return;
    }
    
    if (mediaRecorder.state === 'inactive') {
      console.warn('[Offscreen] Recording already stopped');
      // If already stopped but we have chunks, return them
      if (audioChunks.length > 0) {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];
        resolve(audioBlob);
        return;
      }
      reject(new Error('Recording is already stopped'));
      return;
    }
    
    // Prevent multiple stop calls
    if (mediaRecorder.state === 'stopping') {
      console.warn('[Offscreen] Stop already in progress');
      reject(new Error('Stop already in progress'));
      return;
    }

    // Set timeout in case onstop never fires
    const timeout = setTimeout(() => {
      console.error('[Offscreen] Timeout waiting for onstop event');
      // Clean up and return whatever chunks we have
      if (audioChunks.length > 0) {
        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];
        if (audioStream) {
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
        }
        mediaRecorder = null;
        resolve(audioBlob);
      } else {
        reject(new Error('Timeout waiting for recording to stop'));
      }
    }, 5000); // 5 second timeout

    // Set up stop handler BEFORE calling stop()
    mediaRecorder.onstop = () => {
      clearTimeout(timeout); // Clear timeout since we got the event
      console.log('[Offscreen] MediaRecorder stopped, chunks:', audioChunks.length);
      if (audioChunks.length > 0) {
        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        console.log('[Offscreen] Audio blob created, size:', audioBlob.size, 'type:', audioBlob.type);
        
        // Clean up
        if (audioStream) {
          audioStream.getTracks().forEach(track => {
            track.stop();
            console.log('[Offscreen] Stopped audio track:', track.label);
          });
          audioStream = null;
        }
        const recorder = mediaRecorder;
        mediaRecorder = null;
        audioChunks = [];
        
        resolve(audioBlob);
      } else {
        console.warn('[Offscreen] No audio chunks recorded');
        // Still clean up even if no chunks
        if (audioStream) {
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
        }
        mediaRecorder = null;
        audioChunks = [];
        reject(new Error('No audio data recorded'));
      }
    };

    // Also handle errors
    mediaRecorder.onerror = (event: any) => {
      clearTimeout(timeout); // Clear timeout on error
      console.error('[Offscreen] MediaRecorder error during stop:', event.error);
      // Clean up on error
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      reject(new Error(event.error?.message || 'MediaRecorder error'));
    };

    try {
      console.log('[Offscreen] Calling mediaRecorder.stop()...');
      mediaRecorder.stop();
      console.log('[Offscreen] mediaRecorder.stop() called, waiting for onstop event...');
    } catch (error: any) {
      console.error('[Offscreen] Error calling mediaRecorder.stop():', error);
      reject(error);
    }
  });
}

