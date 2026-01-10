// Google OAuth2 authentication service (replaces Firebase)

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(
  import.meta.env.VITE_CF_API_BASE as string | undefined
);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function assertApiBase() {
  if (!API_BASE) {
    throw new Error(
      "VITE_CF_API_BASE is not set. Provide your Cloudflare Worker/Pages API base URL."
    );
  }
}

function assertGoogleConfig() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID is not set. Please configure Google OAuth credentials."
    );
  }
}

/**
 * Initialize Google OAuth2
 * Loads the Google Identity Services library
 * 
 * IMPORTANT: To fix "origin not allowed" errors:
 * 1. Go to Google Cloud Console: https://console.cloud.google.com/
 * 2. Select your project
 * 3. Go to APIs & Services > Credentials
 * 4. Click on your OAuth 2.0 Client ID
 * 5. Add your origin to "Authorized JavaScript origins":
 *    - For local dev: http://localhost:5173, http://localhost:3000, etc.
 *    - For production: https://yourdomain.com
 * 6. Add redirect URIs to "Authorized redirect URIs" if needed
 * 7. Save changes and wait a few minutes for propagation
 */
export function initGoogleAuth(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      const currentOrigin = window.location.origin;
      reject(new Error(
        `Failed to load Google Identity Services. ` +
        `Please check your internet connection and ensure ${currentOrigin} is authorized in Google Cloud Console.`
      ));
    };
    document.head.appendChild(script);
  });
}

/**
 * Sign in with Google using OAuth2
 * Uses Google Identity Services One Tap or prompt for faster sign-in
 */
export async function signInWithGoogle(): Promise<{
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    display_name?: string;
    photo_url?: string;
    auth_provider: string;
    roles: string[];
  };
  error?: string;
}> {
  assertApiBase();
  assertGoogleConfig();

  try {
    // Initialize Google Auth if not already loaded
    await initGoogleAuth();

    if (!window.google?.accounts) {
      return { success: false, error: 'Google Identity Services not loaded. Please check your internet connection and try again.' };
    }

    // Use button-based flow (simpler and more reliable)
    return new Promise((resolve) => {
      let resolved = false;

      // Create overlay with button
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        padding: 2rem;
        border-radius: 8px;
        max-width: 400px;
        width: 90%;
        text-align: center;
        position: relative;
      `;

      const title = document.createElement('h2');
      title.textContent = 'Sign in with Google';
      title.style.cssText = 'margin: 0 0 1rem 0; font-size: 1.25rem; color: #333;';
      modal.appendChild(title);

      const buttonContainer = document.createElement('div');
      buttonContainer.id = 'google-signin-button-container-' + Date.now();
      modal.appendChild(buttonContainer);

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        color: #666;
      `;
      closeBtn.onclick = () => {
        if (overlay.parentNode) {
          document.body.removeChild(overlay);
        }
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: 'Sign-in cancelled' });
        }
      };
      modal.appendChild(closeBtn);

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Initialize and render button
      try {
        if (!window.google?.accounts?.id) {
          throw new Error('Google Identity Services not available');
        }

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID!,
          callback: async (response: { credential: string }) => {
            if (overlay.parentNode) {
              document.body.removeChild(overlay);
            }
            
            if (!response.credential) {
              if (!resolved) {
                resolved = true;
                resolve({ success: false, error: 'No credential received' });
              }
              return;
            }

            // Verify token with backend
            try {
              const result = await signInWithGoogleIdToken(response.credential);
              if (!resolved) {
                resolved = true;
                resolve(result);
              }
            } catch (error) {
              if (!resolved) {
                resolved = true;
                resolve({ success: false, error: (error as Error).message });
              }
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Render button
        window.google.accounts.id.renderButton(buttonContainer, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          width: 300,
        });
      } catch (error) {
        if (overlay.parentNode) {
          document.body.removeChild(overlay);
        }
        if (!resolved) {
          resolved = true;
          const errorMsg = (error as Error).message;
          const currentOrigin = window.location.origin;
          let helpfulMsg = errorMsg;
          
          if (errorMsg.includes('origin') || errorMsg.includes('403') || errorMsg.includes('not allowed') || errorMsg.includes('GSI_LOGGER')) {
            helpfulMsg = `Origin "${currentOrigin}" is not authorized.\n\n` +
              `Please add it to Google Cloud Console:\n` +
              `1. Go to: https://console.cloud.google.com/apis/credentials\n` +
              `2. Click your OAuth 2.0 Client ID\n` +
              `3. Add "${currentOrigin}" to "Authorized JavaScript origins"\n` +
              `4. Save and wait a few minutes`;
          } else {
            helpfulMsg = `Failed to initialize Google Sign-In: ${errorMsg}. Please check that your origin (${currentOrigin}) is authorized in Google Cloud Console.`;
          }
          
          resolve({ 
            success: false, 
            error: helpfulMsg
          });
        }
      }
    });
  } catch (error) {
    const errorMsg = (error as Error).message;
    const currentOrigin = window.location.origin;
    
    // Provide helpful error message for common issues
    let helpfulMsg = errorMsg;
    if (errorMsg.includes('origin') || errorMsg.includes('403') || errorMsg.includes('not allowed')) {
      helpfulMsg = `Origin not authorized. Please add "${currentOrigin}" to Authorized JavaScript origins in Google Cloud Console:\n\n` +
        `1. Go to: https://console.cloud.google.com/apis/credentials\n` +
        `2. Click your OAuth 2.0 Client ID\n` +
        `3. Add "${currentOrigin}" to "Authorized JavaScript origins"\n` +
        `4. Save and wait a few minutes for changes to propagate`;
    }
    
    return { 
      success: false, 
      error: helpfulMsg
    };
  }
}

/**
 * Sign in with Google using ID token (from Google Sign-In button)
 * This is the recommended approach
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<{
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    display_name?: string;
    photo_url?: string;
    auth_provider: string;
    roles: string[];
  };
  error?: string;
}> {
  assertApiBase();

  try {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id_token: idToken }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Request failed' }));
      return { success: false, error: error.error || 'Authentication failed' };
    }

    const data = await res.json();
    return data;
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Render Google Sign-In button
 * Returns a callback that will be called with the credential (ID token)
 */
export function renderGoogleSignInButton(
  elementId: string,
  onSuccess: (credential: { credential: string }) => void,
  onError?: (error: string) => void
): void {
  assertGoogleConfig();

  initGoogleAuth().then(() => {
    if (!window.google) {
      onError?.('Google Identity Services not loaded');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID!,
      callback: (response: { credential: string }) => {
        if (response.credential) {
          onSuccess(response);
        } else {
          onError?.('No credential received');
        }
      },
    });

    window.google.accounts.id.renderButton(
      document.getElementById(elementId)!,
      {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 300,
      }
    );
  }).catch((error) => {
    onError?.((error as Error).message);
  });
}

// Extend Window interface for Google APIs
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (element: HTMLElement, config?: {
            type?: string;
            theme?: string;
            size?: string;
            text?: string;
            width?: number;
          }) => void;
          prompt: (callback?: (notification: {
            isNotDisplayed: boolean;
            isSkippedMoment: boolean;
            isDismissedMoment: boolean;
          }) => void) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: () => void;
          };
        };
      };
    };
  }
}

