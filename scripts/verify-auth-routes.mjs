const baseUrl = new URL(process.argv[2] ?? "https://devtrack-indol.vercel.app");
const maximumRedirects = 2;

const expectations = [
  { path: "/login", finalStatus: 200, maximumRedirects: 0 },
  { path: "/login/", finalStatus: 200, maximumRedirects: 1 },
  { path: "/", finalStatus: 200, maximumRedirects: 1 },
  { path: "/projects", finalStatus: 200, maximumRedirects: 1 },
  { path: "/recover", finalStatus: 200, maximumRedirects: 0 },
  { path: "/update-password", finalStatus: 200, maximumRedirects: 0 },
  { path: "/auth/callback", finalStatus: 200, maximumRedirects: 1 },
  { path: "/api/auth/logout", finalStatus: 405, maximumRedirects: 0 }
];

async function followCookieFree(startUrl) {
  const chain = [];
  let currentUrl = new URL(startUrl);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl, { redirect: "manual", headers: { "user-agent": "DevTrack auth redirect verifier" } });
    const location = response.headers.get("location");
    chain.push({ status: response.status, url: currentUrl.toString(), location });
    if (!location) return chain;
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.toString() === currentUrl.toString()) throw new Error(`Self-redirect detected at ${currentUrl}`);
    if (redirectCount === maximumRedirects) throw new Error(`Exceeded ${maximumRedirects} redirects from ${startUrl}`);
    currentUrl = nextUrl;
  }
  return chain;
}

let failed = false;
for (const expectation of expectations) {
  try {
    const chain = await followCookieFree(new URL(expectation.path, baseUrl));
    const finalResponse = chain.at(-1);
    const redirectCount = chain.length - 1;
    const valid = finalResponse.status === expectation.finalStatus && redirectCount <= expectation.maximumRedirects;
    console.log(`${valid ? "PASS" : "FAIL"} ${expectation.path} ${chain.map((entry) => `${entry.status} ${new URL(entry.url).pathname}${entry.location ? ` -> ${entry.location}` : ""}`).join(" | ")}`);
    if (!valid) failed = true;
  } catch (error) {
    failed = true;
    console.error(`FAIL ${expectation.path} ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) process.exitCode = 1;
