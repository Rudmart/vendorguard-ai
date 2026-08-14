from playwright.sync_api import sync_playwright

LOGIN_URL = "https://vendorguard-web-container.delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io/login"
API_DOMAIN = "vendorguard-api-container.delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io"


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)
        context = browser.new_context()
        page = context.new_page()

        login_response_holder = {}

        def handle_response(response):
            if "/auth/login" in response.url:
                login_response_holder["status"] = response.status
                login_response_holder["headers"] = response.headers

        page.on("response", handle_response)
        page.on("console", lambda msg: print(f"  [browser console] {msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"  [browser page error] {exc}"))

        print(f"Opening {LOGIN_URL} ...")
        page.goto(LOGIN_URL)

        print("Filling in the form...")
        inputs = page.locator("input")
        inputs.nth(0).fill("Test User")
        inputs.nth(1).fill("testuser@example.com")

        print("Clicking Sign In...")
        page.get_by_role("button", name="Sign In").click()

        page.wait_for_timeout(5000)

        error_text = page.locator("text=Something went wrong").count()
        print(f"\n'Something went wrong' error message visible on page: {'YES' if error_text > 0 else 'NO'}")

        print("\n" + "=" * 60)
        print("RESULTS")
        print("=" * 60)

        if login_response_holder:
            print(f"Login request status: {login_response_holder.get('status')}")
        else:
            print("Never saw a request to /auth/login - check the form field order.")

        cookies = context.cookies()
        api_cookies = [c for c in cookies if API_DOMAIN in c.get("domain", "")]

        print(f"\nCookies the browser actually stored for the API domain: {len(api_cookies)}")
        for c in api_cookies:
            print(f"  name={c['name']}  domain={c['domain']}  sameSite={c.get('sameSite')}  secure={c.get('secure')}")

        print(f"\nCurrent page URL after login attempt: {page.url}")
        if "/login" in page.url:
            print("Still on the login page - the browser did NOT keep you logged in.")
        else:
            print("Redirected away from login - looks like it worked!")

        print("\n(Browser window will close in 8 seconds so you can look at it first)")
        page.wait_for_timeout(8000)
        browser.close()


if __name__ == "__main__":
    run()
