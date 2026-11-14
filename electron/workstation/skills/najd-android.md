---
name: najd-android
description: Build an Android app (APK) from a web app with the user's Android SDK. Use for mobile app requests on Windows; iOS needs a Mac.
---

# Android apps

1. Write the app as a web app in its own folder with najd_files_write: index.html plus css/, js/ and images. Bundle everything (no CDN, no network calls); the app runs offline in a full-screen WebView.
2. Design for a phone: viewport meta, touch-sized controls, `dir="rtl"` and an Arabic font stack for Arabic apps, local storage for saved data.
3. Preview it with najd_web_preview when available, then build with najd_android_build: folder, name (shown under the icon), appId (lowercase package id such as com.najd.notes).
4. Report the APK path from the result. It is signed with a NAJD debug key for testing (adb install or copy to the phone); a Play Store release needs the user's own signing key.
5. If the build fails, read the step and detail in the result, fix the app files and build again once.

iOS apps need a Mac with Xcode; say so instead of trying.
