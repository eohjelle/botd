CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
    channel_id VARCHAR(20) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subscribed BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users_channels (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    points INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id),
    UNIQUE (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS brainteasers (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    question TEXT NOT NULL,
    category VARCHAR(255) DEFAULT 'Uncategorized',
    submitted_by VARCHAR(20) NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_for_botd INTEGER DEFAULT NULL,
    FOREIGN KEY (submitted_by) REFERENCES users(user_id),
    UNIQUE (id),
    UNIQUE (title)
);

CREATE TABLE IF NOT EXISTS solutions (
    id SERIAL PRIMARY KEY,
    brainteaser_id INTEGER NOT NULL,
    solution TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submitted_by VARCHAR(20) NOT NULL,
    FOREIGN KEY (brainteaser_id) REFERENCES brainteasers(id),
    FOREIGN KEY (submitted_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS botd (
    id SERIAL PRIMARY KEY,
    date_of DATE DEFAULT CURRENT_DATE,
    brainteaser_id INTEGER NOT NULL,
    FOREIGN KEY (brainteaser_id) REFERENCES brainteasers(id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_used_for_botd') THEN
        ALTER TABLE brainteasers
        ADD CONSTRAINT fk_used_for_botd
        FOREIGN KEY (used_for_botd) REFERENCES botd(id);
    END IF;
END $$;

CREATE OR REPLACE VIEW leaderboard AS (
    SELECT name, channel_id, points
    FROM users_channels
    JOIN users ON users_channels.user_id = users.user_id
    ORDER BY points DESC
);

CREATE OR REPLACE VIEW botd_brainteasers AS (
    SELECT botd.id, botd.date_of, brainteasers.title, brainteasers.question, users.name AS submitted_by, brainteasers.category
    FROM botd
    JOIN brainteasers ON botd.id = brainteasers.used_for_botd
    JOIN users ON brainteasers.submitted_by = users.user_id
);

CREATE OR REPLACE VIEW botd_solutions AS (
    SELECT botd.id AS botd_id, botd.date_of, brainteasers.question, solutions.solution, users.name AS user_name
    FROM botd
    JOIN brainteasers ON botd.id = brainteasers.used_for_botd
    JOIN solutions ON brainteasers.id = solutions.brainteaser_id
    JOIN users ON solutions.submitted_by = users.user_id
    ORDER BY botd.id, users.name
);