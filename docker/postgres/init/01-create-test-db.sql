-- Runs once, when the Postgres data volume is first created.
-- A separate database for automated tests, so tests never touch your real data.
CREATE DATABASE whc_test;
