const fs = require('fs');

async function testFetchAndExtract(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) {
    console.error(`YouTube returned ${res.status} for ${videoId}`);
    return;
  }
  const html = await res.text();
  
  const tracks = extractCaptionTracksFromHTML(html);
  console.log(`Video ${videoId} extracted tracks: ${tracks.length}`);
  if (tracks.length === 0) {
    // let's try to find what broke it.
    console.log("Searching for \"captionTracks\"...");
    const idx = html.indexOf('"captionTracks"');
    if (idx !== -1) {
      console.log("Found captionTracks at", idx);
      console.log("Substring:", html.substring(idx - 10, idx + 200));
    } else {
      console.log("Could not find \"captionTracks\" in the HTML payload.");
    }
  }
}

function extractCaptionTracksFromHTML(html) {
  const key = '"captionTracks"';
  const keyIdx = html.indexOf(key);
  if (keyIdx === -1) return [];

  const arrStart = html.indexOf("[", keyIdx + key.length);
  if (arrStart === -1) return [];

  let depth = 0;
  let arrEnd = -1;
  let inString = false;
  let escape = false;

  for (let i = arrStart; i < html.length; i++) {
    const char = html[i];

    if (!escape && char === '"') {
      inString = !inString;
    }
    
    escape = (char === '\\' && !escape);

    if (!inString) {
      if (char === "[") depth++;
      else if (char === "]") {
        depth--;
        if (depth === 0) { arrEnd = i; break; }
      }
    }
  }

  if (arrEnd === -1) return [];

  try {
    return JSON.parse(html.slice(arrStart, arrEnd + 1));
  } catch (e) {
    console.error("JSON.parse failed:", e.message);
    return [];
  }
}

async function main() {
  await testFetchAndExtract('kJQP7kiw5Fk');
}

main();
