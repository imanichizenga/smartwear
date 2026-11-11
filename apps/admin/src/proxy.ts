import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/setup', '/invite'];

/** Cheap gate: no admin cookie → login. The API re-checks the session (and 2FA) on every call. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = Boolean(req.cookies.get('sw_admin')?.value);
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|realtime|_next/static|_next/image|icon.svg|apple-icon.png|favicon.ico).*)'] };
