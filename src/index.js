function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { "content-type": "application/json" } }, init));
}

function uid() {
  return crypto.randomUUID();
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

async function getState(env) {
  const habits = await env.DB.prepare("SELECT id, name FROM habits ORDER BY created_at ASC").all();
  const logs = await env.DB.prepare("SELECT habit_id, date FROM habit_log").all();
  const investments = await env.DB
    .prepare("SELECT id, date, ticker, amount, note FROM investments ORDER BY date DESC")
    .all();
  const habitLog = {};
  for (const row of logs.results) habitLog[row.habit_id + "|" + row.date] = true;
  return { habits: habits.results, habitLog, investments: investments.results };
}

async function getValidAccessToken(env) {
  const auth = await env.DB
    .prepare("SELECT refresh_token, access_token, expires_at FROM google_auth WHERE id = 1")
    .first();
  if (!auth || !auth.refresh_token) return null;
  if (auth.access_token && auth.expires_at && auth.expires_at > Date.now() + 60000) {
    return auth.access_token;
  }
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: auth.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  await env.DB.prepare("UPDATE google_auth SET access_token = ?, expires_at = ? WHERE id = 1")
    .bind(data.access_token, expiresAt)
    .run();
  return data.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    let m;

    if (path === "/api/state" && request.method === "GET") {
      return json(await getState(env));
    }

    if (path === "/api/habits" && request.method === "POST") {
      const body = await request.json();
      const id = uid();
      await env.DB.prepare("INSERT INTO habits (id, name, created_at) VALUES (?, ?, ?)")
        .bind(id, body.name, Date.now())
        .run();
      return json({ id, name: body.name });
    }

    if ((m = path.match(/^\/api\/habits\/([^/]+)$/)) && request.method === "DELETE") {
      const id = m[1];
      await env.DB.batch([
        env.DB.prepare("DELETE FROM habit_log WHERE habit_id = ?").bind(id),
        env.DB.prepare("DELETE FROM habits WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }

    if (path === "/api/habit-log/toggle" && request.method === "POST") {
      const body = await request.json();
      const existing = await env.DB
        .prepare("SELECT 1 FROM habit_log WHERE habit_id = ? AND date = ?")
        .bind(body.habitId, body.date)
        .first();
      if (existing) {
        await env.DB.prepare("DELETE FROM habit_log WHERE habit_id = ? AND date = ?")
          .bind(body.habitId, body.date)
          .run();
      } else {
        await env.DB.prepare("INSERT INTO habit_log (habit_id, date) VALUES (?, ?)")
          .bind(body.habitId, body.date)
          .run();
      }
      return json({ ok: true });
    }

    if (path === "/api/investments" && request.method === "POST") {
      const body = await request.json();
      const id = uid();
      await env.DB
        .prepare("INSERT INTO investments (id, date, ticker, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, body.date, body.ticker, body.amount == null ? null : body.amount, body.note || "", Date.now())
        .run();
      return json({ id });
    }

    if ((m = path.match(/^\/api\/investments\/([^/]+)$/))) {
      const id = m[1];
      if (request.method === "PUT") {
        const body = await request.json();
        await env.DB
          .prepare("UPDATE investments SET date=?, ticker=?, amount=?, note=? WHERE id=?")
          .bind(body.date, body.ticker, body.amount == null ? null : body.amount, body.note || "", id)
          .run();
        return json({ ok: true });
      }
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM investments WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
    }

    if (path === "/auth/google/start") {
      const state = randomState();
      const redirectUri = url.origin + "/auth/google/callback";
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.readonly");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          Location: authUrl.toString(),
          "Set-Cookie": `oauth_state=${state}; HttpOnly; Secure; Path=/; Max-Age=600; SameSite=Lax`,
        },
      });
    }

    if (path === "/auth/google/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const cookieState = getCookie(request, "oauth_state");
      if (!code || !state || state !== cookieState) {
        return new Response("授权状态校验失败，请重新发起连接。", { status: 400 });
      }
      const redirectUri = url.origin + "/auth/google/callback";
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenResp.ok) {
        return new Response("换取 token 失败：" + (await tokenResp.text()), { status: 500 });
      }
      const data = await tokenResp.json();
      const expiresAt = Date.now() + data.expires_in * 1000;
      await env.DB
        .prepare(
          "INSERT INTO google_auth (id, refresh_token, access_token, expires_at) VALUES (1, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            "refresh_token = COALESCE(excluded.refresh_token, google_auth.refresh_token), " +
            "access_token = excluded.access_token, expires_at = excluded.expires_at"
        )
        .bind(data.refresh_token || null, data.access_token, expiresAt)
        .run();
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }

    if (path === "/api/calendar/today" && request.method === "GET") {
      const token = await getValidAccessToken(env);
      if (!token) return json({ connected: false });
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 1);
      const evUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      evUrl.searchParams.set("timeMin", startOfDay.toISOString());
      evUrl.searchParams.set("timeMax", endOfDay.toISOString());
      evUrl.searchParams.set("singleEvents", "true");
      evUrl.searchParams.set("orderBy", "startTime");
      const resp = await fetch(evUrl.toString(), { headers: { Authorization: "Bearer " + token } });
      if (!resp.ok) return json({ connected: true, error: await resp.text() }, { status: 502 });
      const data = await resp.json();
      return json({ connected: true, events: data.items || [] });
    }

    return env.ASSETS.fetch(request);
  },
};
