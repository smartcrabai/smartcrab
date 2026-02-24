use serde::{Deserialize, Serialize};

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
