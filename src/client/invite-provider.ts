declare const __NATIVE_INVITE_ORIGIN__: string;
/** Set only by an operator's game build after the endpoint is actually owned/deployed. */
export function nativeInviteOrigin(): string | null {
  const value = typeof __NATIVE_INVITE_ORIGIN__ === 'string' ? __NATIVE_INVITE_ORIGIN__ : '';
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password ? value : null; }
  catch { return null; }
}
