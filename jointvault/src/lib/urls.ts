export function canonicalizeUrl(raw: string): string {
  const input = raw.trim();
  if (!input) return input;
  let url: URL;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
    url = new URL(withScheme);
  } catch {
    return input;
  }
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'twitter.com' || host.endsWith('.twitter.com')) {
    host = host === 'twitter.com' ? 'x.com' : `${host.slice(0, -'twitter.com'.length)}x.com`;
  }
  // YouTube: video kimliği query'dedir — tamamını atmak tüm videoları
  // tek satıra çökertir. ?v= korunur, liste/zaman/paylaşım gürültüsü atılır;
  // youtu.be/<id> aynı forma birleşir.
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (url.pathname.startsWith('/shorts/')) {
      const id = url.pathname.split('/').filter(Boolean)[1] ?? '';
      return `https://www.youtube.com/watch?v=${id}`;
    }
  }
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '/') path = '';
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${path}`;
}

export function isKnownUrl(existing: Iterable<string>, candidate: string): boolean {
  const want = canonicalizeUrl(candidate);
  const known = new Set<string>();
  for (const e of existing) known.add(canonicalizeUrl(e));
  return known.has(want);
}
