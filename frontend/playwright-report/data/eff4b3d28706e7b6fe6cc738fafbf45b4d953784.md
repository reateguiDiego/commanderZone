# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-login.smoke.spec.ts >> auth login smoke renders form
- Location: e2e\auth-login.smoke.spec.ts:3:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'CommanderZone' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'CommanderZone' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - main [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - img "CommanderZone" [ref=e8]
        - paragraph [ref=e9]: Accede a tus mazos, salas y mesa manual de Commander.
      - generic [ref=e10]:
        - tablist "Auth mode" [ref=e11]:
          - button "Login" [ref=e12] [cursor=pointer]
          - button "Register" [ref=e13] [cursor=pointer]
        - generic [ref=e14]:
          - generic [ref=e15]:
            - text: Email
            - textbox "Email" [ref=e16]
          - generic [ref=e17]:
            - text: Password
            - generic [ref=e18]:
              - textbox "Password Mostrar contrasena" [ref=e19]
              - button "Mostrar contrasena" [ref=e20] [cursor=pointer]:
                - img [ref=e22]
          - link "He olvidado mi contrasena" [ref=e25] [cursor=pointer]:
            - /url: /auth/password-reset
          - button "Login" [disabled] [ref=e26]:
            - img [ref=e28]
            - text: Login
  - contentinfo [ref=e32]:
    - generic [ref=e33]:
      - heading "Disclaimer" [level=2] [ref=e34]
      - paragraph [ref=e35]:
        - text: CommanderZone is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
        - strong [ref=e36]: Wizards
        - text: . Portions of the materials used are property of
        - strong [ref=e37]: Wizards of the Coast
        - text: .
        - strong [ref=e38]: ©Wizards of the Coast LLC
        - text: .
      - paragraph [ref=e39]:
        - strong [ref=e40]: "Magic: The Gathering®"
        - text: ","
        - strong [ref=e41]: MTG®
        - text: ", and all associated logos, card images, and intellectual property are trademarks and/or copyrights of"
        - strong [ref=e42]: Wizards of the Coast
        - text: LLC, a subsidiary of
        - strong [ref=e43]: Hasbro, Inc
        - text: ., in the United States and other countries.
        - strong [ref=e44]: © 1993-2026 Wizards of the Coast LLC
        - text: . All rights reserved.
      - paragraph [ref=e45]:
        - text: CommanderZone may display or reference certain
        - strong [ref=e46]: Wizards of the Coast
        - text: intellectual property under the guidelines set forth in
        - strong [ref=e47]: Wizards' Fan Content Policy
        - text: . This site does not sell products, host tournaments, or offer any ranked or competitive services. All features are provided free of charge and are intended solely for non-commercial, educational, and entertainment use by the
        - strong [ref=e48]: "Magic: The Gathering"
        - text: community.
      - paragraph [ref=e49]:
        - text: For more information on
        - strong [ref=e50]: Wizards of the Coast
        - text: "and their intellectual property policies, please visit:"
        - link "https://company.wizards.com" [ref=e51] [cursor=pointer]:
          - /url: https://company.wizards.com
      - paragraph [ref=e52]:
        - text: If you are the rights holder and believe any content on this website violates your rights, please contact us directly to resolve the matter.
        - link "Contact us" [ref=e53] [cursor=pointer]:
          - /url: /contact
        - text: ", view our Help & FAQ, or check our Press Kit."
  - region "Cookie preferences" [ref=e54]:
    - generic [ref=e55]:
      - paragraph [ref=e56]: Cookie preferences
      - paragraph [ref=e57]:
        - text: CommanderZone uses essential cookies for the app. Optional analytics stay disabled unless you allow them. Read the
        - link "privacy policy" [ref=e58] [cursor=pointer]:
          - /url: /privacy-policy/
        - text: and
        - link "cookie policy" [ref=e59] [cursor=pointer]:
          - /url: /cookie-policy/
        - text: .
    - generic [ref=e60]:
      - button "Configure" [ref=e61] [cursor=pointer]
      - button "Reject" [ref=e62] [cursor=pointer]
      - button "Accept" [ref=e63] [cursor=pointer]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | test('auth login smoke renders form', async ({ page }) => {
  4  |   await page.goto('/auth/login');
  5  | 
> 6  |   await expect(page.getByRole('heading', { name: 'CommanderZone' })).toBeVisible();
     |                                                                      ^ Error: expect(locator).toBeVisible() failed
  7  |   await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  8  |   await expect(page.getByLabel('Password')).toBeVisible();
  9  |   await expect(page.locator('form button[type="submit"]')).toContainText('Login');
  10 | });
  11 | 
```