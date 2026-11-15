-- Mizavo migration 53 (Nov 15, 2026): Aiden decided to delete the backup copies made before the Nov 7 and Nov 10
-- test-data wipes. Nothing reads them; test-period scores are no longer being wiped at launch.
drop table private.backup_20261107_session_rounds, private.backup_20261107_sessions, private.backup_20261107_solo_answers,
  private.backup_20261107_solo_games, private.backup_20261107_solo_scores, private.backup_20261107_viewer_scores,
  private.backup_20261110_solo_answers, private.backup_20261110_solo_days, private.backup_20261110_solo_games,
  private.backup_20261110_solo_scores;
