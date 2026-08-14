"""
VendorGuard AI - Login Diagnostic Script
------------------------------------------
Checks the three most common causes of a "login succeeds but bounces back"
bug on cross-subdomain Azure Container Apps deployments:

  1. CORS preflight  - does the API allow requests FROM your web app's origin?
  2. Cookie response  - does a real login attempt actually get a Set-Cookie header back?
  3. Session check    - after "login", does the API recognize you as logged in?

HOW TO RUN:
  1. Make sure Python is installed:  python --version
  2. Install the one dependency:     pip install requests
  3. Edit the two variables below (API_URL, WEB_ORIGIN) if they ever change.
  4. Run it:                         python diagnose_login.py
"""

import requests

# ---- EDIT THESE IF YOUR URLS EVER CHANGE ----
API_URL = "https://vendorguard-api-container.delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io"
WEB_ORIGIN = "https://vendorguard-web-container.delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io"
# Guessing the login route + fields based on your login form ("Your Name", "Email").
# If this test 400s, open apps/api/src/auth-routes.ts and check the real field names.
LOGIN_PATH = "/auth/login"
LOGIN_PAYLOAD = {"displayName": "Test User", "email": "testuser@example.com"}
# ------------------------------------------------


def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


def check_health():
    section("1. API HEALTH CHECK")
    try:
        r = requests.get(f"{API_URL}/health", timeout=10)
        print(f"Status: {r.status_code}")
        print(f"Body:   {r.text}")
        return r.status_code == 200
    except Exception as e:
        print(f"FAILED to reach API at all: {e}")
        return False


def check_cors_preflight():
    section("2. CORS PREFLIGHT CHECK (OPTIONS request)")
    headers = {
        "Origin": WEB_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    try:
        r = requests.options(f"{API_URL}{LOGIN_PATH}", headers=headers, timeout=10)
        allow_origin = r.headers.get("Access-Control-Allow-Origin", "MISSING")
        allow_creds = r.headers.get("Access-Control-Allow-Credentials", "MISSING")
        print(f"Status:                          {r.status_code}")
        print(f"Access-Control-Allow-Origin:     {allow_origin}")
        print(f"Access-Control-Allow-Credentials:{allow_creds}")

        ok = allow_origin == WEB_ORIGIN and allow_creds == "true"
        if ok:
            print("\n✅ CORS looks correctly configured for your web origin.")
        else:
            print("\n❌ CORS PROBLEM DETECTED:")
            if allow_origin != WEB_ORIGIN:
                print(f"   Expected Allow-Origin to be exactly: {WEB_ORIGIN}")
                print(f"   But got:                             {allow_origin}")
            if allow_creds != "true":
                print("   Access-Control-Allow-Credentials must be 'true' (it isn't).")
        return ok
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def check_login_and_cookie():
    section("3. LIVE LOGIN ATTEMPT (checks for Set-Cookie)")
    headers = {"Origin": WEB_ORIGIN, "Content-Type": "application/json"}
    try:
        r = requests.post(f"{API_URL}{LOGIN_PATH}", json=LOGIN_PAYLOAD, headers=headers, timeout=30)
        print(f"Status: {r.status_code}")
        set_cookie = r.headers.get("Set-Cookie")
        if set_cookie:
            print(f"✅ Set-Cookie header IS present:\n   {set_cookie}")
            return True, r.cookies
        else:
            print("❌ No Set-Cookie header in the response at all.")
            print(f"   Response body: {r.text[:300]}")
            return False, None
    except Exception as e:
        print(f"FAILED: {e}")
        return False, None


def check_session(cookies):
    section("4. SESSION CHECK (using the cookie we just got)")
    if not cookies:
        print("Skipped - no cookie was returned in step 3.")
        return
    try:
        r = requests.get(f"{API_URL}/vendors", cookies=cookies, headers={"Origin": WEB_ORIGIN}, timeout=10)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            print("✅ The cookie works - API recognizes the session.")
        else:
            print(f"❌ API rejected the cookie/session. Body: {r.text[:300]}")
    except Exception as e:
        print(f"FAILED: {e}")


if __name__ == "__main__":
    healthy = check_health()
    if not healthy:
        print("\nStopping - API isn't reachable at all, fix that first.")
    else:
        cors_ok = check_cors_preflight()
        login_ok, cookies = check_login_and_cookie()
        check_session(cookies)

        section("SUMMARY")
        print(f"API reachable:        {'YES' if healthy else 'NO'}")
        print(f"CORS configured right: {'YES' if cors_ok else 'NO'}")
        print(f"Login returns cookie:  {'YES' if login_ok else 'NO'}")
        if healthy and cors_ok and login_ok:
            print("\nBackend looks fully correct. The bug is most likely in the")
            print("DEPLOYED WEB CONTAINER'S BUILD - it may have an old/wrong")
            print("NEXT_PUBLIC_API_URL baked in from build time. Rebuild + redeploy")
            print("the web container image to fix.")
