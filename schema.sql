CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_log (
  habit_id TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (habit_id, date)
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  amount REAL,
  note TEXT,
  created_at INTEGER NOT NULL
);
