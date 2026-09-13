function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { "content-type": "application/json" } }, init));
}

function uid() {
  return crypto.randomUUID();
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

    return env.ASSETS.fetch(request);
  },
};
