//! Integration tests for Discord REST API.
//!
//! These tests require the following environment variables:
//! - `DISCORD_BOT_TOKEN` — Bot token from Discord Developer Portal
//! - `DISCORD_TEST_CHANNEL_ID` — Channel ID where the bot can post
//!
//! Run with:
//!   DISCORD_BOT_TOKEN=xxx DISCORD_TEST_CHANNEL_ID=yyy \
//!     cargo test -p smartcrab --test integration_discord -- --ignored

use smartcrab::chat::ChatClient;
use smartcrab::chat::discord::{DiscordClient, DiscordNotification};

fn require_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("env var {name} is required for this test"))
}

fn make_client() -> (DiscordClient, String) {
    let token = require_env("DISCORD_BOT_TOKEN");
    let channel_id = require_env("DISCORD_TEST_CHANNEL_ID");
    (DiscordClient::new(token), channel_id)
}

#[tokio::test]
#[ignore]
async fn test_send_message() {
    let (client, channel_id) = make_client();

    client
        .send_message(&channel_id, "smartcrab integration test: send_message")
        .await
        .expect("send_message should succeed");
}

#[tokio::test]
#[ignore]
async fn test_send_notification() {
    let (client, channel_id) = make_client();

    let notification = DiscordNotification {
        channel_id: channel_id.clone(),
        content: "smartcrab integration test: send_notification".into(),
    };

    client
        .send_notification(&notification)
        .await
        .expect("send_notification should succeed");
}

#[tokio::test]
#[ignore]
async fn test_send_message_invalid_token() {
    let client = DiscordClient::new("invalid-token");

    let result = client
        .send_message("000000000000000000", "should fail")
        .await;

    assert!(result.is_err(), "Expected error with invalid token");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("Discord API error"),
        "Expected Discord API error, got: {err}"
    );
}

#[tokio::test]
#[ignore]
async fn test_send_message_invalid_channel() {
    let token = require_env("DISCORD_BOT_TOKEN");
    let client = DiscordClient::new(token);

    let result = client
        .send_message("000000000000000000", "should fail")
        .await;

    assert!(result.is_err(), "Expected error with invalid channel ID");
}
