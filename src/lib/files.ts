/**
 * Hands a text file to the user: the system share sheet on phones (so it can go to
 * Files, Drive, WhatsApp...), a normal download everywhere else.
 */
export async function saveTextFile(name: string, text: string, mime: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], name, { type: mime });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
