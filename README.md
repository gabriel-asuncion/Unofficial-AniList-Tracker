# Unofficial AniList Tracker
![App Screenshot](https://i.postimg.cc/SssjtBGg/Frame-51027.png)
![App Screenshot](https://i.postimg.cc/hhF5YqVx/ongoing.png)
![App Screenshot](https://i.postimg.cc/BtWVzG2F/tracking.png)

An elegant, automated, and privacy-focused browser extension that tracks your anime progress in the background and updates your AniList profile seamlessly. 

No more manually navigating to AniList to update your episode count—just sit back, watch, and let the extension do the heavy lifting!

---

## ✨ Features

*   **Relentless Iframe-Piercing Tracker:** Deep-scans websites to locate secure and cross-origin video elements hidden inside Shadow DOMs and secure iframes[cite: 2].
*   **Customizable Auto-Track Threshold:** Define exactly when an episode counts as "watched" (e.g., 80% or 90%) using a sleek slider in the settings[cite: 6].
*   **Smart Whitelist Protection:** Zero-footprint background activity[cite: 2]. The extension remains completely inactive on normal websites and only runs on streaming domains you explicitly approve[cite: 2, 6].
*   **Smart Fallback Search:** Bypasses AniList's punctuation blind spots with a multi-step, progressive fallback search algorithm (stripping brackets, special characters, and colons to find stubborn titles)[cite: 1, 6].
*   **Live Status Indicator:** 
    *   🔴 `▶` Badge: Actively tracking a video.
    *   🟢 `✓` Badge: Episode successfully updated to AniList.
*   **Skip Intro Button:** Fast-forward past intros or cold opens by exactly 1:30 with a single click inside the popup.

---

## 🚀 Installation (100% Free)

Since this extension is run locally in Developer Mode, you can load it into any Chromium browser (Brave, Chrome, Edge, Opera) without paying any developer fees.

1.  **Download/Clone the Repository:** Ensure all your project files are in a single folder.
2.  **Open Extension Management:** 
    *   In Chrome, go to: `chrome://extensions`
    *   In Brave, go to: `brave://extensions`
3.  **Enable Developer Mode:** Toggle the **Developer mode** switch in the top-right corner of the page.
4.  **Load the Extension:** Click the **Load unpacked** button in the top-left corner and select your project folder.
5.  **Pin the Extension:** Click the puzzle piece icon in your browser toolbar and pin **AniList Quick Update** for easy access!

---

## 📁 File Structure

Your project directory should look like this:
```text
├── manifest.json         # Extension configuration and permissions[cite: 3]
├── background.js         # Service worker handling API requests and badge updates[cite: 1]
├── content.js            # Video monitoring and progress tracking script[cite: 2]
├── popup.html            # Main extension interface[cite: 5]
├── popup.js              # UI logic, authentication, and tracking settings[cite: 6]
├── popup.css             # Extension custom styling[cite: 4]
└── icons/                # Extension icons[cite: 3]
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
