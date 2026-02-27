/**
 * Retry D1 database query with exponential backoff
 * Handles D1 overload errors by retrying with delays
 */
export async function retryD1Query(queryFn, maxRetries = 3, initialDelay = 100) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error;
      const errorMsg = error?.message || String(error);
      
      // Only retry on D1 overload errors
      if (errorMsg.includes('D1_ERROR') || 
          errorMsg.includes('overloaded') || 
          errorMsg.includes('queued for too long') ||
          errorMsg.includes('D1_DATABASE_ERROR')) {
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delay = initialDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      // For other errors, throw immediately
      throw error;
    }
  }
  throw lastError;
}
