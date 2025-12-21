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
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

/**
 * Sign in with Google using OAuth2
 * Uses Google Identity Services to get ID token via popup-like flow
 */
export async function signInWithGoogle(): Promise<{
  success: boolean;
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

    // Use Google Sign-In with popup-like experience
    return new Promise((resolve) => {
      // Create a hidden container for the button
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '50%';
      container.style.left = '50%';
      container.style.transform = 'translate(-50%, -50%)';
      container.style.zIndex = '10000';
      container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      
      const buttonContainer = document.createElement('div');
      buttonContainer.style.backgroundColor = 'white';
      buttonContainer.style.padding = '20px';
      buttonContainer.style.borderRadius = '8px';
      container.appendChild(buttonContainer);
      
      document.body.appendChild(container);

      if (!window.google) {
        document.body.removeChild(container);
        resolve({ success: false, error: 'Google Identity Services not loaded' });
        return;
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID!,
        callback: async (response: { credential: string }) => {
          document.body.removeChild(container);
          
          if (!response.credential) {
            resolve({ success: false, error: 'No credential received' });
            return;
          }

          // Verify token with backend
          const result = await signInWithGoogleIdToken(response.credential);
          resolve(result);
        },
      });

      // Render button in the popup
      window.google.accounts.id.renderButton(buttonContainer, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
      });

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.position = 'absolute';
      closeBtn.style.top = '10px';
      closeBtn.style.right = '10px';
      closeBtn.style.background = 'none';
      closeBtn.style.border = 'none';
      closeBtn.style.fontSize = '24px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.onclick = () => {
        document.body.removeChild(container);
        resolve({ success: false, error: 'Sign-in cancelled' });
      };
      container.appendChild(closeBtn);
    });
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Sign in with Google using ID token (from Google Sign-In button)
 * This is the recommended approach
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<{
  success: boolean;
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

