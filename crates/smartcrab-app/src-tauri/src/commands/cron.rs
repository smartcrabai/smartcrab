use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppError;

/// A scheduled cron job linked to a pipeline.
#[derive(Debug, Clone, Serialize)]
pub struct CronJob {
    pub id: String,
    pub pipeline_id: String,
    pub schedule: String,
    pub is_active: bool,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Validate a cron expression using the `cron` crate.
fn validate_schedule(schedule: &str) -> Result<(), AppError> {
    schedule
        .parse::<cron::Schedule>()
        .map_err(|e| AppError::InvalidInput(format!("invalid cron expression: {e}")))?;
    Ok(())
}

/// List all cron jobs.
///
/// # Errors
///
/// Returns [`AppError`] if the database lock is poisoned or the query fails.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State must be passed by value"
)]
pub fn list_cron_jobs(db: State<'_, DbState>) -> Result<Vec<CronJob>, AppError> {
    let conn = db.lock()?;
    list_cron_jobs_db(&conn)
}

/// Create a new cron job for the given pipeline.
///
/// # Errors
///
/// Returns [`AppError::InvalidInput`] if the schedule expression is invalid, or
/// [`AppError`] for database failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn create_cron_job(
    db: State<'_, DbState>,
    pipeline_id: String,
    schedule: String,
) -> Result<CronJob, AppError> {
    let conn = db.lock()?;
    create_cron_job_db(&conn, &pipeline_id, &schedule)
}

/// Update an existing cron job's schedule and/or active state.
///
/// # Errors
///
/// Returns [`AppError::InvalidInput`] if the new schedule is invalid, or
/// [`AppError`] for database failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn update_cron_job(
    db: State<'_, DbState>,
    id: String,
    schedule: Option<String>,
    is_active: Option<bool>,
) -> Result<CronJob, AppError> {
    let conn = db.lock()?;
    update_cron_job_db(&conn, &id, schedule.as_deref(), is_active)
}

/// Delete a cron job by id.
///
/// # Errors
///
/// Returns [`AppError::NotFound`] if no job with the given id exists, or
/// [`AppError`] for database failures.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri State and command args must be owned"
)]
pub fn delete_cron_job(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.lock()?;
    delete_cron_job_db(&conn, &id)
}

// ---------------------------------------------------------------------------
// Standalone helpers (no Tauri State) used by tests
// ---------------------------------------------------------------------------

pub(crate) fn list_cron_jobs_db(conn: &rusqlite::Connection) -> Result<Vec<CronJob>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, pipeline_id, schedule, is_active, last_run_at, next_run_at, created_at, updated_at
         FROM cron_jobs
         ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(CronJob {
            id: row.get(0)?,
            pipeline_id: row.get(1)?,
            schedule: row.get(2)?,
            is_active: row.get::<_, i32>(3)? != 0,
            last_run_at: row.get(4)?,
            next_run_at: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row?);
    }
    Ok(jobs)
}

pub(crate) fn create_cron_job_db(
    conn: &rusqlite::Connection,
    pipeline_id: &str,
    schedule: &str,
) -> Result<CronJob, AppError> {
    validate_schedule(schedule)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO cron_jobs (id, pipeline_id, schedule, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        rusqlite::params![id, pipeline_id, schedule, now],
    )?;
    let job = CronJob {
        id,
        pipeline_id: pipeline_id.to_owned(),
        schedule: schedule.to_owned(),
        is_active: true,
        last_run_at: None,
        next_run_at: None,
        created_at: now.clone(),
        updated_at: now,
    };
    Ok(job)
}

pub(crate) fn update_cron_job_db(
    conn: &rusqlite::Connection,
    id: &str,
    schedule: Option<&str>,
    is_active: Option<bool>,
) -> Result<CronJob, AppError> {
    if let Some(s) = schedule {
        validate_schedule(s)?;
    }
    let now = chrono::Utc::now().to_rfc3339();
    match (schedule, is_active) {
        (Some(s), Some(active)) => {
            conn.execute(
                "UPDATE cron_jobs SET schedule = ?1, is_active = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![s, i32::from(active), now, id],
            )?;
        }
        (Some(s), None) => {
            conn.execute(
                "UPDATE cron_jobs SET schedule = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![s, now, id],
            )?;
        }
        (None, Some(active)) => {
            conn.execute(
                "UPDATE cron_jobs SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![i32::from(active), now, id],
            )?;
        }
        (None, None) => {}
    }
    let mut stmt = conn.prepare(
        "SELECT id, pipeline_id, schedule, is_active, last_run_at, next_run_at, created_at, updated_at
         FROM cron_jobs WHERE id = ?1",
    )?;
    stmt.query_row([id], |row| {
        Ok(CronJob {
            id: row.get(0)?,
            pipeline_id: row.get(1)?,
            schedule: row.get(2)?,
            is_active: row.get::<_, i32>(3)? != 0,
            last_run_at: row.get(4)?,
            next_run_at: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })
    .map_err(|_| AppError::NotFound(format!("cron job '{id}' not found")))
}

pub(crate) fn delete_cron_job_db(conn: &rusqlite::Connection, id: &str) -> Result<(), AppError> {
    let affected = conn.execute("DELETE FROM cron_jobs WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("cron job '{id}' not found")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_db;

    #[test]
    fn list_cron_jobs_empty() {
        let conn = test_db();
        let jobs = list_cron_jobs_db(&conn).unwrap_or_else(|e| panic!("should succeed: {e}"));
        assert!(jobs.is_empty());
    }

    #[test]
    fn create_cron_job_valid_schedule() {
        let conn = test_db();
        let job = create_cron_job_db(&conn, "pipeline-1", "0 * * * * *")
            .unwrap_or_else(|e| panic!("should create job: {e}"));
        assert_eq!(job.pipeline_id, "pipeline-1");
        assert_eq!(job.schedule, "0 * * * * *");
        assert!(job.is_active);
    }

    #[test]
    fn create_cron_job_invalid_schedule() {
        let conn = test_db();
        // "* * * * * MON,TURTLE" -- TURTLE is not a valid day name; confirmed
        // invalid via the cron crate's own test suite (test_nom_invalid_days_of_week_list).
        let result = create_cron_job_db(&conn, "pipeline-1", "* * * * * MON,TURTLE");
        assert!(result.is_err());
        let Err(err) = result else {
            panic!("should be InvalidInput")
        };
        assert!(err.to_string().contains("invalid cron expression"));
    }

    #[test]
    fn update_cron_job_schedule() {
        let conn = test_db();
        let job = create_cron_job_db(&conn, "pipeline-1", "0 * * * * *")
            .unwrap_or_else(|e| panic!("should create job: {e}"));
        let updated = update_cron_job_db(&conn, &job.id, Some("0 0 * * * *"), None)
            .unwrap_or_else(|e| panic!("should update: {e}"));
        assert_eq!(updated.schedule, "0 0 * * * *");
        assert!(updated.is_active);
    }

    #[test]
    fn update_cron_job_active_state() {
        let conn = test_db();
        let job = create_cron_job_db(&conn, "pipeline-1", "0 * * * * *")
            .unwrap_or_else(|e| panic!("should create job: {e}"));
        let updated = update_cron_job_db(&conn, &job.id, None, Some(false))
            .unwrap_or_else(|e| panic!("should update: {e}"));
        assert!(!updated.is_active);
    }

    #[test]
    fn delete_cron_job_removes_it() {
        let conn = test_db();
        let job = create_cron_job_db(&conn, "pipeline-1", "0 * * * * *")
            .unwrap_or_else(|e| panic!("should create job: {e}"));
        delete_cron_job_db(&conn, &job.id).unwrap_or_else(|e| panic!("should delete: {e}"));
        let jobs = list_cron_jobs_db(&conn).unwrap_or_else(|e| panic!("should list: {e}"));
        assert!(jobs.is_empty());
    }

    #[test]
    fn delete_cron_job_not_found() {
        let conn = test_db();
        let result = delete_cron_job_db(&conn, "nonexistent-id");
        assert!(result.is_err());
    }
}
