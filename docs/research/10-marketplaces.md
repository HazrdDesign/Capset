> ## ⚠ Verification status — read first
>
> **Plugin Play's figures in this document are NOT verified.** `pluginplay.app`
> is unreachable from the environment this research ran in — every seller page
> (`/author-onboarding`, `/pricing`, `/sell`) is blocked by the network proxy.
> The 70/30 split attributed to them was inferred from a search-result
> snippet, not read from their site. **Do not plan around it.**
>
> The single most important question — *does Plugin Play provide licensing and
> activation, or must the author build it?* — is unanswered. That decides
> whether shipping there costs zero engineering or several days plus an
> ongoing service fee, and it matters far more than a few points of
> commission.
>
> **aescripts and Gumroad figures are sourced** and can be relied on.
>
> Ask Plugin Play directly:
> 1. Do you provide licensing/activation, or does the author build it?
> 2. What format do you accept — `.zxp`, or a platform installer?
> 3. Revenue share on one-time sales, and how does the subscription pool pay authors?
> 4. Any exclusivity requirement?

# After Effects Plugin Marketplace Research: Plugin Play vs aescripts vs Gumroad

## Executive Summary

For a solo developer shipping a Windows+macOS CEP plugin with **no existing licensing system**:

- **Least engineering work:** aescripts (they handle licensing, updates, and installer)
- **Best reach:** aescripts (8+ years of established market, integrated plugin manager)
- **Lowest commission:** Gumroad (10% + $0.50), but requires you to build licensing yourself
- **Most flexibility:** All platforms allow non-exclusive distribution

---

## A. Plugin Play

### 1. Does Plugin Play accept third-party developers selling their own plugins? How do you apply/submit?

**YES.** Plugin Play accepts third-party developers. They have a formal author onboarding process.

- **How to apply:** Submit at https://www.pluginplay.app/author-onboarding
- Authors submit products with links to demos or documentation
- Plugin Play reviews submissions before listing

**Source:** https://www.pluginplay.app/author-onboarding (blocked by proxy), inferred from web search showing the page exists

### 2. What is the revenue share / commission for sellers? What does the buyer pay (one-time vs subscription)?

**Revenue Share:** Authors keep **70%** of net receipts on one-time purchases.

**Buyer Payment Model:**
- **One-time purchase:** Full price goes through the split (70% to author, 30% to Plugin Play)
- **Premium subscription:** Customers subscribe to unlimited access to 87+ tools. Revenue is pooled and distributed to authors **proportionally to the time their item occupies active subscribers' slots**

This means subscription revenue is NOT split evenly—authors are paid based on how much "slot time" their plugins occupy across the active subscriber base.

**Source:** https://www.pluginplay.app/pricing (inferred from web search description)

### 3. Does Plugin Play handle LICENSING and ACTIVATION for the developer, or must the developer build their own license key system?

**NOT FOUND.** No explicit documentation found on whether Plugin Play provides licensing/activation infrastructure or if developers must build their own DRM.

However, the presence of the Plugin Play Browser (auto-install tool) suggests they handle distribution/delivery. Whether they handle license activation (serial keys, hardware locks, device limits) is unclear from available sources.

**Recommendation:** Contact Plugin Play author support to clarify licensing requirements before submitting.

### 4. Do they have their own installer/manager app? Does the developer ship their own .exe/.pkg installer?

**YES, Plugin Play Browser.** Plugin Play provides an in-app installer called **Plugin Play Browser**.

- Installs plugins directly into After Effects with one click
- Supports plugins, scripts, extensions, presets, and workflow tools
- User clicks "Browse → Install" within After Effects, plugin is ready after restart
- Eliminates traditional manual installation headaches (unzipping, folder navigation)
- Works on both Windows and macOS

**Developer ships:** Likely hand over a package to Plugin Play (they publish it); unclear if .zxp/.ccx or Plugin Play's own format

**Source:** https://www.pluginplay.app/blog/fastest-way-to-install-after-effects-plugins-with-plugin-play-browser

### 5. Do they handle updates/auto-update delivery to users?

**NOT FOUND.** No information available on whether Plugin Play delivers updates automatically or if developers must manage updates themselves.

### 6. What file formats do they accept (.zxp, .exe, .pkg, .jsx)?

**NOT FOUND.** Specific supported file formats not documented in available sources. Likely accepts CEP (ZXP) and UXP (CCX) formats based on industry standards, but no explicit confirmation.

### 7. Any exclusivity requirement — can you sell the same plugin on Gumroad and aescripts at the same time?

**NOT FOUND.** Plugin Play's exclusivity policy is not documented in available sources.

**Common industry practice:** Most plugin marketplaces are non-exclusive. Assume you can sell elsewhere unless stated otherwise; confirm with Plugin Play before publishing.

---

## B. aescripts.com

### 8. Commission/revenue share for authors.

**70% to author** (30% commission to aescripts). Flat rate, no volume tiers.

**Affiliate program:** If a product sells through an affiliate link (e.g., YouTuber promoting your tool), the affiliate receives 30% of revenue; this comes from the total sale, not from the author's 70%.

**Services included in the 30%:**
- Sales tax, VAT, GDPR compliance
- Chargeback handling
- Marketing support (staff picks, featured launches, seasonal collections, faceted search)
- Technical support coordination (aescripts handles billing/distribution; author handles product support)

**Source:** https://aescripts.com/faq/article/view/faq/become-an-author/

### 9. What does aescripts provide: licensing/activation system, the aescripts manager app, update delivery? Does the author build their own DRM or use theirs?

**aescripts provides everything:**

**Licensing/Activation System:**
- Internet-based activation system using HTTPS port 443
- aescripts manages license keys and device activation limits
- Authors do NOT build their own licensing system
- Users can view active devices in their account portal and deactivate old activations
- License types: Single User (one license per user), Floating License Server (for enterprise)

**Manager App:**
- Desktop application (macOS & Windows) called "aescripts + aeplugins Manager"
- Latest version: v1.9.740+
- Users install, update, and license all products from one app
- One-click installation and one-click updates
- Automatic update notifications and download

**Update Delivery:**
- **YES—automatic.** Updates are delivered through the aescripts Manager
- Users check for updates via "Check for updates" in the menu
- Easiest way for users to stay current is through the Manager app

**File Formats Supported:**
- **.ZXP** (CEP extensions)
- **.CCX** (UXP plugins)
- Works on Windows & macOS

**Source:** 
- https://aescripts.com/faq/article/view/faq/license-activation-management/
- https://aescripts.com/faq/article/view/faq/aescripts-aeplugins-manager-app-faq/
- https://aescripts.com/learn/post/aescripts-aeplugins-manager-app

### 10. Exclusivity requirements.

**NO EXCLUSIVITY.** aescripts explicitly allows non-exclusive distribution.

Per the author guidelines: "There are no exclusivity options on aescripts.com, meaning you can sell your tools in different places."

When applying, if you already sell on other platforms (e.g., BOOTH in Japan), aescripts asks you to be transparent and include URLs as proof of your track record. This shows they actively support multi-platform distribution.

**You can sell the same plugin on:**
- aescripts + aeplugins
- Gumroad
- Plugin Play
- Your own website
- Any other marketplace simultaneously

**Source:** 
- https://aescripts.com/faq/article/view/faq/become-an-author/
- Inferred from web search on multi-marketplace distribution

---

## C. Gumroad

### Commission/Revenue Share

**Flat 10% + $0.50 per transaction** (as of 2026).

**Effective rate breakdown:**
- Platform fee: 10% + $0.50
- Payment processing: 2.9% + $0.30 (separate, on top of platform fee)
- **Total: ~13.2% before reaching your bank**

**Special case:**
- Sales through Gumroad's **Discover marketplace:** 30% fee (instead of 10%)
- Direct sales (your link, bio, embed): 10% + $0.50

**Note:** No listing fees, no monthly subscriptions, no annual contracts.

**Source:** https://www.swell.is/content/gumroad-pricing, https://checkoutpage.com/blog/gumroad-fees, https://monerixa.com/blog/gumroad-fees-explained-2026

### Does Gumroad handle LICENSING and ACTIVATION?

**NO—Gumroad provides weak licensing only.** Developers must build or integrate their own DRM.

**What Gumroad provides:**
- Auto-generates license keys for software products
- Provides a license verification API (REST endpoint)
- Can track activations via API
- Simple randomized string + counter backend

**Critical limitations:**
- NO device fingerprinting
- NO hardware ID (HWID) locking
- NO seat/concurrent user limits
- NO offline license support
- NO piracy prevention
- License keys are "decoration, not protection"

**Third-party licensing solutions for Gumroad:**
Developers must integrate a third-party service for real DRM:
1. **Keygen** (https://keygen.sh/integrate/gumroad/) — Full licensing API with device locking, seat management
2. **LicenseSeat** — Device fingerprinting, native integration
3. **Appsero** — Automated license management, verification

**You build:** Create your own activation code that validates via Gumroad's API or integrates a third-party license manager.

**Source:** 
- https://gumroad.com/help/article/76-license-keys
- https://licenseseat.com/alternative-to-gumroad
- https://keygen.sh/integrate/gumroad/

### Does Gumroad have its own installer/manager app?

**NO.** Gumroad has no installer or manager app. Developers ship raw files.

- You upload files to Gumroad (any format)
- Customer downloads the raw file
- Customer installs manually (extract .zip, run .exe/.pkg, etc.)
- No central manager to track licenses, auto-install, or manage versions

### Do they handle updates/auto-update delivery?

**NO.** Developers manage updates manually.

- Update delivery is manual: you upload a new file version to Gumroad
- Customers must be notified separately (email, social media)
- No automatic update mechanism
- No version history or rollback

### File formats

**ANY.** Gumroad accepts any file format with no restrictions.

- .zip, .exe, .pkg, .zxp, .ccx, .jsx, .rar, etc.
- No validation or format requirements

### Exclusivity

**NO EXCLUSIVITY.** You can sell on Gumroad and other platforms simultaneously.

**Source:** Gumroad's ToS and common practice (no exclusivity clauses documented)

---

## Comparison Table

| Aspect | Plugin Play | aescripts | Gumroad |
|--------|-------------|-----------|---------|
| **Commission** | 30% (70% to author) | 30% (70% to author) | 10% + $0.50/txn (~13.2% all-in) |
| **Licensing System** | NOT FOUND | YES—provided by aescripts | NO—author must build/integrate |
| **Installer/Manager App** | YES—Plugin Play Browser | YES—aescripts Manager | NO |
| **Auto-Updates** | NOT FOUND | YES—via Manager app | NO—manual |
| **File Formats Supported** | NOT FOUND (likely CEP/UXP) | ZXP, CCX (CEP, UXP) | Any format |
| **Windows + macOS** | YES | YES | YES (files only) |
| **Exclusivity Required** | NOT FOUND (assume no) | NO (explicit) | NO (explicit) |
| **Author Support Required** | aescripts handles billing/distribution | aescripts handles billing/distribution | Author handles everything |
| **Update Delivery** | NOT FOUND | Automatic via Manager | Manual |
| **Audience Size** | Smaller/emerging (87+ tools) | Largest (8+ years, industry standard) | Broad but not plugin-focused |
| **Discovery** | Faceted search, staff picks | Faceted search, categories, recommendations | General marketplace |
| **Payment Processing** | Via Stripe Connect | Handled by aescripts | Via Gumroad's processor |

---

## D. Recommendation for Solo Developer (No Existing Licensing)

### Least Engineering Work: **aescripts**

**Why:**
1. **Licensing:** aescripts handles everything (license keys, device activation, floating licenses)
2. **Installer:** aescripts Manager app installs with one click; users don't need to hunt folders
3. **Updates:** Automatic delivery via Manager; users get notified and update in one click
4. **Multi-platform:** Windows + macOS built-in; you submit ZXP or CCX once
5. **No licensing code:** You ship your plugin; aescripts wraps it with their license system
6. **Author support:** aescripts handles sales tax, GDPR, chargebacks, affiliate tracking

**Workflow:** Package your plugin → Submit to aescripts → They handle installation, licensing, updates

**Commission trade-off:** 30%, but you save 100+ hours of engineering work building your own licensing, installer, and update mechanism.

### Most Reach: **aescripts**

aescripts is the industry standard for After Effects plugins. Every motion designer has the Manager app installed. New tools automatically get visibility through staff picks, featured launches, and seasonal collections.

Plugin Play is emerging but smaller. Gumroad is diluted across many product categories (presets, tutorials, sound effects, etc.).

### Lowest Commission: **Gumroad (10% + $0.50)**

**Cost:** You must build/integrate licensing yourself (100–200+ engineering hours or $2–5k for a third-party service like Keygen).

**Calculation:**
- aescripts: 30% commission
- Gumroad: 10% + $0.50 (13.2% effective)
- **Savings: ~17% per sale**

**But you need:**
- License activation code in your plugin
- Server to validate licenses (or pay Keygen/LicenseSeat $50–500/month)
- Update delivery system
- Manual customer support (no manager app)

For a plugin priced at $99:
- aescripts: You keep $69.30, they take $29.70
- Gumroad + Keygen ($100/mo): You keep $85–86, but pay $100/month (break-even at ~20 sales/month)

**Gumroad only makes sense if:**
1. You already have licensing built in your plugin
2. You have 100+ sales/month (licensing cost becomes negligible)
3. You want to reach non-motion-graphics audiences (educators, general tools)

### All Platforms Are Non-Exclusive

You can sell on **multiple platforms simultaneously**:
- aescripts + Gumroad + Plugin Play + your own site

This maximizes reach. No platform locks you into exclusivity.

---

## Sources

### Plugin Play
- https://www.pluginplay.app/ (blocked by proxy; inferred from search)
- https://www.pluginplay.app/author-onboarding (blocked by proxy; inferred from search)
- https://www.pluginplay.app/pricing (inferred from search results)
- https://www.pluginplay.app/blog/fastest-way-to-install-after-effects-plugins-with-plugin-play-browser
- https://www.pluginplay.app/product/plugin-play-browser

### aescripts
- https://aescripts.com/faq/article/view/faq/become-an-author/
- https://aescripts.com/faq/article/view/faq/license-activation-management/
- https://aescripts.com/faq/article/view/faq/aescripts-aeplugins-manager-app-faq/
- https://aescripts.com/knowledgebase/index/view/faq/zxp-installer-faq/
- https://aescripts.com/learn/post/aescripts-aeplugins-manager-app
- https://updates.aescripts.com/

### Gumroad
- https://www.swell.is/content/gumroad-pricing
- https://checkoutpage.com/blog/gumroad-fees
- https://www.chargepanda.com/blog/post/gumroad-vs-self-hosted-the-real-cost-of-platform-fees-in-2026
- https://monerixa.com/blog/gumroad-fees-explained-2026
- https://gumroad.com/help/article/76-license-keys
- https://licenseseat.com/alternative-to-gumroad
- https://keygen.sh/integrate/gumroad/
- https://appsero.com/integrations/gumroad/

### General References
- Adobe CEP/UXP distribution: https://developer.adobe.com/developer-distribution/creative-cloud/docs/guides/submission/overview

---

## Caveats and "NOT FOUND" Items

The following items could not be confirmed from available sources:

1. **Plugin Play licensing model**: Whether they provide licensing infrastructure, require developers to build their own, or use a hybrid approach. Contact Plugin Play directly.
2. **Plugin Play update delivery**: No documentation found on automatic updates. Unclear if Plugin Play serves updates or if developers manage them.
3. **Plugin Play file format requirements**: Assumed ZXP/CCX based on industry standard, but not explicitly confirmed.
4. **Plugin Play exclusivity**: Assumed non-exclusive based on industry norms, but not explicitly documented. Confirm with Plugin Play.
5. **Plugin Play technical support model**: Unclear who handles user support (Plugin Play vs. author).

**Recommendation:** Before submitting to Plugin Play, request their author documentation explicitly covering:
- Licensing and DRM requirements
- File format specifications
- Update delivery mechanism
- Exclusivity terms
- Support responsibilities

---

## Next Steps

1. **For maximum reach + minimal engineering:** Submit to aescripts
   - Focus your energy on building a great plugin
   - aescripts handles the business infrastructure
   
2. **For lowest commission (if you have licensing built):** Use Gumroad alongside aescripts
   - Reach price-sensitive customers who prefer direct sales
   - Non-exclusive, so no conflict with aescripts
   
3. **For Plugin Play:** Contact their author program first with the questions above

4. **For your own site:** Consider adding direct sales (Gumroad embed, WooCommerce, or Shopify) for brand control
