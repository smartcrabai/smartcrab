+++
title = "Chat"
description = "Chat spec — ChatClient and ChatGateway traits, Discord integration, test mocks"
weight = 6
+++

## Overview

SmartCrab provides two traits for chat platform integration:

- **`ChatClient`**: Sending side — post messages to a channel
- **`ChatGateway`**: Receiving side — connect to a platform's real-time event stream and dispatch incoming messages to Graphs

## `ChatClient` Trait

```rust
#[async_trait]
pub trait ChatClient: Send + Sync + 'static {
    async fn send_message(&self, channel: &str, content: &str) -> Result<()>;
}
```

| Method | Description |
|--------|-------------|
| `send_message(channel, content)` | Sends `content` to the specified `channel` |

### Usage in an Output Node

```rust
struct DiscordNotifier {
    client: Arc<dyn ChatClient>,
}

#[async_trait]
impl OutputNode for DiscordNotifier {
    type Input = NotificationDto;

    async fn run(&self, input: Self::Input) -> Result<()> {
        self.client
            .send_message(&input.channel_id, &input.message)
            .await
    }
}
```

## `ChatGateway` Trait

```rust
#[async_trait]
pub trait ChatGateway: Send + Sync + 'static {
    fn platform(&self) -> &str;
    async fn run(&self, graphs: Vec<Arc<DirectedGraph>>) -> Result<()>;
}
```

| Method | Description |
|--------|-------------|
| `platform()` | Returns the platform identifier (e.g. `"discord"`, `"slack"`) |
| `run(graphs)` | Connects to the platform and dispatches incoming events to the registered Graphs |

## Built-in Implementation: Discord

### `DiscordClient`

Sends messages via the Discord REST API (`POST /channels/{id}/messages`).

```rust
let client = DiscordClient::new("BOT_TOKEN");
client.send_message("CHANNEL_ID", "Hello from SmartCrab!").await?;
```

It also provides `send_notification` as a convenience wrapper for `DiscordNotification`:

```rust
let notification = DiscordNotification {
    channel_id: "CHANNEL_ID".to_string(),
    content: "Hello!".to_string(),
};
client.send_notification(&notification).await?;
```

### Discord DTOs

| Type | Fields | Description |
|------|--------|-------------|
| `DiscordMessage` | `channel_id`, `author`, `content`, `is_mention`, `is_dm` | Incoming Discord message |
| `DiscordNotification` | `channel_id`, `content` | Outgoing Discord notification |

`DiscordMessage::stripped_content(bot_id)` returns the message content with the bot mention prefix removed.

## Test Mocks

### `MockChatClient`

Records all sent messages in memory for assertion in tests.

```rust
let mock = MockChatClient::new();
let client: Arc<dyn ChatClient> = Arc::new(mock.clone());

// ... run the graph ...

let sent = mock.sent_messages();
assert_eq!(sent[0], ("general".to_string(), "Hello!".to_string()));
```

`sent_messages()` returns a `Vec<(channel, content)>` of all messages sent.

### `MockChatGateway`

Immediately runs all registered Graphs once without connecting to an external platform. Useful for integration tests.

```rust
let gateway = MockChatGateway::new("discord");
gateway.run(vec![Arc::new(graph)]).await?;
```
