// Reset daily activity tables (called by scheduled event)
export async function resetDailyTables(env) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Perform the Archive (The "Heavy Lifting")
    // This SQL handles the mapping, the unique ID generation, and the conflicts in one go.
    await env.DB.prepare(`
      INSERT INTO user_daily_stats (
        id, user_id, stats_date, xp_earned, listening_time, reading_time, created_at, updated_at
      )
      SELECT 
        hex(randomblob(16)), user_id, activity_date, daily_xp, daily_listening_time, daily_reading_time, 
        unixepoch() * 1000, unixepoch() * 1000
      FROM user_daily_activity
      WHERE activity_date = ?
      ON CONFLICT(user_id, stats_date) DO UPDATE SET
        listening_time = COALESCE(user_daily_stats.listening_time, excluded.listening_time),
        reading_time = COALESCE(user_daily_stats.reading_time, excluded.reading_time),
        updated_at = unixepoch() * 1000
    `).bind(yesterdayStr).run();

    // Clean up the source table
    // We use < today to ensure we don't accidentally delete data from a user 
    // who has already started their session on the new day.
    await env.DB.prepare(`
      DELETE FROM user_daily_activity
      WHERE activity_date < ?
    `).bind(today).run();

    console.log(`[resetDailyTables] Maintenance complete for ${today}`);
    return { success: true };

  } catch (e) {
    console.error('[resetDailyTables] Critical Error:', e);
    return { success: false, error: e.message };
  }
}
