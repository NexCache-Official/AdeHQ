import { chromium, firefox, webkit } from "playwright";

const engines = { chromium, firefox, webkit };
const results = [];
for (const [name, engine] of Object.entries(engines)) {
  let browser;
  try {
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Call compatibility</title>");
    const capabilities = await page.evaluate(() => ({
      peerConnection: typeof RTCPeerConnection === "function",
      mediaStream: typeof MediaStream === "function",
      mediaRecorder: typeof MediaRecorder === "function",
      getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
      getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      serviceWorker: "serviceWorker" in navigator,
      pushManager: "PushManager" in window,
      senderParameters:
        typeof RTCRtpSender !== "undefined" &&
        typeof RTCRtpSender.prototype.setParameters === "function",
      displayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
      audioContext: typeof AudioContext === "function",
    }));
    if (
      !capabilities.peerConnection ||
      !capabilities.mediaStream ||
      !capabilities.senderParameters
    ) {
      throw new Error(`${name} is missing core WebRTC APIs.`);
    }
    results.push({ engine: name, status: "passed", capabilities });
  } catch (error) {
    if (/Executable doesn't exist|browserType\.launch/.test(String(error))) {
      results.push({ engine: name, status: "not-installed" });
    } else {
      throw error;
    }
  } finally {
    await browser?.close();
  }
}
console.log(JSON.stringify(results));

const missing = results.filter((result) => result.status !== "passed");
if (missing.length && process.env.CALL_BROWSER_REQUIRE_ALL === "1") {
  throw new Error(
    `Install the missing Playwright engines before release verification: ${missing
      .map((result) => result.engine)
      .join(", ")}`,
  );
}
