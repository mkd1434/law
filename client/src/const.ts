export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * 로그인 URL 생성 함수
 * 런타임에 환경 변수를 읽어서 리다이렉트 URI를 현재 origin에 맞게 생성
 * 환경 변수가 없는 경우 안전한 기본값 사용
 */
export const getLoginUrl = (returnPath?: string) => {
  try {
    // 환경 변수 읽기 (기본값 제공)
    const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL || 'https://auth.manus.im';
    const appId = import.meta.env.VITE_APP_ID;

    // 환경 변수 검증
    if (!appId) {
      console.error('[getLoginUrl] VITE_APP_ID is not set. Check .env file.');
      throw new Error('VITE_APP_ID is required');
    }

    if (!oauthPortalUrl) {
      console.error('[getLoginUrl] VITE_OAUTH_PORTAL_URL is not set. Check .env file.');
      throw new Error('VITE_OAUTH_PORTAL_URL is required');
    }

    // 리다이렉트 URI 생성
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(JSON.stringify({
      redirectUri,
      returnPath: returnPath || '/',
    }));

    // URL 객체 생성 (유효성 검증)
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");

    console.log('[getLoginUrl] Generated login URL:', url.toString());
    return url.toString();
  } catch (error) {
    console.error('[getLoginUrl] Error generating login URL:', error);
    // 폴백: 현재 페이지로 돌아가기
    return window.location.href;
  }
};
