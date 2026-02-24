use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::ChatClient;
use crate::error::{Result, SmartCrabError};

/// A Discord message received from a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordMessage {
    pub channel_id: String,
    pub author: String,
    pub content: String,
    pub is_mention: bool,
    pub is_dm: bool,
}

/// A notification to be sent to a Discord channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordNotification {
    pub channel_id: String,
    pub content: String,
}

impl DiscordMessage {
    /// Extract the actual message content, stripping the bot mention prefix.
    pub fn stripped_content(&self, bot_id: &str) -> String {
        let mention_pattern = format!("<@{bot_id}>");
        self.content.replace(&mention_pattern, "").trim().to_owned()
    }
}

/// Discord REST API client.
///
/// Sends messages via the Discord REST API (`POST /channels/{id}/messages`).
pub struct DiscordClient {
    token: String,
    http: reqwest::Client,
}

impl DiscordClient {
    /// Create a new client with the given bot token.
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            http: reqwest::Client::new(),
        }
    }

    /// Send a notification (convenience wrapper around [`ChatClient::send_message`]).
    pub async fn send_notification(&self, notification: &DiscordNotification) -> Result<()> {
        self.send_message(&notification.channel_id, &notification.content)
            .await
    }
}

#[async_trait]
impl ChatClient for DiscordClient {
    async fn send_message(&self, channel: &str, content: &str) -> Result<()> {
        let url = format!("https://discord.com/api/v10/channels/{channel}/messages");
        let body = serde_json::json!({ "content": content });

        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bot {}", self.token))
            .json(&body)
            .send()
            .await
            .map_err(|e| SmartCrabError::Other(format!("Discord request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp
                .text()
                .await
                .unwrap_or_else(|_| "<failed to read body>".into());
            return Err(SmartCrabError::Other(format!(
                "Discord API error ({status}): {text}"
            )));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stripped_content() {
        let msg = DiscordMessage {
            channel_id: "123".into(),
            author: "user".into(),
            content: "<@BOT123> hello world".into(),
            is_mention: true,
            is_dm: false,
        };
        assert_eq!(msg.stripped_content("BOT123"), "hello world");
    }

    #[test]
    fn test_stripped_content_no_mention() {
        let msg = DiscordMessage {
            channel_id: "123".into(),
            author: "user".into(),
            content: "hello world".into(),
            is_mention: false,
            is_dm: true,
        };
        assert_eq!(msg.stripped_content("BOT123"), "hello world");
    }
}
