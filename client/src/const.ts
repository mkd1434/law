export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * 로그인 URL 생성 함수
 * 환경 변수가 없는 경우 null을 반환하여 로그인 기능을 비활성화
 * (Graceful Degradation: 환경 변수 부재로 인한 크래시 방지)
 */
export const getLoginUrl = (returnPath?: string): string | null => {
  try {
    // 환경 변수 읽기 (기본값 없음 - null 반환으로 처리)
    const appId = import.meta.env.VITE_APP_ID;
    const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;

    // 환경 변수 검증: 하나라도 없으면 null 반환 (로그인 기능 비활성화)
    if (!appId) {
      console.warn('[getLoginUrl] VITE_APP_ID is not configured. Login feature disabled.');
      return null;
    }

    if (!oauthPortalUrl) {
      console.warn('[getLoginUrl] VITE_OAUTH_PORTAL_URL is not configured. Login feature disabled.');
      return null;
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

    console.log('[getLoginUrl] Generated login URL successfully');
    return url.toString();
  } catch (error) {
    console.warn('[getLoginUrl] Error generating login URL:', error);
    // 폴백: null 반환 (로그인 버튼 미렌더링)
    return null;
  }
};
