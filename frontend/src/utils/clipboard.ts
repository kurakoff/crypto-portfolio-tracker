/**
 * Copy text to clipboard with fallback for HTTP (non-secure) contexts.
 * navigator.clipboard requires HTTPS, so we fall back to execCommand.
 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
    return;
  }

  // Fallback: create a temporary textarea
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
