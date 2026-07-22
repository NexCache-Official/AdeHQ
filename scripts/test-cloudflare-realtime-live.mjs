import { chromium } from "playwright";

const appId = process.env.CLOUDFLARE_REALTIME_APP_ID;
const token = process.env.CLOUDFLARE_REALTIME_API_TOKEN;
if (!appId || !token) {
  throw new Error("CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_API_TOKEN are required.");
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>AdeHQ Realtime smoke</title>");
  const result = await page.evaluate(
    async ({ appId: id, token: secret }) => {
      const prefix = `https://rtc.live.cloudflare.com/v1/apps/${id}`;
      const request = async (path, body, method = "POST") => {
        const response = await fetch(`${prefix}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const json = await response.json();
        if (!response.ok || json.errorCode) {
          throw new Error(json.errorDescription || `Cloudflare returned ${response.status}`);
        }
        return json;
      };
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
      });
      const track = destination.stream.getAudioTracks()[0];
      const transceiver = pc.addTransceiver(track, { direction: "sendonly" });
      await pc.setLocalDescription(await pc.createOffer());
      const created = await request("/sessions/new", {
        sessionDescription: pc.localDescription,
      });
      await pc.setRemoteDescription(created.sessionDescription);
      await pc.setLocalDescription(await pc.createOffer());
      const trackName = `adehq-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const published = await request(`/sessions/${created.sessionId}/tracks/new`, {
        sessionDescription: pc.localDescription,
        tracks: [{ location: "local", mid: transceiver.mid, trackName }],
      });
      await pc.setRemoteDescription(published.sessionDescription);
      const remoteTrack = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Remote echo track timed out.")), 10_000);
        pc.ontrack = (event) => {
          clearTimeout(timeout);
          resolve(event.track.kind);
        };
      });
      const subscribed = await request(`/sessions/${created.sessionId}/tracks/new`, {
        tracks: [
          {
            location: "remote",
            sessionId: created.sessionId,
            trackName,
          },
        ],
      });
      if (subscribed.requiresImmediateRenegotiation) {
        await pc.setRemoteDescription(subscribed.sessionDescription);
        await pc.setLocalDescription(await pc.createAnswer());
        await request(
          `/sessions/${created.sessionId}/renegotiate`,
          { sessionDescription: pc.localDescription },
          "PUT",
        );
      }
      const kind = await remoteTrack;
      pc.close();
      track.stop();
      oscillator.stop();
      await context.close();
      return { sessionCreated: Boolean(created.sessionId), published: true, echoTrackKind: kind };
    },
    { appId, token },
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
